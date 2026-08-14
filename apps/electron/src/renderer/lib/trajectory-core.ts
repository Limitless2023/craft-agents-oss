/**
 * [INPUT]: 无外部依赖（纯函数）
 * [OUTPUT]: sdkTranscriptPath（会话 → SDK transcript 路径）、parseTrajectory（jsonl → 分类条目，
 *          含回合/步骤分组与工具配对）、buildTimeline（三泳道时间轴段）、summarizeTrajectory
 *          （上下文构成）、summarizeRun（回合数/时长/token/缓存命中）、parseSystemPromptSidecar
 * [POS]: 「轨迹视图」的解析层。主数据源是 **Claude SDK 自己写的 transcript**
 *        （`~/.claude/projects/<slug>/<sdkSessionId>.jsonl`）——craft 的 session.jsonl
 *        是"对话当前样子"的快照（每轮全量重写、只有 9 种消息角色），而 SDK 那份是
 *        "模型实际收到了什么"：注入块逐块可见、压缩元数据完整、工具原始出入参俱全。
 *        我们不重复记录，只做读取与归因。
 *        补充源是 craft 自己写的 sidecar（`<会话>/meta/system-prompt.jsonl`）——SDK
 *        transcript 唯一缺的就是系统提示词，那一段由 craft 在建会话时拼装，只有它自己知道。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/**
 * 会话工作目录 → SDK 项目目录 slug。
 * 规则实测得出：路径分隔符与点号**都**替换为连字符
 * （`/Users/x/.craft-agent/…` → `-Users-x--craft-agent-…`，注意点号产生的双连字符）。
 * 只按斜杠替换会找不到文件——这是唯一容易踩错的地方。
 */
export function sdkProjectSlug(sdkCwd: string): string {
  return sdkCwd.replace(/[/.]/g, '-')
}

/** 会话头的 sdkCwd + sdkSessionId → transcript 绝对路径。缺任一字段返回 null。 */
export function sdkTranscriptPath(
  homeDir: string,
  sdkCwd: string | undefined,
  sdkSessionId: string | undefined,
): string | null {
  if (!sdkCwd || !sdkSessionId) return null
  const home = homeDir.replace(/\/$/, '')
  const absCwd = sdkCwd.startsWith('~') ? sdkCwd.replace(/^~/, home) : sdkCwd
  return `${home}/.claude/projects/${sdkProjectSlug(absCwd)}/${sdkSessionId}.jsonl`
}

/** 会话文件夹 → craft 自写的系统提示词 sidecar 路径（第二档数据源）。 */
export function systemPromptSidecarPath(sessionFolderPath: string | undefined): string | null {
  if (!sessionFolderPath) return null
  return `${sessionFolderPath.replace(/\/$/, '')}/meta/system-prompt.jsonl`
}

// ============================================================================
// 分类模型
// ============================================================================

/** 条目大类——决定 UI 分组与配色。 */
export type TrajectoryKind =
  | 'system-prompt' // craft 拼装的系统提示词（第二档：SDK transcript 里没有）
  | 'injection'   // 应用注入给模型的上下文块（你在界面上永远看不到的部分）
  | 'prompt'      // 用户真实输入
  | 'thinking'    // 模型推理
  | 'reply'       // 模型面向用户的回复
  | 'tool-call'   // 工具调用（含入参）
  | 'tool-result' // 工具返回
  | 'compaction'  // 上下文压缩
  | 'system'      // hook / 系统事件
  | 'other'

export interface TrajectoryEntry {
  index: number
  kind: TrajectoryKind
  /** 细分来源，如 session_state / sources / Bash / compact。UI 的"按来源筛选"依据。 */
  source: string
  /** 正文（工具调用为入参 JSON，压缩为摘要）。 */
  text: string
  charCount: number
  timestamp?: string
  /** 该条目在 transcript 中的原始行，供"查看原始 JSON"。 */
  raw: unknown

