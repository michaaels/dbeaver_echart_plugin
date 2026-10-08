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
    set(value) {
      const options = [...this.querySelectorAll('option')];
      for (const option of options) option.selected = false;
      const selected = options.find(option => option.value === String(value));
      if (selected) selected.selected = true;
    }
  });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 650, width: 1100, height: 650 });
  function Option(text, value) {
    const option = document.createElement('option');
    option.textContent = text;
    option.value = value;
    return option;
  }
  const options = [], queries = [], saves = [], exports = [], configurations = [], cancellations = [], intervals = [], timers = new Map();
  let timerId = 0, dirtySignals = 0, now = Date.now();
  window.setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
  window.clearTimeout = id => timers.delete(id);
  window.setInterval = callback => { intervals.push(callback); return intervals.length; };
  window.clearInterval = () => {};
  window.echarts = {
    init() { return { setOption(option) { options.push(option); }, dispose() {}, clear() {}, resize() {}, on() {} }; }
  };
  window.dbeaverListConnections = () => JSON.stringify([
    { project: 'General', connection: 'MariaDB tests', connectionId: 'test-id' },
    { project: 'Other', connection: 'Maps', connectionId: 'map-id' }
  ]);
  window.dbeaverExecuteWidgetQuery = (id, sql, source) => { queries.push({ id, sql, source: JSON.parse(source) }); return true; };
  window.dbeaverApproveWidgetQueries = () => true;
  window.dbeaverCancelWidgetQuery = id => { cancellations.push(id); return true; };
  window.dbeaverResetDashboardQueries = () => true;
  window.dbeaverSaveDashboard = json => { saves.push(JSON.parse(json)); return 'Dashboards/ECharts/control.echarts-dashboard.json'; };
  window.dbeaverExportDashboard = json => { exports.push(JSON.parse(json)); return true; };
  window.dbeaverSaveConfiguration = json => { configurations.push(JSON.parse(json)); return true; };
  window.dbeaverBrowserReady = () => true;
  window.dbeaverDashboardChanged = () => { dirtySignals++; return true; };
  window.dbeaverRefreshResult = () => { throw new Error('A saved dashboard must use widget SQL'); };
  const sandbox = { window, document, Option, console, Date: { now: () => now }, Map, Set };
  vm.createContext(sandbox);
  for (const file of ['analytics.js', 'dashboard-layout.js', 'dashboard.js', 'widget-editor.js', 'chart.js']) {
    vm.runInContext(fs.readFileSync(web + 'js/' + file, 'utf8'), sandbox);
  }
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { window, document, api: window.DBeaverECharts, options, queries, saves, exports, configurations, cancellations,
    get dirtySignals() { return dirtySignals; },
    flush() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    advance(milliseconds) { now += milliseconds; for (const callback of [...intervals]) callback(); },
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
author.click('widgetEditorSave');
assert.equal(author.queries.length, 0, 'Adding a widget uses the already executed snapshot');
const sqlB = 'SELECT fecha, SUM(ventas) ventas, SUM(costos) costos FROM otra_tabla GROUP BY fecha';
author.api.setSnapshot(snapshot(sqlB));
author.click('addWidget');
author.click('widgetEditorSave');
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
assert.equal(reader.queries.length, 0, 'Opening a saved dashboard must wait for SQL review');
reader.click('reviewDashboardSql');
assert.equal(reader.document.querySelectorAll('#queryReviewSources pre').length, 2);
reader.click('cancelQueryReview');
assert.equal(reader.queries.length, 0, 'Cancelling review does not execute SQL');
reader.click('refreshDashboard');
reader.click('runReviewedQueries');
assert.equal(reader.queries.length, 2, 'Explicit review runs every saved widget');
assert.deepEqual(reader.queries.map(query => query.sql), [sqlA, sqlB]);
assert.equal(reader.queries[0].source.connectionId, 'test-id');
assert.equal(reader.document.getElementById('addWidget').disabled, false);
reader.api.setWidgetSnapshot(saved.widgets[0].id, snapshot(sqlA));
reader.api.setWidgetSnapshot(saved.widgets[1].id, snapshot(sqlB));
assert.ok(reader.options.some(option => option.series[0].data.length === 2), 'Reopened widgets render returned data');
assert.deepEqual(JSON.parse(JSON.stringify(reader.api.dashboardDocument())), saved);

reader.document.querySelector('.widget-edit').dispatchEvent(new reader.window.Event('click'));
const changedSql = "SELECT fecha, ventas, costos FROM ciudad WHERE nombre = 'Cuenca'";
reader.document.getElementById('widgetEditorSql').value = changedSql;
reader.document.getElementById('widgetEditorSql').dispatchEvent(new reader.window.Event('input'));
reader.change(reader.document.getElementById('widgetEditorConnection'), '1');
reader.click('widgetEditorSave');
assert.equal(reader.queries.length, 2, 'Changing SQL and connection invalidates approval');
reader.document.querySelector('.widget-footer button').dispatchEvent(new reader.window.Event('click'));
reader.click('runReviewedQueries');
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
assert.equal(noSql.document.getElementById('widgetEditorSave').disabled, true, 'Widgets require SQL before Apply');
noSql.click('widgetEditorCancel');
noSql.click('saveDashboard');
assert.equal(noSql.saves[0].widgets.length, 0, 'Cancelling a new widget leaves the dashboard empty');

function pointer(page, element, type, x, y, extra = {}) {
  const event = new page.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y, ...extra });
  element.dispatchEvent(event);
}
const arrange = page();
arrange.api.loadDashboard(saved, true);
arrange.click('reviewDashboardSql');
arrange.click('runReviewedQueries');
arrange.api.setWidgetSnapshot(saved.widgets[0].id, snapshot(sqlA));
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

