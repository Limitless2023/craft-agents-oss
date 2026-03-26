# Patching Guide — Craft Agents

在官方 Craft Agents app 上叠加自定义 feature 的完整流程与故障排查。

## 升级流程

官方发布新版后，按顺序执行：

```bash
# 1. 安装官方新版（从官网下载或自动更新）

# 2. 拉取上游代码 + 安装依赖
cd ~/Desktop/Projects/craft-agents-oss
git fetch origin && git merge origin/main
bun install

# 3. 构建 renderer（需代理则先 export proxy）
export https_proxy=http://127.0.0.1:7893
export http_proxy=http://127.0.0.1:7893
bun run --filter '@craft-agent/electron' build:renderer

# 4. 退出 Craft Agents → 打补丁 → 重启
osascript -e 'quit app "Craft Agents"' && sleep 1
bash patch-app.sh
open -a "Craft Agents"
```

## 已知故障与修复

### 1. App 无法启动 — `-600 procNotFound`

**症状**：`open -a "Craft Agents"` 报错 `NSOSStatusErrorDomain Code=-600`

**根因**：macOS 26 在 app bundle 上保留 `com.apple.provenance` 扩展属性（记录原始 notarized 签名来源）。ad-hoc 重签后 provenance 与新签名矛盾，Launch Services 拒绝启动。

**修复**：patch-app.sh 已包含 `xattr -cr` 清除 provenance。若仍失败，手动执行：

```bash
xattr -cr "/Applications/Craft Agents.app"
codesign --force --deep --sign - "/Applications/Craft Agents.app"
open -a "Craft Agents"
```

### 2. App 启动但白屏 / 加载卡住

**症状**：Electron 窗口出现但 renderer 空白。

**根因**：`index.html` 引用的 JS/CSS 带 content hash（如 `main-CRaTc9f9.js`），若 patch 脚本只复制部分前缀的文件，新 hash 文件缺失导致 404。

**修复**：patch-app.sh 已改为 `rsync -a --delete` 整目录同步 renderer。若仍白屏，检查构建是否成功：

```bash
# 确认 build 产物中 index.html 引用的文件都存在
grep -oE 'assets/[^"]+' apps/electron/dist/renderer/index.html | while read f; do
  [ -f "apps/electron/dist/renderer/$f" ] && echo "OK  $f" || echo "MISS $f"
done
```

### 3. Merge 冲突

上游更新可能与自定义 feature 冲突。冲突集中在：

| 文件 | 冲突原因 |
|------|----------|
| `apps/electron/src/renderer/components/app-shell/AppShell.tsx` | 右侧栏按钮 |
| `apps/electron/src/shared/types.ts` | `RightSidebarPanel` 类型 |
| `apps/electron/src/main/index.ts` | `open-file` 事件处理 |
| `packages/shared/src/protocol/channels.ts` | `system.OPEN_FILE` channel |

解决原则：保留自定义逻辑，适配上游新增的接口变更。

## patch-app.sh 做了什么

| 步骤 | 操作 | 为什么 |
|------|------|--------|
| 1 | 替换 `main.cjs` | 主进程 bundle，含 open-file 处理 |
| 2 | 替换 `bootstrap-preload.cjs` | preload 脚本 |
| 3 | rsync renderer/ | 所有前端资源一次性同步，避免漏文件 |
| 4 | 写入 Info.plist | .md 文件关联（仅首次） |
| 5 | `xattr -cr` | 清除 provenance，防止 macOS 26 拒绝启动 |
| 6 | ad-hoc codesign | 修改 bundle 后必须重签 |
| 7 | lsregister | 让 Finder 识别新的文件关联 |

## 设计约束

- **不能独立打包**：macOS 26 对 ad-hoc 签名的 Electron app 执行严格检查，独立打包后无法通过 Gatekeeper
- **每次官方更新后必须重新 patch**：官方更新会覆盖我们替换的文件
- **Info.plist 版本号不会更新**：plist 中的 `CFBundleShortVersionString` 仍为官方安装版本，实际运行代码版本以 git tag 为准
