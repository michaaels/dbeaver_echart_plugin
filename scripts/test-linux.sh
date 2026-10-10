#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DBEAVER_DIR="$(cd "${1:?Usage: bash scripts/test-linux.sh /path/to/installed/dbeaver}" && pwd)"
cd "$ROOT"
export DBEAVER_PLUGINS="$DBEAVER_DIR/plugins"
bash scripts/validate.sh

for engine in ${ECHARTS_TEST_BROWSERS:-chromium webkit}; do
  export ECHARTS_TEST_BROWSER="$engine"
  for suite in chart-labels chart-catalog dashboard-browser dashboard-resize report-designer report-interactions; do
    node "scripts/test-$suite.js"
  done
  python3 scripts/test-report-eml.py
done

xvfb-run -a node scripts/test-plugin-registry.js --installed "$DBEAVER_DIR"
