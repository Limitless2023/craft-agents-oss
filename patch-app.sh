#!/bin/bash
set -e

APP_ROOT="/Applications/Craft Agents.app/Contents"
APP_DIST="$APP_ROOT/Resources/app/dist"
APP_PACKAGE_JSON="$APP_ROOT/Resources/app/package.json"
APP_NM_ANTHROPIC="$APP_ROOT/Resources/app/node_modules/@anthropic-ai"
BUILD="/Users/limitless/Desktop/Projects/craft-agents-oss/apps/electron/dist"
BUILD_PACKAGE_JSON="/Users/limitless/Desktop/Projects/craft-agents-oss/apps/electron/package.json"
REPO_NM_ANTHROPIC="/Users/limitless/Desktop/Projects/craft-agents-oss/node_modules/@anthropic-ai"
PLIST="$APP_ROOT/Info.plist"
APP_VERSION="$(node -p "require('$BUILD_PACKAGE_JSON').version")"

echo "=== Patching Craft Agents ==="

# --- Step 1: Replace main process bundle ---
echo "Replacing main.cjs..."
cp "$BUILD/main.cjs" "$APP_DIST/main.cjs"

# --- Step 2: Replace preload bundle ---
echo "Replacing bootstrap-preload.cjs..."
cp "$BUILD/bootstrap-preload.cjs" "$APP_DIST/bootstrap-preload.cjs"

# --- Step 3: Sync entire renderer directory ---
echo "Syncing renderer..."
rsync -a --delete "$BUILD/renderer/" "$APP_DIST/renderer/"
echo "Renderer synced"

# --- Step 4: Sync app metadata/version ---
echo "Syncing package.json..."
cp "$BUILD_PACKAGE_JSON" "$APP_PACKAGE_JSON"

# ===========================================================================
# Step 4.5: Sync Claude Agent SDK + native binary
# ---------------------------------------------------------------------------
# 自 SDK v0.2.x 起，native 可执行文件 `claude` 被拆到平台特定包
# `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` 中分发。
# 升级时若不同步这两个包，启动会抛
# "Claude Agent SDK native binary not found. The app package may be corrupted."
# ===========================================================================
echo "Syncing @anthropic-ai/claude-agent-sdk..."
mkdir -p "$APP_NM_ANTHROPIC"
rsync -a --delete "$REPO_NM_ANTHROPIC/claude-agent-sdk/" "$APP_NM_ANTHROPIC/claude-agent-sdk/"

# 确定当前架构对应的 binary 包（macOS only — Linux/Windows 走各自打包流程）
ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  arm64|aarch64) BINARY_PKG="claude-agent-sdk-darwin-arm64" ;;
  x86_64)        BINARY_PKG="claude-agent-sdk-darwin-x64"   ;;
  *)             BINARY_PKG="" ;;
esac

if [ -n "$BINARY_PKG" ] && [ -d "$REPO_NM_ANTHROPIC/$BINARY_PKG" ]; then
  echo "Syncing native binary package: $BINARY_PKG..."
  rsync -a --delete "$REPO_NM_ANTHROPIC/$BINARY_PKG/" "$APP_NM_ANTHROPIC/$BINARY_PKG/"
else
  echo "WARN: native binary package not found in repo node_modules — run 'bun install' first"
fi

echo "Setting app version to $APP_VERSION..."
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $APP_VERSION" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $APP_VERSION" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $APP_VERSION" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $APP_VERSION" "$PLIST"

# --- Step 5: Add .md file association to Info.plist ---
if ! /usr/libexec/PlistBuddy -c "Print :CFBundleDocumentTypes" "$PLIST" &>/dev/null; then
  echo "Adding markdown file association..."
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes array" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0 dict" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string 'Markdown Document'" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:0 string md" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:1 string mdx" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:2 string markdown" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string net.daringfireball.markdown" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:1 string public.plain-text" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSHandlerRank string Alternate" "$PLIST"
  echo "File association added"
else
  echo "File association already exists, skipping"
fi

# --- Step 6: Clear provenance + re-sign (macOS 26 blocks ad-hoc apps with stale provenance) ---
echo "Clearing provenance attributes..."
xattr -cr "/Applications/Craft Agents.app"

echo "Re-signing app (ad-hoc)..."
codesign --force --deep --sign - "/Applications/Craft Agents.app"

# --- Step 7: Re-register with Launch Services ---
echo "Registering with Launch Services..."
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "/Applications/Craft Agents.app"

echo ""
echo "=== Done! ==="
echo "Restart Craft Agents to apply changes."
echo "To set as default .md opener: right-click any .md → Get Info → Open With → Craft Agents → Change All"
