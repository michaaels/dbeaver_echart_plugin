'use strict';

// Run the real page controllers against a DOM, without controlling the user's DBeaver.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('../.dev/browser-tests/node_modules/linkedom');
const web = 'plugins/org.example.dbeaver.echarts/web/';

function page() {
  const { window } = parseHTML(fs.readFileSync(web + 'index.html', 'utf8'));
  const document = window.document;
  // LinkeDOM intentionally has no select.value setter or browser geometry.
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; },
    set(value) { for (const option of this.querySelectorAll('option')) option.selected = option.value === String(value); }
  });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 650, width: 1100, height: 650 });
  function Option(text, value) {
    const option = document.createElement('option');
    option.textContent = text;
    option.value = value;
    return option;
  }
  const options = [], queries = [], saves = [], exports = [], configurations = [], timers = new Map();
  let timerId = 0, dirtySignals = 0;
  window.setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
  window.clearTimeout = id => timers.delete(id);
  window.setInterval = () => 0;
  window.clearInterval = () => {};
  window.echarts = {
    init() { return { setOption(option) { options.push(option); }, dispose() {}, clear() {}, resize() {}, on() {} }; }
  };
  window.dbeaverListConnections = () => JSON.stringify([
    { project: 'General', connection: 'MariaDB tests', connectionId: 'test-id' },
    { project: 'Other', connection: 'Maps', connectionId: 'map-id' }
  ]);
  window.dbeaverExecuteWidgetQuery = (id, sql, source) => { queries.push({ id, sql, source: JSON.parse(source) }); return true; };
  window.dbeaverSaveDashboard = json => { saves.push(JSON.parse(json)); return 'Dashboards/ECharts/control.echarts-dashboard.json'; };
  window.dbeaverExportDashboard = json => { exports.push(JSON.parse(json)); return true; };
  window.dbeaverSaveConfiguration = json => { configurations.push(JSON.parse(json)); return true; };
  window.dbeaverBrowserReady = () => true;
  window.dbeaverDashboardChanged = () => { dirtySignals++; return true; };
  window.dbeaverRefreshResult = () => { throw new Error('A saved dashboard must use widget SQL'); };
  const sandbox = { window, document, Option, console, Date, Map, Set };
  vm.createContext(sandbox);
  for (const file of ['analytics.js', 'dashboard-layout.js', 'dashboard.js', 'chart.js']) {
    vm.runInContext(fs.readFileSync(web + 'js/' + file, 'utf8'), sandbox);
  }
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { window, document, api: window.DBeaverECharts, options, queries, saves, exports, configurations,
    get dirtySignals() { return dirtySignals; },
    flush() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    click(id) { document.getElementById(id).dispatchEvent(new window.Event('click')); },
    change(element, value) { element.value = value; element.dispatchEvent(new window.Event('change')); }
  };
}

function snapshot(sql, rows = [['2026-07-01', 100, 70], ['2026-07-02', 200, 150]]) {
  return { schemaVersion: 1, columns: [
    { name: 'fecha', kind: 'DATETIME' }, { name: 'ventas', kind: 'NUMERIC' }, { name: 'costos', kind: 'NUMERIC' }
  ], rows, rowCount: rows.length, exportedRowCount: rows.length, truncated: false,
  source: { kind: 'activeResultSet', project: 'General', connection: 'MariaDB tests', connectionId: 'test-id', sql } };
}

const author = page();
const sqlA = '-- Ventas diarias\nSELECT fecha, ventas, costos FROM echarts_test_sales ORDER BY fecha;';
author.api.setSnapshot(snapshot(sqlA));
author.click('addWidget');
assert.equal(author.queries.length, 0, 'Adding a widget uses the already executed snapshot');
const sqlB = 'SELECT fecha, SUM(ventas) ventas, SUM(costos) costos FROM otra_tabla GROUP BY fecha';
author.api.setSnapshot(snapshot(sqlB));
author.click('addWidget');
author.click('saveDashboard');
assert.equal(author.saves.length, 1);
const saved = author.saves[0];
assert.equal(saved.widgets[0].source.sql, sqlA, 'A later result must not replace the first widget SQL');
assert.equal(saved.widgets[1].source.sql, sqlB);
assert.ok(saved.widgets.every(widget => widget.source.kind === 'savedQuery'));
author.click('exportDashboard');
assert.deepEqual(author.exports[0], saved, 'Export and Save use the same portable format');

const reader = page();
reader.api.loadDashboard(saved, true);
assert.equal(reader.queries.length, 2, 'Opening without an active result queries every saved widget');
assert.deepEqual(reader.queries.map(query => query.sql), [sqlA, sqlB]);
assert.equal(reader.queries[0].source.connectionId, 'test-id');
assert.equal(reader.document.getElementById('addWidget').disabled, true);
reader.api.setWidgetSnapshot(saved.widgets[0].id, snapshot(sqlA));
reader.api.setWidgetSnapshot(saved.widgets[1].id, snapshot(sqlB));
assert.ok(reader.options.some(option => option.series[0].data.length === 2), 'Reopened widgets render returned data');
assert.deepEqual(JSON.parse(JSON.stringify(reader.api.dashboardDocument())), saved);

