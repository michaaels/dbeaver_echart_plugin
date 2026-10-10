'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('plugins/org.example.dbeaver.echarts/web/js/dashboard-layout.js', 'utf8'), sandbox);
const layout = sandbox.window.DBeaverDashboardLayout;
const plain = value => JSON.parse(JSON.stringify(value));

const legacy = [
  { id: 'left', layout: { columnSpan: 1, rowSpan: 1 } },
  { id: 'right', layout: { columnSpan: 1, rowSpan: 1 } },
  { id: 'map', layout: { columnSpan: 2, rowSpan: 1 } }
];
layout.placeWidgets(legacy);
assert.deepEqual(plain(legacy.map(widget => widget.layout)), [
  { x: 0, y: 0, width: 6, height: 8 }, { x: 6, y: 0, width: 6, height: 8 }, { x: 0, y: 8, width: 12, height: 8 }
]);
layout.changeLayout(legacy, 'left', { ...legacy[0].layout, x: 6, y: 0 });
assert.equal(legacy[0].layout.x, 6);
assert.equal(legacy[1].layout.x, 0, 'Occupied widgets move into available space');
assert.equal(legacy[2].layout.y, 8, 'Unrelated placements stay intact');
layout.changeLayout(legacy, 'left', { ...legacy[0].layout, height: 12 });
assert.equal(legacy[2].layout.y, 12, 'Growing a widget makes room without overlapping');
const saved = JSON.stringify(legacy);
layout.placeWidgets(legacy);
assert.equal(JSON.stringify(legacy), saved, 'Rendering and reopening never repack a valid saved layout');

assert.deepEqual(plain(layout.normalizeLayout({ x: -10, y: Infinity, width: 100, height: -30 })),
  { x: 0, y: null, width: 12, height: 5 });
assert.deepEqual(plain(layout.normalizeLayout({ x: 99, y: -1, width: 4.2, height: 7.8 })),
  { x: 8, y: 0, width: 4, height: 8 });

// All 24 widgets must fit even with maximal sizes or colliding imported coordinates.
const packed = Array.from({ length: 24 }, (_, index) => ({ id: String(index), layout: { x: 0, y: 0, width: 12, height: 24 } }));
layout.placeWidgets(packed);
for (let step = 0; step < 100; step++) {
  const widget = packed[step % packed.length];
  layout.changeLayout(packed, widget.id, { x: step % 12, y: step % 15, width: 4 + step % 9, height: 5 + step % 20 });
  for (const [index, current] of packed.entries()) {
    assert.ok(current.layout.x >= 0 && current.layout.x + current.layout.width <= 12);
    assert.ok(current.layout.y >= 0 && current.layout.y + current.layout.height <= 1024);
    for (const other of packed.slice(index + 1)) assert.equal(layout.overlaps(current.layout, other.layout), false);
  }
}
const initial = { x: 3, y: 2, width: 6, height: 8 };
const expected = {
  e: [3, 2, 7, 8], w: [2, 2, 7, 8], n: [3, 1, 6, 9], s: [3, 2, 6, 9],
  ne: [3, 1, 7, 9], nw: [2, 1, 7, 9], se: [3, 2, 7, 9], sw: [2, 2, 7, 9]
};
for (const [edge, values] of Object.entries(expected)) {
  const result = layout.resizeLayout(initial, edge, edge.includes('w') ? -1 : 1, edge.includes('n') ? -1 : 1);
  assert.deepEqual(plain(result), { x: values[0], y: values[1], width: values[2], height: values[3] }, edge);
}
assert.deepEqual(plain(layout.resizeLayout(initial, 'nw', 999, 999)), { x: 5, y: 5, width: 4, height: 5 }, 'Minimum size preserves the opposite corner');
assert.deepEqual(plain(layout.resizeLayout(initial, 'nw', -999, -999)), { x: 0, y: 0, width: 9, height: 10 }, 'Top and left cannot cross dashboard bounds');
assert.deepEqual(plain(layout.resizeLayout(initial, 'se', 999, 999)), { x: 3, y: 2, width: 9, height: 24 }, 'Right bound and maximum height');
console.log('Dashboard layout tests OK: legacy migration, eight-edge resize anchoring/bounds, move, persistence and 24-widget collisions');
