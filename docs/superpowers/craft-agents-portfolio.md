# 项目经历：Craft Agents 深度定制

## 一句话介绍

> 基于开源 AI Agent 桌面应用 Craft Agents 进行深度二次开发，在保持上游同步更新的前提下，独立完成了 **6 个跨全栈的特性开发**，涵盖 Electron 桌面端、React 前端、Node.js 后端、macOS 系统集成，代码改动覆盖 30+ 文件、1400+ 行。

---

## 项目背景

**Craft Agents** 是一款基于 Claude SDK 的 AI Agent 桌面应用（Electron），支持多 session、MCP 工具集成、多模态对话。我在官方开源版本基础上进行 fork 和定制开发，解决实际使用中的痛点，同时保持与上游版本的持续合并能力。

**技术栈**：Electron + React + TypeScript + Jotai + Tailwind CSS + Bun + Claude SDK

---

## Feature 1：Claude Code 加载动画移植

### 做了什么

将 Claude Code CLI 的标志性 spinner 动画系统完整移植到 GUI 环境，包括：
- **流光扫过文字**（Glimmer Sweep）：CSS `background-clip: text` + `linear-gradient` 实现流光效果
- **旋转字符动画**：`·✢✳✶✻✽` 正向+反向呼吸循环，120ms/帧
- **4 种 Agent 状态模式**：requesting（快速流光）→ thinking（灰色呼吸光晕）→ responding（橙色流光）→ tool_use（正弦脉冲）
- **187 个随机动词**：完整移植 Claude Code 的搞怪动词池，每次 mode 切换随机换词
- **卡住变红检测**：3 秒无 token → 指数平滑渐变到红色，工具执行时自动抑制

### 技术亮点

- **三层架构**：后端事件发射（`agent_state` 事件类型） → 事件处理层（存储到 session state） → UI 组件层（50ms 动画时钟驱动）
- **CSS-in-JS 适配**：Claude Code 用 Ink 终端逐字符染色，我改用 CSS `background-clip: text` + inline gradient，解决了 Electron Chromium 下 inline style `backgroundClip` 不生效的问题
- **性能设计**：动画组件（AgentSpinner）独立于父组件的渲染周期，50ms 时钟只驱动动画子树
- **14 个文件改动，~200 行代码**，跨 4 个 package（core、shared、server-core、ui）

### 技术难点

| 难点 | 解决方案 |
|------|---------|
| CLI 逐字符染色 → DOM 实现 | CSS `background-clip: text` + linear-gradient，每 50ms 更新梯度位置 |
| Electron 下 inline `backgroundClip` 不生效 | 拆分为 CSS class（`!important`）+ inline `background` gradient |
| 随机词在 turn 内不变但跨 turn 要变 | `useState(pickVerb)` + `useRef(mode)` 检测 mode 变化时换词 |
| 颜色在浅色背景偏红 | 从 Claude Code 源码精确提取 `rgb(215,119,87)` 等色值 |

---

## Feature 2：本地文件路径链接系统

### 做了什么

AI 消息中的本地文件路径（如 `/Users/foo/report.pdf`）从"无效链接"变成可点击操作：
- PDF → 系统默认应用打开
- 图片 → 应用内预览
- Markdown/代码 → 应用内渲染预览
- 文件夹 → Finder 打开
- 支持空格和 Unicode 路径编码（`%20`、中文路径）

### 技术亮点

- 修改了 Markdown 渲染层的链接识别逻辑（`link-target.ts`）和路由拦截器（`useLinkInterceptor.ts`）
- 文件类型路由：根据扩展名分发到不同的打开方式

---

## Feature 3：Working Directory 文件树浏览器

### 做了什么

在右侧边栏新增项目文件树浏览器：
- **懒加载目录树**：点击展开，不一次性加载整个项目
- **分栏设计**：Working Directory 树 + Session 文件列表，中间可拖动分隔
- **文件搜索**：⌘F 快速过滤文件名
- **侧边栏宽度可调**：拖拽调整右侧边栏宽度

### 技术亮点

