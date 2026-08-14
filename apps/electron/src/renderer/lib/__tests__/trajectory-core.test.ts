/**
 * [INPUT]: 依赖 ../trajectory-core 的全部导出
 * [OUTPUT]: 轨迹解析的守护测试——slug 规则、注入块归因、工具/压缩识别、容错、汇总
 * [POS]: lib/__tests__ 下的纯函数测试。样本结构取自真实 transcript
 *        （~/.claude/projects/…/<sdkSessionId>.jsonl）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test'
import {
  buildTimeline,
  entryInRange,
  FULL_VIEWPORT,
  isFullViewport,
  makeInverseProjector,
  makeProjector,
  mergeTrajectory,
  parseSystemPromptSidecar,
  parseTrajectory,
  sdkProjectSlug,
  sdkTranscriptPath,
  summarizeRun,
  summarizeTools,
  summarizeTrajectory,
  systemPromptSidecarPath,
  panViewport,
  viewportScale,
  zoomViewport,
} from '../trajectory-core'

/** 造一段结构与真实 transcript 一致的样本：1 轮、2 次请求、1 个工具往返。 */
function sampleJsonl(): string {
  return [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-08-13T00:00:00.000Z',
      message: {
        content: [
          { type: 'text', text: '<session_state>\ns\n</session_state>' },
          { type: 'text', text: '跑一下 ls' },
        ],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-13T00:00:02.000Z',
      requestId: 'req_1',
      message: {
        model: 'claude-opus-5',
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } }],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-08-13T00:00:03.500Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'a.txt' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-13T00:00:05.000Z',
      requestId: 'req_2',
      message: {
        model: 'claude-opus-5',
        usage: { input_tokens: 12, output_tokens: 30, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 },
        content: [{ type: 'text', text: '只有 a.txt' }],
      },
    }),
  ].join('\n')
}

describe('sdkProjectSlug', () => {
  test('斜杠与点号都替换为连字符（点号会产生双连字符，实测规则）', () => {
    expect(sdkProjectSlug('/Users/me/.craft-agent/workspaces/w/sessions/s1')).toBe(
      '-Users-me--craft-agent-workspaces-w-sessions-s1'
    )
  })

  test('普通路径无点号时就是斜杠替换', () => {
    expect(sdkProjectSlug('/Users/me/code/proj')).toBe('-Users-me-code-proj')
  })
})

describe('sdkTranscriptPath', () => {
  test('展开 ~ 并拼出 transcript 路径', () => {
    expect(sdkTranscriptPath('/Users/me', '~/.craft-agent/s/x', 'abc-123')).toBe(
      '/Users/me/.claude/projects/-Users-me--craft-agent-s-x/abc-123.jsonl'
    )
  })

  test('缺 sdkCwd 或 sdkSessionId → null（会话尚未与 SDK 关联）', () => {
    expect(sdkTranscriptPath('/Users/me', undefined, 'abc')).toBeNull()
    expect(sdkTranscriptPath('/Users/me', '/tmp/x', undefined)).toBeNull()
  })
})

describe('parseTrajectory', () => {
  test('用户回合拆成注入块 + 真实输入，各归其源', () => {
    const jsonl = JSON.stringify({
      type: 'user',
      timestamp: '2026-08-13T00:00:00Z',
      message: {
        content: [
          { type: 'text', text: "**USER'S DATE AND TIME: Thursday**" },
          { type: 'text', text: '<session_state>\nsessionId: s1\n</session_state>' },
          { type: 'text', text: '<sources>\nActive: none\n</sources>' },
          { type: 'text', text: '帮我看下如何安装' },
        ],
      },
    })
    const out = parseTrajectory(jsonl)
    expect(out.map(e => [e.kind, e.source])).toEqual([
      ['injection', 'date-time'],
      ['injection', 'session_state'],
      ['injection', 'sources'],
      ['prompt', 'user'],
    ])
    expect(out[3]!.charCount).toBe('帮我看下如何安装'.length)
  })

  test('助手回合区分 thinking / 正文 / 工具调用', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: '先看看文档' },
          { type: 'text', text: '我来帮你安装' },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    })
    const out = parseTrajectory(jsonl)
    expect(out.map(e => e.kind)).toEqual(['thinking', 'reply', 'tool-call'])
    expect(out[2]!.source).toBe('Bash')
    expect(out[2]!.text).toContain('"command": "ls"')
  })

  test('工具结果以 user 角色回灌，仍归为 tool-result', () => {
    const jsonl = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'total 12' }] },
    })
    const out = parseTrajectory(jsonl)
    expect(out[0]!.kind).toBe('tool-result')
    expect(out[0]!.text).toBe('total 12')
  })

  test('压缩元数据还原为可读结论（craft 自己只留一句墓碑）', () => {
    const jsonl = JSON.stringify({
      type: 'system',
      compactMetadata: { trigger: 'manual', preTokens: 154480, postTokens: 9656, cumulativeDroppedTokens: 144824 },
    })
    const out = parseTrajectory(jsonl)
    expect(out[0]!.kind).toBe('compaction')
    expect(out[0]!.source).toBe('manual')
    expect(out[0]!.text).toContain('154480')
    expect(out[0]!.text).toContain('144824')
  })

  test('坏行跳过而非整体失败（transcript 可能正被追加，末行是半截）', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } }),
      '{"type":"assist',
      '',
    ].join('\n')
    const out = parseTrajectory(jsonl)
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toBe('hi')
  })
})

