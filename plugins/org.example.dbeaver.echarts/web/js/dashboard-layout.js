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

  function normalizeLayout(value) {
    const width = integer(value?.width, integer(value?.columnSpan, 1, 1, 2) * 6, MIN_WIDTH, COLUMNS);
    const height = integer(value?.height, integer(value?.rowSpan, 1, 1, 2) * 8, MIN_HEIGHT, MAX_HEIGHT);
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

  function placeWidgets(widgets, priorityId) {
    const occupied = [];
    const priority = widgets.find(widget => widget.id === priorityId);
    const ordered = priority ? [priority, ...widgets.filter(widget => widget !== priority)] : widgets;
    for (const widget of ordered) {
      widget.layout = findSpace(normalizeLayout(widget.layout), occupied);
      occupied.push(widget.layout);
    }
    return widgets;
  }

  function changeLayout(widgets, id, layout) {
    const widget = widgets.find(item => item.id === id);
    if (!widget) return;
    widget.layout = normalizeLayout(layout);
    placeWidgets(widgets, id);
  }

  window.DBeaverDashboardLayout = Object.freeze({
    COLUMNS, ROW_HEIGHT, GAP, MAX_ROWS, MIN_WIDTH, MIN_HEIGHT, MAX_HEIGHT,
    normalizeLayout, overlaps, placeWidgets, changeLayout
  });
})();