  // —— 分组与时序（DeepSeek 式时间轴所需）————————————————————————
  /** 1-based 回合号：一条真实用户输入开启一个回合。 */
  turn: number
  /** 1-based 步号：回合内每次 API 请求（requestId）算一步。 */
  step: number
  requestId?: string
  startMs?: number
  /** 工具调用配到结果后填入结果时刻；其余条目与 startMs 相同。 */
  endMs?: number
  durationMs?: number

  // —— 工具专属 ——————————————————————————————————————————————
  toolUseId?: string
  toolName?: string
  toolInput?: unknown
  /** 工具调用配对到的结果正文（列表里 `名字 {入参} → 结果` 的右半边）。 */
  resultText?: string
  resultIsError?: boolean

  // —— 助手专属 ——————————————————————————————————————————————
  model?: string
  usage?: TokenUsage
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

/** 注入块识别：靠内容特征而非位置——注入顺序会随版本变。 */
const INJECTION_PATTERNS: Array<{ test: RegExp; source: string }> = [
  { test: /^\*\*USER'S DATE AND TIME/i, source: 'date-time' },
  { test: /^<session_state>/, source: 'session_state' },
  { test: /^<sources>/, source: 'sources' },
  { test: /^<workspace_capabilities>/, source: 'workspace_capabilities' },
  { test: /^<working_directory>/, source: 'working_directory' },
  { test: /^<project_context_files>/, source: 'project_context_files' },
  { test: /^<system-reminder>/, source: 'system_reminder' },
]

function classifyUserBlock(text: string): { kind: TrajectoryKind; source: string } {
  const head = text.trimStart()
  for (const { test, source } of INJECTION_PATTERNS) {
    if (test.test(head)) return { kind: 'injection', source }
  }
  return { kind: 'prompt', source: 'user' }
}

function asText(block: unknown): string {
  if (typeof block === 'string') return block
  if (block && typeof block === 'object') {
    const b = block as Record<string, unknown>
    if (typeof b.text === 'string') return b.text
    if (typeof b.thinking === 'string') return b.thinking
  }
  return ''
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function readUsage(message: Record<string, unknown> | undefined): TokenUsage | undefined {
  const u = message?.usage as Record<string, unknown> | undefined
  if (!u) return undefined
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheCreation: num(u.cache_creation_input_tokens),
  }
}

/** 工具结果正文可能是字符串，也可能是 content 块数组。 */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content.map(b => asText(b)).filter(Boolean)
    if (parts.length) return parts.join('\n')
  }
  return JSON.stringify(content ?? '', null, 2)
}

/**
 * 解析 SDK transcript（JSONL）为分类条目。
 * 容错优先：单行解析失败跳过而不是整体失败——transcript 由外部进程写入，
 * 可能在读取瞬间正被追加（半行）。
 *
 * 分组规则（实测）：
 * - **回合**：出现"含非 tool_result 块的 user 行"即开启新回合——工具结果同样以
 *   user 角色回灌，必须排除，否则每个工具结果都会被当成一次新提问。
 * - **步**：同一次 API 请求的多个块共享 `requestId`，requestId 变化即进入下一步。
 */
