#!/bin/bash
# Post-install setup for monorepo
# 1. Symlink next to root node_modules so eslint-config-next can resolve it
# 2. Download ffmpeg-kit xcframeworks for iOS builds

set -e

# Symlink next from apps/web to root node_modules for eslint-config-next resolution
if [ -d "apps/web/node_modules/next" ]; then
  echo "[postinstall] Symlinking next to root node_modules for eslint..."
  ln -sfn ../apps/web/node_modules/next node_modules/next
fi

ZIP_URL="https://github.com/jdarshan5/ffmpeg-kit-react-native/releases/download/rn-binaries/ffmpeg-full-gpl-6-0-2.zip"
MARKER_REL="ffmpegkit.xcframework/ios-arm64/ffmpegkit.framework/Headers/FFmpegKitConfig.h"

# パッケージの実体を探す。.npmrc の node-linker=hoisted が効いていれば root、
# isolated レイアウトになった場合は apps/mobile 側 (.pnpm への symlink) に居る。
# 決め打ちパスに mkdir -p すると、実体でないダミーに展開して静かに素通りし、
# ビルドが CocoaPods の 'ffmpegkit/FFmpegKitConfig.h' file not found で落ちる。
PKG_DIR=""
for candidate in \
  node_modules/ffmpeg-kit-react-native \
  apps/mobile/node_modules/ffmpeg-kit-react-native \
  node_modules/.pnpm/ffmpeg-kit-react-native@*/node_modules/ffmpeg-kit-react-native
do
  if [ -f "$candidate/ffmpeg-kit-react-native.podspec" ]; then
    PKG_DIR="$candidate"
    break
  fi
done

if [ -z "$PKG_DIR" ]; then
  echo "[ffmpeg-kit] ERROR: ffmpeg-kit-react-native package not found." >&2
  echo "[ffmpeg-kit] Searched root / apps/mobile / .pnpm store from $(pwd)." >&2
  exit 1
fi

FFMPEG_DIR="$PKG_DIR/bundle-apple-framework-ios"

# Skip if already extracted
if [ -f "$FFMPEG_DIR/$MARKER_REL" ]; then
  echo "[ffmpeg-kit] xcframeworks already present in $PKG_DIR, skipping download."
  exit 0
fi

echo "[ffmpeg-kit] Downloading xcframeworks..."
rm -f /tmp/ffmpeg-kit-*.zip
TMPZIP=$(mktemp /tmp/ffmpeg-kit-XXXXXX.zip)
curl -fL -o "$TMPZIP" "$ZIP_URL"

echo "[ffmpeg-kit] Extracting to $FFMPEG_DIR..."
mkdir -p "$FFMPEG_DIR"
unzip -o -q "$TMPZIP" -d "$FFMPEG_DIR"
rm -f "$TMPZIP"

# 展開結果を検証する。zip の中身の階層が変わっても気付けるようにする。
if [ ! -f "$FFMPEG_DIR/$MARKER_REL" ]; then
  echo "[ffmpeg-kit] ERROR: extraction finished but $MARKER_REL is missing." >&2
  echo "[ffmpeg-kit] Contents of $FFMPEG_DIR:" >&2
  ls -1 "$FFMPEG_DIR" >&2 || true
  exit 1
fi

echo "[ffmpeg-kit] Done ($PKG_DIR)."
