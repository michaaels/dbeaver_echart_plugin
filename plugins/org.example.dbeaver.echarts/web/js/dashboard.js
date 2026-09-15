(() => {
  'use strict';

  const SCHEMA_VERSION = 1;
  const chartInstances = new Map();
  const resizeObservers = new Map();
  let sequence = 0;

  function nextId() {
    sequence += 1;
    return `widget-${Date.now().toString(36)}-${sequence.toString(36)}`;
  }

  function createDashboard() {
    return {
      schemaVersion: SCHEMA_VERSION,
      title: 'Result dashboard',
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
      layout: { columnSpan: 1, rowSpan: 1 }
    };
  }

  function normalizeSource(source) {
    return {
      schemaVersion: 1,
      kind: source?.kind === 'activeResultSet' ? 'activeResultSet' : 'savedQuery',
      name: typeof source?.name === 'string' ? source.name : 'Active result set',
      connection: typeof source?.connection === 'string' ? source.connection : null,
      sql: typeof source?.sql === 'string' ? source.sql : ''
    };
  }

  function normalizeDashboard(value) {
    if (!value || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.widgets)) {
      throw new Error('Unsupported dashboard JSON schema.');
    }
    const dashboard = createDashboard();
    dashboard.title = typeof value.title === 'string' ? value.title.slice(0, 200) : dashboard.title;
    dashboard.variables = normalizeDictionary(value.variables);
    dashboard.filters = normalizeDictionary(value.filters);
    dashboard.widgets = value.widgets.slice(0, 24).map(normalizeWidget);
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
      layout: {
        columnSpan: Math.max(1, Math.min(2, Number(value?.layout?.columnSpan) || 1)),
        rowSpan: Math.max(1, Math.min(2, Number(value?.layout?.rowSpan) || 1))
      }
    };
  }

  function render({
    root, filterRoot, empty, dashboard, snapshot, widgetSnapshots, widgetErrors, widgetRequests,
    theme, renderer, onChange, onRefresh
  }) {
    dispose();
    root.replaceChildren();
    renderFilters(filterRoot, dashboard, onChange);
    if (!dashboard.widgets.length) {
      empty.hidden = false;
      empty.textContent = 'Add a widget from the current chart configuration.';
      return;
    }
    empty.hidden = true;

    for (const widget of dashboard.widgets) {
      const element = document.createElement('article');
      element.className = 'dashboard-widget';
      element.dataset.widgetId = widget.id;
      element.style.gridColumn = `span ${widget.layout.columnSpan}`;
      element.style.gridRow = `span ${widget.layout.rowSpan}`;

      const header = buildHeader(widget, dashboard, onChange);
      const chartElement = document.createElement('div');
      chartElement.className = 'widget-chart';
      const footer = buildFooter(widget, onChange, onRefresh);
      element.append(header, chartElement, footer);
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

  function buildHeader(widget, dashboard, onChange) {
    const header = document.createElement('header');
    header.className = 'widget-header';
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
    header.append(title, source, remove);
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
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Use SQL';
    apply.addEventListener('click', () => {
      widget.source.sql = sql.value.trim();
      widget.source.kind = widget.source.sql ? 'savedQuery' : 'activeResultSet';
      onChange();
    });
    editor.append(sql, apply);
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
    for (const observer of resizeObservers.values()) observer.disconnect();
    resizeObservers.clear();
    for (const chart of chartInstances.values()) chart.dispose();
    chartInstances.clear();
  }

  window.DBeaverEChartsDashboard = Object.freeze({
    SCHEMA_VERSION,
    createDashboard,
    createWidget,
    dispose,
    normalizeDashboard,
    render
  });
})();
