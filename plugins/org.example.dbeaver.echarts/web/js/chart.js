(() => {
  'use strict';

  const state = {
    snapshot: null,
    chart: null,
    renderer: 'canvas',
    xIndex: -1,
    yIndex: -1,
    chartType: 'line'
  };

  const els = {};
  let resizeObserver = null;
  let lastChartWidth = 0;
  let lastChartHeight = 0;

  function $(id) { return document.getElementById(id); }

  function init() {
    els.chart = $('chart');
    els.empty = $('empty');
    els.status = $('status');
    els.chartType = $('chartType');
    els.xField = $('xField');
    els.yField = $('yField');
    els.renderer = $('renderer');
    els.reload = $('reload');

    els.chartType.addEventListener('change', () => {
      state.chartType = els.chartType.value;
      render();
    });
    els.xField.addEventListener('change', () => {
      state.xIndex = Number(els.xField.value);
      render();
    });
    els.yField.addEventListener('change', () => {
      state.yIndex = Number(els.yField.value);
      render();
    });
    els.renderer.addEventListener('change', () => {
      state.renderer = els.renderer.value;
      recreateChart();
      render();
    });
    els.reload.addEventListener('click', () => reload({ preserveSelection: true }));
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        resizeChart(entry?.contentRect?.width, entry?.contentRect?.height);
      });
      resizeObserver.observe(els.chart);
    } else {
      window.addEventListener('resize', resizeChart);
    }

    reload({ preserveSelection: false });
  }

  function readSnapshot() {
    if (typeof window.dbeaverGetDataset !== 'function') {
      throw new Error('DBeaver browser bridge is not available.');
    }
    const raw = window.dbeaverGetDataset();
    const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('DBeaver returned an invalid dataset.');
    }
    if (snapshot.error) {
      throw new Error(snapshot.error);
    }
    if (snapshot.schemaVersion !== 1) {
      throw new Error(`Unsupported dataset schema: ${snapshot.schemaVersion}`);
    }
    return snapshot;
  }

  function reload({ preserveSelection = true } = {}) {
    try {
      if (typeof window.echarts === 'undefined') {
        throw new Error(
          'Apache ECharts runtime is missing.\n' +
          'Run scripts/vendor-echarts.ps1 or scripts/vendor-echarts.sh before building the plugin.'
        );
      }
      const previousX = preserveSelection ? selectedColumnName(state.xIndex) : null;
      const previousY = preserveSelection ? selectedColumnName(state.yIndex) : null;

      state.snapshot = readSnapshot();
      configureFields(previousX, previousY);
      render();
      setMessage(null);
      updateStatus();
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function selectedColumnName(index) {
    return state.snapshot?.columns?.[index]?.name ?? null;
  }

  function configureFields(previousX, previousY) {
    const columns = state.snapshot.columns || [];
    fillSelect(els.xField, columns);
    fillSelect(els.yField, columns);

    state.xIndex = findPrevious(columns, previousX);
    if (state.xIndex < 0) state.xIndex = inferX(columns);

    state.yIndex = findPrevious(columns, previousY);
    if (state.yIndex < 0 || state.yIndex === state.xIndex) state.yIndex = inferY(columns, state.xIndex);

    if (state.xIndex >= 0) els.xField.value = String(state.xIndex);
    if (state.yIndex >= 0) els.yField.value = String(state.yIndex);
  }

  function fillSelect(select, columns) {
    select.replaceChildren();
    columns.forEach((column, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${column.name} (${column.kind})`;
      select.appendChild(option);
    });
  }

  function findPrevious(columns, name) {
    if (!name) return -1;
    return columns.findIndex(column => column.name === name);
  }

  function inferX(columns) {
    let index = columns.findIndex(column => isDateKind(column.kind));
    if (index >= 0) return index;
    index = columns.findIndex(column => isTextKind(column.kind));
    return index >= 0 ? index : (columns.length ? 0 : -1);
  }

  function inferY(columns, xIndex) {
    const index = columns.findIndex((column, i) => i !== xIndex && isNumericKind(column.kind));
    if (index >= 0) return index;
    return columns.findIndex((_, i) => i !== xIndex);
  }

  function render() {
    const snapshot = state.snapshot;
    if (!snapshot || !snapshot.columns?.length || !snapshot.rows?.length) {
      disposeChart();
      setMessage('The result set has no rows or visible columns to chart.');
      return;
    }
    if (state.xIndex < 0 || state.yIndex < 0) {
      disposeChart();
      setMessage('Select at least two result-set columns.');
      return;
    }

    setMessage(null);
    const chart = ensureChart();
    chart.clear();
    chart.setOption(buildOption(snapshot), { notMerge: true, lazyUpdate: false });
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

  function buildOption(snapshot) {
    const xColumn = snapshot.columns[state.xIndex];
    const yColumn = snapshot.columns[state.yIndex];
    const type = state.chartType;

    if (type === 'pie') return buildPieOption(snapshot.rows, xColumn, yColumn);
    if (type === 'scatter') return buildScatterOption(snapshot.rows, xColumn, yColumn);
    return buildAxisOption(snapshot.rows, xColumn, yColumn, type);
  }

  function baseOption(xColumn, yColumn) {
    return {
      animation: false,
      title: {
        text: `${yColumn.name} by ${xColumn.name}`,
        left: 12,
        top: 8,
        textStyle: { fontSize: 14, fontWeight: 600 }
      },
      tooltip: { trigger: 'axis', confine: true },
      toolbox: {
        right: 12,
        feature: { dataZoom: {}, restore: {}, saveAsImage: {} }
      },
      grid: { left: 58, right: 28, top: 58, bottom: 58, containLabel: true }
    };
  }

  function buildAxisOption(rows, xColumn, yColumn, type) {
    const option = baseOption(xColumn, yColumn);
    const useTimeAxis = type !== 'bar' && isDateKind(xColumn.kind);
    const seriesType = type === 'area' ? 'line' : type;

    option.xAxis = useTimeAxis
      ? { type: 'time', name: xColumn.name, nameLocation: 'middle', nameGap: 32 }
      : {
          type: 'category',
          name: xColumn.name,
          nameLocation: 'middle',
          nameGap: 34,
          data: rows.map(row => displayValue(row[state.xIndex])),
          axisLabel: { hideOverlap: true }
        };
    option.yAxis = {
      type: 'value',
      name: yColumn.name,
      scale: true
    };
    option.dataZoom = [
      { type: 'inside', filterMode: 'none' },
      { type: 'slider', height: 18, bottom: 8, filterMode: 'none' }
    ];
    option.series = [{
      name: yColumn.name,
      type: seriesType,
      showSymbol: rows.length <= 500,
      sampling: rows.length > 2000 ? 'lttb' : undefined,
      progressive: 5000,
      progressiveThreshold: 10000,
      large: seriesType === 'bar' && rows.length > 2000,
      areaStyle: type === 'area' ? {} : undefined,
      data: useTimeAxis
        ? rows.map(row => [row[state.xIndex], toNumber(row[state.yIndex])]).filter(pair => pair[0] != null && Number.isFinite(pair[1]))
        : rows.map(row => toNumber(row[state.yIndex]))
    }];
    return option;
  }

  function buildScatterOption(rows, xColumn, yColumn) {
    const option = baseOption(xColumn, yColumn);
    option.tooltip = { trigger: 'item', confine: true };
    option.xAxis = { type: 'value', name: xColumn.name, scale: true };
    option.yAxis = { type: 'value', name: yColumn.name, scale: true };
    option.dataZoom = [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }];
    option.series = [{
      name: `${xColumn.name} / ${yColumn.name}`,
      type: 'scatter',
      large: rows.length > 5000,
      largeThreshold: 5000,
      progressive: 5000,
      data: rows
        .map(row => [toNumber(row[state.xIndex]), toNumber(row[state.yIndex])])
        .filter(pair => Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
    }];
    return option;
  }

  function buildPieOption(rows, xColumn, yColumn) {
    const totals = new Map();
    for (const row of rows) {
      const name = displayValue(row[state.xIndex]);
      const value = toNumber(row[state.yIndex]);
      if (!Number.isFinite(value)) continue;
      totals.set(name, (totals.get(name) || 0) + value);
    }
    const data = [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return {
      animation: false,
      title: {
        text: `${yColumn.name} by ${xColumn.name}`,
        left: 12,
        top: 8,
        textStyle: { fontSize: 14, fontWeight: 600 }
      },
      tooltip: { trigger: 'item', confine: true },
      legend: { type: 'scroll', bottom: 5 },
      toolbox: { right: 12, feature: { restore: {}, saveAsImage: {} } },
      series: [{
        name: yColumn.name,
        type: 'pie',
        radius: ['25%', '68%'],
        center: ['50%', '49%'],
        minAngle: 1,
        data
      }]
    };
  }

  function ensureChart() {
    if (!state.chart) {
      state.chart = window.echarts.init(els.chart, null, { renderer: state.renderer });
    }
    return state.chart;
  }

  function recreateChart() {
    disposeChart();
    if (state.snapshot?.rows?.length) ensureChart();
  }

  function disposeChart() {
    if (state.chart) {
      state.chart.dispose();
      state.chart = null;
    }
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

  function isNumericKind(kind) {
    return kind === 'NUMERIC';
  }

  function isDateKind(kind) {
    return kind === 'DATETIME';
  }

  function isTextKind(kind) {
    return kind === 'STRING';
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return NaN;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : NaN;
  }

  function displayValue(value) {
    if (value === null || value === undefined) return '(null)';
    return String(value);
  }

  window.DBeaverECharts = Object.freeze({ reload });
  window.addEventListener('DOMContentLoaded', init, { once: true });
})();