describe('summarizeTrajectory', () => {
  test('按大类聚合并算占比，注入块另按来源排行', () => {
    const entries = parseTrajectory(
      [
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              { type: 'text', text: '<sources>' + 'x'.repeat(90) + '</sources>' },
              { type: 'text', text: '短问题' },
            ],
          },
        }),
      ].join('\n')
    )
    const s = summarizeTrajectory(entries)
    expect(s.byKind[0]!.kind).toBe('injection')
    expect(s.byKind[0]!.share).toBeGreaterThan(0.9)
    expect(s.injections[0]!.source).toBe('sources')
    expect(s.compactions).toBe(0)
  })
})

describe('回合与步骤分组', () => {
  test('工具结果虽是 user 角色，但不开启新回合（否则每个工具都算一次提问）', () => {
    const out = parseTrajectory(sampleJsonl())
    expect(out.every(e => e.turn === 1)).toBe(true)
  })

  test('requestId 变化即进入下一步', () => {
    const out = parseTrajectory(sampleJsonl())
    expect(out.find(e => e.kind === 'tool-call')!.step).toBe(1)
    expect(out.find(e => e.kind === 'reply')!.step).toBe(2)
  })

  test('真实提问才翻页：第二条用户消息 → 第 2 轮', () => {
    const jsonl = [
      sampleJsonl(),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-08-13T00:00:09.000Z',
        message: { content: [{ type: 'text', text: '再来一次' }] },
      }),
    ].join('\n')
    const out = parseTrajectory(jsonl)
    expect(out[out.length - 1]!.turn).toBe(2)
  })
})

describe('工具配对', () => {
  test('结果按 tool_use_id 回填到调用行，并算出真实时长', () => {
    const call = parseTrajectory(sampleJsonl()).find(e => e.kind === 'tool-call')!
    expect(call.toolName).toBe('Bash')
    expect(call.resultText).toBe('a.txt')
    expect(call.durationMs).toBe(1500)
  })

  test('未配对的调用不留假时长（宁可显示 — 也不能编）', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-13T00:00:02.000Z',
      requestId: 'r',
      message: { content: [{ type: 'tool_use', id: 'tu_x', name: 'Bash', input: {} }] },
    })
    expect(parseTrajectory(jsonl)[0]!.durationMs).toBeUndefined()
  })
})

describe('buildTimeline', () => {
  test('三条泳道各就各位，工具段用调用→结果的真实区间', () => {
    const entries = parseTrajectory(sampleJsonl())
    const tl = buildTimeline(entries)
    const lanes = new Set(tl.segments.map(s => s.lane))
    expect(lanes).toEqual(new Set(['input', 'model', 'tools']))
    const tool = tl.segments.find(s => s.lane === 'tools')!
    expect(tool.endMs - tool.startMs).toBe(1500)
  })

  test('模型段从上一个事件结束算起——否则等待时间凭空消失', () => {
    const tl = buildTimeline(parseTrajectory(sampleJsonl()))
    const first = tl.segments.filter(s => s.lane === 'model').sort((a, b) => a.startMs - b.startMs)[0]!
    // 用户消息在 0s，第一次请求的块落在 2s，这 2 秒必须算进模型段
    expect(first.endMs - first.startMs).toBe(2000)
  })
})

