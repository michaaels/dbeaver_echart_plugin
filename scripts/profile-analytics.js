'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('plugins/org.example.dbeaver.echarts/web/js/analytics.js', 'utf8'), context);
const analytics = context.window.DBeaverEChartsAnalytics;

const rowCount = Number(process.argv[2] || 50000);
const rows = Array.from({ length: rowCount }, (_, index) => [
  new Date(2026, 0, 1, 0, index).toISOString(),
  Math.sin(index / 100) * 1000 + index / 10,
  Math.cos(index / 140) * 50 + 100,
  -180 + (index % 36000) / 100,
  -90 + (index % 18000) / 100
]);
const columns = [
  { name: 'date', kind: 'DATETIME' },
  { name: 'traffic', kind: 'NUMERIC' },
  { name: 'quality', kind: 'NUMERIC' },
  { name: 'longitude', kind: 'NUMERIC' },
  { name: 'latitude', kind: 'NUMERIC' }
];
const theme = {
  background: '#fff', foreground: '#222', muted: '#666', border: '#ccc', grid: '#ddd', controlBackground: '#f5f5f5'
};

function measure(chartType, xIndex, yIndices) {
  const start = performance.now();
  const option = analytics.buildOption({
    rows, columns, rowCount, xIndex, yIndices, yAxes: {}, chartType,
    marks: { markLine: false, markArea: false, visualMap: true }, theme
  });
  const elapsed = performance.now() - start;
  console.log(`${chartType}: ${elapsed.toFixed(1)} ms, ${option.series[0].data.length} points`);
}

measure('line', 0, [1, 2]);
measure('scatter', 1, [2]);
measure('map', 3, [4, 1]);
console.log(`heap used: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MiB`);