export function parseTrajectory(jsonl: string): TrajectoryEntry[] {
  const entries: TrajectoryEntry[] = []
  let index = 0
  let turn = 0
  let step = 0
  let lastRequestId: string | undefined
  /** toolUseId → 该工具调用在 entries 中的下标，用于回填结果。 */
  const pendingTools = new Map<string, number>()

  const push = (e: Omit<TrajectoryEntry, 'index' | 'charCount' | 'turn' | 'step'>) => {
    const startMs = e.timestamp ? Date.parse(e.timestamp) : undefined
    entries.push({
      ...e,
      index: index++,
      charCount: e.text.length,
      turn: Math.max(turn, 1),
      step: Math.max(step, 1),
      startMs: Number.isFinite(startMs) ? startMs : undefined,
      endMs: e.endMs ?? (Number.isFinite(startMs) ? startMs : undefined),
    })
    return entries.length - 1
  }

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    const timestamp = typeof row.timestamp === 'string' ? row.timestamp : undefined
    const type = row.type
    const message = row.message as Record<string, unknown> | undefined
    const requestId = typeof row.requestId === 'string' ? row.requestId : undefined

    // 压缩：SDK 把元数据和摘要都写全了（craft 自己只留一句"Compacted Conversation"）
    const compactMeta = row.compactMetadata as Record<string, unknown> | undefined
    if (compactMeta) {
      const pre = compactMeta.preTokens
      const post = compactMeta.postTokens
      const dropped = compactMeta.cumulativeDroppedTokens
      push({
        kind: 'compaction',
        source: String(compactMeta.trigger ?? 'compact'),
        text: `压缩前 ${pre} tokens → 压缩后 ${post} tokens（累计丢弃 ${dropped}）`,
        timestamp,
        raw: row,
      })
      continue
    }

    if (type === 'user') {
      const content = message?.content
      const blocks: unknown[] = Array.isArray(content) ? content : [content]
      const isRealPrompt = blocks.some(
        b => !(b && typeof b === 'object' && (b as Record<string, unknown>).type === 'tool_result'),
      )
      // 真实提问才翻页；工具结果虽然也是 user 角色，但属于当前回合
      if (isRealPrompt) {
        turn += 1
        step = 1
        lastRequestId = undefined
      }

      for (const block of blocks) {
        const b = block as Record<string, unknown> | undefined
        if (b?.type === 'tool_result') {
          const toolUseId = typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined
          const text = toolResultText(b.content)
          const isError = b.is_error === true
          const at = push({
            kind: 'tool-result',
            source: 'tool_result',
            text,
            timestamp,
            raw: block,
            toolUseId,
            resultIsError: isError,
          })
          // 回填到发起它的那次调用：列表一行即可读完"调了什么 → 得到什么"
          if (toolUseId && pendingTools.has(toolUseId)) {
            const callIdx = pendingTools.get(toolUseId)!
            const call = entries[callIdx]!
            const resultEnd = entries[at]!.startMs
            call.resultText = text
            call.resultIsError = isError
            call.endMs = resultEnd ?? call.endMs
            call.durationMs =
              call.startMs != null && resultEnd != null ? Math.max(0, resultEnd - call.startMs) : undefined
            entries[at]!.toolName = call.toolName
            pendingTools.delete(toolUseId)
          }
          continue
        }
        const text = asText(block)
        if (!text) continue
        const { kind, source } = classifyUserBlock(text)
        push({ kind, source, text, timestamp, raw: block })
      }
      continue
    }

    if (type === 'assistant') {
      if (turn === 0) turn = 1
      if (requestId && requestId !== lastRequestId) {
        // 同一回合内每次 API 请求算一步（首个请求即第 1 步）
        step = lastRequestId === undefined ? Math.max(step, 1) : step + 1
        lastRequestId = requestId
      }
      const usage = readUsage(message)
      const model = typeof message?.model === 'string' ? message.model : undefined
      const content = message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown> | undefined
          if (b?.type === 'tool_use') {
            const toolUseId = typeof b.id === 'string' ? b.id : undefined
            const name = typeof b.name === 'string' ? b.name : 'tool'
            const at = push({
              kind: 'tool-call',
              source: name,
              text: JSON.stringify(b.input ?? {}, null, 2),
              timestamp,
              raw: block,
              requestId,
              toolUseId,
              toolName: name,
              toolInput: b.input,
              model,
              // 只调工具、不说话的请求很常见——不挂 usage 会让这一步的 token 凭空消失
              usage,
            })
            if (toolUseId) pendingTools.set(toolUseId, at)
            continue
          }
          if (b?.type === 'thinking') {
            const text = asText(block)
            if (text) push({ kind: 'thinking', source: 'thinking', text, timestamp, raw: block, requestId, model, usage })
            continue
          }
          const text = asText(block)
          if (text) push({ kind: 'reply', source: 'assistant', text, timestamp, raw: block, requestId, model, usage })
        }
      }
      continue
    }

    if (type === 'system') {
      push({
        kind: 'system',
        source: typeof row.subtype === 'string' ? row.subtype : 'system',
        text: typeof row.content === 'string' ? row.content : JSON.stringify(row, null, 2).slice(0, 2000),
        timestamp,
        raw: row,
      })
      continue
    }

    // attachment / queue-operation / last-prompt 等：保留但归入 other，
    // 它们信息量低，UI 默认折叠这一类
    if (typeof type === 'string') {
      push({ kind: 'other', source: type, text: '', timestamp, raw: row })
    }
  }

  return entries
}