const stopped = page();
const periodic = JSON.parse(JSON.stringify(saved));
periodic.widgets.forEach(widget => { widget.refreshPolicy = { mode: 'interval', intervalSeconds: 30 }; });
stopped.api.loadDashboard(periodic, true);
stopped.advance(60_000);
assert.equal(stopped.queries.length, 0, 'Intervals cannot execute unreviewed SQL');
stopped.click('reviewDashboardSql');
stopped.click('runReviewedQueries');
assert.equal(stopped.queries.length, 2);
assert.ok(stopped.document.querySelector('.widget-footer').textContent.includes('Stop'));
stopped.click('stopDashboard');
stopped.advance(60_000);
assert.equal(stopped.queries.length, 2, 'Stop pauses periodic execution');
assert.deepEqual(stopped.cancellations, saved.widgets.map(widget => widget.id));
assert.equal(stopped.document.getElementById('status').textContent, 'Queries paused');
const renderedBeforeLateResult = stopped.options.length;
stopped.api.setWidgetSnapshot(saved.widgets[0].id, snapshot(sqlA));
stopped.api.setWidgetError(saved.widgets[1].id, 'Late error');
assert.equal(stopped.options.length, renderedBeforeLateResult, 'Stopped results cannot redraw charts');
assert.ok(stopped.document.getElementById('dashboardGrid').textContent.includes('Stopped.'));
stopped.click('refreshDashboard');
assert.equal(stopped.queries.length, 4, 'Explicit refresh resumes approved queries');
stopped.api.setWidgetError(saved.widgets[0].id, 'Query timed out');
stopped.api.setWidgetSnapshot(saved.widgets[1].id, snapshot(sqlB));
stopped.advance(60_000);
assert.equal(stopped.queries.length, 5, 'Failed queries stay paused; healthy intervals continue');
assert.equal(stopped.queries.at(-1).id, saved.widgets[1].id);
const queryCountBeforeReopen = stopped.queries.length;
stopped.api.loadDashboard(saved, true);
assert.equal(stopped.queries.length, queryCountBeforeReopen, 'Reopening requires new approval');
assert.match(stopped.document.getElementById('status').textContent, /awaiting SQL review/);

const removed = page();
removed.api.loadDashboard(saved, true);
removed.click('reviewDashboardSql');
removed.click('runReviewedQueries');
removed.document.querySelector('.widget-header button[title="Remove widget"]').dispatchEvent(new removed.window.Event('click'));
assert.deepEqual(removed.cancellations, [saved.widgets[0].id], 'Removing a widget cancels its job');
removed.api.setWidgetSnapshot(saved.widgets[0].id, snapshot(sqlA));
assert.equal(removed.api.dashboardDocument().widgets.length, 1);

