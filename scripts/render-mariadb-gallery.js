'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const web = path.join(root, 'plugins/org.example.dbeaver.echarts/web/js');
const datasets = JSON.parse(fs.readFileSync(path.join(root, '.dev/mariadb-datasets.json'), 'utf8'));
const fixtureQueries = fs.readFileSync(path.join(root, 'dev/mariadb/chart-queries.sql'), 'utf8')
  .split(';').map(sql => sql.trim()).filter(Boolean);
const echarts = require(path.join(web, 'echarts.min.js'));
const sandbox = { window: { echarts } };
vm.createContext(sandbox);
for (const file of ['analytics.js', 'world-map.js', 'dashboard-layout.js', 'dashboard.js']) vm.runInContext(fs.readFileSync(path.join(web, file), 'utf8'), sandbox);
const analytics = sandbox.window.DBeaverEChartsAnalytics;
const dashboards = sandbox.window.DBeaverEChartsDashboard;
const output = path.join(root, '.dev/mariadb-gallery');
fs.mkdirSync(output, { recursive: true });
const themes = {
  light: { background: '#ffffff', foreground: '#222222', muted: '#666666', border: '#cccccc', grid: '#dddddd', controlBackground: '#f5f5f5' },
  dark: { background: '#292929', foreground: '#eeeeee', muted: '#aaaaaa', border: '#555555', grid: '#444444', controlBackground: '#333333' }
};
const cases = [
  ['line', 1, 'fecha', ['ventas', 'costos']],
  ['area', 1, 'fecha', ['ventas', 'costos']],
  ['bar', 1, 'fecha', ['ventas', 'costos']],
  ['scatter', 3, 'unidades', ['ventas']],
  ['pie', 2, 'region', ['ventas']],
  ['gauge', 7, 'indicador', ['valor']],
  ['radar', 15, 'ciudad', ['ventas', 'costos', 'unidades', 'satisfaccion']],
  ['heatmap', 6, 'fecha', ['costa', 'sierra', 'amazonia', 'insular']],
  ['boxplot', 5, 'producto', ['ventas', 'costos', 'unidades']],
  ['treemap', 2, 'region', ['ventas']],
  ['funnel', 8, 'nombre', ['cantidad']],
  ['map', 9, 'longitud', ['latitud', 'ventas']],
  ['bar', 10, 'categoria', ['valor', 'segunda_serie']],
  ['line', 12, 'categoria', ['valor']],
  ['line', 4, 'id', ['ventas', 'costos']]
];
const reports = [];
for (const [chartType, number, xName, yNames] of cases) {
  const snapshot = datasets[number - 1];
  const xIndex = snapshot.columns.findIndex(c => c.name === xName);
  const yIndices = yNames.map(name => snapshot.columns.findIndex(c => c.name === name));
  assert.ok(xIndex >= 0 && yIndices.every(i => i >= 0), 'All configured columns must exist');
  const dashboard = dashboards.createDashboard();
  dashboard.widgets.push(dashboards.createWidget({ chartType, xColumn: xName, yColumns: yNames,
    yAxes: Object.fromEntries(yNames.map((name, index) => [name, index ? 'right' : 'left'])) }, {
      ...snapshot, source: { kind: 'activeResultSet', sql: snapshot.sql || fixtureQueries[number - 1], connectionId: 'test-id', project: 'test' }
    }));
  const reopened = dashboards.normalizeDashboard(JSON.parse(JSON.stringify(dashboards.portableDashboard(dashboard))));
  assert.equal(reopened.widgets[0].source.kind, 'savedQuery');
  assert.equal(reopened.widgets[0].source.sql, fixtureQueries[number - 1]);
  for (const [themeName, theme] of Object.entries(themes)) {
    const context = dashboards.buildContext(reopened.widgets[0], reopened, snapshot, theme);
    const option = analytics.buildOption(context);
    assert.equal(analytics.hasRenderableData(option), true, `${chartType} must contain actual SQL data`);
    option.animation = false;
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 1100, height: 650 });
    const started = performance.now();
    try {
      chart.setOption(option);
      const svg = chart.renderToSVGString();
      assert.ok(svg.startsWith('<svg') && svg.includes('<path'), 'ECharts must render geometry');
      assert.ok(!/\b(?:NaN|Infinity|undefined)\b/.test(svg), 'Rendered SVG must contain valid coordinates and labels');
      if (number === 1) assert.equal(option.series[0].data.length, 90);
      if (chartType === 'map') assert.equal(option.series[0].data.length, 6);
      if (chartType === 'funnel') assert.deepEqual(Array.from(option.series[0].data, d => d.value), [10000, 6800, 3500, 2100, 1800]);
      const filename = `${String(number).padStart(2, '0')}-${chartType}-${themeName}.svg`;
      fs.writeFileSync(path.join(output, filename), svg);
      reports.push({ chartType, query: number, theme: themeName, rows: snapshot.rows.length,
        milliseconds: Math.round(performance.now() - started), filename, svgBytes: Buffer.byteLength(svg) });
    } finally { chart.dispose(); }
  }
}
const empty = analytics.buildOption({ ...datasets[10], rowCount: 0, chartType: 'line', xIndex: 0,
  yIndices: [1], yAxes: {}, marks: {}, theme: themes.light });
assert.equal(analytics.hasRenderableData(empty), false, 'Empty SQL must not invent points');
const total = datasets[0].rows.reduce((sum, row) => sum + Number(row[1]), 0);
assert.ok(Math.abs(total - Number(datasets[12].rows[0][1])) < 0.01, 'Daily totals must match the KPI query');
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ echarts: echarts.version, renders: reports, totalSales: total }, null, 2));
const cards = reports.map(r => `<article><h2>${r.chartType} · ${r.theme} · consulta ${r.query}</h2><p>${r.rows} filas · ${r.milliseconds} ms</p><img loading="lazy" src="${r.filename}" alt="${r.chartType}"></article>`).join('\n');
fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><html lang="es"><meta charset="utf-8"><title>Pruebas ECharts / MariaDB</title><style>body{font-family:system-ui;margin:24px;background:#eee;color:#222}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(480px,1fr));gap:20px}article{background:white;padding:16px;border-radius:8px}img{width:100%;height:auto}h2{font-size:18px}p{color:#666}</style><h1>Galería ECharts con datos de MariaDB</h1><p>12 tipos, temas claro y oscuro, nulos, una fila y 3.240 registros. Renderizado SVG automático; las interacciones SWT se verifican dentro de DBeaver.</p><main>${cards}</main></html>`);
console.log(`${reports.length} SVG renders OK; 12 chart types; empty result and SQL totals checked`);
console.log(path.join(output, 'index.html'));