// ============================================================================
// 第二档：craft 自己拼装的系统提示词（SDK transcript 里没有的那一块）
// ============================================================================

/**
 * 解析 craft 写的 sidecar。每行 `{ timestamp, sha, chars, text, model?, tools? }`，
 * 只在内容变化时追加——所以行数 = 这个会话里系统提示词变过几个版本。
 * 返回按时间正序的条目，kind 固定 `system-prompt`。
 */
export function parseSystemPromptSidecar(jsonl: string): TrajectoryEntry[] {
  const out: TrajectoryEntry[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const text = typeof row.text === 'string' ? row.text : ''
    if (!text) continue
    const timestamp = typeof row.timestamp === 'string' ? row.timestamp : undefined
    const startMs = timestamp ? Date.parse(timestamp) : undefined
    out.push({
      index: -1 - out.length, // 负号占位，合并时统一重排
      kind: 'system-prompt',
      source: typeof row.source === 'string' ? row.source : 'craft-append',
      text,
      charCount: text.length,
      timestamp,
      raw: row,
      turn: 0,
      step: 0,
      startMs: Number.isFinite(startMs) ? startMs : undefined,
      endMs: Number.isFinite(startMs) ? startMs : undefined,
      model: typeof row.model === 'string' ? row.model : undefined,
    })
  }
  return out
}

/**
 * 系统提示词条目并入主轨迹：**一律置顶**，按记录先后排列。
 *
 * 刻意不按时间戳插到"记录的那一刻"：系统提示词是会话级的**常量配置**，不是某一刻
 * 发生的事件——它从第一个 token 起就在起作用，只是我们直到某轮才把它抄下来。
 * 按记录时刻插入会让它埋在对话中间，读者以为"这时候才加上的"，那是假信息。
 * （初版正是这么做的，还额外踩了个坑：transcript 里 `last-prompt` 之类的条目没有
 * 时间戳，"无时间戳即落位"的分支让它掉进了第 1 轮附近。）
 * 多个版本（改了偏好/换了模型导致提示词变化）按记录顺序堆在顶部，各自带自己的时间戳。
 */
export function mergeTrajectory(
  main: TrajectoryEntry[],
  systemPrompts: TrajectoryEntry[],
): TrajectoryEntry[] {
  if (!systemPrompts.length) return main
  // index 是 UI 的选中键与展开键，合并后必须唯一且连续
  return [...systemPrompts, ...main].map((e, i) => ({ ...e, index: i }))
}

// ============================================================================
// 时间轴：三条泳道（Input / Model / Tools）
// ============================================================================

export type Lane = 'input' | 'model' | 'tools'

export interface LaneSegment {
  lane: Lane
  /** 指向 entries 里的 index，点击即选中该条目。 */
  entryIndex: number
  startMs: number
  endMs: number
  turn: number
  step: number
  label: string
  isError?: boolean
}

export interface TimeSpan {
  turn: number
  step: number
  startMs: number
  endMs: number
}

export interface TrajectoryTimeline {
  segments: LaneSegment[]
  /** 每个回合的时间跨度，用于 Turns 轴模式与回合分隔。 */
  turns: Array<{ turn: number; startMs: number; endMs: number }>
  /** 每一步（一次 API 请求）的时间跨度，用于 Calls 轴模式。 */
  steps: TimeSpan[]
  t0: number
  t1: number
}