const hostile = page();
const imported = JSON.parse(JSON.stringify(saved));
imported.widgets[0].source.sql = "SELECT '<img src=x onerror=alert(1)>' AS ventas";
imported.widgets[0].source.approved = true;
imported.queryApprovals = { [saved.widgets[0].id]: true };
hostile.api.loadDashboard(imported, true);
assert.equal(hostile.queries.length, 0, 'Approval flags from files have no authority');
hostile.click('reviewDashboardSql');
assert.equal(hostile.document.querySelector('#queryReviewSources pre').textContent, imported.widgets[0].source.sql);
assert.equal(hostile.document.querySelector('#queryReviewSources img'), null, 'Review renders SQL as text');
// A standalone author starts from an empty dashboard and assigns an independent query.
const builder = page();
builder.api.loadDashboard({ schemaVersion: 1, widgets: [] }, true);
builder.click('addWidget');
assert.equal(builder.document.getElementById('widgetEditorSave').disabled, true);
builder.document.getElementById('widgetEditorName').value = 'Revenue and margin';
builder.document.getElementById('widgetEditorName').dispatchEvent(new builder.window.Event('input'));
builder.change(builder.document.getElementById('widgetEditorConnection'), '0');
const widgetSql = 'SELECT region, revenue, margin FROM independent_metrics';
builder.document.getElementById('widgetEditorSql').value = widgetSql;
builder.document.getElementById('widgetEditorSql').dispatchEvent(new builder.window.Event('input'));
builder.click('widgetEditorRun');
assert.ok(builder.queries.length, builder.document.getElementById('widgetEditorError').textContent || builder.document.getElementById('widgetEditorStatus').textContent);
const preview = builder.queries.at(-1);
assert.equal(preview.sql, widgetSql);
assert.equal(preview.source.connectionId, 'test-id');
assert.equal(builder.api.dashboardDocument().widgets.length, 0, 'Preview is a detached draft');
const independentSnapshot = { schemaVersion: 1, columns: [
  { name: 'region', kind: 'STRING' }, { name: 'revenue', kind: 'NUMERIC' }, { name: 'margin', kind: 'NUMERIC' }
], rows: [['Costa', 100, 20], ['Sierra', 200, 40]], rowCount: 2, exportedRowCount: 2, truncated: false };
builder.api.setWidgetSnapshot(preview.id, independentSnapshot);
assert.equal(builder.document.getElementById('widgetEditorCategory').value, 'region');
builder.change(builder.document.getElementById('widgetEditorType'), 'bar');
const seriesMargin = builder.document.querySelector('#widgetEditorSeries input[aria-label="Series margin"]');
seriesMargin.checked = true;
seriesMargin.dispatchEvent(new builder.window.Event('change'));
builder.change(builder.document.querySelector('#widgetEditorSeries select[aria-label="Axis margin"]'), 'right');
builder.click('widgetEditorSave');
assert.equal(builder.queries.length, 1, 'Apply uses the executed preview');
assert.equal(builder.api.dashboardDocument().widgets.length, 1);
const authored = JSON.parse(JSON.stringify(builder.api.dashboardDocument()));
assert.deepEqual(authored.widgets[0].chart.yColumns, ['revenue', 'margin']);
assert.equal(authored.widgets[0].chart.yAxes.margin, 'right');
assert.equal(authored.widgets[0].source.sql, widgetSql);
assert.equal(authored.widgets[0].chart.chartType, 'bar');
assert.ok(!JSON.stringify(authored).includes('previewApproved'), 'Preview approval is not persisted');
builder.click('saveDashboard');
assert.deepEqual(builder.saves[0], authored);

builder.document.querySelector('.widget-edit').dispatchEvent(new builder.window.Event('click'));
const draftSql = 'SELECT region, revenue, margin FROM other_metrics';
builder.document.getElementById('widgetEditorSql').value = draftSql;
builder.document.getElementById('widgetEditorSql').dispatchEvent(new builder.window.Event('input'));
builder.click('widgetEditorRun');
const cancelledPreview = builder.queries.at(-1);
builder.click('widgetEditorStop');
builder.api.setWidgetSnapshot(cancelledPreview.id, independentSnapshot);
assert.match(builder.document.getElementById('widgetEditorStatus').textContent, /stopped/);
builder.click('widgetEditorCancel');
assert.deepEqual(JSON.parse(JSON.stringify(builder.api.dashboardDocument())), authored, 'Cancel discards changes to an existing query');