- 新增 RPC channel（`list_directory`）实现 main → renderer 的目录列表通信
- `WorkingDirectoryTree` 组件：递归渲染 + 状态管理，175 行
- 侧边栏宽度通过 `localStorage` 持久化

---

## Feature 4：macOS Finder 文件关联

### 做了什么

双击 Finder 中的 `.md` 文件直接在 Craft Agents 中打开预览：
- 修改 `Info.plist` 注册 UTI（`net.daringfireball.markdown`）
- 通过 `app.on('open-file')` → IPC → renderer overlay 链路实现
- 支持冷启动场景（`pendingOpenFile` 队列）

### 技术亮点

- **patch-app.sh 自动化**：修改 Info.plist → ad-hoc re-sign → Launch Services 注册，一键完成
- 在 macOS 26 严格代码签名环境下找到了可行的 in-place patch 方案

---

## Feature 5：CLI Hooks 集成

### 做了什么

读取 `~/.claude/settings.json` 中配置的 hooks，在 agent 生命周期事件时触发外部脚本：
- 支持 PreToolUse、PostToolUse、Notification 等 hook 类型
- 完整的测试覆盖（109 行测试代码）

---

## Feature 6：持续上游同步

### 做了什么

维护了从 v0.7.4 到 v0.8.3 共 **10+ 个上游版本** 的合并，在每次合并中解决冲突，确保自定义功能不被覆盖：

```
v0.7.4 → v0.7.5 → ... → v0.8.0 → v0.8.1 → v0.8.2 → v0.8.3
    ↑ 自定义功能持续跟随上游更新，无功能回退
```

### 技术亮点

- 自定义改动尽量采用"末尾追加"和"新文件"策略，降低合并冲突概率
- 每次 merge 都有独立 commit（`merge: update to vX.Y.Z, resolve conflicts`）

---

## 项目数据

| 指标 | 数据 |
|------|------|
| 自定义 Feature | 6 个 |
| 代码改动 | 30+ 文件，1400+ 行 |
| 新增文件 | 10+ 个 |
| 跨 Package | 5 个（core, shared, server-core, ui, electron） |
| 上游合并 | 10+ 个版本 |
| 架构层级 | 全栈（Electron main + renderer + Node.js backend + React UI） |

---

## 面试话术参考

### 30 秒版

> 我基于开源 AI Agent 桌面应用 Craft Agents 做了深度二次开发。最有技术含量的是把 Claude Code 的加载动画系统从 CLI 移植到 GUI，涉及三层架构改动（后端事件 → 事件处理 → UI 动画），解决了 CSS background-clip 在 Electron 中不生效等适配问题。同时还做了本地文件链接、项目文件树、macOS 系统集成等功能，持续跟进了 10+ 个上游版本的合并。

### 追问"最有挑战的部分"

> Claude Code 的动画系统原本是用 React Ink（终端 UI）实现的，每个字符单独染色。移到浏览器 DOM 后，我用 CSS background-clip: text + linear-gradient 实现了相同的流光效果，但发现 Electron 的 Chromium 对 inline style 的 backgroundClip 支持有问题，最后用 CSS class + !important 解决。另外随机动词的换词时机也需要理解 Claude Code 的组件生命周期——它的 spinner 在工具执行间会 unmount/remount，我们的不会，所以我通过检测 mode 变化来模拟这个行为。

### 追问"为什么要 fork 而不是提 PR"

> 这些功能比较个性化（比如 macOS 文件关联、Claude Code 风格的 spinner），不一定符合上游的产品方向。Fork 让我可以自由实验，同时通过保持"追加式改动"的原则，确保每次上游更新都能低成本合并。事实上我已经跟随了 10+ 个版本的更新，没有一次合并导致功能回退。

### 追问"学到了什么"

> 三点：一是 **Electron 全栈开发**的实战经验——从 main process 的 IPC、到 renderer 的 React 状态管理、再到 macOS 系统级集成（Info.plist、代码签名）；二是 **阅读大型开源项目源码**的能力——Claude Code 的 spinner 系统分布在 10+ 个文件中，我通过分析文档完整理解了它的设计意图后才动手实现；三是 **可维护的 fork 策略**——如何在二次开发和上游同步之间找到平衡。
