(() => {
  'use strict';

  const SCHEMA_VERSION = 1;
  const chartInstances = new Map();
  const resizeObservers = new Map();
  const layoutEngine = window.DBeaverDashboardLayout;
  let activeGesture = null;
  let pendingRender = null;
  let sequence = 0;

  function nextId() {
    sequence += 1;
    return `widget-${Date.now().toString(36)}-${sequence.toString(36)}`;
  }

  function createDashboard() {
    return {
      format: 'dbeaver-echarts-dashboard',
      schemaVersion: SCHEMA_VERSION,
      title: 'Result dashboard',
      renderer: 'canvas',
      variables: {},
      filters: {},
      widgets: []
    };
  }

  function createWidget(chartConfiguration, snapshot) {
    const yColumns = Array.isArray(chartConfiguration.yColumns)
      ? chartConfiguration.yColumns
      : chartConfiguration.yColumn ? [chartConfiguration.yColumn] : [];
    return {
      id: nextId(),
      title: yColumns.length ? yColumns.join(', ') : 'Chart',
      source: normalizeSource(snapshot?.source),
      chart: {
        chartType: chartConfiguration.chartType || 'line',
        xColumn: chartConfiguration.xColumn || null,
        yColumns,
        yAxes: chartConfiguration.yAxes || {},
        marks: chartConfiguration.marks || {}
      },
      refreshPolicy: { mode: 'onResult', intervalSeconds: 0 },
      drillDown: { enabled: true },
      layout: layoutEngine.normalizeLayout(null)
    };
  }

  function normalizeSource(source) {
    return {
      schemaVersion: 1,
      kind: source?.kind === 'activeResultSet' ? 'activeResultSet' : 'savedQuery',
      name: typeof source?.name === 'string' ? source.name : 'Active result set',
      connection: typeof source?.connection === 'string' ? source.connection : null,
      connectionId: typeof source?.connectionId === 'string' ? source.connectionId : null,
      project: typeof source?.project === 'string' ? source.project : null,
      sql: typeof source?.sql === 'string' ? source.sql : ''
    };
  }

  function normalizeDashboard(value) {
    if (!value || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.widgets)
        || (value.format && value.format !== 'dbeaver-echarts-dashboard')) {
      throw new Error('Unsupported dashboard JSON schema.');
    }
    const dashboard = createDashboard();
    dashboard.title = typeof value.title === 'string' ? value.title.slice(0, 200) : dashboard.title;
    dashboard.renderer = value.renderer === 'svg' ? 'svg' : 'canvas';
    dashboard.variables = normalizeDictionary(value.variables);
    dashboard.filters = normalizeDictionary(value.filters);
    if (value.widgets.length > 24) throw new Error('A dashboard supports up to 24 widgets.');
    dashboard.widgets = value.widgets.map(normalizeWidget);
    if (new Set(dashboard.widgets.map(widget => widget.id)).size !== dashboard.widgets.length) {
      throw new Error('Dashboard widget IDs must be unique.');
    }
    layoutEngine.placeWidgets(dashboard.widgets);
    return dashboard;
  }

  // Files contain independent queries, never a reference to a transient result tab.
  function portableDashboard(value, renderer) {
    const dashboard = normalizeDashboard(value);
    if (renderer) dashboard.renderer = renderer === 'svg' ? 'svg' : 'canvas';
    for (const widget of dashboard.widgets) {
      if (!widget.source.sql.trim()) {
        throw new Error(`"${widget.title}" has no SQL. Open Source and assign its query before saving.`);
      }
      widget.source.kind = 'savedQuery';
      if (widget.refreshPolicy.mode === 'onResult') widget.refreshPolicy.mode = 'manual';
    }
    return dashboard;
  }

  function normalizeDictionary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key]) => typeof key === 'string').slice(0, 50));
  }

  function normalizeWidget(value) {
    const chart = value?.chart || {};
    const refreshPolicy = value?.refreshPolicy || {};
    return {
      id: typeof value?.id === 'string' && value.id ? value.id : nextId(),
      title: typeof value?.title === 'string' ? value.title.slice(0, 200) : 'Chart',
      source: normalizeSource(value?.source),
      chart: {
        chartType: typeof chart.chartType === 'string' ? chart.chartType : 'line',
        xColumn: typeof chart.xColumn === 'string' ? chart.xColumn : null,
        yColumns: Array.isArray(chart.yColumns) ? chart.yColumns.filter(name => typeof name === 'string').slice(0, 12) : [],
        yAxes: normalizeDictionary(chart.yAxes),
        marks: normalizeDictionary(chart.marks)
      },
      refreshPolicy: {
        mode: ['manual', 'onResult', 'interval'].includes(refreshPolicy.mode) ? refreshPolicy.mode : 'onResult',
        intervalSeconds: Math.max(0, Math.min(86400, Number(refreshPolicy.intervalSeconds) || 0))
      },
      drillDown: { enabled: value?.drillDown?.enabled !== false },
      layout: layoutEngine.normalizeLayout(value?.layout)
    };
  }

  function render(options) {
    if (activeGesture) { pendingRender = options; return; }
    const {
    root, filterRoot, empty, dashboard, snapshot, widgetSnapshots, widgetErrors, widgetRequests,
    theme, renderer, onChange, onRefresh
    } = options;
    dispose();
    root.replaceChildren();
    renderFilters(filterRoot, dashboard, onChange);
    if (!dashboard.widgets.length) {
      empty.hidden = false;
      empty.textContent = 'Add a widget from the current chart configuration.';
      return;
    }
    empty.hidden = true;
    layoutEngine.placeWidgets(dashboard.widgets);

    for (const widget of dashboard.widgets) {
      const element = document.createElement('article');
      element.className = 'dashboard-widget';
      element.dataset.widgetId = widget.id;
      applyLayout(element, widget.layout);

      const header = buildHeader(widget, dashboard, onChange);
      const chartElement = document.createElement('div');
      chartElement.className = 'widget-chart';
      const footer = buildFooter(widget, onChange, onRefresh);
      element.append(header, chartElement, footer);
      addLayoutControls(root, element, header, widget, dashboard, onChange);
      root.appendChild(element);
      renderWidgetChart(
        chartElement,
        widget,
        dashboard,
        snapshot,
        widgetSnapshots?.get(widget.id),
        widgetErrors?.get(widget.id),
        widgetRequests?.has(widget.id),
        theme,
        renderer,
        onChange
      );
    }
  }

  function applyLayout(element, layout) {
    element.style.gridColumn = `${layout.x + 1} / span ${layout.width}`;
    element.style.gridRow = `${layout.y + 1} / span ${layout.height}`;
  }

  function addLayoutControls(root, element, header, widget, dashboard, onChange) {
    const move = header.querySelector('.widget-drag-handle');
    const resize = document.createElement('button');
    resize.type = 'button';
    resize.className = 'widget-resize-handle';
    resize.textContent = '◢';
    resize.title = 'Drag corner to resize; arrow keys resize the widget';
    resize.setAttribute('aria-label', `Resize ${widget.title}`);
    element.appendChild(resize);
    header.addEventListener('pointerdown', event => {
      if (event.target.closest('.widget-title, button:not(.widget-drag-handle)')) return;
      startLayoutGesture(event, 'move', root, element, header, widget, dashboard, onChange);
    });
    resize.addEventListener('pointerdown', event => {
      startLayoutGesture(event, 'resize', root, element, resize, widget, dashboard, onChange);
    });
    for (const [handle, mode] of [[move, 'move'], [resize, 'resize']]) {
      handle.addEventListener('keydown', event => {
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!delta || activeGesture) return;
        event.preventDefault();
        const layout = proposedLayout(widget.layout, mode, delta[0], delta[1]);
        layoutEngine.changeLayout(dashboard.widgets, widget.id, layout);
        onChange();
        const updated = [...root.children].find(child => child.dataset.widgetId === widget.id);
        updated?.querySelector(`.widget-${mode === 'move' ? 'drag' : 'resize'}-handle`)?.focus();
      });
    }
  }

  function proposedLayout(initial, mode, dx, dy) {
    return layoutEngine.normalizeLayout(mode === 'move'
      ? { ...initial, x: initial.x + dx, y: initial.y + dy }
      : { ...initial, width: Math.min(layoutEngine.COLUMNS - initial.x, initial.width + dx), height: initial.height + dy });
  }

  function startLayoutGesture(event, mode, root, element, handle, widget, dashboard, onChange) {
    if (activeGesture || (event.button ?? 0) !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    const initial = { ...widget.layout };
    const origin = root.getBoundingClientRect();
    const styles = window.getComputedStyle?.(root);
    const gap = parseFloat(styles?.columnGap) || layoutEngine.GAP;
    const padding = (parseFloat(styles?.paddingLeft) || layoutEngine.GAP)
      + (parseFloat(styles?.paddingRight) || layoutEngine.GAP);
    const pitchX = ((root.clientWidth || origin.width) - padding + gap) / layoutEngine.COLUMNS;
    const pitchY = layoutEngine.ROW_HEIGHT + (parseFloat(styles?.rowGap) || layoutEngine.GAP);
    if (!(pitchX > 0)) return;
    const startX = event.clientX, startY = event.clientY, pointerId = event.pointerId ?? 0;
    const preview = document.createElement('div');
    preview.className = 'widget-layout-preview';
    preview.setAttribute('aria-hidden', 'true');
    applyLayout(preview, initial);
    root.appendChild(preview);
    element.classList.add('widget-layout-active');
    root.classList.add('dashboard-layout-active');
    let candidate = initial, lastPointer = event, dragging = false;
    const scroll = root.closest('.dashboard-workspace');
    const matches = pointer => (pointer.pointerId ?? 0) === pointerId;

    function update(pointer) {
      lastPointer = pointer;
      const current = root.getBoundingClientRect();
      const dx = Math.round((pointer.clientX - startX - current.left + origin.left) / pitchX);
      const dy = Math.round((pointer.clientY - startY - current.top + origin.top) / pitchY);
      const previous = candidate;
      candidate = proposedLayout(initial, mode, dx, dy);
      applyLayout(preview, candidate);
      if (mode === 'resize') {
        applyLayout(element, candidate);
        if (candidate.width !== previous.width || candidate.height !== previous.height) {
          chartInstances.get(widget.id)?.resize();
        }
      } else {
        element.style.transform = `translate(${(candidate.x - initial.x) * pitchX}px, ${(candidate.y - initial.y) * pitchY}px)`;
      }
    }

    function finish(commit) {
      if (!activeGesture) return;
      const deferred = pendingRender;
      activeGesture = null;
      pendingRender = null;
      window.clearInterval(scrollTimer);
      document.removeEventListener('pointermove', pointerMove, true);
      document.removeEventListener('pointerup', pointerUp, true);
      document.removeEventListener('pointercancel', pointerCancel, true);
      document.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('blur', windowBlur);
      handle.removeEventListener('lostpointercapture', pointerCancel);
      try { if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId); } catch (error) { /* Disposed native handle. */ }
      preview.remove();
      element.style.transform = '';
      applyLayout(element, initial);
      element.classList.remove('widget-layout-active');
      root.classList.remove('dashboard-layout-active');
      chartInstances.get(widget.id)?.resize();
      const changed = ['x', 'y', 'width', 'height'].some(key => candidate[key] !== initial[key]);
      if (commit && changed) {
        layoutEngine.changeLayout(dashboard.widgets, widget.id, candidate);
        onChange();
      } else if (deferred) { render(deferred); }
    }

    function pointerMove(pointer) {
      if (matches(pointer)) {
        dragging ||= Math.hypot(pointer.clientX - startX, pointer.clientY - startY) >= 3;
        pointer.preventDefault();
        update(pointer);
      }
    }
    function pointerUp(pointer) { if (matches(pointer)) { update(pointer); finish(true); } }
    function pointerCancel(pointer) { if (matches(pointer)) finish(false); }
    function keyDown(key) { if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); finish(false); } }
    function windowBlur() { finish(false); }
    const scrollTimer = window.setInterval(() => {
      if (!scroll || !dragging) return;
      const bounds = scroll.getBoundingClientRect();
      const step = (position, start, end) => position < start + 32 ? -16 : position > end - 32 ? 16 : 0;
      const x = scroll.scrollLeft, y = scroll.scrollTop;
      scroll.scrollLeft += step(lastPointer.clientX, bounds.left, bounds.right);
      scroll.scrollTop += step(lastPointer.clientY, bounds.top, bounds.bottom);
      if (x !== scroll.scrollLeft || y !== scroll.scrollTop) update(lastPointer);
    }, 30);
    activeGesture = { cancel: () => finish(false) };
    document.addEventListener('pointermove', pointerMove, true);
    document.addEventListener('pointerup', pointerUp, true);
    document.addEventListener('pointercancel', pointerCancel, true);
    document.addEventListener('keydown', keyDown, true);
    window.addEventListener('blur', windowBlur);
    handle.addEventListener('lostpointercapture', pointerCancel);
    try { handle.setPointerCapture?.(pointerId); } catch (error) { /* Document listeners also cover older SWT browsers. */ }
  }

  function buildHeader(widget, dashboard, onChange) {
    const header = document.createElement('header');
    header.className = 'widget-header';
    const move = document.createElement('button');
    move.type = 'button';
    move.className = 'widget-drag-handle';
    move.textContent = '⠿';
    move.title = 'Drag to move; arrow keys move the widget';
    move.setAttribute('aria-label', `Move ${widget.title}`);
    const title = document.createElement('h3');
    title.className = 'widget-title';
    title.contentEditable = 'true';
    title.spellcheck = false;
    title.textContent = widget.title;
    title.title = 'Click to rename';
    title.addEventListener('blur', () => {
      widget.title = title.textContent.trim().slice(0, 200) || 'Chart';
      onChange();
    });

    const source = document.createElement('span');
    source.className = 'widget-source';
    source.textContent = widget.source.connection || widget.source.name;
    source.title = widget.source.sql || widget.source.name;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Remove widget';
    remove.addEventListener('click', () => {
      dashboard.widgets = dashboard.widgets.filter(item => item.id !== widget.id);
      onChange();
    });
    header.append(move, title, source, remove);
    return header;
  }

  function buildFooter(widget, onChange, onRefresh) {
    const footer = document.createElement('footer');
    footer.className = 'widget-footer';
    const policy = document.createElement('select');
    policy.title = 'Refresh policy';
    policy.append(
      new Option('On result', 'onResult:0'),
      new Option('Manual', 'manual:0'),
      new Option('Every 30 s', 'interval:30'),
      new Option('Every minute', 'interval:60'),
      new Option('Every 5 min', 'interval:300')
    );
    policy.value = `${widget.refreshPolicy.mode}:${widget.refreshPolicy.intervalSeconds}`;
    policy.addEventListener('change', () => {
      const [mode, seconds] = policy.value.split(':');
      widget.refreshPolicy = { mode, intervalSeconds: Number(seconds) };
      onChange();
    });

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = 'Refresh';
    refresh.addEventListener('click', () => onRefresh(widget));

    const source = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Source';
    const editor = document.createElement('div');
    editor.className = 'widget-source-editor';
    const sql = document.createElement('textarea');
    sql.value = widget.source.sql;
    sql.placeholder = 'Read-only SQL; blank uses the active ResultSet';
    const connection = document.createElement('select');
    connection.setAttribute('aria-label', 'DBeaver connection');
    connection.append(new Option(widget.source.connection || 'Choose connection', ''));
    let connections = [];
    if (typeof window.dbeaverListConnections === 'function') {
      try { connections = JSON.parse(window.dbeaverListConnections()); } catch (error) { console.error(error); }
    }
    connections.forEach((item, index) => {
      connection.append(new Option(`${item.project} / ${item.connection}`, String(index)));
      if (item.connectionId === widget.source.connectionId && item.project === widget.source.project) {
        connection.value = String(index);
      }
    });
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Use SQL';
    apply.addEventListener('click', () => {
      widget.source.sql = sql.value;
      widget.source.kind = widget.source.sql ? 'savedQuery' : 'activeResultSet';
      if (connection.value !== '') Object.assign(widget.source, connections[Number(connection.value)]);
      onChange();
      onRefresh(widget);
    });
    editor.append(connection, sql, apply);
    source.append(summary, editor);
    footer.append(policy, refresh, source);
    return footer;
  }

  function renderWidgetChart(
    element,
    widget,
    dashboard,
    activeSnapshot,
    widgetSnapshot,
    widgetError,
    widgetLoading,
    theme,
    renderer,
    onChange
  ) {
    if (widgetLoading) {
      element.classList.add('message');
      element.textContent = 'Loading widget query…';
      return;
    }
    if (widgetError) {
      element.classList.add('message');
      element.textContent = widgetError;
      return;
    }
    const snapshot = widget.source.kind === 'savedQuery' ? widgetSnapshot : activeSnapshot;
    const context = buildContext(widget, dashboard, snapshot, theme);
    if (!context) {
      element.classList.add('message');
      element.textContent = 'Run the widget source query or select compatible columns.';
      return;
    }
    const chart = window.echarts.init(element, null, { renderer });
    chartInstances.set(widget.id, chart);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(element);
      resizeObservers.set(widget.id, observer);
    }
    const option = window.DBeaverEChartsAnalytics.buildOption(context);
    chart.setOption(option, { notMerge: true, lazyUpdate: false });
    if (widget.drillDown.enabled) {
      chart.on('click', event => {
        const value = categoryFromEvent(event);
        if (value === null) return;
        dashboard.filters[widget.chart.xColumn] = value;
        dashboard.variables[widget.chart.xColumn] = value;
        onChange();
      });
    }
  }

  function buildContext(widget, dashboard, snapshot, theme) {
    if (!snapshot?.columns?.length || !snapshot?.rows?.length) return null;
    const xIndex = snapshot.columns.findIndex(column => column.name === widget.chart.xColumn);
    const yIndices = widget.chart.yColumns
      .map(name => snapshot.columns.findIndex(column => column.name === name && column.kind === 'NUMERIC'))
      .filter(index => index >= 0);
    if (xIndex < 0 || !yIndices.length) return null;
    const rows = filterRows(snapshot.rows, snapshot.columns, dashboard.filters);
    const yAxes = Object.fromEntries(yIndices.map(index => [
      index,
      widget.chart.yAxes[snapshot.columns[index].name] === 'right' ? 'right' : 'left'
    ]));
    return {
      rows,
      columns: snapshot.columns,
      rowCount: rows.length,
      xIndex,
      yIndices,
      yAxes,
      chartType: widget.chart.chartType,
      marks: widget.chart.marks,
      theme
    };
  }

  function filterRows(rows, columns, filters) {
    const active = Object.entries(filters).map(([name, value]) => ({
      index: columns.findIndex(column => column.name === name),
      value: String(value)
    })).filter(filter => filter.index >= 0);
    if (!active.length) return rows;
    return rows.filter(row => active.every(filter => String(row[filter.index]) === filter.value));
  }

  function categoryFromEvent(event) {
    if (Array.isArray(event?.value)) return event.value[0] === undefined ? null : String(event.value[0]);
    if (event?.data && typeof event.data === 'object' && event.data.name !== undefined) return String(event.data.name);
    return event?.name === undefined ? null : String(event.name);
  }

  function renderFilters(root, dashboard, onChange) {
    root.replaceChildren();
    const filters = Object.entries(dashboard.filters);
    root.hidden = !filters.length;
    for (const [name, value] of filters) {
      const token = document.createElement('span');
      token.className = 'filter-token';
      token.append(document.createTextNode(`${name}: ${value}`));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Remove ${name} filter`;
      remove.addEventListener('click', () => {
        delete dashboard.filters[name];
        delete dashboard.variables[name];
        onChange();
      });
      token.appendChild(remove);
      root.appendChild(token);
    }
  }

  function dispose() {
    pendingRender = null;
    activeGesture?.cancel();
    for (const observer of resizeObservers.values()) observer.disconnect();
    resizeObservers.clear();
    for (const chart of chartInstances.values()) chart.dispose();
    chartInstances.clear();
  }

  window.DBeaverEChartsDashboard = Object.freeze({
    SCHEMA_VERSION,
    createDashboard,
    createWidget,
    buildContext,
    dispose,
    normalizeDashboard,
    portableDashboard,
    render
  });
})();
