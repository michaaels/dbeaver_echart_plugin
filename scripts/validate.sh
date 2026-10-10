#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

python3 - <<'PY'
import re
import xml.etree.ElementTree as ET
from pathlib import Path
files = [
    Path('plugins/org.example.dbeaver.echarts/plugin.xml'),
    Path('features/org.example.dbeaver.echarts.feature/feature.xml'),
    Path('plugins/org.example.dbeaver.echarts/.project'),
    Path('plugins/org.example.dbeaver.echarts/.classpath'),
    Path('features/org.example.dbeaver.echarts.feature/.project'),
    Path('sites/org.example.dbeaver.echarts.site/.project'),
    Path('sites/org.example.dbeaver.echarts.site/category.xml'),
]
for path in files:
    ET.parse(path)
    print(f'XML OK: {path}')

feature_version = ET.parse('features/org.example.dbeaver.echarts.feature/feature.xml').getroot().get('version')
site_version = ET.parse('sites/org.example.dbeaver.echarts.site/category.xml').getroot().find('feature').get('version')
manifest = Path('plugins/org.example.dbeaver.echarts/META-INF/MANIFEST.MF').read_text(encoding='utf-8')
bundle_version = re.search(r'^Bundle-Version:\s*(\S+)', manifest, re.MULTILINE).group(1)
assert bundle_version == feature_version == site_version, (
    f'Version mismatch: bundle={bundle_version} feature={feature_version} site={site_version}'
)
print(f'Version alignment OK: {feature_version}')
PY

if command -v node >/dev/null 2>&1; then
  for javascript in plugins/org.example.dbeaver.echarts/web/js/*.js; do
    [[ "$(basename "$javascript")" == 'echarts.min.js' ]] && continue
    node --check "$javascript"
    echo "JavaScript OK: $(basename "$javascript")"
  done
  node scripts/test-analytics.js
  node scripts/test-dashboard.js
  node scripts/test-dashboard-layout.js
  node scripts/test-report-model.js
  if [[ -d .dev/browser-tests/node_modules/linkedom ]]; then
    node scripts/test-dashboard-bridge.js
  else
    echo 'SKIP: DOM/bridge tests require npm install --prefix .dev/browser-tests linkedom@0.18.13'
  fi
else
  echo 'SKIP: node is not installed'
fi

bash -n scripts/vendor-echarts.sh
echo 'Shell OK: vendor-echarts.sh'
bash -n scripts/vendor-world-map.sh
echo 'Shell OK: vendor-world-map.sh'

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
  plugins/org.example.dbeaver.echarts/third-party/echarts/licenses/LICENSE-d3 \
  plugins/org.example.dbeaver.echarts/third-party/world-map/LICENSE \
  plugins/org.example.dbeaver.echarts/third-party/world-map/README.md; do
  [[ -s "$legal" ]] || { echo "ERROR: missing $legal" >&2; exit 1; }
done
echo 'Third-party notices OK'

world_map='plugins/org.example.dbeaver.echarts/web/js/world-map.js'
[[ -s "$world_map" ]] || { echo 'ERROR: world map asset is missing' >&2; exit 1; }
grep -Fq "registerMap('world'" "$world_map" || { echo 'ERROR: world map registration is missing' >&2; exit 1; }
expected_world_map='6db6d347f43ecf7d1e83aabe468e35aba886249f12b0bd89130bf8e6fdac756b'
actual_world_map="$(sha256sum "$world_map" | awk '{print $1}')"
[[ "$actual_world_map" == "$expected_world_map" ]] || { echo "ERROR: wrong world map asset: $actual_world_map" >&2; exit 1; }
echo "World map asset OK: SHA-256 $actual_world_map"

bash scripts/smoke-tests.sh
