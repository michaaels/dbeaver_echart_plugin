'use strict';

// Real mouse/keyboard events and the bundled ECharts, in an isolated headless Edge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../.dev/browser-tests/node_modules/playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'dev/dashboards/control-ventas.echarts-dashboard.json'), 'utf8'));
  const datasets = JSON.parse(fs.readFileSync(path.join(root, '.dev/mariadb-datasets.json'), 'utf8'));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ fixture, datasets }) => {
      window.testSaves = [];
      window.testQueries = [];
      window.testDirty = 0;
      window.dbeaverSaveDashboard = json => { window.testSaves.push(JSON.parse(json)); return 'test/dashboard.json'; };
      window.dbeaverSaveConfiguration = () => true;
      window.dbeaverDashboardChanged = () => { window.testDirty++; return true; };
      window.dbeaverListConnections = () => JSON.stringify([
        { project: 'General', connection: 'Sales test', connectionId: 'sales-id' },
        { project: 'Other', connection: 'Other test', connectionId: 'other-id' }
      ]);
      window.dbeaverApproveWidgetQueries = () => true;
      window.dbeaverResetDashboardQueries = () => true;
      window.dbeaverCancelWidgetQuery = () => true;
      window.dbeaverExecuteWidgetQuery = (id, sql) => {
        window.testQueries.push({ id, sql });
        const data = sql.includes('AS total_by_region')
          ? { columns: [{ name: 'region', kind: 'STRING' }, { name: 'total_by_region', kind: 'NUMERIC' }], rows: [['Costa', 12000], ['Sierra', 18000]] }
          : datasets[id.includes('mapa') ? 8 : 0];
        setTimeout(() => window.DBeaverECharts.setWidgetSnapshot(id, {
          ...data, schemaVersion: 1, rowCount: data.rows.length, exportedRowCount: data.rows.length,
          effectiveMaxRows: 5000, truncated: false
        }), 0);
        return true;
      };
      window.dbeaverBrowserReady = () => { window.DBeaverECharts.loadDashboard(fixture, true); return true; };
    }, { fixture, datasets });
    await page.goto(pathToFileURL(path.join(root, 'plugins/org.example.dbeaver.echarts/web/index.html')).href);
    assert.equal(await page.evaluate(() => window.testQueries.length), 0, 'Opening a dashboard must not execute SQL');
    await page.locator('#reviewDashboardSql').click();
    assert.equal(await page.locator('#queryReviewSources pre').count(), 3);
    assert.equal(await page.locator('#queryReviewSources pre').first().textContent(), fixture.widgets[0].source.sql);
    const reviewScreenshot = path.join(root, '.dev/screenshots/dashboard-query-review.png');
    fs.mkdirSync(path.dirname(reviewScreenshot), { recursive: true });
    await page.screenshot({ path: reviewScreenshot });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.testQueries.length), 0, 'Cancelling review must not execute SQL');
    await page.locator('#refreshDashboard').click();
    await page.locator('#runReviewedQueries').click();
    await page.waitForFunction(() => document.querySelectorAll('.widget-chart canvas').length === 3);
    const first = page.locator('[data-widget-id="ventas-diarias-linea"]');
    const layout = () => page.evaluate(() => window.DBeaverECharts.dashboardDocument().widgets[0].layout);
    const queryCount = await page.evaluate(() => window.testQueries.length);
    const original = await layout();
    const box = await first.boundingBox();
    const pitchX = (box.width + 8) / original.width;
    const move = await first.locator('.widget-drag-handle').boundingBox();
    const start = { x: move.x + move.width / 2, y: move.y + move.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + pitchX * 6, start.y, { steps: 8 });
    await page.mouse.up();
    assert.equal((await layout()).x, 6);
    assert.equal(await page.locator('.widget-layout-preview').count(), 0);

    const corner = await first.locator('.widget-resize-handle').boundingBox();
    const end = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
    await page.mouse.move(end.x, end.y);
    await page.mouse.down();
    await page.mouse.move(end.x - pitchX * 2, end.y + 96, { steps: 8 });
    await page.mouse.up();
    const resized = await layout();
    assert.equal(resized.width, 4);
    assert.equal(resized.height, 10);
    const resizedBox = await first.boundingBox();
    assert.ok(resizedBox.width < box.width && resizedBox.height > box.height);

    const cancelHandle = await first.locator('.widget-drag-handle').boundingBox();
    await page.mouse.move(cancelHandle.x + 12, cancelHandle.y + 12);
    await page.mouse.down();
    await page.mouse.move(cancelHandle.x + 12, cancelHandle.y + 120, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(await layout(), resized);

    // The title remains editable; changing layout must preserve SQL, map and chart interactions.
    await first.locator('.widget-title').fill('Ventas diarias: control');
    await page.locator('#saveDashboard').click();
    const saved = await page.evaluate(() => window.testSaves.at(-1));
    assert.equal(saved.widgets[0].title, 'Ventas diarias: control');
    assert.deepEqual(saved.widgets[0].layout, resized);
    assert.equal(saved.widgets[0].source.sql, fixture.widgets[0].source.sql);
    assert.equal(saved.widgets[2].chart.chartType, 'map');
    assert.equal(await page.evaluate(() => window.testQueries.length), queryCount);
    assert.ok(await page.evaluate(() => window.testDirty > 0));
    await page.evaluate(saved => window.DBeaverECharts.loadDashboard(saved, true), saved);
    assert.equal(await page.evaluate(() => window.testQueries.length), queryCount, 'Reopening clears approvals');
    await page.locator('#reviewDashboardSql').click();
    await page.locator('#runReviewedQueries').click();
    await page.waitForFunction(() => document.querySelectorAll('.widget-chart canvas').length === 3);
    assert.deepEqual(await layout(), resized);
    await page.evaluate(() => window.DBeaverECharts.setTheme({
      background: '#292929', foreground: '#eeeeee', muted: '#aaaaaa', border: '#555555',
      grid: '#444444', controlBackground: '#333333', dark: true
    }));
    const backgrounds = await page.evaluate(() => [...document.querySelectorAll('.widget-chart')]
      .map(element => window.echarts.getInstanceByDom(element).getOption().backgroundColor));
    assert.ok(backgrounds.every(color => color === '#292929'), 'Standalone charts must receive the DBeaver theme');
    await page.setViewportSize({ width: 600, height: 850 });
    assert.deepEqual(await layout(), resized, 'A narrow viewport preserves saved coordinates');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const screenshot = path.join(root, '.dev/screenshots/dashboard-layout.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, fullPage: true });

    // Author entirely inside the standalone dashboard, without a result tab.
    const beforeCreate = await page.evaluate(() => window.DBeaverECharts.dashboardDocument());
    await page.locator('#addWidget').click();
    assert.equal(await page.locator('#widgetEditor').evaluate(element => element.open), true);
    await page.locator('#widgetEditorName').fill('Ventas por región');
    await page.locator('#widgetEditorConnection').selectOption('0');
    const independentSql = 'SELECT region, SUM(ventas) AS total_by_region FROM echarts_test_sales GROUP BY region';
    await page.locator('#widgetEditorSql').fill(independentSql);
    const countBeforePreview = await page.evaluate(() => window.testQueries.length);
    await page.locator('#widgetEditorRun').click();
    await page.waitForFunction(() => document.querySelector('#widgetEditorStatus').textContent.includes('2 rows'));
    assert.equal(await page.locator('#widgetEditorCategory').inputValue(), 'region');
    assert.equal(await page.locator('#widgetEditorSeries input').isChecked(), true);
    await page.locator('#widgetEditorType').selectOption('bar');
    assert.equal(await page.locator('#widgetEditorPreview canvas').count(), 1);
    const barMinimum = await page.evaluate(() => window.echarts.getInstanceByDom(document.querySelector('#widgetEditorPreview'))
      .getModel().getComponent('yAxis').axis.scale.getExtent()[0]);
    assert.equal(barMinimum, 0, 'Positive bars must start from zero so the smallest value stays visible');
    const editorScreenshot = path.join(root, '.dev/screenshots/dashboard-widget-editor.png');
    await page.screenshot({ path: editorScreenshot });
    await page.locator('#widgetEditorSave').click();
    const afterCreate = await page.evaluate(() => window.DBeaverECharts.dashboardDocument());
    assert.equal(afterCreate.widgets.length, 4);
    assert.deepEqual(afterCreate.widgets.slice(0, 3), beforeCreate.widgets, 'Creating a widget must preserve the existing charts');
    const created = afterCreate.widgets[3];
    assert.equal(created.source.sql, independentSql);
    assert.equal(created.source.connectionId, 'sales-id');
    assert.equal(created.chart.xColumn, 'region');
    assert.deepEqual(created.chart.yColumns, ['total_by_region']);
    assert.equal(created.chart.chartType, 'bar');
    assert.equal(await page.evaluate(() => window.testQueries.length), countBeforePreview + 1, 'Apply reuses preview data');

    // Edit a query and returned column mapping, then cancel an uncommitted edit.
    const createdWidget = page.locator(`[data-widget-id="${created.id}"]`);
    await createdWidget.locator('.widget-edit').click();
    await page.locator('#widgetEditorSql').fill(independentSql + ' ORDER BY total_by_region DESC');
    await page.locator('#widgetEditorConnection').selectOption('1');
    await page.locator('#widgetEditorRun').click();
    await page.waitForFunction(() => document.querySelector('#widgetEditorStatus').textContent.includes('2 rows'));
    await page.locator('#widgetEditorType').selectOption('pie');
    await page.locator('#widgetEditorSave').click();
    const edited = await page.evaluate(() => window.DBeaverECharts.dashboardDocument().widgets.at(-1));
    assert.equal(edited.source.sql, independentSql + ' ORDER BY total_by_region DESC');
    assert.equal(edited.source.connectionId, 'other-id');
    assert.equal(edited.chart.chartType, 'pie');
    await createdWidget.locator('.widget-edit').click();
    await page.locator('#widgetEditorSql').fill('SELECT 999');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => window.DBeaverECharts.dashboardDocument().widgets.at(-1)), edited);
    await page.locator('#saveDashboard').click();
    const fullSaved = await page.evaluate(() => window.testSaves.at(-1));
    await page.evaluate(saved => window.DBeaverECharts.loadDashboard(saved, true), fullSaved);
    const queryCountBeforeCancelledCreate = await page.evaluate(() => window.testQueries.length);
    // Waiting messages must not cover the Edit button or prevent new widget creation.
    await createdWidget.locator('.widget-edit').click();
    await page.keyboard.press('Escape');
    await page.locator('#addWidget').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.DBeaverECharts.dashboardDocument().widgets.length), 4);
    assert.equal(await page.evaluate(() => window.testQueries.length), queryCountBeforeCancelledCreate);
    assert.deepEqual(await page.evaluate(() => window.DBeaverECharts.dashboardDocument()), fullSaved);
    assert.deepEqual(errors, []);
    console.log('Headless Edge/ECharts tests OK: real mouse drag/resize, Escape, title edit, SQL preservation and reopening');
    console.log(screenshot);
    console.log('Standalone widget authoring OK: independent SQL, preview, column inference, connection/type changes, Apply/Cancel and reopening');
    console.log(editorScreenshot);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
