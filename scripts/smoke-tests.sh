#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

python3 - "${DBEAVER_PLUGINS:-}" <<'PY'
import re
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

plugins = Path(sys.argv[1]) if sys.argv[1] else None
plugin_xml = ET.parse(Path('plugins/org.example.dbeaver.echarts/plugin.xml')).getroot()
extensions = list(plugin_xml.findall('extension'))
assert any(e.get('point') == 'org.jkiss.dbeaver.resultset.presentation' and e.find('presentation') is not None for e in extensions)
assert any(e.get('point') == 'org.eclipse.ui.preferencePages' and e.find('page') is not None for e in extensions)

def contains(path, pattern):
    text = Path(path).read_text(encoding='utf-8')
    assert re.search(pattern, text), f'Compatibility contract missing in {path}: {pattern}'

manifest = 'plugins/org.example.dbeaver.echarts/META-INF/MANIFEST.MF'
for bundle in ('org.eclipse.core.runtime', 'org.eclipse.core.jobs', 'org.eclipse.jface', 'org.eclipse.swt', 'org.eclipse.ui', 'org.jkiss.dbeaver.ui.editors.data', 'org.osgi.service.prefs'):
    contains(manifest, re.escape(bundle))

presentation = 'plugins/org.example.dbeaver.echarts/src/org/example/dbeaver/echarts/EChartsPresentation.java'
adapter = 'plugins/org.example.dbeaver.echarts/src/org/example/dbeaver/echarts/DBeaverResultSetAdapter.java'
job = 'plugins/org.example.dbeaver.echarts/src/org/example/dbeaver/echarts/EChartsSnapshotJob.java'
dashboard_job = 'plugins/org.example.dbeaver.echarts/src/org/example/dbeaver/echarts/DashboardQueryJob.java'
preferences = 'plugins/org.example.dbeaver.echarts/src/org/example/dbeaver/echarts/EChartsPreferencePage.java'
for path, pattern in (
    (presentation, r'new EChartsSnapshotJob'),
    (presentation, r'IThemeManager'),
    (presentation, r'dbeaverSaveConfiguration'),
    (presentation, r'runOnUiThread'),
    (presentation, r'currentDisplay\.asyncExec'),
    (presentation, r'dbeaverRefreshResult'),
    (presentation, r'dbeaverImportDashboard'),
    (presentation, r'dbeaverExportDashboard'),
    (presentation, r'dbeaverExecuteWidgetQuery'),
    (adapter, r'copySelection'),
    (job, r'extends Job'),
    (dashboard_job, r'extends AbstractJob'),
    (dashboard_job, r'isReadOnlyQuery'),
    (dashboard_job, r'DBCExecutionPurpose\.USER'),
    (preferences, r'IWorkbenchPreferencePage'),
):
    contains(path, pattern)

chart = 'plugins/org.example.dbeaver.echarts/web/js/chart.js'
for pattern in (r'setSnapshot', r'setTheme', r'setConfigurationJson', r'dbeaverSaveConfiguration', r'dbeaverBrowserReady', r'preferredYNames'):
    contains(chart, pattern)

analytics = 'plugins/org.example.dbeaver.echarts/web/js/analytics.js'
for pattern in (r'useCategoryAxis', r'saveAsImage', r'dataZoom', r'buildGauge', r'buildRadar', r'buildHeatmap', r'buildBoxplot', r'buildTreemap', r'buildFunnel', r'buildMap'):
    contains(analytics, pattern)

dashboard = 'plugins/org.example.dbeaver.echarts/web/js/dashboard.js'
for pattern in (r'createDashboard', r'refreshPolicy', r'dashboard\.filters', r'drillDown'):
    contains(dashboard, pattern)

if plugins:
    if not plugins.is_dir():
        raise AssertionError(f'DBeaver plugin directory does not exist: {plugins}')
    bundles = sorted(plugins.glob('org.jkiss.dbeaver.ui.editors.data_*.jar'))
    assert bundles, 'DBeaver data editor bundle was not found in the target'
    with zipfile.ZipFile(bundles[0]) as bundle:
        entries = set(bundle.namelist())
    for entry in (
        'org/jkiss/dbeaver/ui/controls/resultset/IResultSetPresentation.class',
        'org/jkiss/dbeaver/ui/controls/resultset/IResultSetController.class',
        'org/jkiss/dbeaver/ui/controls/resultset/AbstractPresentation.class',
        'org/jkiss/dbeaver/ui/controls/resultset/ResultSetCopySettings.class',
    ):
        assert entry in entries, f'DBeaver target API class is missing: {entry}'
    print(f'DBeaver target API OK: {bundles[0].name}')

    javac = shutil.which('javac')
    if javac:
        import tempfile
        with tempfile.TemporaryDirectory(prefix='dbeaver-echarts-smoke-') as output:
            sources = [str(path) for path in Path('plugins/org.example.dbeaver.echarts/src').rglob('*.java')]
            subprocess.run(
                [javac, '-encoding', 'UTF-8', '-source', '21', '-target', '21', '-cp', str(plugins / '*'), '-d', output, *sources],
                check=True,
            )
            classpath = os.pathsep.join((output, str(plugins / '*')))
            tests = ['DashboardFilesTest', 'DashboardQueryControlsTest', 'ReportFilesTest', 'ReportParametersTest', 'BrowserNavigationTest']
            subprocess.run([javac, '-encoding', 'UTF-8', '-source', '21', '-target', '21', '-cp', classpath,
                            '-d', output, *[f'scripts/tests/{test}.java' for test in tests]], check=True)
            for test in tests:
                subprocess.run(['java', '-cp', classpath, f'org.example.dbeaver.echarts.{test}'], check=True)
        print('Java source compatibility OK: supplied DBeaver target')
    else:
        print('SKIP: javac is not installed; target source compile was not run')

print('Compatibility smoke tests OK: extension, bridge and DBeaver API contracts')
PY
