'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../.dev/browser-tests/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const initial = { x: 3, y: 2, width: 6, height: 8 };
async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.queryCount = 0; window.queryFailure = false; window.cancelled = [];
      window.dbeaverBrowserReady = window.dbeaverSaveConfiguration = window.dbeaverDashboardChanged = () => true;
      window.dbeaverApproveWidgetQueries = window.dbeaverResetDashboardQueries = () => true;
      window.dbeaverCancelWidgetQuery = id => { window.cancelled.push(id); return true; };
      window.dbeaverExecuteWidgetQuery = (id) => {
        window.queryCount++;
        setTimeout(() => window.queryFailure ? window.DBeaverECharts.setWidgetError(id, 'Test connection lost') : window.DBeaverECharts.setWidgetSnapshot(id, {
          schemaVersion: 1, columns: [{ name: 'fecha', kind: 'DATETIME' }, { name: 'ventas', kind: 'NUMERIC' }],
          rows: [['2026-10-01', 100], ['2026-10-02', 140]], effectiveMaxRows: 100, truncated: false
        }), 15); return true;
      };
    });
    await page.goto(pathToFileURL(path.join(root, 'plugins/org.example.dbeaver.echarts/web/report.html')).href);
    const fixture = await page.evaluate(initial => {
      const M = window.DBeaverReportModel, report = M.create('Layout checks'), source = M.source({ id: 'daily', sql: 'SELECT fecha, ventas FROM demo', connectionId: 'demo', name: 'Daily' }), widget = M.widget('chart');
      widget.id = 'chart'; widget.layout = initial; widget.sourceId = 'daily'; widget.config.chart.xColumn = 'fecha'; widget.config.chart.yColumns = ['ventas'];
      report.sources.push(source); report.widgets.push(widget); return M.normalize(report);
    }, initial);
    const doc = () => page.evaluate(() => window.DBeaverECharts.reportDocument());
    async function load(zoom = '1') {
      await page.evaluate(fixture => window.DBeaverECharts.loadReport(fixture), fixture);
      await page.locator('#reportZoom').selectOption(zoom);
      await page.locator('#generateReport').click(); await page.locator('#runReportQueries').click();
      await page.waitForFunction(() => document.getElementById('reportPreviewDialog').open);
      await page.locator('[data-close="reportPreviewDialog"]').click();
      await page.locator('[data-layer-id="chart"]').click();
    }
    const frame = page.locator('[data-component-id="chart"]').first();
    async function drag(edge, cancel = false, zoom = 1) {
      const handle = frame.locator(`[data-edge="${edge}"]`); await handle.scrollIntoViewIfNeeded();
      const box = await frame.boundingBox(), bounds = await handle.boundingBox(), pitch = (box.width + 8 * zoom) / initial.width;
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + (edge.includes('w') ? -pitch : edge.includes('e') ? pitch : 0), y + (edge.includes('n') ? -32 * zoom : edge.includes('s') ? 32 * zoom : 0), { steps: 5 });
      assert.equal(await page.locator('.report-drag-guide').count(), 1);
      if (cancel) await page.keyboard.press('Escape'); await page.mouse.up();
      assert.equal(await page.locator('.report-drag-guide').count(), 0); assert.equal(await page.locator('.report-dragging').count(), 0);
    }
    for (const edge of ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']) {
      await load(); const queries = await page.evaluate(() => window.queryCount);
      if (edge.length === 1) assert.ok(await frame.locator(`[data-edge="${edge}"]`).evaluate((element, edge) => {
        const box = element.getBoundingClientRect(); return [.1, .5, .9].every(fraction => document.elementFromPoint(box.x + box.width * (/[ns]/.test(edge) ? fraction : .5), box.y + box.height * (/[ew]/.test(edge) ? fraction : .5)) === element);
      }, edge), `${edge}: full border is reachable`);
      await drag(edge);
      assert.deepEqual((await doc()).widgets[0].layout, { x: initial.x - (edge.includes('w') ? 1 : 0), y: initial.y - (edge.includes('n') ? 1 : 0), width: initial.width + (/[ew]/.test(edge) ? 1 : 0), height: initial.height + (/[ns]/.test(edge) ? 1 : 0) }, `${edge}: anchored resize`);
      await page.waitForTimeout(30);
      assert.ok(await frame.locator('.report-chart').evaluate(element => {
        const chart = window.echarts.getInstanceByDom(element); return chart.getWidth() === element.clientWidth && chart.getHeight() === element.clientHeight;
      }), 'Chart follows component dimensions');
      assert.equal(await page.evaluate(() => window.queryCount), queries, 'Layout changes never rerun SQL');
      await page.locator('#undoReport').click(); assert.deepEqual((await doc()).widgets[0].layout, initial);
    }
    await load(); await drag('se', true); assert.deepEqual((await doc()).widgets[0].layout, initial);
    await load('0.75'); await drag('nw', false, .75); assert.equal((await doc()).widgets[0].layout.width, 7);
    await load(); const move = frame.locator('.report-move'); const box = await move.boundingBox();
    await page.mouse.move(box.x + 30, box.y + 8); await page.mouse.down(); await page.mouse.move(box.x + 30, box.y + 72, { steps: 5 }); await page.mouse.up();
    assert.equal((await doc()).widgets[0].layout.y, initial.y + 2);
    const retained = await doc(); await page.evaluate(() => { window.queryFailure = true; });
    await page.locator('#refreshReport').click(); await page.locator('#runReportQueries').click(); await page.waitForSelector('.report-data-error');
    assert.match(await page.locator('#reportCanvas .report-data-error').textContent(), /Test connection lost/); assert.deepEqual(await doc(), retained, 'Failed refresh preserves design');
    await page.evaluate(() => { const M = window.DBeaverReportModel, report = M.create('Sections'), section = M.widget('section'); section.id = 'section'; section.layout = { x: 0, y: 0, width: 12, height: 12 }; report.widgets.push(section); window.DBeaverECharts.loadReport(report); });
    const target = page.locator('[data-component-id="section"] .report-grid');
    await page.locator('[data-component-type="heading"]').dragTo(target);
    const nested = (await doc()).widgets.find(widget => widget.type === 'heading'); assert.ok(nested); assert.equal(nested.parentId, 'section', 'HTML5 drop targets empty sections');
    await page.locator('[data-layer-id="section"]').click(); await page.locator('#componentProperties').getByRole('button', { name: 'Copy', exact: true }).click();
    await page.locator('#componentProperties').getByRole('button', { name: 'Paste', exact: true }).click();
    assert.equal((await doc()).widgets.filter(widget => widget.type === 'section').length, 2); assert.equal((await doc()).widgets.filter(widget => widget.type === 'heading').length, 2);
    await page.keyboard.press('Delete'); assert.equal((await doc()).widgets.length, 2, 'Delete removes selected container and descendants');
    for (const width of [360, 640, 900]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: controls do not overflow`);
    }
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.DBeaverECharts.dispose());
    assert.equal(await page.locator('.report-drag-guide').count(), 0);
    console.log('Report interaction OK: all 8 mouse edges, full border hits, ECharts resize, anchored bounds, Escape/undo, 75% zoom, move, failed refresh, section drop/copy/delete, narrow windows and disposal');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
