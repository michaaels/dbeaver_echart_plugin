'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync('plugins/org.example.dbeaver.echarts/web/js/dashboard.js', 'utf8'),
  context
);

const dashboards = context.window.DBeaverEChartsDashboard;
const dashboard = dashboards.createDashboard();
const widget = dashboards.createWidget({
  chartType: 'line',
  xColumn: 'date',
  yColumns: ['traffic', 'quality'],
  yAxes: { quality: 'right' },
  marks: { markLine: true }
}, {
  source: { kind: 'activeResultSet', name: 'Query', connection: 'local', sql: 'select 1' }
});
dashboard.widgets.push(widget);
dashboard.filters.site = 'A';

const normalized = dashboards.normalizeDashboard(JSON.parse(JSON.stringify(dashboard)));
assert.equal(normalized.schemaVersion, 1);
assert.equal(normalized.widgets.length, 1);
assert.deepEqual(Array.from(normalized.widgets[0].chart.yColumns), ['traffic', 'quality']);
assert.equal(normalized.widgets[0].source.sql, 'select 1');
assert.equal(normalized.filters.site, 'A');
assert.throws(() => dashboards.normalizeDashboard({ schemaVersion: 99, widgets: [] }));

console.log('Dashboard schema tests OK');