builder.document.querySelector('.widget-edit').dispatchEvent(new builder.window.Event('click'));
builder.document.getElementById('widgetEditorSql').value = draftSql;
builder.document.getElementById('widgetEditorSql').dispatchEvent(new builder.window.Event('input'));
builder.click('refreshDashboard'); // Simulates a background dashboard refresh during editing.
const refreshingWidget = builder.queries.at(-1);
builder.api.setWidgetSnapshot(refreshingWidget.id, independentSnapshot);
assert.equal(builder.document.getElementById('widgetEditorSql').value, draftSql, 'Background rendering preserves SQL drafts');
builder.api.setTheme({ background: '#222222', foreground: '#eeeeee', dark: true });
assert.equal(builder.document.getElementById('widgetEditorSql').value, draftSql, 'Theme changes preserve SQL drafts');
builder.click('widgetEditorSave');
assert.equal(builder.api.dashboardDocument().widgets[0].source.sql, draftSql, 'An existing mapping can save SQL before previewing it');
const beforeReview = builder.queries.length;
builder.click('refreshDashboard');
assert.equal(builder.queries.length, beforeReview, 'Changing a query without preview invalidates execution approval');
assert.ok(builder.document.getElementById('queryReview').hasAttribute('open'));
builder.click('cancelQueryReview');
builder.api.loadDashboard(authored, true);
builder.document.querySelector('.widget-edit').dispatchEvent(new builder.window.Event('click'));
builder.click('widgetEditorRun');
builder.api.setWidgetError(builder.queries.at(-1).id, 'SQL syntax error');
assert.equal(builder.document.getElementById('widgetEditorError').textContent, 'SQL syntax error');
builder.click('widgetEditorCancel');

const gauge = page();
gauge.api.loadDashboard({ schemaVersion: 1, widgets: [] }, true);
gauge.click('addWidget');
gauge.change(gauge.document.getElementById('widgetEditorConnection'), '0');
gauge.document.getElementById('widgetEditorSql').value = 'SELECT SUM(ventas) AS total FROM echarts_test_sales';
gauge.document.getElementById('widgetEditorSql').dispatchEvent(new gauge.window.Event('input'));
gauge.click('widgetEditorRun');
gauge.api.setWidgetSnapshot(gauge.queries.at(-1).id, { schemaVersion: 1,
  columns: [{ name: 'total', kind: 'NUMERIC' }], rows: [[125000]], rowCount: 1 });
gauge.change(gauge.document.getElementById('widgetEditorType'), 'gauge');
assert.equal(gauge.document.getElementById('widgetEditorSave').disabled, false, 'A gauge supports a single numeric column');
gauge.click('widgetEditorSave');
assert.deepEqual(JSON.parse(JSON.stringify(gauge.api.dashboardDocument().widgets[0].chart.yColumns)), ['total']);
assert.ok(gauge.options.some(option => option.series[0].type === 'gauge'));

const concurrent = page();
concurrent.api.loadDashboard(saved, true);
concurrent.click('reviewDashboardSql');
concurrent.click('runReviewedQueries');
concurrent.document.querySelector('.widget-edit').dispatchEvent(new concurrent.window.Event('click'));
concurrent.click('widgetEditorRun');
concurrent.api.setWidgetSnapshot(concurrent.queries.at(-1).id, snapshot(sqlA, [['2026-07-01', 333, 100]]));
concurrent.click('widgetEditorSave');
assert.ok(concurrent.cancellations.includes(saved.widgets[0].id), 'Applying a preview cancels the older widget request');
const renderedAfterApply = concurrent.options.length;
concurrent.api.setWidgetSnapshot(saved.widgets[0].id, snapshot(sqlA, [['2026-07-01', 1, 1]]));
assert.equal(concurrent.options.length, renderedAfterApply, 'An older widget result cannot replace the applied preview');

console.log('Dashboard bridge tests OK: SQL capture, Save/Export, standalone load, rendering, rebinding, refresh, missing SQL');
console.log('Dashboard pointer tests OK: move, resize, Escape/cancel, async refresh, keyboard, Save/reopen, unchanged SQL');
console.log('Dashboard execution tests OK: review/cancel, approval invalidation, stop/resume, late results, widget removal, untrusted flags and SQL text');
console.log('Widget editor tests OK: independent SQL creation, preview/Stop, series/axes, Apply/Cancel, draft retention and approval invalidation');
