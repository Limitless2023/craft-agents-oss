# Preview 面板 Follow-up（对齐聊天）— 设计

> 日期: 2026-07-02 · 分支: `feat/preview-followup` · 完整 spec→plan→SDD

## 目标
让右侧 **Preview 面板**（预览 .md 文件）也具备与聊天一致的 follow-up：在预览里选中文字 → ↳Follow-up 岛写备注 → 存为**持久高亮标注** → 出现在当前会话**同一个输入框**的 pending follow-up 列表 → 随下条消息一起发送给 AI；发送引用带**文件名**做出处。

## 范围
**纯 renderer**。不动后端（`sessionCommand` 会拒收非会话消息的标注 → 用渲染层 store）。复用现成的选区/岛/高亮 UI 组件与发送/拼接逻辑，新增一套按文件的标注存储 + 输入框收集接入。

## 关键复用与约束（来自代码探查）
- 选区→chip→岛→高亮 UI 已封装为 **`packages/ui/src/components/overlay/AnnotatableMarkdownDocument.tsx`**（props: `content / messageId / sessionId / annotations / onAddAnnotation / onRemoveAnnotation / onUpdateAnnotation / onOpenUrl / onOpenFile / isStreaming`）。门槛 `canAnnotateMessage` 要求非空 `messageId`。
- 数据模型 `AnnotationV1`（`@craft-agent/core`）：`target.source={sessionId,messageId}` + selectors（`text-position{start,end}` + `text-quote{exact,prefix,suffix}`）；备注在 `body[].note` 且镜像到 `meta.followUp{text,lastSentAt,lastSentText}`。选中文字可直接取 `text-quote.exact`。
- 发送/拼接：`formatFollowUpSection(pending, opts)`（`app-shell/ChatDisplay.follow-ups.ts`）只需 `{selectedText, note}`；`onSendMessage(sessionId, message, ...)`（AppShellContext，PreviewPanel 可取）。
- PreviewPanel 现状：`PreviewPanelContent` 有 `sessionId` + `activeTab.filePath`；内容 `<Markdown mode="minimal">`（`PreviewPanel.tsx:471-482`）；无 messageId/标注。聊天 pending 收集 `pendingFollowUpAnnotations`（`ChatDisplay.tsx:1083`）只扫 `session.messages`。

## 设计

### ① 身份约定
Preview 标注以 **`filePath` 充当 `messageId`**（每文件稳定唯一），`sessionId` = 当前聚焦会话。这样 `AnnotatableMarkdownDocument` + `AnnotationV1` 自洽，无需后端。

### ② 渲染层标注 store（新建）
`apps/electron/src/renderer/atoms/preview-annotations.ts`（仿 `atoms/sidebar-docs.ts` 的 jotai atomFamily + localStorage）：
- 状态：`atomFamily(sessionId → Record<filePath, AnnotationV1[]>)`，持久化键 `craft-preview-annotations:<sessionId>`。
- **纯 core**（拆到 `preview-annotations-core.ts`，bun test 覆盖）：
  - `addAnnotation(map, filePath, ann): Map` / `removeAnnotation(map, filePath, annId)` / `updateAnnotation(map, filePath, annId, patch)`
  - `markFollowUpSent(map, filePath, annId, sentText)`（写 `meta.followUp.lastSentAt/lastSentText`）
  - `collectPendingFollowUps(map): Array<{filePath, annotation}>`（有 note 且未发送的）
  - `isFollowUpSent(ann)`（复用 core 既有语义）
- Hooks：`usePreviewAnnotations(sessionId, filePath)` → `[AnnotationV1[], {add,remove,update}]`；`usePreviewPendingFollowUps(sessionId)` → 供输入框收集。

### ③ PreviewPanel 接入
`PreviewPanel.tsx` 非 diff 渲染分支把 `<Markdown>` 换成：
```tsx
<AnnotatableMarkdownDocument
  content={content}
  messageId={activeTab.filePath}
  sessionId={sessionId}
  annotations={annotations}         // usePreviewAnnotations(sessionId, filePath)
  onAddAnnotation={add}
  onRemoveAnnotation={remove}
  onUpdateAnnotation={update}
  onOpenUrl={(url) => window.electronAPI.openUrl(url)}
  onOpenFile={onOpenFile}
/>
```
（diff 模式仍用 UnifiedDiffViewer，不加标注。）

### ④ 输入框 pending + 发送（对齐聊天两步模型）
`ChatDisplay.tsx`：
- 扩展 `pendingFollowUpAnnotations`：在扫 `session.messages` 之外，**并入** `usePreviewPendingFollowUps(session.id)` 的条目，映射为同一形状并加 `source: { kind: 'preview', fileName }`（`fileName` = basename(filePath)）；`selectedText` 取标注 `text-quote.exact`。
- 提交 `handleSubmit`：`formatFollowUpSection` 照常拼接；提交后对 preview 条目调用 store 的 `markFollowUpSent`（对齐聊天对 message 标注的 `updateAnnotation` 标记）。

### ⑤ 发送格式（带文件名出处）
扩展 `formatFollowUpSection`（`ChatDisplay.follow-ups.ts`，纯函数、加单测）：pending 项可带可选 `sourceLabel`；有则引用行前缀加 `(文件名)`：
```
> [#1] (报告.md) {选中段落}
→ {备注}
```
聊天来的条目 `sourceLabel` 为空，输出不变（保持向后兼容 + 现有测试通过）。

### ⑥ 细节 / 边界
- **与聊天一致**：岛只做"Save"、不即时发（攒着随下条消息发）；高亮按文档编号；`isStreaming` 传 false（文件非流式）。
- **Save & Send** 暂不加（聊天版 `AnnotatableMarkdownDocument` 也没接），保持一致；需要再议。
- **pending chip 与标签页解耦**：标注按 filePath 存，关掉预览标签页后 pending 仍在、仍会随下条消息发送（对齐聊天 follow-up 的持久性）。
- **已知限制（记录）**：Preview 文件会被 agent 实时改写（2s 轮询刷新）；标注按字符偏移锚定，文件内容大改后高亮可能漂移/失锚。v1 接受此限制（text-quote 的 exact/prefix/suffix 提供有限再锚能力）；彻底再锚留后续。聊天不受此影响（消息不可变）。
- compact/diff 模式不介入。

### ⑦ 测试
- `preview-annotations-core.ts`：add/remove/update/markSent/collectPending/isFollowUpSent 纯逻辑 bun test。
- `formatFollowUpSection`：新增"带 sourceLabel"用例 + 保留原有无 label 行为。

### 打补丁
纯 renderer → `build:renderer` + `patch-app.sh`。

## 明确不做（YAGNI）
不做后端持久化/跨设备同步、不做标注再锚引擎、不做 Save&Send 即时发、不做 diff 模式标注、不做跨会话共享标注。

## 受影响文件
**新建**：`atoms/preview-annotations.ts`、`atoms/preview-annotations-core.ts`(+test)
**改**：`right-sidebar/PreviewPanel.tsx`、`app-shell/ChatDisplay.tsx`、`app-shell/ChatDisplay.follow-ups.ts`(+test)、docs
**复用不改**：`AnnotatableMarkdownDocument.tsx` 及其岛/高亮子组件、`onSendMessage`
