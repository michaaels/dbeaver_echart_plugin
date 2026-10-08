'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../.dev/browser-tests/node_modules/playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    await page.setContent('<div id="chart"></div>');
    for (const file of ['echarts.min.js', 'analytics.js']) {
      await page.addScriptTag({ path: path.join(root, 'plugins/org.example.dbeaver.echarts/web/js', file) });
    }
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const renderer of ['canvas', 'svg']) {
      for (const dark of [false, true]) {
        for (const chartType of ['line', 'bar']) {
          for (const width of [320, 600, 920]) {
            const result = await page.evaluate(({ renderer, dark, width, chartType }) => {
              const element = document.getElementById('chart');
              window.echarts.getInstanceByDom(element)?.dispose();
              element.style.width = width + 'px';
              element.style.height = '360px';
              const theme = {
                background: dark ? '#292929' : '#ffffff', foreground: dark ? '#eeeeee' : '#222222',
                muted: dark ? '#aaaaaa' : '#666666', border: '#777777', grid: '#777777',
                controlBackground: dark ? '#333333' : '#eeeeee'
              };
              const rows = Array.from({ length: 90 }, (_, index) => [
                new Date(Date.UTC(2026, 6, index + 1)).toISOString(), 10000 + index * 20, 22000 + index * 30
              ]);
              const chart = window.echarts.init(element, null, { renderer });
              const option = window.DBeaverEChartsAnalytics.buildOption({
                columns: [{ name: 'fecha', kind: 'DATETIME' }, { name: 'ventas', kind: 'NUMERIC' }, { name: 'costos', kind: 'NUMERIC' }],
                rows, rowCount: rows.length, xIndex: 0, yIndices: [1, 2], yAxes: { 1: 'left', 2: 'right' },
                chartType, marks: {}, theme
              });
              option.animation = false;
              chart.setOption(option);
              const labels = type => {
                const found = [];
                chart.getModel().eachComponent(type, model => {
                  chart.getViewOfComponentModel(model).group.traverse(element => {
                    if (element.type !== 'text' || element.ignore || element.invisible || !element.style.text) return;
                    const rectangle = element.getBoundingRect().clone();
                    if (element.transform) rectangle.applyTransform(element.transform);
                    found.push({ text: String(element.style.text), rectangle });
                  });
                });
                return found;
              };
              const overlap = (a, b) => a.x < b.x + b.width - 0.5 && a.x + a.width > b.x + 0.5
                && a.y < b.y + b.height - 0.5 && a.y + a.height > b.y + 0.5;
              const legend = labels('legend').filter(label => ['ventas', 'costos'].includes(label.text));
              const axes = labels('yAxis');
              const xLabels = labels('xAxis').filter(label => label.text !== 'fecha');
              return {
                legendCount: legend.length,
                collisions: legend.flatMap(a => axes.filter(b => overlap(a.rectangle, b.rectangle)).map(b => [a.text, b.text])),
                tickCollisions: xLabels.flatMap((a, index) => xLabels.slice(index + 1)
                  .filter(b => overlap(a.rectangle, b.rectangle)).map(b => [a.text, b.text]))
              };
            }, { renderer, dark, width, chartType });
            const scenario = `${chartType}, ${renderer}, ${dark ? 'dark' : 'light'}, ${width}px`;
            assert.equal(result.legendCount, 2, scenario);
            assert.deepEqual(result.collisions, [], `Legend/axis name collision: ${scenario}`);
            assert.deepEqual(result.tickCollisions, [], `Date tick collision: ${scenario}`);
          }
        }
      }
    }
    const screenshot = path.join(root, '.dev/screenshots/chart-labels.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot });
    assert.deepEqual(errors, []);
    console.log('Chart label layout tests OK: line/bar, Canvas/SVG, light/dark, 320/600/920px, dual axes and 90 dates');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
