'use strict';

// Self-contained CI fixture: real pointer events and bundled ECharts, no database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../.dev/browser-tests/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const initial = { x: 3, y: 2, width: 6, height: 8 };

async function main() {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'dev/dashboards/control-ventas.echarts-dashboard.json'), 'utf8'));
  fixture.widgets = [fixture.widgets[0]];
  fixture.widgets[0].layout = initial;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(fixture => {
      window.testQueries = 0;
      window.testSaves = [];
      window.dbeaverSaveDashboard = json => { window.testSaves.push(JSON.parse(json)); return 'test/dashboard.json'; };
      window.dbeaverSaveConfiguration = () => true;
      window.dbeaverDashboardChanged = () => true;
      window.dbeaverApproveWidgetQueries = () => true;
      window.dbeaverResetDashboardQueries = () => true;
      window.dbeaverExecuteWidgetQuery = id => {
        window.testQueries++;
        setTimeout(() => window.DBeaverECharts.setWidgetSnapshot(id, {
          schemaVersion: 1,
          columns: [{ name: 'fecha', kind: 'DATETIME' }, { name: 'ventas', kind: 'NUMERIC' }, { name: 'costos', kind: 'NUMERIC' }],
          rows: Array.from({ length: 8 }, (_, index) => [new Date(Date.UTC(2026, 6, index + 1)).toISOString(), 10000 + index * 500, 20000 + index * 800]),
          rowCount: 8, exportedRowCount: 8, effectiveMaxRows: 5000, truncated: false
        }), 0);
        return true;
      };
      window.dbeaverBrowserReady = () => { window.DBeaverECharts.loadDashboard(fixture, true); return true; };
    }, fixture);
    await page.goto(pathToFileURL(path.join(root, 'plugins/org.example.dbeaver.echarts/web/index.html')).href);
    const card = page.locator('.dashboard-widget');
    const layout = () => page.evaluate(() => window.DBeaverECharts.dashboardDocument().widgets[0].layout);
    async function load(document = fixture) {
      await page.evaluate(document => window.DBeaverECharts.loadDashboard(document, true), document);
      await page.locator('#reviewDashboardSql').click();
      await page.locator('#runReviewedQueries').click();
      await page.waitForFunction(() => document.querySelectorAll('.widget-chart canvas').length === 1);
    }
    async function drag(edge, cancel = false) {
      const handle = card.locator(`[data-resize-edge="${edge}"]`);
      await handle.scrollIntoViewIfNeeded();
      const bounds = await handle.boundingBox();
      const box = await card.boundingBox();
      const pitch = (box.width + 8) / initial.width;
      const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + (edge.includes('w') ? -pitch : edge.includes('e') ? pitch : 0),
        start.y + (edge.includes('n') ? -48 : edge.includes('s') ? 48 : 0), { steps: 5 });
      assert.equal(await page.locator('.widget-layout-preview').count(), 1, `${edge}: live preview`);
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.equal(await page.locator('.widget-layout-preview').count(), 0, `${edge}: preview cleaned up`);
      assert.equal(await page.locator('.dashboard-grid').evaluate(element => element.style.cursor), '', `${edge}: cursor restored`);
    }

    for (const edge of ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']) {
      await load();
      const beforeQueries = await page.evaluate(() => window.testQueries);
      const expected = {
        x: initial.x - (edge.includes('w') ? 1 : 0),
        y: initial.y - (edge.includes('n') ? 1 : 0),
        width: initial.width + (/[ew]/.test(edge) ? 1 : 0),
        height: initial.height + (/[ns]/.test(edge) ? 1 : 0)
      };
      // Three positions along each straight border must hit the resize surface.
      if (edge.length === 1) {
        assert.ok(await card.locator(`[data-resize-edge="${edge}"]`).evaluate((element, edge) => {
          const box = element.getBoundingClientRect();
          return [.1, .5, .9].every(fraction => document.elementFromPoint(
            box.x + box.width * (/[ns]/.test(edge) ? fraction : .5),
            box.y + box.height * (/[ew]/.test(edge) ? fraction : .5)) === element);
        }, edge), `${edge}: the whole edge is reachable`);
      }
      await drag(edge);
      assert.deepEqual(await layout(), expected, `${edge}: opposite edge stays anchored`);
      const dimensions = await card.locator('.widget-chart').evaluate(element => ({
        width: element.clientWidth, height: element.clientHeight,
        chartWidth: window.echarts.getInstanceByDom(element).getWidth(),
        chartHeight: window.echarts.getInstanceByDom(element).getHeight()
      }));
      assert.equal(dimensions.width, dimensions.chartWidth, `${edge}: chart width follows the card`);
      assert.equal(dimensions.height, dimensions.chartHeight, `${edge}: chart height follows the card`);
      await page.locator('#saveDashboard').click();
      const saved = await page.evaluate(() => window.testSaves.at(-1));
      assert.deepEqual(saved.widgets[0].layout, expected);
      assert.equal(saved.widgets[0].source.sql, fixture.widgets[0].source.sql);
      assert.equal(await page.evaluate(() => window.testQueries), beforeQueries, `${edge}: layout changes never execute SQL`);
      await page.evaluate(saved => window.DBeaverECharts.loadDashboard(saved, true), saved);
      assert.deepEqual(await layout(), expected, `${edge}: saved layout reopens`);
      assert.equal(await page.evaluate(() => window.testQueries), beforeQueries, `${edge}: reopening never executes SQL`);
      await load();
      await drag(edge, true);
      assert.deepEqual(await layout(), initial, `${edge}: Escape restores the original layout`);
    }

    await card.locator('[data-resize-edge="se"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal((await layout()).width, 7, 'Keyboard resize remains available');
    assert.equal(await card.locator('[data-resize-edge="se"]').evaluate(element => element === document.activeElement), true);
    await card.locator('.widget-drag-handle').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal((await layout()).x, 2, 'Keyboard move remains available');

    for (const dark of [false, true]) {
      await page.evaluate(dark => window.DBeaverECharts.setTheme({
        background: dark ? '#303030' : '#ffffff', foreground: dark ? '#eeeeee' : '#222222',
        muted: dark ? '#b0b0b0' : '#666666', border: dark ? '#555555' : '#cccccc',
        grid: dark ? '#555555' : '#dddddd', controlBackground: dark ? '#383838' : '#f3f3f3', dark
      }), dark);
      for (const width of [360, 480, 600, 900, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const savedLayout = await layout();
        for (const selector of ['#addWidget', '#saveDashboard', '#reviewDashboardSql', '#dashboardFiles > summary', '#displayOptions > summary']) {
          const box = await page.locator(selector).boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= width, `${selector} fits ${width}px`);
        }
        await page.locator('#dashboardFiles > summary').click();
        const panel = await page.locator('#dashboardFiles .popover-panel').boundingBox();
        assert.ok(panel.x >= 0 && panel.x + panel.width <= width, `Files menu fits ${width}px: ${JSON.stringify(panel)}`);
        await page.locator('#displayOptions > summary').click();
        assert.equal(await page.locator('#dashboardFiles').evaluate(element => element.open), false, 'Only one menu stays open');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#displayOptions').evaluate(element => element.open), false);
        assert.equal(await page.locator('#displayOptions > summary').evaluate(element => element === document.activeElement), true, 'Escape restores menu focus');
        await page.locator('#dashboardFiles > summary').click();
        await page.locator('#dashboardTitle').click();
        assert.equal(await page.locator('#dashboardFiles').evaluate(element => element.open), false, 'Clicking outside closes menus');
        assert.deepEqual(await layout(), savedLayout, 'Narrow viewports preserve coordinates');
      }
      const screenshot = path.join(root, `.dev/screenshots/dashboard-ux-${dark ? 'dark' : 'light'}.png`);
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot });
    }
    assert.deepEqual(errors, []);
    console.log('Dashboard UX OK: all 8 mouse resize directions, anchored edges, live ECharts resize, Escape, keyboard, SQL preservation, save/reopen, menus and 360–1440px light/dark toolbar');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
