'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync('plugins/org.example.dbeaver.echarts/web/js/analytics.js', 'utf8'),
  context
);

const analytics = context.window.DBeaverEChartsAnalytics;
const rows = [
  ['A', '2026-01-01T00:00:00Z', 10, 100, -79.9, -2.2],
  ['B', '2026-01-02T00:00:00Z', 20, 80, -78.5, -0.2],
  ['C', '2026-01-03T00:00:00Z', 30, 60, -79.0, -1.4],
  ['A', '2026-01-04T00:00:00Z', 40, 40, -80.0, -3.2]
];
const columns = [
  { name: 'category', kind: 'STRING' },
  { name: 'date', kind: 'DATETIME' },
  { name: 'traffic', kind: 'NUMERIC' },
  { name: 'quality', kind: 'NUMERIC' },
  { name: 'longitude', kind: 'NUMERIC' },
  { name: 'latitude', kind: 'NUMERIC' }
];
const theme = {
  background: '#fff', foreground: '#222', muted: '#666', border: '#ccc', grid: '#ddd', controlBackground: '#f5f5f5'
};

for (const chartType of ['line', 'area', 'bar', 'scatter', 'pie', 'gauge', 'radar', 'heatmap', 'boxplot', 'treemap', 'funnel', 'map']) {
  const map = chartType === 'map';
  const option = analytics.buildOption({
    rows,
    columns,
    rowCount: rows.length,
    xIndex: map ? 4 : chartType === 'line' ? 1 : 0,
    yIndices: map ? [5, 2] : [2, 3],
    yAxes: map ? { 5: 'left', 2: 'right' } : { 2: 'left', 3: 'right' },
    chartType,
    marks: { markLine: true, markArea: true, visualMap: true },
    theme
  });
  assert.equal(analytics.hasRenderableData(option), true, `${chartType} must produce data`);
}

const dualAxis = analytics.buildOption({
  rows,
  columns,
  rowCount: rows.length,
  xIndex: 1,
  yIndices: [2, 3],
  yAxes: { 2: 'left', 3: 'right' },
  chartType: 'line',
  marks: { markLine: true, markArea: true, visualMap: true },
  theme
});
assert.equal(dualAxis.yAxis.length, 2);
assert.equal(dualAxis.series.length, 2);
assert.equal(dualAxis.series[1].yAxisIndex, 1);
assert.ok(dualAxis.series[0].markLine);
assert.ok(dualAxis.series[0].markArea);
assert.ok(dualAxis.visualMap);

console.log('Analytical chart option tests OK');
