#!/bin/bash
set -e

APP_ROOT="/Applications/Craft Agents.app/Contents"
APP_DIST="$APP_ROOT/Resources/app/dist"
BUILD="/Users/limitless/Desktop/Projects/craft-agents-oss/apps/electron/dist"
PLIST="$APP_ROOT/Info.plist"

echo "=== Patching Craft Agents ==="

# --- Step 1: Replace main process bundle ---
echo "Replacing main.cjs..."
cp "$BUILD/main.cjs" "$APP_DIST/main.cjs"

# --- Step 2: Replace preload bundle ---
echo "Replacing bootstrap-preload.cjs..."
cp "$BUILD/bootstrap-preload.cjs" "$APP_DIST/bootstrap-preload.cjs"

# --- Step 3: Replace renderer bundles + index.html ---
echo "Replacing renderer bundles..."

# Remove old hashed files
for prefix in main- playground- sonner-; do
  rm -f "$APP_DIST/renderer/assets/${prefix}"*.js "$APP_DIST/renderer/assets/${prefix}"*.js.map
done

# Copy new builds
for prefix in main- playground- sonner-; do
  cp "$BUILD/renderer/assets/${prefix}"*.js "$APP_DIST/renderer/assets/" 2>/dev/null || true
  cp "$BUILD/renderer/assets/${prefix}"*.js.map "$APP_DIST/renderer/assets/" 2>/dev/null || true
done

# Copy index.html directly from build output (avoids fragile hash detection)
cp "$BUILD/renderer/index.html" "$APP_DIST/renderer/index.html"
echo "Renderer replaced (using build output index.html)"

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

# --- Step 6: Re-sign app (modifying Info.plist invalidates the original signature) ---
echo "Re-signing app (ad-hoc)..."
codesign --force --deep --sign - "/Applications/Craft Agents.app"

# --- Step 7: Re-register with Launch Services ---
echo "Registering with Launch Services..."
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "/Applications/Craft Agents.app"

echo ""
echo "=== Done! ==="
echo "Restart Craft Agents to apply changes."
echo "To set as default .md opener: right-click any .md → Get Info → Open With → Craft Agents → Change All"