const MIN_SEGMENT_MS = 120 // 零时长事件（瞬时注入）也要看得见

/**
 * 由条目推导三条泳道。
 *
 * Model 段刻意从**上一个事件结束**算起而不是从首个块的时间戳算起：模型那段时间里
 * 我们只能看到"请求发出到第一个块落盘"的间隔，把它算进去才对得上体感耗时。
 * 这也是为什么 UI 必须写明"时长来自会话时间戳"——它含排队与网络往返，不是服务端计时。
 */
export function buildTimeline(entries: TrajectoryEntry[]): TrajectoryTimeline {
  const timed = entries.filter(e => e.startMs != null)
  if (!timed.length) return { segments: [], turns: [], steps: [], t0: 0, t1: 0 }

  const t0 = Math.min(...timed.map(e => e.startMs!))
  const t1 = Math.max(...timed.map(e => e.endMs ?? e.startMs!))
  const segments: LaneSegment[] = []

  // Input：用户输入与注入块 —— 瞬时事件，给最小可见宽度
  for (const e of timed) {
    if (e.kind !== 'prompt' && e.kind !== 'injection') continue
    segments.push({
      lane: 'input',
      entryIndex: e.index,
      startMs: e.startMs!,
      endMs: e.startMs! + MIN_SEGMENT_MS,
      turn: e.turn,
      step: e.step,
      label: e.source,
    })
  }

  // Model：按 requestId 聚合，起点回溯到上一个事件的结束
  const byRequest = new Map<string, TrajectoryEntry[]>()
  for (const e of timed) {
    if (!e.requestId) continue
    const list = byRequest.get(e.requestId) ?? []
    list.push(e)
    byRequest.set(e.requestId, list)
  }
  for (const [requestId, list] of byRequest) {
    const first = list[0]!
    const lastMs = Math.max(...list.map(e => e.startMs!))
    // 上一个事件（不含本请求自身的块）结束的时刻
    const prior = timed.filter(e => e.requestId !== requestId && (e.endMs ?? e.startMs!) <= first.startMs!)
    const priorEnd = prior.length ? Math.max(...prior.map(e => e.endMs ?? e.startMs!)) : first.startMs!
    segments.push({
      lane: 'model',
      entryIndex: first.index,
      startMs: priorEnd,
      endMs: Math.max(lastMs, priorEnd + MIN_SEGMENT_MS),
      turn: first.turn,
      step: first.step,
      label: first.model ?? 'model',
    })
  }

  // Tools：调用 → 结果的真实区间
  for (const e of timed) {
    if (e.kind !== 'tool-call') continue
    segments.push({
      lane: 'tools',
      entryIndex: e.index,
      startMs: e.startMs!,
      endMs: Math.max(e.endMs ?? e.startMs!, e.startMs! + MIN_SEGMENT_MS),
      turn: e.turn,
      step: e.step,
      label: e.toolName ?? e.source,
      isError: e.resultIsError,
    })
  }

  const turnMap = new Map<number, { startMs: number; endMs: number }>()
  for (const e of timed) {
    if (e.turn <= 0) continue
    const cur = turnMap.get(e.turn)
    const s = e.startMs!
    const en = e.endMs ?? s
    if (!cur) turnMap.set(e.turn, { startMs: s, endMs: en })
    else turnMap.set(e.turn, { startMs: Math.min(cur.startMs, s), endMs: Math.max(cur.endMs, en) })
  }

  const stepMap = new Map<string, TimeSpan>()
  for (const e of timed) {
    if (e.turn <= 0) continue
    const key = `${e.turn}/${e.step}`
    const s = e.startMs!
    const en = e.endMs ?? s
    const cur = stepMap.get(key)
    if (!cur) stepMap.set(key, { turn: e.turn, step: e.step, startMs: s, endMs: en })
    else {
      cur.startMs = Math.min(cur.startMs, s)
      cur.endMs = Math.max(cur.endMs, en)
    }
  }

  return {
    segments: segments.sort((a, b) => a.startMs - b.startMs),
    turns: [...turnMap.entries()].map(([turn, v]) => ({ turn, ...v })).sort((a, b) => a.turn - b.turn),
    steps: [...stepMap.values()].sort((a, b) => a.turn - b.turn || a.step - b.step),
    t0,
    t1,
  }
}

