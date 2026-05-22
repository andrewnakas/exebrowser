#!/usr/bin/env bash
# Regenerate the embedded Boxedwine runtime + small overlay zip from upstream.
# Run this if you want to refresh against a newer Boxedwine release.
# The big root zip (>25MB) stays out of public/ — it goes through the Worker.

set -euo pipefail

PUBLIC_DIR="$(cd "$(dirname "$0")/.." && pwd)/public"
RUNTIME_DIR="$PUBLIC_DIR/boxedwine/build/default"
APPS_DIR="$PUBLIC_DIR/boxedwine/apps"
UPSTREAM="https://www.boxedwine.org/boxedwine"

mkdir -p "$RUNTIME_DIR" "$APPS_DIR"

echo "Fetching Boxedwine runtime…"
for f in boxedwine.js boxedwine.wasm boxedwine-shell.js browserfs.boxedwine.js jszip.min.js; do
  curl -sSfL -o "$RUNTIME_DIR/$f" "$UPSTREAM/build/default/$f"
  printf "  %-30s %s bytes\n" "$f" "$(wc -c < "$RUNTIME_DIR/$f")"
done

echo "Fetching min-online overlay…"
curl -sSfL -o "$APPS_DIR/wine1.7.55-v8-min-online.zip" \
  "$UPSTREAM/apps/wine1.7.55-v8-min-online.zip"
printf "  %-30s %s bytes\n" "wine1.7.55-v8-min-online.zip" "$(wc -c < "$APPS_DIR/wine1.7.55-v8-min-online.zip")"

echo "Done."
