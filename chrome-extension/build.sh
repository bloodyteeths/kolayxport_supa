#!/usr/bin/env bash
# Package the KolayXport Chrome extension for the Chrome Web Store.
# Zips ONLY the files the manifest references (content scripts, service worker,
# popup + its local assets, icons, web-accessible resources) into
#   <repo>/dist/chrome-extension-v<version>.zip   (dist/ is gitignored)
# Usage: bash chrome-extension/build.sh
set -euo pipefail

EXT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$EXT_DIR/.." && pwd)"
OUT_DIR="$REPO_DIR/dist"

FILES="$(node "$EXT_DIR/build-files.js" "$EXT_DIR")"

VERSION="$(node -p "require('$EXT_DIR/manifest.json').version")"
OUT="$OUT_DIR/chrome-extension-v$VERSION.zip"

# Syntax-check every JS file that ships.
while IFS= read -r f; do
  case "$f" in *.js) node --check "$EXT_DIR/$f" ;; esac
done <<< "$FILES"

mkdir -p "$OUT_DIR"
rm -f "$OUT"
cd "$EXT_DIR"
# shellcheck disable=SC2086
echo "$FILES" | zip -q -X "$OUT" -@
echo "Built $OUT"
echo "$FILES" | sed 's/^/  /'