describe('makeProjector', () => {
  test('duration 口径按真实时间线性映射', () => {
    const tl = buildTimeline(parseTrajectory(sampleJsonl()))
    const p = makeProjector(tl, 'duration')
    expect(p(tl.t0)).toBe(0)
    expect(p(tl.t1)).toBe(1)
    expect(p((tl.t0 + tl.t1) / 2)).toBeCloseTo(0.5, 5)
  })

  test('calls 口径下每一步各占等宽一格——快步慢步都看得见', () => {
    const tl = buildTimeline(parseTrajectory(sampleJsonl()))
    const p = makeProjector(tl, 'calls')
    expect(tl.steps).toHaveLength(2)
    // 两步 → 各占一半：第 1 步整段落在左半，第 2 步落在右半
    expect(p(tl.steps[0]!.startMs)).toBeLessThan(0.5)
    expect(p(tl.steps[0]!.endMs)).toBeLessThanOrEqual(0.5)
    expect(p(tl.steps[1]!.startMs)).toBeGreaterThan(0.5)
  })
})

describe('summarizeRun', () => {
  test('token 按 requestId 去重——同一请求的每个块都带同一份 usage', () => {
    const dup = [
      sampleJsonl(),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-13T00:00:05.500Z',
        requestId: 'req_2', // 与上一条同请求：usage 不得再累加一次
        message: {
          usage: { input_tokens: 12, output_tokens: 30, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 },
          content: [{ type: 'text', text: '补充一句' }],
        },
      }),
    ].join('\n')
    const entries = parseTrajectory(dup)
    const run = summarizeRun(entries, buildTimeline(entries))
    expect(run.outputTokens).toBe(50) // 20 + 30，而不是 20 + 30 + 30
    expect(run.steps).toBe(2)
    expect(run.turns).toBe(1)
  })

  test('缓存命中率 = 读缓存 /（读缓存 + 新建 + 未缓存输入）', () => {
    const entries = parseTrajectory(sampleJsonl())
    const run = summarizeRun(entries, buildTimeline(entries))
    expect(run.cacheHitRate).toBeCloseTo(300 / (300 + 5 + 22), 5)
  })
})

describe('第二档：系统提示词 sidecar', () => {
  test('路径拼在会话文件夹的 meta/ 下', () => {
    expect(systemPromptSidecarPath('/w/sessions/s1/')).toBe('/w/sessions/s1/meta/system-prompt.jsonl')
    expect(systemPromptSidecarPath(undefined)).toBeNull()
  })

  test('解析出 system-prompt 条目，缺 text 的行跳过', () => {
    const jsonl = [
      JSON.stringify({ timestamp: '2026-08-13T00:00:00.000Z', sha: 'a', chars: 3, text: 'abc' }),
      JSON.stringify({ timestamp: '2026-08-13T00:00:01.000Z', sha: 'b', chars: 0 }),
    ].join('\n')
    const out = parseSystemPromptSidecar(jsonl)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('system-prompt')
    expect(out[0]!.charCount).toBe(3)
  })

  test('一律置顶并重排 index（index 是 UI 的选中键，必须唯一连续）', () => {
    const main = parseTrajectory(sampleJsonl())
    const sp = parseSystemPromptSidecar(
      JSON.stringify({ timestamp: '2026-08-12T23:59:59.000Z', sha: 'a', text: 'SYS' })
    )
    const merged = mergeTrajectory(main, sp)
    expect(merged[0]!.kind).toBe('system-prompt')
    expect(merged).toHaveLength(main.length + 1)
    expect(merged.map(e => e.index)).toEqual(merged.map((_, i) => i))
  })

  test('晚于全部对话才记录下来的提示词，依然置顶——它是常量不是事件', () => {
    const main = parseTrajectory(sampleJsonl())
    const sp = parseSystemPromptSidecar(
      JSON.stringify({ timestamp: '2099-01-01T00:00:00.000Z', sha: 'z', text: 'SYS' })
    )
    expect(mergeTrajectory(main, sp)[0]!.kind).toBe('system-prompt')
  })

  test('主轨迹里的无时间戳条目不再把它拽走（初版的落位 bug）', () => {
    const main = parseTrajectory(
      [
        JSON.stringify({ type: 'last-prompt' }), // 真实 transcript 里就有这种无时间戳行
        sampleJsonl(),
      ].join('\n')
    )
    const sp = parseSystemPromptSidecar(
      JSON.stringify({ timestamp: '2026-08-14T08:16:00.000Z', sha: 'a', text: 'SYS' })
    )
    expect(mergeTrajectory(main, sp)[0]!.kind).toBe('system-prompt')
  })

  test('多个版本按记录顺序堆在顶部', () => {
    const main = parseTrajectory(sampleJsonl())
    const sp = parseSystemPromptSidecar(
      [
        JSON.stringify({ timestamp: '2026-08-13T00:00:00.000Z', sha: 'a', text: 'V1' }),
        JSON.stringify({ timestamp: '2026-08-14T00:00:00.000Z', sha: 'b', text: 'V2' }),
      ].join('\n')
    )
    const merged = mergeTrajectory(main, sp)
    expect(merged.slice(0, 2).map(e => e.text)).toEqual(['V1', 'V2'])
  })

  test('没有 sidecar 时原样返回，不做无谓拷贝', () => {
    const main = parseTrajectory(sampleJsonl())
    expect(mergeTrajectory(main, [])).toBe(main)
  })
})

