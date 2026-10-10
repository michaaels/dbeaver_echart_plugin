(() => {
  'use strict';

  const CHART_TYPES = new Set(window.DBeaverEChartsAnalytics.CHART_TYPES.map(type => type.id));
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
    standalone: false,
    dashboard: null,
    widgetSnapshots: new Map(),
    widgetErrors: new Map(),
    widgetRequests: new Set(),
    widgetRefreshTimes: new Map(),
    queryApprovals: new Map(),
    sourceBindings: new Map(),
    pausedWidgets: new Set(),
    configurationLoaded: false,
    theme: DEFAULT_THEME
  };

  const els = {};
  let resizeObserver = null;
  let lastChartWidth = 0;
  let lastChartHeight = 0;
  let configurationSaveTimer = null;
  let lastDashboardRefresh = 0;
  let pendingReview = [];

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
      saveDashboard: $('saveDashboard'),
      openDashboard: $('openDashboard'),
      refreshDashboard: $('refreshDashboard'),
      reviewDashboardSql: $('reviewDashboardSql'),
      stopDashboard: $('stopDashboard'),
      queryReview: $('queryReview'),
      queryReviewSources: $('queryReviewSources'),
      runReviewedQueries: $('runReviewedQueries'),
      cancelQueryReview: $('cancelQueryReview'),
      dashboardTitle: $('dashboardTitle'),
      dashboardSummary: $('dashboardSummary'),
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
    els.saveDashboard.addEventListener('click', saveDashboard);
    els.openDashboard.addEventListener('click', () => window.dbeaverOpenDashboard?.());
    els.refreshDashboard.addEventListener('click', refreshDashboard);
    els.reviewDashboardSql.addEventListener('click', () => reviewQueries(state.dashboard.widgets));
    els.stopDashboard.addEventListener('click', stopDashboardQueries);
    els.runReviewedQueries.addEventListener('click', runReviewedQueries);
    els.cancelQueryReview.addEventListener('click', closeQueryReview);
    els.queryReview.addEventListener('cancel', closeQueryReview);
    els.dashboardTitle.addEventListener('input', () => {
      state.dashboard.title = els.dashboardTitle.value;
      schedulePersistConfiguration();
    });
    const popovers = [...document.querySelectorAll('.toolbar-popover')];
    $('openReportDesigner').addEventListener('click', () => {
      const dashboard = state.viewMode === 'dashboard' ? state.dashboard : {
        title: state.snapshot?.source?.name || 'Report from chart',
        widgets: state.snapshot ? [window.DBeaverEChartsDashboard.createWidget(currentChartConfiguration(), state.snapshot)] : []
      };
      if (window.dbeaverOpenReportDesigner?.(JSON.stringify(dashboard)) !== true) els.status.textContent = 'Report Designer could not open. Use Window > Show View > ECharts > Report Designer.';
    });
    const closePopovers = except => popovers.forEach(popover => { if (popover !== except) popover.open = false; });
    const positionPopover = popover => {
      if (!popover.open) return;
      const panel = popover.querySelector('.popover-panel');
      panel.style.transform = '';
      const box = panel.getBoundingClientRect();
      const shift = box.left < 12 ? 12 - box.left : Math.min(0, window.innerWidth - 12 - box.right);
      panel.style.transform = `translateX(${shift}px)`;
    };
    popovers.forEach(popover => {
      popover.addEventListener('toggle', () => positionPopover(popover));
      popover.querySelector('summary').addEventListener('click', event => {
        event.preventDefault();
        closePopovers(popover);
        popover.open = !popover.open;
        positionPopover(popover);
      });
      popover.addEventListener('click', event => {
        if (event.target.closest('.file-actions button')) closePopovers();
      });
    });
    window.addEventListener('resize', () => popovers.forEach(positionPopover));
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest?.('.toolbar-popover')) closePopovers();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const open = popovers.find(popover => popover.open);
      if (open) { closePopovers(); open.querySelector('summary').focus(); }
    });

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
      window.DBeaverWidgetEditor.setAppearance(state.theme, state.renderer);
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
    resetDashboardQueries();
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
    resetDashboardQueries();
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
    window.DBeaverWidgetEditor.setAppearance(state.theme, state.renderer);
    const root = document.documentElement;
    root.style.colorScheme = state.theme.dark ? 'dark' : 'light';
    document.body.classList.toggle('dark-theme', state.theme.dark);
    root.style.setProperty('--bg', state.theme.background);
    root.style.setProperty('--fg', state.theme.foreground);
    root.style.setProperty('--muted', state.theme.muted);
    root.style.setProperty('--border', state.theme.border);
    root.style.setProperty('--control-bg', state.theme.controlBackground);
    if (state.snapshot || state.viewMode === 'dashboard') render();
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
    document.body.classList.toggle('dashboard-mode', dashboardMode);
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
    reconcileQuerySources();
    els.dashboardTitle.value = state.dashboard.title;
    const count = state.dashboard.widgets.length;
    els.dashboardSummary.textContent = `${count} ${count === 1 ? 'widget' : 'widgets'}`;
    els.clearFilters.disabled = !Object.keys(state.dashboard.filters).length;
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
      },
      onCancel: widget => { stopWidgetQuery(widget); renderDashboard(); },
      onEdit: widget => editDashboardWidget(widget)
    });
    requestMissingWidgetSnapshots();
    updateDashboardStatus();
  }

  function addDashboardWidget() {
    if (state.dashboard.widgets.length >= 24) {
      els.status.textContent = 'A dashboard supports up to 24 widgets.';
      return;
    }
    const snapshot = state.standalone ? null : state.snapshot;
    const widget = window.DBeaverEChartsDashboard.createWidget(snapshot ? currentChartConfiguration() : {
      chartType: 'line', xColumn: null, yColumns: [], yAxes: {}, marks: {}
    }, snapshot);
    widget.source.kind = 'savedQuery';
    widget.refreshPolicy = { mode: 'manual', intervalSeconds: 0 };
    if (!snapshot && state.dashboard.widgets.length) {
      const source = state.dashboard.widgets.at(-1).source;
      for (const field of ['connectionId', 'connection', 'project']) widget.source[field] = source[field];
    }
    editDashboardWidget(widget, true, snapshot);
  }

  function editDashboardWidget(widget, isNew = false, seedSnapshot = null) {
    window.DBeaverWidgetEditor.open({
      widget, isNew, snapshot: seedSnapshot || state.widgetSnapshots.get(widget.id)
        || (widget.source.kind === 'activeResultSet' ? state.snapshot : null),
      theme: state.theme, renderer: state.renderer,
      cancelPreview: id => window.dbeaverCancelWidgetQuery?.(id, true),
      runPreview: (id, source) => {
        // The user sees the exact draft SQL and connection and explicitly clicks Run preview.
        if (window.dbeaverApproveWidgetQueries?.(JSON.stringify([{ id, sql: source.sql, source }])) !== true
          || window.dbeaverExecuteWidgetQuery?.(id, source.sql, JSON.stringify(source)) !== true) {
          throw new Error('DBeaver could not run the preview. Check the SQL and connection.');
        }
      },
      save: (draft, snapshot, previewApproved) => {
        const index = state.dashboard.widgets.findIndex(item => item.id === widget.id);
        if (!isNew && index < 0) throw new Error('This widget was removed while editing.');
        if (isNew && state.dashboard.widgets.length >= 24) throw new Error('A dashboard supports up to 24 widgets.');
        const normalized = window.DBeaverEChartsDashboard.normalizeDashboard({ schemaVersion: 1, widgets: [draft] }).widgets[0];
        if (isNew) state.dashboard.widgets.push(normalized);
        else state.dashboard.widgets[index] = normalized;
        reconcileQuerySources();
        if (snapshot && (isNew || previewApproved)) {
          if (state.widgetRequests.has(normalized.id)) {
            window.dbeaverCancelWidgetQuery?.(normalized.id);
            state.widgetRequests.delete(normalized.id);
          }
          state.widgetSnapshots.set(normalized.id, snapshot);
          state.widgetErrors.delete(normalized.id);
        }
        if (previewApproved && window.dbeaverApproveWidgetQueries?.(JSON.stringify([
          { id: normalized.id, sql: normalized.source.sql, source: normalized.source }
        ])) === true) {
          state.queryApprovals.set(normalized.id, sourceSignature(normalized));
          state.pausedWidgets.delete(normalized.id);
          state.widgetRefreshTimes.set(normalized.id, Date.now());
        }
        state.viewMode = 'dashboard';
        els.viewMode.value = 'dashboard';
        dashboardChanged();
      }
    });
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

  function sourceSignature(widget) {
    const source = widget.source;
    return JSON.stringify([source.sql, source.kind, source.project || '', source.connectionId || '', source.connection || '']);
  }

  function isApproved(widget) { return state.queryApprovals.get(widget.id) === sourceSignature(widget); }

  function closeQueryReview() {
    pendingReview = [];
    if (typeof els.queryReview.close === 'function') els.queryReview.close();
    else els.queryReview.removeAttribute('open');
  }

  function reviewQueries(widgets) {
    const queries = widgets.filter(widget => widget.source.kind === 'savedQuery' && widget.source.sql);
    if (!queries.length) return;
    closeQueryReview();
    pendingReview = queries.map(widget => ({ id: widget.id, signature: sourceSignature(widget) }));
    els.queryReviewSources.replaceChildren();
    for (const widget of queries) {
      const section = document.createElement('section');
      const title = document.createElement('h3');
      title.textContent = widget.title;
      const connection = document.createElement('div');
      connection.textContent = `${widget.source.project || 'Dashboard project'} / ${widget.source.connection || 'Choose a connection in Edit'} (${widget.source.connectionId || 'legacy name reference'})`;
      const sql = document.createElement('pre');
      sql.textContent = widget.source.sql;
      section.append(title, connection, sql);
      els.queryReviewSources.appendChild(section);
    }
    if (typeof els.queryReview.showModal === 'function') els.queryReview.showModal();
    else els.queryReview.setAttribute('open', '');
  }

  function runReviewedQueries() {
    const queries = pendingReview.map(entry => state.dashboard.widgets.find(widget => widget.id === entry.id));
    if (!queries.length || queries.some((widget, index) => !widget || sourceSignature(widget) !== pendingReview[index].signature)) {
      closeQueryReview();
      els.status.textContent = 'The query source changed. Review the SQL again.';
      return;
    }
    const approved = window.dbeaverApproveWidgetQueries?.(JSON.stringify(queries.map(widget => ({
      id: widget.id, sql: widget.source.sql, source: widget.source
    }))));
    if (approved !== true) {
      els.status.textContent = 'DBeaver could not approve these queries.';
      return;
    }
    for (const widget of queries) state.queryApprovals.set(widget.id, sourceSignature(widget));
    closeQueryReview();
    for (const widget of queries) requestWidgetRefresh(widget);
    renderDashboard();
  }

  function stopWidgetQuery(widget) {
    window.dbeaverCancelWidgetQuery?.(widget.id);
    state.widgetRequests.delete(widget.id);
    state.pausedWidgets.add(widget.id);
    state.widgetErrors.set(widget.id, 'Stopped. Refresh to run again.');
  }

  function stopDashboardQueries() {
    for (const widget of state.dashboard.widgets) {
      state.pausedWidgets.add(widget.id);
      if (state.widgetRequests.has(widget.id)) stopWidgetQuery(widget);
    }
    renderDashboard();
  }

  function resetDashboardQueries() {
    window.DBeaverWidgetEditor.close();
    window.dbeaverResetDashboardQueries?.();
    state.queryApprovals.clear();
    state.sourceBindings.clear();
    state.pausedWidgets.clear();
    state.widgetRefreshTimes.clear();
    closeQueryReview();
  }

  function reconcileQuerySources() {
    const widgets = new Map(state.dashboard.widgets.map(widget => [widget.id, widget]));
    for (const [id, binding] of state.sourceBindings) {
      const widget = widgets.get(id);
      if (!widget || binding !== sourceSignature(widget)) {
        window.dbeaverCancelWidgetQuery?.(id, true);
        state.queryApprovals.delete(id);
        state.widgetRequests.delete(id);
        state.widgetSnapshots.delete(id);
        state.widgetErrors.delete(id);
        state.pausedWidgets.delete(id);
        state.widgetRefreshTimes.delete(id);
        state.sourceBindings.delete(id);
      }
    }
    for (const widget of widgets.values()) state.sourceBindings.set(widget.id, sourceSignature(widget));
  }

  function requestWidgetRefresh(widget, automatic = false) {
    if (widget?.source?.kind === 'savedQuery' && widget.source.sql) {
      if (!isApproved(widget)) {
        if (!automatic) reviewQueries([widget]);
        return;
      }
      if (automatic && state.pausedWidgets.has(widget.id)) return;
      if (state.widgetRequests.has(widget.id)) return;
      state.pausedWidgets.delete(widget.id);
      state.widgetSnapshots.delete(widget.id);
      state.widgetErrors.delete(widget.id);
      state.widgetRequests.add(widget.id);
      state.widgetRefreshTimes.set(widget.id, Date.now());
      if (typeof window.dbeaverExecuteWidgetQuery === 'function') {
        try {
          if (window.dbeaverExecuteWidgetQuery(widget.id, widget.source.sql, JSON.stringify(widget.source)) !== true) {
            throw new Error('The SQL or connection needs review before this query can run.');
          }
        } catch (error) {
          state.widgetRequests.delete(widget.id);
          state.widgetErrors.set(widget.id, error.message);
          state.pausedWidgets.add(widget.id);
        }
      } else {
        state.widgetRequests.delete(widget.id);
        state.widgetErrors.set(widget.id, 'The dashboard query bridge is unavailable.');
        state.pausedWidgets.add(widget.id);
      }
      return;
    }
    if (typeof window.dbeaverRefreshResult === 'function') window.dbeaverRefreshResult();
  }

  function requestMissingWidgetSnapshots() {
    for (const widget of state.dashboard.widgets) {
      if (widget.source.kind !== 'savedQuery' || !widget.source.sql) continue;
      if (state.widgetSnapshots.has(widget.id) || state.widgetErrors.has(widget.id) || state.widgetRequests.has(widget.id)) continue;
      requestWidgetRefresh(widget, true);
    }
  }

  function setWidgetSnapshot(widgetId, snapshot) {
    if (window.DBeaverWidgetEditor.receiveSnapshot(widgetId, snapshot)) return;
    if (!state.widgetRequests.has(widgetId)) return;
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
    if (window.DBeaverWidgetEditor.receiveError(widgetId, message)) return;
    if (!state.widgetRequests.has(widgetId)) return;
    state.widgetRequests.delete(widgetId);
    state.widgetSnapshots.delete(widgetId);
    state.widgetErrors.set(widgetId, message);
    state.pausedWidgets.add(widgetId);
    if (state.viewMode === 'dashboard') renderDashboard();
  }

  function checkDashboardRefreshPolicies() {
    if (state.viewMode !== 'dashboard' || !state.dashboard?.widgets?.length) return;
    const now = Date.now();
    for (const widget of state.dashboard.widgets) {
      if (widget.refreshPolicy.mode !== 'interval' || widget.refreshPolicy.intervalSeconds < 5) continue;
      if (state.widgetRequests.has(widget.id) || state.pausedWidgets.has(widget.id) || !isApproved(widget)) continue;
      const previous = state.widgetRefreshTimes.get(widget.id) || lastDashboardRefresh;
      if (now - previous >= widget.refreshPolicy.intervalSeconds * 1000) {
        state.widgetRefreshTimes.set(widget.id, now);
        lastDashboardRefresh = now;
        requestWidgetRefresh(widget, true);
        renderDashboard();
      }
    }
  }

  function importDashboard() {
    if (typeof window.dbeaverImportDashboard !== 'function') return;
    try {
      const serialized = window.dbeaverImportDashboard();
      if (!serialized) return;
      loadDashboard(JSON.parse(serialized), state.standalone);
      dashboardChanged();
    } catch (error) {
      els.status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function exportDashboard() {
    writeDashboard('dbeaverExportDashboard');
  }

  function dashboardDocument() {
    return window.DBeaverEChartsDashboard.portableDashboard(state.dashboard, state.renderer);
  }

  function writeDashboard(bridge) {
    try {
      if (typeof window[bridge] !== 'function') throw new Error('Dashboard file storage is available in DBeaver.');
      const result = window[bridge](JSON.stringify(dashboardDocument(), null, 2));
      if (result) els.status.textContent = typeof result === 'string' ? `Saved: ${result}` : 'Dashboard saved';
    } catch (error) { els.status.textContent = error.message; }
  }

  function saveDashboard() { writeDashboard('dbeaverSaveDashboard'); }

  function refreshDashboard() {
    if (state.dashboard.widgets.some(widget => widget.source.kind === 'savedQuery' && widget.source.sql && !isApproved(widget))) {
      reviewQueries(state.dashboard.widgets);
      return;
    }
    for (const widget of state.dashboard.widgets) requestWidgetRefresh(widget);
    renderDashboard();
  }

  function loadDashboard(document, standalone = false) {
    const dashboard = window.DBeaverEChartsDashboard.normalizeDashboard(document);
    resetDashboardQueries();
    state.standalone = standalone;
    documentBodyMode(standalone);
    state.dashboard = dashboard;
    state.renderer = dashboard.renderer;
    els.renderer.value = state.renderer;
    state.viewMode = 'dashboard';
    els.viewMode.value = 'dashboard';
    state.configurationLoaded = true;
    state.widgetSnapshots.clear();
    state.widgetErrors.clear();
    state.widgetRequests.clear();
    render();
  }

  function documentBodyMode(standalone) {
    document.body.classList.toggle('standalone-dashboard', standalone);
    els.addWidget.disabled = false;
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
    if (state.standalone) window.dbeaverDashboardChanged?.();
    if (configurationSaveTimer !== null) window.clearTimeout(configurationSaveTimer);
    configurationSaveTimer = window.setTimeout(() => {
      configurationSaveTimer = null;
      persistConfiguration();
    }, 250);
  }

  function persistConfiguration() {
    if (typeof window.dbeaverSaveConfiguration !== 'function') return;
    state.dashboard.renderer = state.renderer;
    window.dbeaverSaveConfiguration(JSON.stringify({
      schemaVersion: 1,
      ...currentChartConfiguration(),
      viewMode: state.viewMode,
      dashboard: state.dashboard
    }));
  }

  function updateStatus() {
    if (state.viewMode === 'dashboard') { updateDashboardStatus(); return; }
    const snapshot = state.snapshot;
    if (!snapshot) return;
    els.status.textContent = snapshot.truncated
      ? `${snapshot.exportedRowCount.toLocaleString()} of ${snapshot.rowCount.toLocaleString()} rows (effective limit ${snapshot.effectiveMaxRows.toLocaleString()})`
      : `${snapshot.rowCount.toLocaleString()} rows`;
  }

  function updateDashboardStatus() {
    const waiting = state.dashboard.widgets.filter(widget => widget.source.kind === 'savedQuery' && widget.source.sql && !isApproved(widget)).length;
    const running = state.widgetRequests.size;
    els.reviewDashboardSql.classList.toggle('needs-review', waiting > 0);
    els.reviewDashboardSql.title = waiting ? `${waiting} widget queries need review before they can run` : 'Review the SQL and connections for this dashboard';
    els.status.dataset.state = running ? 'running' : waiting ? 'review' : state.pausedWidgets.size ? 'paused' : 'ready';
    els.stopDashboard.disabled = !running && !state.dashboard.widgets.some(widget => widget.refreshPolicy.mode === 'interval' && isApproved(widget) && !state.pausedWidgets.has(widget.id));
    els.status.textContent = running ? `${running} queries running` : waiting ? `${waiting} queries awaiting SQL review` : state.pausedWidgets.size ? 'Queries paused' : 'Dashboard ready';
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
    setTheme,
    loadDashboard,
    dashboardDocument
  });
  window.addEventListener('DOMContentLoaded', init, { once: true });
})();
