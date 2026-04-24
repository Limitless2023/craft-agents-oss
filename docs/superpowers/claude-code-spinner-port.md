# Feature: Claude Code 加载动画移植到 Craft Agents

> 将 Claude Code CLI 的 spinner 动画系统完整移植到 Craft Agents 的 GUI 环境，包括流光扫过文字、旋转字符、187 个随机动词、多种动画模式、卡住变红检测。

---

## 概览

Claude Code 的加载动画是其标志性 UI 特征之一——在终端环境中，通过旋转字符、流光高亮、呼吸光晕等多层动画，给用户"AI 正在认真工作"的反馈。本次移植将这套系统从 CLI/Ink 架构适配到 Electron/React DOM 环境，保留核心体验的同时做了 GUI 适配。

### 移植前 vs 移植后

| 方面 | 移植前 | 移植后 |
|------|--------|--------|
| 加载指示器 | 九宫格 CSS spinner + 固定文案循环 | Claude Code 风格旋转字符 + 流光文字 |
| 文案 | 固定 50 个短句（"Thinking..."、"Brewing..."） | 187 个 Claude Code 原版搞怪动词，每次 mode 切换随机换词 |
| 动画模式 | 无区分 | 4 种模式对应不同动画效果 |
| 异常反馈 | 无 | 3 秒无 token → 渐变到红色 |
| 颜色 | 灰色 | Claude 品牌橙 `rgb(215,119,87)` |

---

## 架构设计

### 三层改动

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Backend (事件发射)                      │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │ ClaudeAgent    │→│ ClaudeEventAdapter      │  │
│  │ yield          │  │ message_start → thinking│  │
│  │ 'requesting'   │  │ text_delta → responding │  │
│  │                │  │ tool_block → tool_use   │  │
│  └───────────────┘  └────────────────────────┘  │
│            ↓ AgentEvent: { type: 'agent_state' } │
│  ┌───────────────────────────────────────────┐  │
│  │ SessionManager.processEvent()              │  │
│  │ → sendEvent({ type: 'agent_state', ... })  │  │
│  └───────────────────────────────────────────┘  │
├─────────────────────────────────────────────────┤
│  Layer 2: Event Processing (状态存储)             │
│  ┌───────────────────────────────────────────┐  │
│  │ processor.ts → handleAgentState()          │  │
│  │ → session.agentState = event.state         │  │
│  │ → clear on complete/error/interrupted      │  │
│  └───────────────────────────────────────────┘  │
├─────────────────────────────────────────────────┤
│  Layer 3: UI Components (动画渲染)                │
│  ┌───────────────────────────────────────────┐  │
│  │ AgentSpinner                               │  │
│  │ ├── useAnimationLoop(50ms)                 │  │
│  │ ├── Spinner Glyph (·✢✳✶✻✽)              │  │
│  │ ├── GlimmerText (CSS gradient clip)        │  │
│  │ ├── Stalled Detection (3s → red)           │  │
│  │ └── Random Verb (187 words)                │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 数据流

```
用户发送消息
    ↓
ClaudeAgent.chat() → yield { type: 'agent_state', state: 'requesting' }
    ↓
SDK message_start → adapter emit { type: 'agent_state', state: 'thinking' }
    ↓
SDK text_delta (first) → adapter emit { type: 'agent_state', state: 'responding' }
    ↓
SDK content_block_start (tool_use) → adapter emit { type: 'agent_state', state: 'tool_use' }
    ↓
SessionManager.processEvent() → sendEvent to renderer
    ↓
event-processor → session.agentState = 'tool_use'
    ↓
ChatDisplay reads session.agentState → <AgentSpinner mode="tool_use" />
    ↓
AgentSpinner renders: ✶ Flibbertigibbeting… 12s
```

---

## 四种动画模式

| 模式 | 触发时机 | 流光方向 | 流光速度 | 颜色 | 特殊效果 |
|------|---------|---------|---------|------|---------|
| `requesting` | `chat()` 被调用后 | 左→右 | 50ms/step | Claude 橙 | 无 |
| `thinking` | `message_start` 到达 | 右→左 | 200ms/step | 灰色 | 3 秒后正弦呼吸光晕 |
| `responding` | 第一个 `text_delta` | 右→左 | 200ms/step | Claude 橙 | 无 |
| `tool_use` | `content_block_start` | 右→左 | 200ms/step | Claude 橙 | 整句正弦脉冲 |

### 动画参数（来自 Claude Code 源码）

**旋转字符**：`·✢✳✶✻✽✻✶✳✢·`（正向+反向，呼吸感），120ms/帧

**流光效果**：CSS `background-clip: text` + `linear-gradient`，每 50ms 更新梯度位置

**Thinking 呼吸光晕**：
```ts
const THINKING_DELAY_MS = 3000    // 3 秒延迟
const THINKING_GLOW_PERIOD_S = 2  // 2 秒正弦周期
opacity = (Math.sin(elapsed * π * 2 / period) + 1) / 2
```

**卡住变红**：
```ts
// 3 秒无新 token → 开始变红，2 秒内渐变到全红
stalledIntensity = min((timeSinceLastToken - 3000) / 2000, 1)
// 指数平滑避免突变
smoothed += (target - smoothed) * 0.1
```

---

## 随机动词系统

### 设计原则（Claude Code Spinner.tsx:168-170）