const sourceEditor = reader.document.querySelector('.widget-source-editor');
const changedSql = "SELECT fecha, ventas, costos FROM ciudad WHERE nombre = 'Cuenca'";
sourceEditor.querySelector('textarea').value = changedSql;
reader.change(sourceEditor.querySelector('select'), '1');
sourceEditor.querySelector('button').dispatchEvent(new reader.window.Event('click'));
assert.equal(reader.queries.at(-1).sql, changedSql);
assert.equal(reader.queries.at(-1).source.project, 'Other');
assert.equal(reader.queries.at(-1).source.connectionId, 'map-id');
reader.flush();
assert.equal(reader.configurations.at(-1).dashboard.widgets[0].source.sql, changedSql);
reader.api.setWidgetError(saved.widgets[0].id, 'Connection not found. Choose a connection in Source.');
assert.ok(reader.document.getElementById('dashboardGrid').textContent.includes('Connection not found'));
reader.click('refreshDashboard');
assert.equal(reader.queries.at(-2).source.connectionId, 'map-id');
assert.equal(reader.queries.at(-1).sql, sqlB);

const title = reader.document.getElementById('dashboardTitle');
title.value = 'Control de ventas / Cuenca';
title.dispatchEvent(new reader.window.Event('input'));
assert.ok(reader.dirtySignals > 0, 'The Eclipse editor is marked dirty immediately, before the debounce');
reader.click('saveDashboard'); // No wait for the pending preference debounce.
assert.equal(reader.saves.at(-1).title, title.value);

const noSql = page();
noSql.api.setSnapshot(snapshot(''));
noSql.click('addWidget');
noSql.click('saveDashboard');
assert.equal(noSql.saves.length, 0);
assert.match(noSql.document.getElementById('status').textContent, /has no SQL/);

function pointer(page, element, type, x, y, extra = {}) {
  const event = new page.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y, ...extra });
  element.dispatchEvent(event);
}
const arrange = page();
arrange.api.loadDashboard(saved, true);
saved.widgets.forEach(widget => arrange.api.setWidgetSnapshot(widget.id, snapshot(widget.source.sql)));
const grid = arrange.document.getElementById('dashboardGrid');
const pitch = (1100 - 8) / 12;
const first = () => [...grid.querySelectorAll('.dashboard-widget')].find(element => element.dataset.widgetId === saved.widgets[0].id);
const currentLayout = () => JSON.parse(JSON.stringify(arrange.api.dashboardDocument().widgets[0].layout));
pointer(arrange, first().querySelector('.widget-drag-handle'), 'pointerdown', 50, 60);
pointer(arrange, arrange.document, 'pointermove', 50 + pitch * 6, 60);
// Data arriving while dragging must not detach the captured handle or reset the preview.
arrange.api.setWidgetSnapshot(saved.widgets[1].id, snapshot(sqlB));
assert.ok(grid.querySelector('.widget-layout-preview'));
pointer(arrange, arrange.document, 'pointerup', 50 + pitch * 6, 60);
assert.equal(currentLayout().x, 6);
assert.equal(arrange.api.dashboardDocument().widgets[1].layout.x, 0);
assert.equal(grid.querySelector('.widget-layout-preview'), null);
assert.ok(arrange.dirtySignals > 0);

const originalSize = currentLayout();
pointer(arrange, first().querySelector('.widget-resize-handle'), 'pointerdown', 700, 350);
pointer(arrange, arrange.document, 'pointermove', 700 - pitch * 2, 350 + 48 * 3);
pointer(arrange, arrange.document, 'pointerup', 700 - pitch * 2, 350 + 48 * 3);
assert.equal(currentLayout().width, 4);
assert.equal(currentLayout().height, originalSize.height + 3);
const afterResize = currentLayout();
pointer(arrange, first().querySelector('.widget-drag-handle'), 'pointerdown', 650, 60);
pointer(arrange, arrange.document, 'pointermove', 650, 60 + 48 * 4);
const escape = new arrange.window.Event('keydown', { bubbles: true, cancelable: true });
escape.key = 'Escape';
arrange.document.dispatchEvent(escape);
assert.deepEqual(currentLayout(), afterResize);
assert.equal(grid.querySelector('.widget-layout-preview'), null);
pointer(arrange, first().querySelector('.widget-resize-handle'), 'pointerdown', 700, 350);
pointer(arrange, arrange.document, 'pointermove', 700, 450);
pointer(arrange, arrange.document, 'pointercancel', 700, 450);
assert.deepEqual(currentLayout(), afterResize);

// Secondary clicks and text editing do not initiate a layout gesture.
pointer(arrange, first().querySelector('.widget-drag-handle'), 'pointerdown', 50, 60, { button: 2 });
pointer(arrange, first().querySelector('.widget-title'), 'pointerdown', 50, 60);
assert.equal(grid.querySelector('.widget-layout-preview'), null);
const arrow = new arrange.window.Event('keydown', { bubbles: true, cancelable: true });
arrow.key = 'ArrowDown';
first().querySelector('.widget-resize-handle').dispatchEvent(arrow);
assert.equal(currentLayout().height, afterResize.height + 1);
arrange.click('saveDashboard');
const layoutFile = arrange.saves.at(-1);
const restored = page();
restored.api.loadDashboard(layoutFile, true);
assert.deepEqual(JSON.parse(JSON.stringify(restored.api.dashboardDocument())), layoutFile);
assert.equal(arrange.queries.length, 2, 'Changing placement never reruns SQL');
console.log('Dashboard bridge tests OK: SQL capture, Save/Export, standalone load, rendering, rebinding, refresh, missing SQL');
console.log('Dashboard pointer tests OK: move, resize, Escape/cancel, async refresh, keyboard, Save/reopen, unchanged SQL');