/** 时间轴 x 轴口径。 */
export type AxisMode = 'duration' | 'turns' | 'calls'

/**
 * 生成"时刻 → [0,1] 横坐标"的投影函数。
 *
 * 三种口径解决同一个矛盾：真实时长下一次 40 秒的模型生成会把十几个毫秒级工具挤成一根线，
 * 而等宽口径又看不出谁慢。所以让用户切：
 * - duration：按真实时间，看**耗时都花在哪**
 * - turns：每个回合等宽，看**每轮内部的结构**
 * - calls：每一步等宽，看**步骤序列**
 */
export function makeProjector(
  timeline: TrajectoryTimeline,
  mode: AxisMode,
): (ms: number) => number {
  const { t0, t1 } = timeline
  const span = Math.max(1, t1 - t0)
  if (mode === 'duration') return (ms: number) => clamp01((ms - t0) / span)

  const buckets: Array<{ startMs: number; endMs: number }> =
    mode === 'turns'
      ? timeline.turns.map(t => ({ startMs: t.startMs, endMs: t.endMs }))
      : timeline.steps.map(s => ({ startMs: s.startMs, endMs: s.endMs }))
  if (!buckets.length) return (ms: number) => clamp01((ms - t0) / span)

  const width = 1 / buckets.length
  return (ms: number) => {
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i]!
      if (ms < b.startMs) return clamp01(i * width) // 落在桶之间的空隙 → 贴到下个桶起点
      if (ms <= b.endMs) {
        // 零宽度桶（一步里只有一个瞬时事件）取槽位正中：贴左缘会让它缩成一根线，
        // 等宽口径分给它的那一格就白分了。居中是诚实的——瞬时事件本就该是个点而非条。
        const inner = b.endMs > b.startMs ? (ms - b.startMs) / (b.endMs - b.startMs) : 0.5
        return clamp01((i + inner) * width)
      }
    }
    return 1
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * `makeProjector` 的逆：横坐标 [0,1] → 时刻。框选需要它——手上只有像素位置，
 * 要换算成时间窗口才能圈出条目。三种口径各自可逆，桶内按比例还原。
 */
export function makeInverseProjector(
  timeline: TrajectoryTimeline,
  mode: AxisMode,
): (x: number) => number {
  const { t0, t1 } = timeline
  const span = Math.max(1, t1 - t0)
  if (mode === 'duration') return (x: number) => t0 + clamp01(x) * span

  const buckets: Array<{ startMs: number; endMs: number }> =
    mode === 'turns'
      ? timeline.turns.map(t => ({ startMs: t.startMs, endMs: t.endMs }))
      : timeline.steps.map(s => ({ startMs: s.startMs, endMs: s.endMs }))
  if (!buckets.length) return (x: number) => t0 + clamp01(x) * span

  return (x: number) => {
    const scaled = clamp01(x) * buckets.length
    // x=1 落在末桶右端而不是越界的下一桶
    const i = Math.min(buckets.length - 1, Math.floor(scaled))
    const b = buckets[i]!
    return b.startMs + (scaled - i) * (b.endMs - b.startMs)
  }
}

// ============================================================================
// 视口：时间轴的缩放与平移
// ============================================================================

/**
 * 可见区间，单位是**轴空间**（投影后的 [0,1]）而非时刻。
 * 选轴空间是关键：三种轴口径都已归一到 [0,1]，缩放逻辑因此对它们完全同构——
 * 若在时间维度上做缩放，`回合`/`步骤` 这两种等宽口径就得各写一套。
 */
