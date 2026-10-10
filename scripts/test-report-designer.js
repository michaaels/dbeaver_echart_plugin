'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../.dev/browser-tests/node_modules/playwright');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'plugins/org.example.dbeaver.echarts/web');
const assets = Object.fromEntries([['echarts', 'js/echarts.min.js'], ['worldMap', 'js/world-map.js'], ['analytics', 'js/analytics.js'],
  ['widgets', 'js/report-widgets.js'], ['paperCss', 'css/report-paper.css']].map(([key, file]) => [key, fs.readFileSync(path.join(web, file), 'utf8')]));
assets.licenses = fs.readFileSync(path.join(web, '../third-party/echarts/LICENSE'), 'utf8');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ assets }) => {
      window.testQueries = []; window.testExports = []; window.testTemplates = [];
      window.dbeaverBrowserReady = () => true;
      window.dbeaverSaveConfiguration = () => true; window.dbeaverDashboardChanged = () => true;
      window.dbeaverListConnections = () => JSON.stringify([{ project: 'General', connection: 'Demo sales', connectionId: 'demo-sales' }]);
      window.dbeaverApproveWidgetQueries = () => true; window.dbeaverResetDashboardQueries = () => true; window.dbeaverCancelWidgetQuery = () => true;
      window.dbeaverReportPickImage = () => {
        const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 56;
        const context = canvas.getContext('2d'); context.fillStyle = '#245f91'; context.fillRect(0, 0, 180, 56);
        context.fillStyle = '#ffffff'; context.font = 'bold 20px Segoe UI'; context.fillText('VENTAS', 44, 35);
        context.fillRect(15, 32, 5, 12); context.fillRect(24, 24, 5, 20); context.fillRect(33, 15, 5, 29);
        return canvas.toDataURL('image/png');
      }; window.dbeaverReportExportAssets = () => JSON.stringify(assets);
      window.dbeaverSaveReport = json => { window.testTemplates.push(JSON.parse(json)); return 'Reports/ECharts/demo.echarts-report.json'; };
      window.dbeaverExportReport = (content, kind, title) => { window.testExports.push({ content, kind, title }); return JSON.stringify({ path: `demo.${kind}`, opened: false, sent: false }); };
      window.dbeaverExecuteWidgetQuery = (id, sql, source) => {
        window.testQueries.push({ id, sql, source: JSON.parse(source) });
        setTimeout(() => window.DBeaverECharts.setWidgetSnapshot(id, { schemaVersion: 1, columns: [
          { name: 'fecha', kind: 'DATETIME' }, { name: 'ventas', kind: 'NUMERIC' }, { name: 'costos', kind: 'NUMERIC' }],
          rows: Array.from({ length: 16 }, (_, index) => [`2026-10-${String(index + 1).padStart(2, '0')}`, 1200 + index * 80, 600 + index * 35]),
          effectiveMaxRows: 5000, rowCount: 16, truncated: false }), 10);
        return true;
      };
    }, { assets });
    await page.goto(pathToFileURL(path.join(web, 'report.html')).href);
    const document = () => page.evaluate(() => window.DBeaverECharts.reportDocument());
    const properties = page.locator('#componentProperties');
    // Reproduce the gap left after deleting a component above existing content.
    await page.evaluate(() => {
      const M = window.DBeaverReportModel, report = M.create('Delete regression');
      const table = M.widget('table'), heading = M.widget('heading');
      table.id = 'remove-me'; heading.id = 'keep-me'; heading.layout.y = table.layout.height;
      report.widgets.push(table, heading); window.DBeaverECharts.loadReport(report);
    });
    await page.locator('[data-layer-id="remove-me"]').click();
    await properties.getByRole('button', { name: 'Delete', exact: true }).click();
    assert.equal((await document()).widgets[0].layout.y, 0, 'Deleting the first component reclaims the space');
    await page.locator('#undoReport').click();
    assert.equal((await document()).widgets.find(w => w.id === 'keep-me').layout.y, 8, 'Undo restores the original layout');
    await page.locator('#redoReport').click();
    assert.equal((await document()).widgets[0].layout.y, 0);
    await page.evaluate(() => window.DBeaverECharts.loadReport(window.DBeaverReportModel.create()));
    await page.locator('#reportTitle').fill('Reporte diario de ventas');
    await page.locator('[data-component-type="heading"]').click();
    await properties.getByLabel('Text', { exact: true }).fill('Ventas · {{start_date}}');
    const headingLayout = (await document()).widgets[0].layout;
    await page.locator('[data-component-type="image"]').click();
    assert.deepEqual((await document()).widgets[0].layout, headingLayout, 'Click-to-add preserves existing positions');
    await properties.getByRole('button', { name: 'Choose local image', exact: true }).click();
    assert.ok((await document()).widgets.find(widget => widget.type === 'image').config.image.startsWith('data:image/png'));
    await page.locator('#reportParameters').click();
    await page.locator('#addReportParameter').click();
    await page.locator('#reportParameterList').getByLabel('Name', { exact: true }).fill('start_date');
    await page.locator('#reportParameterHeading').click();
    await page.locator('#reportParameterList').getByLabel('Type', { exact: true }).selectOption('date');
    await page.locator('#reportParameterList').getByLabel('Default value', { exact: true }).fill('2026-10-01');
    await page.locator('#reportParameterHeading').click();
    await page.locator('#reportParameterList').getByLabel('Current value', { exact: true }).fill('2026-10-01');
    await page.locator('#reportParameterHeading').click();
    await page.locator('[data-close="reportParameterDialog"]').click();
    await page.locator('#reportData').click(); await page.locator('#addReportSource').click();
    await page.locator('#reportSourceForm').getByLabel('Query name', { exact: true }).fill('Ventas diarias');
    await page.locator('#reportSourceForm').getByLabel('Connection', { exact: true }).selectOption('0');
    const sql = 'SELECT fecha, ventas, costos FROM ventas_demo WHERE fecha >= :start_date';
    await page.locator('#reportSourceForm').getByLabel('SQL', { exact: true }).fill(sql);
    await page.locator('[data-close="reportDataDialog"]').click();
    const sourceId = (await document()).sources[0].id;
    await page.locator('[data-component-type="chart"]').click();
    await properties.getByLabel('Query', { exact: true }).selectOption(sourceId);
    await properties.getByRole('button', { name: 'Configure chart and preview SQL' }).click();
    await page.locator('#widgetEditorRun').click();
    await page.waitForFunction(() => document.querySelector('#widgetEditorStatus').textContent.includes('16 rows'));
    await page.locator('#widgetEditorName').fill('Ventas y costos diarios');
    await page.getByLabel('Series costos', { exact: true }).check();
    await page.getByLabel('Axis costos', { exact: true }).selectOption('right');
    await page.locator('#widgetEditorSave').click();
    assert.equal(await page.locator('#reportCanvas .report-chart canvas').count(), 1);
    const previewQueries = await page.evaluate(() => window.testQueries.length);
    await page.locator('[data-component-type="kpi"]').click();
    await properties.getByLabel('Query', { exact: true }).selectOption(sourceId);
    await properties.getByLabel('Value column', { exact: true }).selectOption('ventas');
    await properties.getByLabel('Component title', { exact: true }).fill('Ventas acumuladas');
    await page.locator('[data-component-type="table"]').click();
    await properties.getByLabel('Query', { exact: true }).selectOption(sourceId);
    await properties.getByLabel('Show totals / subtotals', { exact: true }).check();
    await properties.getByLabel('Rows per page', { exact: true }).fill('5'); await properties.getByLabel('Rows per page', { exact: true }).press('Tab');
    assert.equal(await page.locator('#reportCanvas .report-table tbody tr').count(), 7);
    await page.locator('#reportCanvas .report-pagination').getByRole('button', { name: 'Next', exact: true }).click();
    assert.match(await page.locator('#reportCanvas .report-table tbody tr').first().textContent(), /06.*2026/);
    await properties.getByLabel('Rows per page', { exact: true }).fill('20'); await properties.getByLabel('Rows per page', { exact: true }).press('Tab');
    const salesColumn = properties.locator('[data-column-name="ventas"]'); await salesColumn.locator('summary').click();
    await salesColumn.getByLabel('Column heading', { exact: true }).fill('Ventas');
    await salesColumn.getByLabel('Conditional color', { exact: true }).check();
    await salesColumn.getByLabel('Rule threshold', { exact: true }).fill('1500'); await salesColumn.getByLabel('Rule threshold', { exact: true }).press('Tab');
    assert.ok(await page.locator('#reportCanvas .report-table td').evaluateAll(cells => cells.some(cell => getComputedStyle(cell).color === 'rgb(180, 35, 24)')));
    await properties.getByLabel('Subtotal group', { exact: true }).selectOption('fecha');
    assert.equal(await page.locator('#reportCanvas .report-total').count(), 34, '16 groups plus total, label and values per group');
    await properties.getByLabel('Subtotal group', { exact: true }).selectOption('');
    await properties.getByLabel('Condition column (first row)', { exact: true }).selectOption('ventas');
    await properties.getByLabel('Show only when condition matches', { exact: true }).check();
    await properties.getByLabel('Condition', { exact: true }).selectOption('gt');
    await properties.getByLabel('Compare to', { exact: true }).fill('999999');
    await page.locator('#previewReport').click();
    assert.equal(await page.locator('#reportPreviewCanvas .report-table').count(), 0, 'Conditional visibility is applied to preview');
    await page.locator('[data-close="reportPreviewDialog"]').click();
    await properties.getByLabel('Show only when condition matches', { exact: true }).uncheck();
    assert.equal(await page.evaluate(() => window.testQueries.length), previewQueries, 'New widgets reuse an existing source snapshot');
    const beforeMove = await document(), table = beforeMove.widgets.find(widget => widget.type === 'table');
    const frame = page.locator(`[data-component-id="${table.id}"]`);
    await frame.locator('.report-move').scrollIntoViewIfNeeded();
    await frame.locator('.report-move').focus(); await page.keyboard.press('ArrowDown');
    assert.equal((await document()).widgets.find(widget => widget.id === table.id).layout.y, table.layout.y + 1);
    await page.locator('#undoReport').click();
    assert.deepEqual((await document()).widgets.find(widget => widget.id === table.id).layout, table.layout);
    await page.locator('#redoReport').click();
    await properties.getByRole('button', { name: 'Duplicate', exact: true }).click();
    assert.equal((await document()).widgets.filter(widget => widget.type === 'table').length, 2);
    await properties.getByRole('button', { name: 'Delete', exact: true }).click();
    assert.equal((await document()).widgets.filter(widget => widget.type === 'table').length, 1);
    // Arrange the final report through the same properties controls a user uses.
    await page.locator('[data-component-type="date"]').click();
    const arranged = await document();
    const layouts = { heading: { x: 0, y: 0, width: 9, height: 2 }, image: { x: 10, y: 0, width: 2, height: 2 },
      kpi: { x: 0, y: 2, width: 12, height: 3 }, chart: { x: 0, y: 5, width: 7, height: 20 },
      table: { x: 7, y: 5, width: 5, height: 20 }, date: { x: 0, y: 25, width: 12, height: 1 } };
    // Reserve empty rows first so intermediate edits do not displace finished components.
    for (const widget of arranged.widgets) {
      await page.locator(`[data-layer-id="${widget.id}"]`).click();
      await properties.getByLabel('Row', { exact: true }).fill(String(100 + arranged.widgets.indexOf(widget) * 30));
      await properties.getByLabel('Row', { exact: true }).press('Tab');
    }
    for (const widget of arranged.widgets) {
      await page.locator(`[data-layer-id="${widget.id}"]`).click();
      for (const [name, label] of [['width', 'Width (columns)'], ['height', 'Height (rows)'], ['x', 'Column'], ['y', 'Row']]) {
        await properties.getByLabel(label, { exact: true }).fill(String(layouts[widget.type][name]));
        await properties.getByLabel(label, { exact: true }).press('Tab');
      }
    }
    assert.deepEqual((await document()).widgets.find(widget => widget.type === 'heading').layout, layouts.heading);
    await page.locator('#generateReport').click();
    assert.equal(await page.locator('#reportReviewQueries .report-review-query').count(), 1, 'Shared SQL executes once');
    assert.match(await page.locator('#reportReviewQueries').textContent(), /start_date \(date\): 2026-10-01/);
    await page.locator('#runReportQueries').click();
    await page.waitForFunction(() => document.getElementById('reportPreviewDialog').open);
    assert.equal(await page.evaluate(() => window.testQueries.length), previewQueries + 1);
    assert.equal(await page.locator('#reportPreviewCanvas .report-chart canvas').count(), 1);
    await page.locator('[data-close="reportPreviewDialog"]').click();
    await page.locator('#saveReport').click();
    const saved = await page.evaluate(() => window.testTemplates.at(-1));
    assert.equal(saved.sources[0].sql, sql);
    assert.equal(saved.sources[0].connectionId, 'demo-sales');
    assert.equal(saved.parameters[0].default, '2026-10-01');
    assert.ok(!('rows' in saved) && !('snapshots' in saved));
    for (const mode of ['interactive', 'email', 'template']) {
      await page.locator('#exportReport').click(); await page.locator('#reportExportFormat').selectOption(mode); await page.locator('#saveReportExport').click();
    }
    await page.locator('#outlookReport').click();
    const emailPreview = page.frameLocator('#reportEmailPreview');
    await emailPreview.getByText('Ventas y costos diarios', { exact: true }).waitFor();
    assert.ok(await emailPreview.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), 'Email preview includes loaded chart and logo images');
    assert.equal(await page.locator('.report-check').first().evaluate(label => getComputedStyle(label).display), 'flex', 'Checkbox remains beside its label');
    const previewBox = await page.locator('#reportEmailPreview').boundingBox();
    const fieldsBox = await page.locator('.report-email-fields').boundingBox();
    assert.ok(previewBox.y >= fieldsBox.y + fieldsBox.height && previewBox.width >= fieldsBox.width - 8,
      'Preview is below the draft fields and uses their full width');
    assert.ok(previewBox.height > 200 && previewBox.y + previewBox.height <= 1100, 'Preview is visible below draft fields');
    const outputDirectory = path.join(root, '.dev/screenshots'); fs.mkdirSync(outputDirectory, { recursive: true });
    await page.screenshot({ path: path.join(outputDirectory, 'report-email-compose.png') });
    await page.locator('#reportEmailTo').fill('review@example.com');
    await page.locator('#reportEmailCc').fill('control@example.com');
    await page.locator('#reportEmailMessage').fill('Reporte para revisión.');
    await page.locator('#reportEmailMessage').press('Tab');
    await emailPreview.getByText('Reporte para revisión.', { exact: true }).waitFor();
    await page.setViewportSize({ width: 600, height: 700 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Email dialog stays within a narrow window');
    const saveEmailBox = await page.locator('#saveReportEmail').boundingBox();
    assert.ok(saveEmailBox.y + saveEmailBox.height <= 700, 'Save stays visible while the draft fields scroll');
    await page.setViewportSize({ width: 1700, height: 1100 });
    await page.locator('#reportEmailTo').fill('invalid'); await page.locator('#saveReportEmail').click();
    assert.match(await page.locator('#reportEmailError').textContent(), /email addresses/);
    await page.locator('#reportEmailTo').fill('review@example.com');
    await page.locator('#saveReportEmail').click();
    const exported = await page.evaluate(() => window.testExports);
    const html = exported.find(item => item.kind === 'interactive').content;
    assert.ok(!html.includes(sql) && !html.includes('demo-sales'), 'HTML must not contain SQL or connection identifiers');
    assert.ok(!/\bsrc=["'](?:https?:)?\/\//i.test(html), 'Offline HTML must not load CDN resources');
    const staticHtml = exported.find(item => item.kind === 'email').content;
    assert.ok(!/<script|<canvas|display:\s*grid/i.test(staticHtml));
    assert.match(staticHtml, /Data table/); assert.match(staticHtml, /Ventas y costos diarios/);
    assert.match(staticHtml, /data:image\/png;base64/);
    const eml = exported.find(item => item.kind === 'eml').content;
    assert.match(eml, /X-Unsent: 1\r\n/); assert.match(eml, /Content-ID: <image-/); assert.match(eml, /filename="report.html"/);
    const artifactDir = path.join(root, '.dev/reports'); fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'ventas-interactive.html'), html); fs.writeFileSync(path.join(artifactDir, 'ventas-email.html'), staticHtml); fs.writeFileSync(path.join(artifactDir, 'ventas-draft.eml'), eml);
    fs.writeFileSync(path.join(artifactDir, 'ventas.echarts-report.json'), JSON.stringify(saved, null, 2));
    await page.evaluate(() => window.DBeaverECharts.setTheme({ background: '#303030', foreground: '#eeeeee', muted: '#b0b0b0', border: '#555555', controlBackground: '#383838', dark: true }));
    const screenshot = path.join(root, '.dev/screenshots/report-designer.png'); fs.mkdirSync(path.dirname(screenshot), { recursive: true }); await page.screenshot({ path: screenshot });
    await page.setViewportSize({ width: 900, height: 900 }); await page.locator('#reportZoom').selectOption('0.75');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Designer controls stay within a narrow window');
    await page.screenshot({ path: path.join(root, '.dev/screenshots/report-designer-narrow.png') });
    await page.setViewportSize({ width: 1700, height: 1100 }); await page.locator('#reportZoom').selectOption('1');
    const countBeforeReopen = await page.evaluate(() => window.testQueries.length);
    await page.evaluate(saved => window.DBeaverECharts.loadReport(saved), saved);
    assert.equal(await page.evaluate(() => window.testQueries.length), countBeforeReopen);
    assert.deepEqual(await document(), saved, 'Template reopens without changes or runtime rows');
    const offline = await browser.newContext({ viewport: { width: 1100, height: 1000 }, offline: true });
    const result = await offline.newPage(); const requests = []; result.on('request', request => requests.push(request.url()));
    const reportErrors = []; result.on('pageerror', error => reportErrors.push(error.message));
    await result.goto(pathToFileURL(path.join(artifactDir, 'ventas-interactive.html')).href);
    await result.waitForSelector('.report-chart canvas');
    assert.match(await result.locator('.report-kpi-value').textContent(), /28[,.]?800/);
    assert.equal(await result.locator('.report-table tbody tr').count(), 18);
    assert.ok(requests.every(url => url.startsWith('file:') || url.startsWith('data:')));
    assert.deepEqual(reportErrors, []); assert.deepEqual(errors, []);
    await result.screenshot({ path: path.join(root, '.dev/screenshots/report-html-offline.png'), fullPage: true });
    await result.setViewportSize({ width: 390, height: 900 });
    assert.ok(await result.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const components = await result.locator('.report-component').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom }; }));
    assert.ok(components.every((box, index) => !index || box.top >= components[index - 1].bottom), 'Offline HTML stacks components without overlaps on narrow screens');
    await result.setViewportSize({ width: 1100, height: 1000 });
    await result.goto(pathToFileURL(path.join(artifactDir, 'ventas-email.html')).href);
    assert.equal(await result.locator('script,canvas').count(), 0); assert.equal(await result.locator('table table tbody tr').count() >= 18, true);
    await result.screenshot({ path: path.join(root, '.dev/screenshots/report-email.png'), fullPage: true });
    await offline.close();
    // Static mail must preserve the selected page and explicit height, not expand all 90 rows.
    const tableMail = await page.evaluate(() => {
      const M = window.DBeaverReportModel, W = window.DBeaverReportWidgets, E = window.DBeaverReportExport;
      const report = M.create('Bounded email table'), widget = M.widget('table');
      widget.id = 'bounded-table'; widget.sourceId = 'rows'; widget.layout = { x: 0, y: 0, width: 12, height: 26 };
      widget.config.pageSize = 10; widget.config.totals = true; report.widgets = [widget];
      const snapshots = { rows: { columns: [{ name: 'id', kind: 'NUMERIC' }, { name: 'amount', kind: 'NUMERIC' }],
        rows: Array.from({ length: 90 }, (_, i) => [i + 1, (i + 1) * 100]) } };
      const mount = W.node('div'); document.body.append(mount);
      const dispose = W.renderReport(mount, report, snapshots);
      const designerRows = mount.querySelectorAll('.report-table tbody tr').length; dispose(); mount.remove();
      const pages = { 'bounded-table': 2 }, email = E.emailHtml(report, snapshots, { tablePages: pages }, {});
      const extract = html => { const doc = new DOMParser().parseFromString(html, 'text/html'), rows = [...doc.querySelectorAll('table:not([role]) > tbody > tr')];
        return { rows: rows.length, first: rows[0]?.textContent, last: rows.at(-3)?.textContent, text: doc.body.textContent, html }; };
      widget.config.pageSize = 45;
      const limited = extract(E.emailHtml(report, snapshots, {}, {}));
      widget.layout.height = 50;
      const expanded = extract(E.emailHtml(report, snapshots, {}, {}));
      return { designerRows, selected: extract(email), limited, expanded };
    });
    assert.equal(tableMail.selected.rows, tableMail.designerRows, 'Email preserves configured page size and totals');
    assert.match(tableMail.selected.first, /^21\.00/); assert.match(tableMail.selected.last, /^30\.00/);
    assert.match(tableMail.selected.text, /Rows 21–30 of 90/);
    assert.match(tableMail.selected.text, /409,500\.00/, 'Grand total still covers all source rows');
    assert.ok(tableMail.limited.rows < 47, 'Height bounds a manually larger page');
    assert.equal(tableMail.expanded.rows, 47, 'A manually enlarged height and page can display more rows');
    assert.ok(!/<button|<script|<canvas/.test(tableMail.selected.html), 'Static email contains no inactive pagination buttons');
    console.log('Report Designer OK: visual authoring, image, shared typed SQL, ECharts preview, KPI/table, totals, keyboard layout, undo/redo, duplicate/delete, save/reopen, offline HTML, static email and CID/attachment EML');
    console.log(screenshot);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
