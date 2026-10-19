#!/bin/bash
# Builds Followthrough.app (Apple silicon + Intel) and a zip for GitHub Releases.
# Needs only the Xcode Command Line Tools and Node. Run from the repo root: ./mac/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p 'require("./scripts/config.json").version')
BUILD=$(date +%Y%m%d%H%M)
OUT=dist
APP="$OUT/Followthrough.app"

node scripts/build.mjs
rm -rf "$OUT" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$OUT/tmp"

# icon
swift mac/Sources/icon.swift "$OUT/tmp/AppIcon.iconset"
iconutil -c icns "$OUT/tmp/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"

# binary for both chip types
for ARCH in arm64 x86_64; do
  swiftc -O -target "$ARCH-apple-macos13.0" -o "$OUT/tmp/Followthrough-$ARCH" mac/Sources/main.swift \
    -framework AppKit -framework WebKit -framework Speech -framework AVFoundation -framework ServiceManagement
done
lipo -create "$OUT/tmp/Followthrough-arm64" "$OUT/tmp/Followthrough-x86_64" -output "$APP/Contents/MacOS/Followthrough"

sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" mac/Info.plist > "$APP/Contents/Info.plist"
cp -R mac/Resources/web "$APP/Contents/Resources/web"

# ad-hoc signature (free); a Developer ID signature removes the first-launch warning
codesign --force --deep --sign - "$APP"
(cd "$OUT" && ditto -c -k --keepParent Followthrough.app "Followthrough-$VERSION-mac.zip")
rm -rf "$OUT/tmp"
echo "Built $APP and $OUT/Followthrough-$VERSION-mac.zip"
