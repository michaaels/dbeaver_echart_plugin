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

// A portable file retains exact SQL and all chart/map settings, without transient sources.
const unicodeSql = "-- Ventas diarias: región\nSELECT fecha, 'niño; café' AS etiqueta, ventas, costos\nFROM echarts_test_sales;";
widget.source.sql = unicodeSql;
Object.assign(widget.source, { connectionId: 'mariadb-local-id', project: 'General', password: 'must-not-export', url: 'must-not-export' });
const map = dashboards.createWidget({ chartType: 'map', xColumn: 'longitud', yColumns: ['latitud', 'ventas'] }, {
  source: { kind: 'activeResultSet', sql: 'SELECT ciudad, longitud, latitud, ventas FROM ciudades', connection: 'mapas', connectionId: 'geo-id', project: 'General' }
});
map.refreshPolicy = { mode: 'interval', intervalSeconds: 60 };
dashboard.widgets.push(map);
const serialized = JSON.stringify(dashboards.portableDashboard(dashboard, 'svg'));
const reopened = dashboards.normalizeDashboard(JSON.parse(serialized));
assert.equal(reopened.format, 'dbeaver-echarts-dashboard');
assert.equal(reopened.renderer, 'svg');
assert.equal(reopened.widgets[0].source.kind, 'savedQuery');
assert.equal(reopened.widgets[0].source.sql, unicodeSql);
assert.equal(reopened.widgets[0].source.connectionId, 'mariadb-local-id');
assert.equal(reopened.widgets[0].source.project, 'General');
assert.equal(reopened.widgets[0].refreshPolicy.mode, 'manual');
assert.equal(reopened.widgets[1].chart.chartType, 'map');
assert.equal(reopened.widgets[1].refreshPolicy.intervalSeconds, 60);
assert.equal(reopened.widgets[0].chart.yAxes.quality, 'right');
assert.ok(!serialized.includes('must-not-export'));
assert.equal(widget.source.kind, 'activeResultSet', 'Saving must not mutate the active dashboard');
const missingSql = JSON.parse(serialized);
missingSql.widgets[1].source.sql = '   ';
assert.throws(() => dashboards.portableDashboard(missingSql), /has no SQL/);
assert.throws(() => dashboards.normalizeDashboard({ ...JSON.parse(serialized), format: 'native-dashboard' }));
const duplicates = JSON.parse(serialized);
duplicates.widgets[1].id = duplicates.widgets[0].id;
assert.throws(() => dashboards.normalizeDashboard(duplicates), /unique/);
assert.throws(() => dashboards.normalizeDashboard({ schemaVersion: 1, widgets: Array(25).fill(map) }), /24/);
console.log('Portable dashboard tests OK: independent SQL, connection references, maps, legacy schema, bounds');
const example = JSON.parse(fs.readFileSync('dev/dashboards/control-ventas.echarts-dashboard.json', 'utf8'));
const restoredExample = dashboards.portableDashboard(example);
assert.equal(restoredExample.widgets.length, 3);
assert.equal(restoredExample.widgets[2].chart.chartType, 'map');
assert.ok(restoredExample.widgets.every(item => item.source.sql.includes('echarts_test_sales')));
