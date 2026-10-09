(() => {
  'use strict';

  const COLUMNS = 12;
  const ROW_HEIGHT = 40;
  const GAP = 8;
  const MAX_ROWS = 1024;
  const MIN_WIDTH = 4;
  const MIN_HEIGHT = 5;
  const MAX_HEIGHT = 24;

  function integer(value, fallback, min, max) {
    const number = Number(value);
    return value !== null && value !== undefined && Number.isFinite(number)
      ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
  }

  function normalizeLayout(value, bounds = {}) {
    const width = integer(value?.width, integer(value?.columnSpan, 1, 1, 2) * 6, bounds.minWidth ?? MIN_WIDTH, COLUMNS);
    const height = integer(value?.height, integer(value?.rowSpan, 1, 1, 2) * 8, bounds.minHeight ?? MIN_HEIGHT, bounds.maxHeight ?? MAX_HEIGHT);
    return {
      x: integer(value?.x, null, 0, COLUMNS - width),
      y: integer(value?.y, null, 0, MAX_ROWS - height),
      width,
      height
    };
  }

  function overlaps(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  function findSpace(layout, occupied) {
    const free = candidate => occupied.every(other => !overlaps(candidate, other));
    if (layout.x !== null && layout.y !== null && free(layout)) return layout;
    const firstRow = layout.y ?? 0;
    // Preserve the preferred row when possible; fall back to earlier gaps at the bottom bound.
    for (const [start, end] of [[firstRow, MAX_ROWS - layout.height], [0, firstRow - 1]]) {
      for (let y = start; y <= end; y++) {
        for (let x = 0; x <= COLUMNS - layout.width; x++) {
          const candidate = { ...layout, x, y };
          if (free(candidate)) return candidate;
        }
      }
    }
    throw new Error('Dashboard has no space for this widget.');
  }

  function placeWidgets(widgets, priorityId, bounds) {
    const occupied = [];
    const priority = widgets.find(widget => widget.id === priorityId);
    const ordered = priority ? [priority, ...widgets.filter(widget => widget !== priority)] : widgets;
    for (const widget of ordered) {
      widget.layout = findSpace(normalizeLayout(widget.layout, bounds), occupied);
      occupied.push(widget.layout);
    }
    return widgets;
  }

  function changeLayout(widgets, id, layout, bounds) {
    const widget = widgets.find(item => item.id === id);
    if (!widget) return;
    widget.layout = normalizeLayout(layout, bounds);
    placeWidgets(widgets, id, bounds);
  }

  function resizeLayout(initial, edge, dx, dy, bounds = {}) {
    const minWidth = bounds.minWidth ?? MIN_WIDTH, minHeight = bounds.minHeight ?? MIN_HEIGHT, maxHeight = bounds.maxHeight ?? MAX_HEIGHT;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    let left = initial.x, right = initial.x + initial.width;
    let top = initial.y, bottom = initial.y + initial.height;
    if (edge.includes('w')) left = clamp(left + dx, Math.max(0, right - COLUMNS), right - minWidth);
    if (edge.includes('e')) right = clamp(right + dx, left + minWidth, COLUMNS);
    if (edge.includes('n')) top = clamp(top + dy, Math.max(0, bottom - maxHeight), bottom - minHeight);
    if (edge.includes('s')) bottom = clamp(bottom + dy, top + minHeight, Math.min(MAX_ROWS, top + maxHeight));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  window.DBeaverDashboardLayout = Object.freeze({
    COLUMNS, ROW_HEIGHT, GAP, MAX_ROWS, MIN_WIDTH, MIN_HEIGHT, MAX_HEIGHT,
    normalizeLayout, overlaps, placeWidgets, changeLayout, resizeLayout
  });
})();
