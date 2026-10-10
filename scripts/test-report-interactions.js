'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchBrowser } = require('./browser-test-runtime');
const root = path.resolve(__dirname, '..');
const initial = { x: 3, y: 2, width: 6, height: 8 };
async function main() {
  const browser = await launchBrowser();
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
    const libraryHeading = page.locator('[data-component-type="heading"]');
    const libraryBox = await libraryHeading.boundingBox(), targetBox = await target.boundingBox();
    const beforeDrop = await doc(), queriesBeforeDrop = await page.evaluate(() => window.queryCount);
    await page.mouse.move(libraryBox.x + 20, libraryBox.y + 10); await page.mouse.down();
    await page.mouse.move(libraryBox.x + 30, libraryBox.y + 15);
    await page.mouse.move(targetBox.x + 50, targetBox.y + 50, { steps: 8 });
    await page.mouse.move(targetBox.x + 50, targetBox.y + 50);
    const ghost = page.locator('.report-drop-preview');
    await ghost.waitFor(); assert.match(await ghost.innerText(), /Report title/);
    assert.deepEqual(await doc(), beforeDrop, 'Preview does not modify the report');
    const ghostBox = await ghost.boundingBox(); assert.ok(ghostBox.width > 100 && ghostBox.height > 40);
    fs.mkdirSync(path.join(root, '.dev/screenshots'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.dev/screenshots/report-drop-preview.png') });
    await page.mouse.up(); assert.equal(await ghost.count(), 0);
    const nested = (await doc()).widgets.find(widget => widget.type === 'heading'); assert.ok(nested); assert.equal(nested.parentId, 'section', 'HTML5 drop targets empty sections');
    const placedBox = await page.locator(`[data-component-id="${nested.id}"]`).boundingBox();
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(placedBox[key] - ghostBox[key]) < 1, `Drop matches preview ${key}`);
    assert.equal(await page.evaluate(() => window.queryCount), queriesBeforeDrop, 'Drag preview never executes SQL');
    // A cancelled library drag leaves neither a component nor a preview behind.
    const beforeCancel = await doc();
    await page.mouse.move(libraryBox.x + 20, libraryBox.y + 10); await page.mouse.down();
    await page.mouse.move(libraryBox.x + 30, libraryBox.y + 15);
    await page.mouse.move(targetBox.x + 50, targetBox.y + 50, { steps: 8 }); await page.mouse.move(targetBox.x + 50, targetBox.y + 50);
    await ghost.waitFor();
    assert.equal(await page.locator(`[data-component-id="${nested.id}"]`).evaluate(element => element.style.gridRow), '4 / span 2', 'Section sibling reflows within its own grid');
    assert.deepEqual(await doc(), beforeCancel);
    assert.equal(await page.locator('[data-component-id="section"]').evaluate(element => element.style.gridRow), '1 / span 12', 'Nested preview does not move its parent');
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.equal(await ghost.count(), 0); assert.deepEqual(await doc(), beforeCancel);
    assert.equal(await page.locator(`[data-component-id="${nested.id}"]`).evaluate(element => element.style.gridRow), '2 / span 2');
    await page.locator('[data-layer-id="section"]').click(); await page.locator('#componentProperties').getByRole('button', { name: 'Copy', exact: true }).click();
    await page.locator('#componentProperties').getByRole('button', { name: 'Paste', exact: true }).click();
    assert.equal((await doc()).widgets.filter(widget => widget.type === 'section').length, 2); assert.equal((await doc()).widgets.filter(widget => widget.type === 'heading').length, 2);
    await page.keyboard.press('Delete'); assert.equal((await doc()).widgets.length, 2, 'Delete removes selected container and descendants');
    for (const width of [360, 640, 900]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: controls do not overflow`);
    }
    assert.deepEqual(errors, []);
    // Root drops use the same clamped footprint at 75% zoom, including the right edge.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => window.DBeaverECharts.loadReport(window.DBeaverReportModel.create('Zoomed drop')));
    await page.locator('#reportZoom').selectOption('0.75');
    const tableButton = page.locator('[data-component-type="table"]'); await tableButton.scrollIntoViewIfNeeded();
    const tableButtonBox = await tableButton.boundingBox(), canvasBox = await page.locator('#reportCanvas').boundingBox();
    await page.mouse.move(tableButtonBox.x + 20, tableButtonBox.y + 10); await page.mouse.down();
    await page.mouse.move(tableButtonBox.x + 35, tableButtonBox.y + 15);
    await page.mouse.move(canvasBox.x + canvasBox.width - 25, canvasBox.y + 100, { steps: 8 });
    await page.mouse.move(canvasBox.x + canvasBox.width - 25, canvasBox.y + 100);
    await ghost.waitFor(); const zoomGhost = await ghost.boundingBox();
    await page.mouse.up(); const placedTable = (await doc()).widgets[0];
    assert.equal(placedTable.layout.x, 6, 'Right-edge drop is clamped before placement');
    const zoomPlaced = await page.locator(`[data-component-id="${placedTable.id}"]`).boundingBox();
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(zoomPlaced[key] - zoomGhost[key]) < 1, `Zoomed drop matches ${key}`);
    await page.locator('#undoReport').click(); assert.equal((await doc()).widgets.length, 0);
    // Inserting into occupied space previews the whole report, not an overlay.
    const reflowReport = await page.evaluate(fixture => {
      const M = window.DBeaverReportModel, report = M.clone(fixture), title = M.widget('heading'), table = M.widget('table'), kpi = M.widget('kpi');
      title.id = 'title'; title.layout = { x: 0, y: 0, width: 12, height: 2 };
      report.widgets[0].layout = { x: 0, y: 2, width: 7, height: 8 };
      table.id = 'table'; table.layout = { x: 7, y: 2, width: 5, height: 8 }; table.sourceId = 'daily';
      kpi.id = 'kpi'; kpi.layout = { x: 0, y: 10, width: 12, height: 3 }; kpi.sourceId = 'daily'; kpi.config.column = 'ventas';
      report.widgets = [title, report.widgets[0], table, kpi]; return M.normalize(report);
    }, fixture);
    const domLayouts = () => page.locator('#reportCanvas [data-component-id]').evaluateAll(frames => Object.fromEntries(frames.map(frame => {
      const [x, width] = frame.style.gridColumn.match(/\d+/g).map(Number), [y, height] = frame.style.gridRow.match(/\d+/g).map(Number);
      return [frame.dataset.componentId, { x: x - 1, y: y - 1, width, height }];
    })));
    const modelLayouts = report => Object.fromEntries(report.widgets.map(widget => [widget.id, widget.layout]));
    const beginHeading = async (x, y) => {
      const button = page.locator('[data-component-type="heading"]'); await button.scrollIntoViewIfNeeded(); const box = await button.boundingBox();
      await page.mouse.move(box.x + 20, box.y + 10); await page.mouse.down(); await page.mouse.move(box.x + 35, box.y + 15);
      await page.mouse.move(x, y, { steps: 8 }); await page.mouse.move(x, y); await ghost.waitFor();
    };
    for (const zoom of ['1', '0.75']) {
      await page.evaluate(() => { window.queryFailure = false; });
      await page.evaluate(report => window.DBeaverECharts.loadReport(report), reflowReport);
      await page.locator('#reportZoom').selectOption(zoom);
      await page.locator('#generateReport').click(); await page.locator('#runReportQueries').click();
      await page.waitForFunction(() => document.getElementById('reportPreviewDialog').open);
      await page.locator('[data-close="reportPreviewDialog"]').click();
      const original = await doc(), baseline = modelLayouts(original), queries = await page.evaluate(() => window.queryCount);
      const rootBox = await page.locator('#reportCanvas > .report-grid').boundingBox(), x = rootBox.x + 25, y = rootBox.y + 15;
      await beginHeading(x, y);
      const preview = await domLayouts();
      assert.deepEqual(Object.fromEntries(Object.entries(preview).map(([id, layout]) => [id, layout.y])), { title: 2, chart: 4, table: 4, kpi: 12 }, 'All colliding siblings move before release');
      assert.deepEqual(await doc(), original, 'Reflow preview never edits the template');
      // Repeated hover and changing rows must always plan from the original layout.
      await page.mouse.move(x, y + 64 * Number(zoom)); await page.mouse.move(x, y);
      assert.deepEqual(await domLayouts(), preview, 'Returning to the same position does not accumulate displacement');
      await page.screenshot({ path: path.join(root, `.dev/screenshots/report-reflow-preview-${zoom}.png`) });
      await page.keyboard.press('Escape'); await page.mouse.up();
      assert.deepEqual(await domLayouts(), baseline, 'Escape restores every component');
      assert.deepEqual(await doc(), original); assert.equal(await page.locator('#undoReport').isDisabled(), true, 'Preview does not create undo entries');
      await beginHeading(x, y);
      const beforeRelease = await domLayouts(), footprint = await ghost.boundingBox(); await page.mouse.up();
      const inserted = (await doc()).widgets.find(widget => !baseline[widget.id]);
      assert.ok(inserted, 'Drop must insert the previewed component'); const committed = modelLayouts(await doc());
      for (const id of Object.keys(baseline)) assert.deepEqual(committed[id], beforeRelease[id], `Committed ${id} matches preview`);
      const placed = await page.locator(`[data-component-id="${inserted.id}"]`).boundingBox();
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(placed[key] - footprint[key]) < 1);
      assert.equal(await page.evaluate(() => window.queryCount), queries, 'Preview and commit do not run SQL');
      await page.locator('#undoReport').click(); assert.deepEqual(await doc(), original);
      await page.locator('#redoReport').click(); assert.deepEqual(modelLayouts(await doc()), committed);
      await page.locator('#undoReport').click();
      await beginHeading(x, y); await page.mouse.move(20, 20); await page.mouse.up();
      assert.equal(await ghost.count(), 0); assert.deepEqual(await domLayouts(), baseline, 'Leaving the sheet restores all positions');
    }
    // Moving and resizing existing components uses the same live collision preview.
    await page.locator('[data-layer-id="title"]').click();
    const titleFrame = page.locator('[data-component-id="title"]');
    for (const edge of ['move', 's']) {
      const original = await doc(), baseline = modelLayouts(original);
      const handle = titleFrame.locator(edge === 'move' ? '.report-move' : '[data-edge="s"]'), box = await handle.boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 32 * .75, { steps: 5 });
      const preview = await domLayouts(); assert.equal(preview.chart.y, 3); assert.equal(preview.table.y, 3); assert.equal(preview.kpi.y, 11);
      assert.deepEqual(await doc(), original);
      await page.keyboard.press('Escape'); await page.mouse.up(); assert.deepEqual(await domLayouts(), baseline);
      const again = await titleFrame.locator(edge === 'move' ? '.report-move' : '[data-edge="s"]').boundingBox();
      await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2); await page.mouse.down();
      await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2 + 32 * .75, { steps: 5 });
      const finalPreview = await domLayouts(); await page.mouse.up(); assert.deepEqual(modelLayouts(await doc()), finalPreview);
      await page.locator('#undoReport').click(); assert.deepEqual(await doc(), original);
    }
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.DBeaverECharts.dispose());
    assert.equal(await page.locator('.report-drag-guide,.report-drop-preview').count(), 0);
    console.log('Report interaction OK: 8 edges, ECharts resize, live sibling reflow on insert/move/resize, preview/commit equality, no cumulative drift or SQL, Escape/outside/undo/redo, 75% zoom, sections and disposal');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
