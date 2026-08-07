#!/usr/bin/env bash
set -euo pipefail

VERSION="6.1.0"
EXPECTED_BLOB="3b8ed4bcd17f7c838d86d4920af588f1a0aeb389"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/plugins/org.example.dbeaver.echarts/web/js/echarts.min.js"
URL="https://raw.githubusercontent.com/apache/echarts/${VERSION}/dist/echarts.min.js"
TMP="${DEST}.tmp"

mkdir -p "$(dirname "$DEST")"
trap 'rm -f "$TMP"' EXIT

if command -v curl >/dev/null 2>&1; then
  curl --fail --location --silent --show-error "$URL" --output "$TMP"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP" "$URL"
else
  echo "curl or wget is required" >&2
  exit 2
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to verify the pinned Git blob hash" >&2
  exit 3
fi

ACTUAL_BLOB="$(git hash-object "$TMP")"
if [[ "$ACTUAL_BLOB" != "$EXPECTED_BLOB" ]]; then
  echo "ECharts integrity check failed" >&2
  echo "expected: $EXPECTED_BLOB" >&2
  echo "actual:   $ACTUAL_BLOB" >&2
  exit 4
fi

mv "$TMP" "$DEST"
trap - EXIT
printf 'Vendored Apache ECharts %s -> %s\n' "$VERSION" "$DEST"