describe('框选：makeInverseProjector 与 entryInRange', () => {
  test('duration 口径下与正向投影严格互逆', () => {
    const tl = buildTimeline(parseTrajectory(sampleJsonl()))
    const p = makeProjector(tl, 'duration')
    const inv = makeInverseProjector(tl, 'duration')
    for (const x of [0, 0.25, 0.5, 1]) expect(p(inv(x))).toBeCloseTo(x, 5)
  })

  test('calls 口径下也互逆——前提是每一步都有实际跨度', () => {
    // 专用样本：两步各含两个时刻，都是正宽度桶
    const jsonl = [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-08-13T00:00:00.000Z',
        message: { content: [{ type: 'text', text: 'go' }] },
      }),
      JSON.stringify({
        type: 'assistant', timestamp: '2026-08-13T00:00:01.000Z', requestId: 'r1',
        message: { content: [{ type: 'text', text: 'a' }] },
      }),
      JSON.stringify({
        type: 'assistant', timestamp: '2026-08-13T00:00:03.000Z', requestId: 'r2',
        message: { content: [{ type: 'text', text: 'b' }] },
      }),
      JSON.stringify({
        type: 'assistant', timestamp: '2026-08-13T00:00:06.000Z', requestId: 'r2',
        message: { content: [{ type: 'text', text: 'c' }] },
      }),
    ].join('\n')
    const tl = buildTimeline(parseTrajectory(jsonl))
    const p = makeProjector(tl, 'calls')
    const inv = makeInverseProjector(tl, 'calls')
    for (const x of [0.1, 0.5, 0.9]) expect(p(inv(x))).toBeCloseTo(x, 5)
  })

  test('零宽度的一步取槽位正中，而不是缩成左边缘一根线', () => {
    const tl = buildTimeline(parseTrajectory(sampleJsonl()))
    const p = makeProjector(tl, 'calls')
    // 第 2 步只有一个瞬时回复 → 桶零宽；它该落在自己那半格的正中（0.75）
    expect(tl.steps[1]!.startMs).toBe(tl.steps[1]!.endMs)
    expect(p(tl.steps[1]!.startMs)).toBeCloseTo(0.75, 5)
  })

  test('x=1 落在末桶右端而不是越界', () => {
    const tl = buildTimeline(parseTrajectory(sampleJsonl()))
    expect(makeInverseProjector(tl, 'calls')(1)).toBe(tl.steps[tl.steps.length - 1]!.endMs)
  })

  test('跨窗口边界的工具调用算在窗内——起点在窗前、结果落在窗内也是"这段发生的事"', () => {
    const call = parseTrajectory(sampleJsonl()).find(e => e.kind === 'tool-call')!
    const afterCallStarted = call.startMs! + 500
    expect(entryInRange(call, { startMs: afterCallStarted, endMs: afterCallStarted + 100 })).toBe(true)
  })

  test('无时间戳的条目一律算窗外，且无框选时全部算窗内', () => {
    const e = parseSystemPromptSidecar(JSON.stringify({ sha: 'a', text: 'SYS' }))[0]!
    expect(entryInRange(e, { startMs: 0, endMs: Infinity })).toBe(false)
    expect(entryInRange(e, null)).toBe(true)
  })
})