export interface Viewport {
  v0: number
  v1: number
}

export const FULL_VIEWPORT: Viewport = { v0: 0, v1: 1 }

/** 最小可见跨度：500× 足够把百轮会话里的单独一步撑满整条轨道。 */
const MIN_VIEWPORT_SPAN = 1 / 500

/**
 * 以 anchor（视口内的相对位置，0=左缘 1=右缘）为定点缩放。
 * 定点缩放是"指哪放哪"的手感来源：光标下的那个点在缩放前后必须停在原地，
 * 否则每次滚轮都要重新找目标。
 */
export function zoomViewport(view: Viewport, factor: number, anchor: number): Viewport {
  const span = view.v1 - view.v0
  const nextSpan = Math.min(1, Math.max(MIN_VIEWPORT_SPAN, span / factor))
  const anchorAxis = view.v0 + clamp01(anchor) * span
  // 先按定点求起点，再整体推回 [0,1] 内——推动时保持跨度不变，否则边缘处会被压扁
  let v0 = anchorAxis - clamp01(anchor) * nextSpan
  v0 = Math.min(Math.max(v0, 0), 1 - nextSpan)
  return { v0, v1: v0 + nextSpan }
}

/** 平移。delta 以视口跨度为单位（+1 = 右移一整屏）。 */
export function panViewport(view: Viewport, delta: number): Viewport {
  const span = view.v1 - view.v0
  const v0 = Math.min(Math.max(view.v0 + delta * span, 0), 1 - span)
  return { v0, v1: v0 + span }
}

/** 当前放大倍数，用于读数条。 */
export function viewportScale(view: Viewport): number {
  return 1 / Math.max(view.v1 - view.v0, MIN_VIEWPORT_SPAN)
}

export function isFullViewport(view: Viewport): boolean {
  return view.v0 <= 0 && view.v1 >= 1
}

/** 时间窗口。框选的产物，null 表示未框选。 */
export interface TimeRange {
  startMs: number
  endMs: number
}

/** 条目是否落在窗口内。无时间戳的条目（如老 sidecar 记录）一律算窗外。 */
export function entryInRange(entry: TrajectoryEntry, range: TimeRange | null): boolean {
  if (!range) return true
  if (entry.startMs == null) return false
  // 用 endMs 兜住跨窗口边界的工具调用：起点在窗前但结果落在窗内，也算这段里发生的事
  const end = entry.endMs ?? entry.startMs
  return end >= range.startMs && entry.startMs <= range.endMs
}

// ============================================================================
// 统计
// ============================================================================

export interface TrajectorySummary {
  totalChars: number
  /** 按 kind 聚合的字符数与条目数，降序——回答"上下文都被什么占了"。 */
  byKind: Array<{ kind: TrajectoryKind; chars: number; count: number; share: number }>
  /** 注入块按来源聚合，降序——回答"哪个注入块最占地方"。 */
  injections: Array<{ source: string; chars: number; count: number }>
  compactions: number
}

export function summarizeTrajectory(entries: TrajectoryEntry[]): TrajectorySummary {
  const kindMap = new Map<TrajectoryKind, { chars: number; count: number }>()
  const injMap = new Map<string, { chars: number; count: number }>()
  let totalChars = 0

  for (const e of entries) {
    totalChars += e.charCount
    const k = kindMap.get(e.kind) ?? { chars: 0, count: 0 }
    kindMap.set(e.kind, { chars: k.chars + e.charCount, count: k.count + 1 })
    if (e.kind === 'injection') {
      const i = injMap.get(e.source) ?? { chars: 0, count: 0 }
      injMap.set(e.source, { chars: i.chars + e.charCount, count: i.count + 1 })
    }
  }

  return {
    totalChars,
    byKind: [...kindMap.entries()]
      .map(([kind, v]) => ({ kind, ...v, share: totalChars ? v.chars / totalChars : 0 }))
      .sort((a, b) => b.chars - a.chars),
    injections: [...injMap.entries()]
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.chars - a.chars),
    compactions: entries.filter(e => e.kind === 'compaction').length,
  }
}