```ts
// 优先级链
const displayMessage = overrideMessage   // 最高：系统强制（如 "Compacting…"）
  ?? currentTodo?.activeForm             // 次高：todo 的进行时描述
  ?? randomVerb                          // 最低：随机兜底
```

### 词表特征

- **187 个现在进行时动词**，完整复制自 Claude Code `spinnerVerbs.ts`
- **选词风格**：烹饪隐喻（Baking, Brewing, Sautéing）、自然现象（Crystallizing, Germinating）、搞怪词（Flibbertigibbeting, Discombobulating, Whatchamacalliting）、彩蛋（Clauding, Gitifying）
- **避免负面词**：没有 Failing、Crashing、Erroring
- **后缀**：使用 U+2026 单字符省略号 `…`，不是三个点 `...`

### 换词时机

每次 agent streaming state 切换时换一个新词：

```ts
const [randomVerb, setRandomVerb] = useState(pickVerb)
const prevModeRef = useRef(mode)
if (mode !== prevModeRef.current) {
  prevModeRef.current = mode
  setRandomVerb(pickVerb())  // mode 变 → 新词
}
```

这模拟了 Claude Code 中 spinner 在 API roundtrip 之间 unmount/remount 的行为。

---

## 颜色系统

所有颜色直接取自 Claude Code 源码 `src/utils/theme.ts`：

| 用途 | 颜色值 | 说明 |
|------|--------|------|
| Claude 橙（基础色） | `rgb(215, 119, 87)` | 主文字和 glyph 颜色 |
| Claude 橙高亮（流光） | `rgb(245, 149, 117)` | 流光扫过时的高亮色 |
| 卡住红 | `rgb(171, 43, 63)` | 3 秒无 token 后渐变目标 |
| Thinking 灰 | `rgb(153, 153, 153)` | thinking 模式基础色 |
| Thinking 灰高亮 | `rgb(185, 185, 185)` | thinking 呼吸光晕色 |

### CLI → GUI 适配

Claude Code 的 `background-clip: text` 在终端 Ink 中通过逐字符染色实现。在 DOM 中，我们使用 CSS 方案：

```css
.agent-glimmer-text {
  -webkit-background-clip: text !important;
  background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
}
```

动态梯度通过 inline style 的 `background: linear-gradient(...)` 设置，每 50ms 更新一次梯度中心位置。

---

## 文件清单

### 新增文件（4 个）

| 文件 | 作用 | 行数 |
|------|------|------|
| `packages/ui/.../AgentSpinner/AgentSpinner.tsx` | 主组件：glyph + glimmer + stalled + verbs | ~195 |
| `packages/ui/.../AgentSpinner/GlimmerText.tsx` | 流光文字（CSS gradient clip） | ~100 |
| `packages/ui/.../AgentSpinner/useAnimationLoop.ts` | 50ms 共享动画时钟 | ~28 |
| `packages/ui/.../AgentSpinner/index.ts` | Barrel 导出 | 3 |

### 修改文件（10 个）

| 文件 | 改动说明 |
|------|---------|
| `packages/core/src/types/message.ts` | 新增 `agent_state` 事件 + `AgentStreamState` 类型 |
| `packages/core/src/types/index.ts` | Re-export `AgentStreamState` |
| `packages/shared/src/agent/claude-agent.ts` | yield `'requesting'` state |
| `packages/shared/src/agent/backend/claude/event-adapter.ts` | Emit `thinking` / `responding` / `tool_use` |
| `packages/shared/src/protocol/dto.ts` | `SessionEvent` + `Session.agentState` |
| `packages/server-core/src/sessions/SessionManager.ts` | Forward `agent_state` 事件 |
| `apps/electron/src/renderer/event-processor/types.ts` | `AgentStateEvent` 接口 |
| `apps/electron/src/renderer/event-processor/processor.ts` | `agent_state` case 路由 |
| `apps/electron/src/renderer/event-processor/handlers/session.ts` | `handleAgentState` + 清理逻辑 |
| `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` | 用 `AgentSpinner` 替换 `ProcessingIndicator` |

### 总改动量

```
14 files changed, ~200 lines added, ~10 lines removed
4 new files created
```

---

## 与 Claude Code 源码的对应关系

| Craft Agents 文件 | 对应 Claude Code 源文件 |
|-------------------|----------------------|
| `AgentSpinner.tsx` | `Spinner.tsx` (SpinnerWithVerb) + `SpinnerAnimationRow.tsx` |
| `GlimmerText.tsx` | `GlimmerMessage.tsx` |
| `useAnimationLoop.ts` | `use-animation-frame.ts` |
| Stalled detection (内联) | `useStalledAnimation.ts` |
| Spinner chars (内联) | `utils.ts` (getDefaultCharacters) |
| Spinner verbs (内联) | `spinnerVerbs.ts` |
| Event adapter emissions | REPL.tsx `streamMode` + `setStreamMode` |

---

## 未来可扩展方向

1. **Todo 覆盖**：当 todo 系统接入后，`todo.activeForm`（如 "Refactoring auth flow"）应覆盖随机词
2. **完成动词**：8 个过去时动词（Baked, Brewed, Cooked...）+ `for ${seconds}s` 格式
3. **用户自定义词表**：支持 `append` / `replace` 两种模式，可在配置中自定义
4. **Dark/Light 主题适配**：当前颜色对暗色主题最优，亮色主题可进一步微调
5. **Reduced motion**：支持 `prefers-reduced-motion` 媒体查询，降级为静态指示器
