(() => {
  'use strict';

  const CHART_TYPES = new Set([
    'line', 'area', 'bar', 'scatter', 'pie', 'gauge', 'radar', 'heatmap', 'boxplot', 'treemap', 'funnel', 'map'
  ]);
  const DEFAULT_THEME = {
    background: '#ffffff',
    foreground: '#333333',
    muted: '#6b7280',
    border: '#c8cdd4',
    grid: '#d9dde3',
    controlBackground: '#f5f6f8',
    dark: false
  };

  const state = {
    snapshot: null,
    chart: null,
    renderer: 'canvas',
    chartType: 'line',
    xIndex: -1,
    yIndex: -1,
    yIndices: [],
    yAxes: {},
    preferredXName: null,
    preferredYNames: [],
    preferredYAxes: {},
    marks: { markLine: false, markArea: false, visualMap: false },
    viewMode: 'chart',
    dashboard: null,
    widgetSnapshots: new Map(),
    widgetErrors: new Map(),
    widgetRequests: new Set(),
    widgetRefreshTimes: new Map(),
    configurationLoaded: false,
    theme: DEFAULT_THEME
  };

  const els = {};
  let resizeObserver = null;
  let lastChartWidth = 0;
  let lastChartHeight = 0;
  let configurationSaveTimer = null;
  let lastDashboardRefresh = 0;

  function $(id) { return document.getElementById(id); }

  function init() {
    Object.assign(els, {
      chart: $('chart'),
      chartView: $('chartView'),
      dashboardView: $('dashboardView'),
      dashboardGrid: $('dashboardGrid'),
      dashboardFilters: $('dashboardFilters'),
      dashboardEmpty: $('dashboardEmpty'),
      dashboardActions: $('dashboardActions'),
      viewMode: $('viewMode'),
      addWidget: $('addWidget'),
      clearFilters: $('clearFilters'),
      importDashboard: $('importDashboard'),
      exportDashboard: $('exportDashboard'),
      empty: $('empty'),
      status: $('status'),
      chartType: $('chartType'),
      xField: $('xField'),
      yField: $('yField'),
      renderer: $('renderer'),
      seriesCount: $('seriesCount'),
      seriesOptions: $('seriesOptions'),
      markLine: $('markLine'),
      markArea: $('markArea'),
      visualMap: $('visualMap')
    });

    state.dashboard = window.DBeaverEChartsDashboard.createDashboard();
    els.viewMode.addEventListener('change', () => updateConfiguration(() => {
      state.viewMode = els.viewMode.value;
    }));
    els.addWidget.addEventListener('click', addDashboardWidget);
    els.clearFilters.addEventListener('click', () => {
      state.dashboard.filters = {};
      state.dashboard.variables = {};
      dashboardChanged();
    });
    els.importDashboard.addEventListener('click', importDashboard);
    els.exportDashboard.addEventListener('click', exportDashboard);

    els.chartType.addEventListener('change', () => updateConfiguration(() => {
      state.chartType = els.chartType.value;
    }));
    els.xField.addEventListener('change', () => updateConfiguration(() => {
      state.xIndex = Number(els.xField.value);
      state.preferredXName = selectedColumnName(state.xIndex);
    }));
    els.yField.addEventListener('change', () => updateConfiguration(() => {
      const index = Number(els.yField.value);
      state.yIndex = index;
      state.yIndices = [index, ...state.yIndices.filter(item => item !== index)];
      syncPreferredSeries();
      renderSeriesOptions();
    }));
    els.renderer.addEventListener('change', () => updateConfiguration(() => {
      state.renderer = els.renderer.value;
      recreateChart();
    }));
    for (const name of ['markLine', 'markArea', 'visualMap']) {
      els[name].addEventListener('change', () => updateConfiguration(() => {
        state.marks[name] = els[name].checked;
      }));
    }

    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        resizeChart(entry?.contentRect?.width, entry?.contentRect?.height);
      });
      resizeObserver.observe(els.chart);
    } else {
      window.addEventListener('resize', resizeChart);
    }

    setLoading();
    window.setInterval(checkDashboardRefreshPolicies, 1000);
    if (typeof window.dbeaverBrowserReady === 'function') window.dbeaverBrowserReady();
  }

  function updateConfiguration(change) {
    change();
    normalizeSelectionForChart();
    render();
    schedulePersistConfiguration();
  }

  function reload({ preserveSelection = true } = {}) {
    if (!preserveSelection) {
      state.preferredXName = null;
      state.preferredYNames = [];
      state.preferredYAxes = {};
    }
    setLoading();
  }

  function setSnapshot(snapshot) {
    try {
      validateSnapshot(snapshot);
      if (!state.configurationLoaded && ['canvas', 'svg'].includes(snapshot.defaultRenderer)) {
        state.renderer = snapshot.defaultRenderer;
        els.renderer.value = state.renderer;
      }
      const previousX = selectedColumnName(state.xIndex);
      const previousYNames = selectedYNames();
      state.snapshot = snapshot;
      configureFields(previousX, previousYNames);
      normalizeSelectionForChart();
      render();
      updateStatus();
      schedulePersistConfiguration();
    } catch (error) {
      console.error(error);
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('DBeaver returned an invalid dataset.');
    if (snapshot.error) throw new Error(snapshot.error);
    if (snapshot.schemaVersion !== 1) throw new Error(`Unsupported dataset schema: ${snapshot.schemaVersion}`);
  }

  function setLoading() {
    if (els.status) els.status.textContent = 'Loading result set…';
  }

  function setError(message) {
    disposeChart();
    setMessage(message);
    if (els.status) els.status.textContent = 'Unable to load result set';
  }

  function setConfiguration(configuration) {
    if (!configuration || configuration.schemaVersion !== 1) return;
    if (CHART_TYPES.has(configuration.chartType)) {
      state.chartType = configuration.chartType;
      els.chartType.value = state.chartType;
    }
    if (['canvas', 'svg'].includes(configuration.renderer)) {
      const rendererChanged = state.renderer !== configuration.renderer;
      state.renderer = configuration.renderer;
      els.renderer.value = state.renderer;
      if (rendererChanged) recreateChart();
    }
    state.configurationLoaded = true;
    state.preferredXName = typeof configuration.xColumn === 'string' ? configuration.xColumn : null;
    state.preferredYNames = Array.isArray(configuration.yColumns)
      ? configuration.yColumns.filter(name => typeof name === 'string')
      : typeof configuration.yColumn === 'string' ? [configuration.yColumn] : [];
    state.preferredYAxes = configuration.yAxes && typeof configuration.yAxes === 'object'
      ? configuration.yAxes
      : {};
    state.marks = {
      markLine: Boolean(configuration.marks?.markLine),
      markArea: Boolean(configuration.marks?.markArea),
      visualMap: Boolean(configuration.marks?.visualMap)
    };
    state.viewMode = configuration.viewMode === 'dashboard' ? 'dashboard' : 'chart';
    els.viewMode.value = state.viewMode;
    if (configuration.dashboard) {
      try {
        state.dashboard = window.DBeaverEChartsDashboard.normalizeDashboard(configuration.dashboard);
      } catch (error) {
        console.error(error);
        state.dashboard = window.DBeaverEChartsDashboard.createDashboard();
      }
    }
    state.widgetSnapshots.clear();
    state.widgetErrors.clear();
    state.widgetRequests.clear();
    syncMarkControls();
    if (state.snapshot) {
      configureFields(null, []);
      normalizeSelectionForChart();
      render();
    }
  }

  function setConfigurationJson(serializedConfiguration) {
    try {
      setConfiguration(JSON.parse(serializedConfiguration));
    } catch (error) {
      console.error(error);
      clearConfiguration();
    }
  }

  function clearConfiguration() {
    state.configurationLoaded = false;
    state.chartType = 'line';
    state.renderer = 'canvas';
    state.preferredXName = null;
    state.preferredYNames = [];
    state.preferredYAxes = {};
    state.marks = { markLine: false, markArea: false, visualMap: false };
    state.viewMode = 'chart';
    state.dashboard = window.DBeaverEChartsDashboard.createDashboard();
    state.widgetSnapshots.clear();
    state.widgetErrors.clear();
    state.widgetRequests.clear();
    if (els.chartType) els.chartType.value = state.chartType;
    if (els.renderer) els.renderer.value = state.renderer;
    if (els.viewMode) els.viewMode.value = state.viewMode;
    syncMarkControls();
    if (state.snapshot) {
      configureFields(null, []);
      normalizeSelectionForChart();
      render();
    }
  }

  function setTheme(theme) {
    state.theme = { ...DEFAULT_THEME, ...(theme || {}) };
    const root = document.documentElement;
    root.style.setProperty('--bg', state.theme.background);
    root.style.setProperty('--fg', state.theme.foreground);
    root.style.setProperty('--muted', state.theme.muted);
    root.style.setProperty('--border', state.theme.border);
    root.style.setProperty('--control-bg', state.theme.controlBackground);
    if (state.snapshot) render();
  }

  function configureFields(previousX, previousYNames) {
    const columns = state.snapshot.columns || [];
    fillSelect(els.xField, columns);
    fillSelect(els.yField, columns);

    state.xIndex = findColumn(columns, state.preferredXName || previousX);
    if (state.xIndex < 0) state.xIndex = inferX(columns);

    const requestedYNames = state.preferredYNames.length ? state.preferredYNames : previousYNames;
    state.yIndices = requestedYNames
      .map(name => findColumn(columns, name))
      .filter((index, position, values) => index >= 0 && index !== state.xIndex && values.indexOf(index) === position);
    if (!state.yIndices.length) {
      const inferred = inferY(columns, state.xIndex);
      if (inferred >= 0) state.yIndices = [inferred];
    }
    state.yIndex = state.yIndices[0] ?? -1;
    state.yAxes = Object.fromEntries(state.yIndices.map(index => [
      index,
      state.preferredYAxes[columns[index]?.name] === 'right' ? 'right' : 'left'
    ]));

    if (state.xIndex >= 0) els.xField.value = String(state.xIndex);
    if (state.yIndex >= 0) els.yField.value = String(state.yIndex);
    state.preferredXName = selectedColumnName(state.xIndex);
    syncPreferredSeries();
    renderSeriesOptions();
  }

  function normalizeSelectionForChart() {
    const columns = state.snapshot?.columns || [];
    const numericIndices = columns
      .map((column, index) => ({ column, index }))
      .filter(item => item.index !== state.xIndex && item.column.kind === 'NUMERIC')
      .map(item => item.index);
    state.yIndices = state.yIndices.filter(index => numericIndices.includes(index));
    if (!state.yIndices.length && numericIndices.length) state.yIndices = [numericIndices[0]];
    state.yIndex = state.yIndices[0] ?? -1;
    if (state.yIndex >= 0) els.yField.value = String(state.yIndex);
    for (const index of state.yIndices) {
      if (!['left', 'right'].includes(state.yAxes[index])) state.yAxes[index] = 'left';
    }
    syncPreferredSeries();
    renderSeriesOptions();
  }

  function renderSeriesOptions() {
    if (!els.seriesOptions) return;
    els.seriesOptions.replaceChildren();
    const columns = state.snapshot?.columns || [];
    columns.forEach((column, index) => {
      if (column.kind !== 'NUMERIC' || index === state.xIndex) return;
      const row = document.createElement('div');
      row.className = 'series-option';
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.yIndices.includes(index);
      checkbox.addEventListener('change', () => updateConfiguration(() => {
        state.yIndices = checkbox.checked
          ? [...state.yIndices, index].filter((value, position, values) => values.indexOf(value) === position)
          : state.yIndices.filter(value => value !== index);
        state.yIndex = state.yIndices[0] ?? -1;
        syncPreferredSeries();
      }));
      const name = document.createElement('span');
      name.textContent = column.name;
      name.title = column.name;
      label.append(checkbox, name);

      const axis = document.createElement('select');
      axis.disabled = !checkbox.checked;
      axis.append(new Option('Left', 'left'), new Option('Right', 'right'));
      axis.value = state.yAxes[index] || 'left';
      axis.addEventListener('change', () => updateConfiguration(() => {
        state.yAxes[index] = axis.value;
        syncPreferredSeries();
      }));
      row.append(label, axis);
      els.seriesOptions.appendChild(row);
    });
    els.seriesCount.textContent = String(state.yIndices.length);
  }

  function syncPreferredSeries() {
    state.preferredYNames = selectedYNames();
    state.preferredYAxes = Object.fromEntries(state.yIndices.map(index => [
      selectedColumnName(index),
      state.yAxes[index] || 'left'
    ]).filter(([name]) => Boolean(name)));
  }

  function syncMarkControls() {
    for (const name of ['markLine', 'markArea', 'visualMap']) {
      if (els[name]) els[name].checked = state.marks[name];
    }
  }

  function fillSelect(select, columns) {
    select.replaceChildren();
    columns.forEach((column, index) => select.appendChild(new Option(`${column.name} (${column.kind})`, String(index))));
  }

  function findColumn(columns, name) {
    if (!name) return -1;
    return columns.findIndex(column => column.name === name);
  }

  function inferX(columns) {
    let index = columns.findIndex(column => column.kind === 'DATETIME');
    if (index >= 0) return index;
    index = columns.findIndex(column => column.kind === 'STRING');
    return index >= 0 ? index : (columns.length ? 0 : -1);
  }

  function inferY(columns, xIndex) {
    return columns.findIndex((column, index) => index !== xIndex && column.kind === 'NUMERIC');
  }

  function selectedColumnName(index) {
    return state.snapshot?.columns?.[index]?.name ?? null;
  }

  function selectedYNames() {
    return state.yIndices.map(selectedColumnName).filter(Boolean);
  }

  function render() {
    const dashboardMode = state.viewMode === 'dashboard';
    els.chartView.hidden = dashboardMode;
    els.dashboardView.hidden = !dashboardMode;
    els.dashboardActions.hidden = !dashboardMode;
    if (dashboardMode) {
      renderDashboard();
      return;
    }
    window.DBeaverEChartsDashboard.dispose();
    renderChart();
  }

  function renderChart() {
    const snapshot = state.snapshot;
    if (!snapshot?.columns?.length || !snapshot?.rows?.length) {
      showEmpty('The result set has no rows or visible columns to chart.');
      return;
    }
    if (state.xIndex < 0 || !state.yIndices.length) {
      showEmpty('Select one category column and at least one numeric series.');
      return;
    }
    if (typeof window.echarts === 'undefined' || !window.DBeaverEChartsAnalytics) {
      showEmpty('The Apache ECharts analytical runtime is unavailable.');
      return;
    }

    try {
      const option = window.DBeaverEChartsAnalytics.buildOption({
        rows: snapshot.rows,
        columns: snapshot.columns,
        rowCount: snapshot.rows.length,
        xIndex: state.xIndex,
        yIndices: state.yIndices,
        yAxes: state.yAxes,
        chartType: state.chartType,
        marks: state.marks,
        theme: state.theme
      });
      if (!window.DBeaverEChartsAnalytics.hasRenderableData(option)) {
        showEmpty('No compatible numeric values were found for the selected series.');
        return;
      }
      setMessage(null);
      const chart = ensureChart();
      chart.clear();
      chart.setOption(option, { notMerge: true, lazyUpdate: false });
    } catch (error) {
      console.error(error);
      showEmpty(error instanceof Error ? error.message : String(error));
    }
  }

  function renderDashboard() {
    disposeChart();
    window.DBeaverEChartsDashboard.render({
      root: els.dashboardGrid,
      filterRoot: els.dashboardFilters,
      empty: els.dashboardEmpty,
      dashboard: state.dashboard,
      snapshot: state.snapshot,
      widgetSnapshots: state.widgetSnapshots,
      widgetErrors: state.widgetErrors,
      widgetRequests: state.widgetRequests,
      theme: state.theme,
      renderer: state.renderer,
      onChange: dashboardChanged,
      onRefresh: widget => {
        requestWidgetRefresh(widget);
        renderDashboard();
      }
    });
    requestMissingWidgetSnapshots();
  }

  function addDashboardWidget() {
    if (!state.snapshot) return;
    state.dashboard.widgets.push(window.DBeaverEChartsDashboard.createWidget(
      currentChartConfiguration(),
      state.snapshot
    ));
    state.viewMode = 'dashboard';
    els.viewMode.value = state.viewMode;
    dashboardChanged();
  }

  function dashboardChanged() {
    render();
    schedulePersistConfiguration();
  }

  function currentChartConfiguration() {
    return {
      chartType: state.chartType,
      xColumn: selectedColumnName(state.xIndex) || state.preferredXName,
      yColumn: selectedColumnName(state.yIndex),
      yColumns: selectedYNames(),
      yAxes: state.preferredYAxes,
      marks: state.marks,
      renderer: state.renderer
    };
  }

  function requestWidgetRefresh(widget) {
    if (widget?.source?.kind === 'savedQuery' && widget.source.sql) {
      state.widgetSnapshots.delete(widget.id);
      state.widgetErrors.delete(widget.id);
      state.widgetRequests.add(widget.id);
      state.widgetRefreshTimes.set(widget.id, Date.now());
      if (typeof window.dbeaverExecuteWidgetQuery === 'function') {
        window.dbeaverExecuteWidgetQuery(widget.id, widget.source.sql);
      } else {
        state.widgetRequests.delete(widget.id);
        state.widgetErrors.set(widget.id, 'The dashboard query bridge is unavailable.');
      }
      return;
    }
    if (typeof window.dbeaverRefreshResult === 'function') window.dbeaverRefreshResult();
  }

  function requestMissingWidgetSnapshots() {
    for (const widget of state.dashboard.widgets) {
      if (widget.source.kind !== 'savedQuery' || !widget.source.sql) continue;
      if (state.widgetSnapshots.has(widget.id) || state.widgetErrors.has(widget.id) || state.widgetRequests.has(widget.id)) continue;
      requestWidgetRefresh(widget);
    }
  }

  function setWidgetSnapshot(widgetId, snapshot) {
    try {
      validateSnapshot(snapshot);
      state.widgetRequests.delete(widgetId);
      state.widgetErrors.delete(widgetId);
      state.widgetSnapshots.set(widgetId, snapshot);
      if (state.viewMode === 'dashboard') renderDashboard();
    } catch (error) {
      setWidgetError(widgetId, error instanceof Error ? error.message : String(error));
    }
  }

  function setWidgetError(widgetId, message) {
    state.widgetRequests.delete(widgetId);
    state.widgetSnapshots.delete(widgetId);
    state.widgetErrors.set(widgetId, message);
    if (state.viewMode === 'dashboard') renderDashboard();
  }

  function checkDashboardRefreshPolicies() {
    if (state.viewMode !== 'dashboard' || !state.dashboard?.widgets?.length) return;
    const now = Date.now();
    for (const widget of state.dashboard.widgets) {
      if (widget.refreshPolicy.mode !== 'interval' || widget.refreshPolicy.intervalSeconds < 5) continue;
      if (state.widgetRequests.has(widget.id)) continue;
      const previous = state.widgetRefreshTimes.get(widget.id) || lastDashboardRefresh;
      if (now - previous >= widget.refreshPolicy.intervalSeconds * 1000) {
        state.widgetRefreshTimes.set(widget.id, now);
        lastDashboardRefresh = now;
        requestWidgetRefresh(widget);
      }
    }
  }

  function importDashboard() {
    if (typeof window.dbeaverImportDashboard !== 'function') return;
    try {
      const serialized = window.dbeaverImportDashboard();
      if (!serialized) return;
      state.dashboard = window.DBeaverEChartsDashboard.normalizeDashboard(JSON.parse(serialized));
      state.widgetSnapshots.clear();
      state.widgetErrors.clear();
      state.widgetRequests.clear();
      state.viewMode = 'dashboard';
      els.viewMode.value = state.viewMode;
      dashboardChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  function exportDashboard() {
    if (typeof window.dbeaverExportDashboard !== 'function') return;
    window.dbeaverExportDashboard(JSON.stringify(state.dashboard, null, 2));
  }

  function showEmpty(message) {
    disposeChart();
    setMessage(message);
  }

  function ensureChart() {
    if (!state.chart) state.chart = window.echarts.init(els.chart, null, { renderer: state.renderer });
    return state.chart;
  }

  function recreateChart() {
    disposeChart();
    if (state.viewMode === 'chart' && state.snapshot?.rows?.length) ensureChart();
  }

  function disposeChart() {
    if (state.chart) {
      state.chart.dispose();
      state.chart = null;
    }
  }

  function resizeChart(width, height) {
    if (!els.chart) return;
    const bounds = els.chart.getBoundingClientRect();
    const nextWidth = Math.round(Number.isFinite(width) ? width : bounds.width);
    const nextHeight = Math.round(Number.isFinite(height) ? height : bounds.height);
    if (nextWidth <= 0 || nextHeight <= 0) return;
    if (nextWidth === lastChartWidth && nextHeight === lastChartHeight) return;
    lastChartWidth = nextWidth;
    lastChartHeight = nextHeight;
    state.chart?.resize();
  }

  function schedulePersistConfiguration() {
    if (configurationSaveTimer !== null) window.clearTimeout(configurationSaveTimer);
    configurationSaveTimer = window.setTimeout(() => {
      configurationSaveTimer = null;
      persistConfiguration();
    }, 250);
  }

  function persistConfiguration() {
    if (typeof window.dbeaverSaveConfiguration !== 'function') return;
    window.dbeaverSaveConfiguration(JSON.stringify({
      schemaVersion: 1,
      ...currentChartConfiguration(),
      viewMode: state.viewMode,
      dashboard: state.dashboard
    }));
  }

  function updateStatus() {
    const snapshot = state.snapshot;
    if (!snapshot) return;
    els.status.textContent = snapshot.truncated
      ? `${snapshot.exportedRowCount.toLocaleString()} of ${snapshot.rowCount.toLocaleString()} rows (effective limit ${snapshot.effectiveMaxRows.toLocaleString()})`
      : `${snapshot.rowCount.toLocaleString()} rows`;
  }

  function setMessage(message) {
    if (!message) {
      els.empty.hidden = true;
      els.empty.textContent = '';
      return;
    }
    els.empty.hidden = false;
    els.empty.textContent = message;
  }

  window.DBeaverECharts = Object.freeze({
    reload,
    clearConfiguration,
    setConfiguration,
    setConfigurationJson,
    setError,
    setLoading,
    setSnapshot,
    setWidgetSnapshot,
    setWidgetError,
    setTheme
  });
  window.addEventListener('DOMContentLoaded', init, { once: true });
})();
