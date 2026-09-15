#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URI='https://raw.githubusercontent.com/apache/echarts-examples/gh-pages/public/data/asset/geo/world.json'
EXPECTED='049b334579e5a42d5d16c72d014d380e048e39fc1504049f212acb589484d2fa'
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl --fail --location --silent --show-error "$URI" --output "$TMP"
ACTUAL="$(sha256sum "$TMP" | awk '{print $1}')"
[[ "$ACTUAL" == "$EXPECTED" ]] || { echo "Unexpected world map hash: $ACTUAL" >&2; exit 1; }
{
  printf "(() => { 'use strict'; window.echarts.registerMap('world', "
  tr -d '\n\r' < "$TMP"
  printf "); })();\n"
} > "$ROOT/plugins/org.example.dbeaver.echarts/web/js/world-map.js"
echo "Vendored world map: $ACTUAL"
