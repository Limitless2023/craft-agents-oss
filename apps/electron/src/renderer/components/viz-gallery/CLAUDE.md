# viz-gallery/

> L2 | 父级: apps/electron/src/renderer/components/../../../../CLAUDE.md（root，见 "Inline Interactive Visualization" 章节）

跨会话可视化资产画廊：扫描 workspace 根 + 各会话工作目录下的 `.craft/visualizations/*.html`（排除 `-standalone` 导出副本），以活缩略图网格展示，点击经 AppShellContext.onOpenFile 走链接拦截器 → VizPreviewOverlay 全屏。设计决策：扫描用现成 `fs:listFiles`（单层、目标目录内无点前缀条目，零新 IPC）；缩略图是半尺寸沙箱 iframe（pointer-events 关闭、不接主题桥、上限 60 个），交互与主题跟随留给全屏层。

成员清单
VizGalleryPage.tsx: 页面层（零 props 自取数据，Favorites 同款模板），含 VizThumbCard 活缩略图卡片
viz-gallery-core.ts: 纯逻辑（collectVizRoots 去重 / isGalleryVizFile 收录过滤 / entryDisplayName）
__tests__/viz-gallery-core.test.ts: 纯逻辑守护测试

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
