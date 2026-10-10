'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchBrowser } = require('./browser-test-runtime');

async function main() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const web = path.resolve(__dirname, '../plugins/org.example.dbeaver.echarts/web');
    let catalog;
    for (const file of ['index.html', 'report.html']) {
      await page.goto(pathToFileURL(path.join(web, file)).href);
      const options = await page.locator('#chartType option').evaluateAll(options => options.map(option => option.value));
      if (catalog) assert.deepEqual(options, catalog, 'Reports and dashboards offer the same supported chart types');
      catalog = options;
    }
    assert.equal(catalog.length, 15);
    for (const renderer of ['canvas', 'svg']) {
      for (const chartType of catalog) {
        const result = await page.evaluate(({ renderer, chartType }) => {
          const rows = [['Quito', 10, 3, -78.4678, -0.1807], ['Cuenca', 8, 4, -79.0045, -2.9006], ['Quito', 5, 2, -78.4678, -0.1807]];
          const columns = ['city', 'sales', 'costs', 'longitude', 'latitude'].map((name, index) => ({ name, kind: index ? 'NUMERIC' : 'STRING' }));
          const context = { rows, columns, rowCount: rows.length, xIndex: chartType === 'map' ? 3 : chartType === 'scatter' ? 1 : 0,
            yIndices: chartType === 'map' ? [4, 1] : chartType === 'scatter' ? [2] : [1, 2], yAxes: {}, chartType, marks: {},
            theme: { background: '#ffffff', foreground: '#243447', muted: '#657487', border: '#d5dce3', grid: '#e5eaf0', controlBackground: '#f3f3f3' } };
          const mount = document.createElement('div'); mount.style.cssText = 'width:760px;height:420px'; document.body.append(mount);
          const chart = window.echarts.init(mount, null, { renderer });
          try {
            const option = window.DBeaverEChartsAnalytics.buildOption(context); option.animation = false;
            chart.setOption(option);
            const rendered = chart.getOption(), image = chart.getDataURL({ type: 'png', backgroundColor: '#ffffff' });
            const shapes = renderer === 'svg' ? mount.querySelectorAll('path').length : mount.querySelectorAll('canvas').length;
            return { data: window.DBeaverEChartsAnalytics.hasRenderableData(rendered), shapes, imageLength: image.length,
              seriesType: rendered.series[0].type, count: rendered.series[0].data.length };
          } finally { chart.dispose(); mount.remove(); }
        }, { renderer, chartType });
        assert.ok(result.data && result.shapes > 0 && result.imageLength > 1000, `${chartType}/${renderer} renders and exports`);
        if (chartType === 'horizontalBar' || chartType === 'stackedBar') assert.equal(result.seriesType, 'bar');
        if (chartType === 'stackedArea') assert.equal(result.seriesType, 'line');
      }
    }
    assert.deepEqual(errors, []);
    console.log('Chart catalog OK: 15 types shared by reports/dashboards, 30 Canvas/SVG renders and image exports');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