export interface ToolStat {
  name: string
  /** 调用次数（含没配到结果的）。 */
  calls: number
  /** 配到结果、因而能计时的次数。与 calls 不等时说明有调用还没落结果。 */
  timedCalls: number
  totalMs: number
  errors: number
}

/**
 * 按工具聚合耗时，降序——回答"这个会话的时间被谁吃了"。
 *
 * 只累加**配到结果的**调用：没配对的调用没有结束时刻，按 0 计入会让慢工具显得快。
 * 因此 calls 与 timedCalls 分开报，UI 才能诚实地在数据不全时说"—"而不是"0.0s"。
 */
export function summarizeTools(entries: TrajectoryEntry[]): ToolStat[] {
  const map = new Map<string, ToolStat>()
  for (const e of entries) {
    if (e.kind !== 'tool-call') continue
    const name = e.toolName ?? e.source
    const stat = map.get(name) ?? { name, calls: 0, timedCalls: 0, totalMs: 0, errors: 0 }
    stat.calls += 1
    if (e.durationMs != null) {
      stat.timedCalls += 1
      stat.totalMs += e.durationMs
    }
    if (e.resultIsError) stat.errors += 1
    map.set(name, stat)
  }
  return [...map.values()].sort((a, b) => b.totalMs - a.totalMs || b.calls - a.calls)
}

export interface RunSummary {
  turns: number
  steps: number
  /** 模型段总时长（含排队与网络往返，见 buildTimeline 说明）。 */
  modelMs: number
  toolMs: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** 缓存命中率 = 读缓存 /（读缓存 + 新建缓存 + 未缓存输入）。 */
  cacheHitRate: number | null
}

/**
 * 底部统计条的数据。
 * **token 必须按 requestId 去重**——同一请求的每个块都带一份完全相同的 usage，
 * 逐块累加会把用量放大到块数倍（thinking + text + tool_use 常见 3 倍）。
 */
export function summarizeRun(entries: TrajectoryEntry[], timeline: TrajectoryTimeline): RunSummary {
  const perRequest = new Map<string, TokenUsage>()
  for (const e of entries) {
    if (!e.requestId || !e.usage) continue
    perRequest.set(e.requestId, e.usage)
  }
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheCreation = 0
  for (const u of perRequest.values()) {
    input += u.input
    output += u.output
    cacheRead += u.cacheRead
    cacheCreation += u.cacheCreation
  }
  const cacheDenom = cacheRead + cacheCreation + input

  const modelMs = timeline.segments
    .filter(s => s.lane === 'model')
    .reduce((sum, s) => sum + (s.endMs - s.startMs), 0)
  const toolSegs = timeline.segments.filter(s => s.lane === 'tools')

  return {
    turns: entries.reduce((m, e) => Math.max(m, e.turn), 0),
    steps: new Set(entries.map(e => e.requestId).filter(Boolean)).size,
    modelMs,
    toolMs: toolSegs.reduce((sum, s) => sum + (s.endMs - s.startMs), 0),
    toolCalls: toolSegs.length,
    inputTokens: input + cacheRead + cacheCreation,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheHitRate: cacheDenom > 0 ? cacheRead / cacheDenom : null,
  }
}

// ============================================================================
// 展示辅助
// ============================================================================

/** 毫秒 → 人读时长。轨迹里既有 9ms 的本地工具，也有 40s 的模型生成，需要分档。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`
}

/** 工具入参压成一行预览（列表里 `名字 {…}` 的中间那截）。 */
export function compactJson(value: unknown, max = 120): string {
  let s: string
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value ?? {})
  } catch {
    s = String(value)
  }
  s = s.replace(/\s+/g, ' ')
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** 大数字千分位——底部统计条与 token 列用。 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K`
  return String(n)
}
