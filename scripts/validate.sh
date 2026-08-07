#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

python - <<'PY'
import xml.etree.ElementTree as ET
from pathlib import Path
files = [
    Path('plugins/org.example.dbeaver.echarts/plugin.xml'),
    Path('features/org.example.dbeaver.echarts.feature/feature.xml'),
    Path('plugins/org.example.dbeaver.echarts/.project'),
    Path('plugins/org.example.dbeaver.echarts/.classpath'),
    Path('features/org.example.dbeaver.echarts.feature/.project'),
]
for path in files:
    ET.parse(path)
    print(f'XML OK: {path}')
PY

if command -v node >/dev/null 2>&1; then
  node --check plugins/org.example.dbeaver.echarts/web/js/chart.js
  echo 'JavaScript OK: chart.js'
else
  echo 'SKIP: node is not installed'
fi

bash -n scripts/vendor-echarts.sh
echo 'Shell OK: vendor-echarts.sh'

if command -v javac >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  javac -d "$tmp" plugins/org.example.dbeaver.echarts/src/org/example/dbeaver/echarts/JsonWriter.java
  echo 'Java OK (standalone): JsonWriter.java'
  rm -rf "$tmp"
  trap - EXIT
else
  echo 'SKIP: javac is not installed'
fi

if grep -RInE 'https?://' plugins/org.example.dbeaver.echarts/web --exclude='echarts.min.js'; then
  echo 'ERROR: browser frontend contains a network URL' >&2
  exit 1
else
  echo 'Offline frontend OK: no HTTP(S) URLs in web/'
fi

if [[ -f plugins/org.example.dbeaver.echarts/web/js/echarts.min.js ]]; then
  if ! command -v git >/dev/null 2>&1; then
    echo 'ERROR: git is required to verify echarts.min.js' >&2
    exit 1
  fi
  expected='3b8ed4bcd17f7c838d86d4920af588f1a0aeb389'
  actual="$(git hash-object plugins/org.example.dbeaver.echarts/web/js/echarts.min.js)"
  [[ "$actual" == "$expected" ]] || {
    echo "ERROR: wrong ECharts blob: $actual" >&2
    exit 1
  }
  echo "ECharts OK: Git blob $actual"
else
  echo 'ECharts pending: run scripts/vendor-echarts.sh or vendor-echarts.ps1'
fi

for legal in \
  plugins/org.example.dbeaver.echarts/third-party/echarts/LICENSE \
  plugins/org.example.dbeaver.echarts/third-party/echarts/NOTICE \
  plugins/org.example.dbeaver.echarts/third-party/echarts/licenses/LICENSE-d3; do
  [[ -s "$legal" ]] || { echo "ERROR: missing $legal" >&2; exit 1; }
done
echo 'Third-party notices OK'