describe('视口缩放与平移', () => {
  test('定点缩放：光标下那个点缩放前后停在原地', () => {
    const v = zoomViewport(FULL_VIEWPORT, 4, 0.5)
    // 全景中点是轴空间 0.5，放大 4× 后仍应是视口中点
    expect(v.v0 + 0.5 * (v.v1 - v.v0)).toBeCloseTo(0.5, 6)
    expect(v.v1 - v.v0).toBeCloseTo(0.25, 6)
  })

  test('贴边缩放不越界，且跨度不被压扁', () => {
    const v = zoomViewport(FULL_VIEWPORT, 4, 0) // 锚在最左
    expect(v.v0).toBe(0)
    expect(v.v1 - v.v0).toBeCloseTo(0.25, 6)
    const r = zoomViewport(FULL_VIEWPORT, 4, 1) // 锚在最右
    expect(r.v1).toBeCloseTo(1, 6)
    expect(r.v1 - r.v0).toBeCloseTo(0.25, 6)
  })

  test('缩小到底就是全景，不会出现负坐标或超过 1', () => {
    const v = zoomViewport({ v0: 0.4, v1: 0.6 }, 0.01, 0.5)
    expect(v).toEqual({ v0: 0, v1: 1 })
    expect(isFullViewport(v)).toBe(true)
  })

  test('放大有上限（500×），否则浮点误差会把视口算没', () => {
    let v = FULL_VIEWPORT
    for (let i = 0; i < 50; i++) v = zoomViewport(v, 4, 0.5)
    expect(viewportScale(v)).toBeCloseTo(500, 0)
    expect(v.v1).toBeGreaterThan(v.v0)
  })

  test('平移到两端就停住，跨度始终不变', () => {
    const z = zoomViewport(FULL_VIEWPORT, 4, 0.5)
    const span = z.v1 - z.v0
    const left = panViewport(z, -99)
    expect(left.v0).toBe(0)
    expect(left.v1 - left.v0).toBeCloseTo(span, 6)
    const right = panViewport(z, 99)
    expect(right.v1).toBeCloseTo(1, 6)
    expect(right.v1 - right.v0).toBeCloseTo(span, 6)
  })
})

describe('summarizeTools', () => {
  /** 三次调用：Bash 两次（一次成功一次报错），WebFetch 一次且明显更慢。 */
  const jsonl = [
    JSON.stringify({
      type: 'assistant', timestamp: '2026-08-13T00:00:00.000Z', requestId: 'r1',
      message: { content: [
        { type: 'tool_use', id: 'a', name: 'Bash', input: {} },
        { type: 'tool_use', id: 'b', name: 'WebFetch', input: {} },
      ] },
    }),
    JSON.stringify({
      type: 'user', timestamp: '2026-08-13T00:00:01.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
    }),
    JSON.stringify({
      type: 'user', timestamp: '2026-08-13T00:00:10.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'b', content: 'slow' }] },
    }),
    JSON.stringify({
      type: 'assistant', timestamp: '2026-08-13T00:00:11.000Z', requestId: 'r2',
      message: { content: [{ type: 'tool_use', id: 'c', name: 'Bash', input: {} }] },
    }),
    JSON.stringify({
      type: 'user', timestamp: '2026-08-13T00:00:12.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'c', content: 'boom', is_error: true }] },
    }),
  ].join('\n')

  test('按总耗时降序——慢的排前面，而不是调用多的', () => {
    const stats = summarizeTools(parseTrajectory(jsonl))
    expect(stats.map(s => s.name)).toEqual(['WebFetch', 'Bash'])
    expect(stats[0]!.totalMs).toBe(10_000)
    expect(stats[1]!.totalMs).toBe(2000) // 1s + 1s，调用两次仍排在后面
  })

  test('失败次数单独计数', () => {
    const bash = summarizeTools(parseTrajectory(jsonl)).find(s => s.name === 'Bash')!
    expect(bash.calls).toBe(2)
    expect(bash.errors).toBe(1)
  })

  test('没配到结果的调用不按 0 计入耗时——否则慢工具会显得快', () => {
    const pending = JSON.stringify({
      type: 'assistant', timestamp: '2026-08-13T00:00:00.000Z', requestId: 'r',
      message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] },
    })
    const stat = summarizeTools(parseTrajectory(pending))[0]!
    expect(stat.calls).toBe(1)
    expect(stat.timedCalls).toBe(0)
    expect(stat.totalMs).toBe(0)
  })

  test('无工具调用时返回空数组（UI 据此整块隐藏）', () => {
    expect(summarizeTools(parseTrajectory(JSON.stringify({
      type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] },
    })))).toEqual([])
  })
})
