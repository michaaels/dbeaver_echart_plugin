(() => {
  'use strict';

  const CARTESIAN_TYPES = new Set(['line', 'area', 'bar', 'scatter']);
  const toNumber = value => {
    if (value === null || value === undefined || value === '') return NaN;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : NaN;
  };
  const displayValue = value => value === null || value === undefined ? '(null)' : String(value);
  const numericValues = (rows, index) => rows.map(row => toNumber(row[index])).filter(Number.isFinite);

  function extent(values, fallbackMinimum = 0, fallbackMaximum = 1) {
    if (!values.length) return [fallbackMinimum, fallbackMaximum];
    let minimum = values[0];
    let maximum = values[0];
    for (let index = 1; index < values.length; index++) {
      minimum = Math.min(minimum, values[index]);
      maximum = Math.max(maximum, values[index]);
    }
    if (minimum === maximum) {
      const padding = Math.abs(minimum || 1) * 0.1;
      return [minimum - padding, maximum + padding];
    }
    return [minimum, maximum];
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
  }

  function quantile(sortedValues, percentile) {
    if (!sortedValues.length) return NaN;
    const position = (sortedValues.length - 1) * percentile;
    const lower = Math.floor(position);
    const fraction = position - lower;
    return sortedValues[lower + 1] === undefined
      ? sortedValues[lower]
      : sortedValues[lower] + fraction * (sortedValues[lower + 1] - sortedValues[lower]);
  }

  function boxplot(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return [sorted[0], quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75), sorted.at(-1)];
  }

  function aggregateByCategory(rows, xIndex, yIndex) {
    const totals = new Map();
    for (const row of rows) {
      const value = toNumber(row[yIndex]);
      if (!Number.isFinite(value)) continue;
      const name = displayValue(row[xIndex]);
      totals.set(name, (totals.get(name) || 0) + value);
    }
    return [...totals.entries()].map(([name, value]) => ({ name, value }));
  }

  function toolbox(theme, zoom = false) {
    const feature = { restore: {}, saveAsImage: {} };
    if (zoom) feature.dataZoom = { yAxisIndex: 'none' };
    return {
      right: 12,
      iconStyle: { borderColor: theme.muted },
      emphasis: { iconStyle: { borderColor: theme.foreground } },
      feature
    };
  }

  function titleText(columns, xIndex, yIndices) {
    const names = yIndices.map(index => columns[index]?.name).filter(Boolean);
    return `${names.length > 2 ? `${names.length} series` : names.join(', ')} by ${columns[xIndex]?.name || 'category'}`;
  }

  function baseOption(context, zoom = false) {
    const { columns, xIndex, yIndices, theme } = context;
    return {
      animation: context.rowCount <= 2000,
      backgroundColor: theme.background,
      color: ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4'],
      textStyle: { color: theme.foreground },
      title: {
        text: titleText(columns, xIndex, yIndices),
        left: 12,
        top: 8,
        textStyle: { fontSize: 14, fontWeight: 600, color: theme.foreground }
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: theme.controlBackground,
        borderColor: theme.border,
        textStyle: { color: theme.foreground }
      },
      legend: { type: 'scroll', top: 34, left: 12, right: 130, textStyle: { color: theme.foreground } },
      toolbox: toolbox(theme, zoom)
    };
  }

  function axisStyle(theme, includeGrid = false) {
    const axis = {
      axisLine: { lineStyle: { color: theme.muted } },
      axisLabel: { color: theme.muted },
      nameTextStyle: { color: theme.muted }
    };
    if (includeGrid) axis.splitLine = { lineStyle: { color: theme.grid } };
    return axis;
  }

  function dataZoom() {
    return [
      {
        type: 'inside',
        xAxisIndex: [0],
        filterMode: 'none',
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: true,
        preventDefaultMouseMove: true
      },
      { type: 'slider', xAxisIndex: [0], height: 18, bottom: 8, filterMode: 'none', realtime: true }
    ];
  }

  function seriesMarks(enabled) {
    const marks = {};
    if (enabled.markLine) marks.markLine = { silent: true, data: [{ type: 'average', name: 'Mean' }] };
    if (enabled.markArea) {
      marks.markArea = { silent: true, data: [[{ type: 'min', name: 'Min' }, { type: 'max', name: 'Max' }]] };
    }
    return marks;
  }

  function buildCartesian(context) {
    const { rows, columns, xIndex, yIndices, yAxes, chartType, theme, marks } = context;
    const xColumn = columns[xIndex];
    const useTimeAxis = xColumn.kind === 'DATETIME' && chartType !== 'bar';
    const useCategoryAxis = xColumn.kind === 'STRING' || chartType === 'bar';
    const option = baseOption(context, true);
    const axisNames = { left: [], right: [] };
    for (const index of yIndices) axisNames[yAxes[index] === 'right' ? 'right' : 'left'].push(columns[index].name);

    option.grid = { left: 62, right: axisNames.right.length ? 62 : 28, top: 70, bottom: 64, containLabel: true };
    option.xAxis = useTimeAxis
      ? { type: 'time', name: xColumn.name, nameLocation: 'middle', nameGap: 34, ...axisStyle(theme) }
      : useCategoryAxis
        ? {
            type: 'category',
            name: xColumn.name,
            nameLocation: 'middle',
            nameGap: 36,
            data: [...new Set(rows.map(row => displayValue(row[xIndex])))],
            ...axisStyle(theme),
            axisLabel: { hideOverlap: true, color: theme.muted }
          }
        : { type: 'value', name: xColumn.name, scale: true, ...axisStyle(theme, true) };
    option.yAxis = [{
      type: 'value', name: axisNames.left.join(', '), scale: true, position: 'left', ...axisStyle(theme, true)
    }];
    if (axisNames.right.length) {
      option.yAxis.push({
        type: 'value', name: axisNames.right.join(', '), scale: true, position: 'right', ...axisStyle(theme)
      });
    }
    option.dataZoom = dataZoom();
    option.series = yIndices.map(yIndex => {
      const seriesType = chartType === 'area' ? 'line' : chartType;
      const values = rows
        .map(row => {
          const category = useCategoryAxis ? displayValue(row[xIndex]) : useTimeAxis ? row[xIndex] : toNumber(row[xIndex]);
          return [category, toNumber(row[yIndex])];
        })
        .filter(pair => pair[0] != null && Number.isFinite(pair[1]) && (useCategoryAxis || useTimeAxis || Number.isFinite(pair[0])));
      return {
        name: columns[yIndex].name,
        type: seriesType,
        yAxisIndex: yAxes[yIndex] === 'right' && option.yAxis.length > 1 ? 1 : 0,
        showSymbol: rows.length <= 500,
        sampling: seriesType === 'line' && rows.length > 2000 ? 'lttb' : undefined,
        progressive: 5000,
        progressiveThreshold: 10000,
        large: (seriesType === 'bar' || seriesType === 'scatter') && rows.length > 5000 && !useCategoryAxis,
        areaStyle: chartType === 'area' ? {} : undefined,
        data: values,
        ...seriesMarks(marks)
      };
    });
    if (marks.visualMap && option.series.length) {
      const [minimum, maximum] = extent(numericValues(rows, yIndices[0]));
      option.visualMap = {
        type: 'continuous', min: minimum, max: maximum, dimension: 1, seriesIndex: 0,
        right: 8, bottom: 54, calculable: true, textStyle: { color: theme.muted }
      };
    }
    return option;
  }

  function buildPie(context) {
    const { rows, columns, xIndex, yIndices, theme } = context;
    const yIndex = yIndices[0];
    const option = baseOption(context);
    option.tooltip.trigger = 'item';
    option.legend = { type: 'scroll', bottom: 5, textStyle: { color: theme.foreground } };
    option.series = [{
      name: columns[yIndex].name,
      type: 'pie',
      radius: ['25%', '68%'],
      center: ['50%', '50%'],
      minAngle: 1,
      data: aggregateByCategory(rows, xIndex, yIndex).sort((left, right) => right.value - left.value)
    }];
    return option;
  }

  function buildGauge(context) {
    const { rows, columns, yIndices, theme } = context;
    const yIndex = yIndices[0];
    const values = numericValues(rows, yIndex);
    const [minimum, maximum] = extent(values);
    const value = average(values);
    const option = baseOption(context);
    option.tooltip.trigger = 'item';
    option.legend = undefined;
    option.series = [{
      name: columns[yIndex].name,
      type: 'gauge',
      min: minimum,
      max: maximum,
      progress: { show: true, width: 14 },
      axisLine: { lineStyle: { width: 14 } },
      axisLabel: { color: theme.muted },
      detail: { valueAnimation: context.rowCount <= 2000, color: theme.foreground, formatter: '{value}' },
      data: [{ name: 'Average', value: Number.isFinite(value) ? Number(value.toPrecision(8)) : 0 }]
    }];
    return option;
  }

  function buildRadar(context) {
    const { rows, columns, yIndices, theme } = context;
    const metrics = yIndices.map(index => {
      const values = numericValues(rows, index);
      const [, maximum] = extent(values);
      return { index, values, maximum: Math.max(Math.abs(maximum), 1) };
    });
    const option = baseOption(context);
    option.tooltip.trigger = 'item';
    option.radar = {
      center: ['50%', '54%'],
      radius: '64%',
      indicator: metrics.map(metric => ({ name: columns[metric.index].name, max: metric.maximum })),
      axisName: { color: theme.foreground },
      splitLine: { lineStyle: { color: theme.grid } },
      splitArea: { areaStyle: { color: [theme.background, theme.controlBackground] } }
    };
    option.series = [{
      name: 'Average', type: 'radar', data: [{ name: 'Average', value: metrics.map(metric => average(metric.values)) }]
    }];
    return option;
  }

  function buildHeatmap(context) {
    const { rows, columns, xIndex, yIndices, theme } = context;
    const categories = [...new Set(rows.map(row => displayValue(row[xIndex])))];
    const categoryIndex = new Map(categories.map((name, index) => [name, index]));
    const data = [];
    yIndices.forEach((yIndex, seriesIndex) => {
      for (const row of rows) {
        const value = toNumber(row[yIndex]);
        if (Number.isFinite(value)) data.push([categoryIndex.get(displayValue(row[xIndex])), seriesIndex, value]);
      }
    });
    const [minimum, maximum] = extent(data.map(item => item[2]));
    const option = baseOption(context, true);
    option.grid = { left: 90, right: 70, top: 70, bottom: 64, containLabel: true };
    option.xAxis = { type: 'category', name: columns[xIndex].name, data: categories, ...axisStyle(theme) };
    option.yAxis = { type: 'category', data: yIndices.map(index => columns[index].name), ...axisStyle(theme) };
    option.dataZoom = dataZoom();
    option.visualMap = { min: minimum, max: maximum, calculable: true, right: 8, top: 90, textStyle: { color: theme.muted } };
    option.series = [{ name: 'Value', type: 'heatmap', data, progressive: 5000 }];
    return option;
  }

  function buildBoxplot(context) {
    const { rows, columns, yIndices, theme } = context;
    const option = baseOption(context);
    option.grid = { left: 62, right: 28, top: 70, bottom: 48, containLabel: true };
    option.xAxis = { type: 'category', data: yIndices.map(index => columns[index].name), ...axisStyle(theme) };
    option.yAxis = { type: 'value', scale: true, ...axisStyle(theme, true) };
    option.series = [{ name: 'Distribution', type: 'boxplot', data: yIndices.map(index => boxplot(numericValues(rows, index))) }];
    return option;
  }

  function buildTreemap(context) {
    const option = baseOption(context);
    option.tooltip.trigger = 'item';
    option.legend = undefined;
    option.series = [{
      name: 'Value', type: 'treemap', roam: true, nodeClick: 'zoomToNode', breadcrumb: { show: true },
      data: aggregateByCategory(context.rows, context.xIndex, context.yIndices[0]).sort((left, right) => right.value - left.value)
    }];
    return option;
  }

  function buildFunnel(context) {
    const option = baseOption(context);
    option.tooltip.trigger = 'item';
    option.legend = { type: 'scroll', bottom: 5, textStyle: { color: context.theme.foreground } };
    option.series = [{
      name: 'Value', type: 'funnel', left: '12%', top: 72, bottom: 42, width: '76%', sort: 'descending', gap: 2,
      data: aggregateByCategory(context.rows, context.xIndex, context.yIndices[0]).sort((left, right) => right.value - left.value)
    }];
    return option;
  }

  function buildMap(context) {
    const { rows, columns, xIndex, yIndices, theme } = context;
    const latitudeIndex = yIndices[0];
    const valueIndex = yIndices[1] ?? latitudeIndex;
    const data = rows.map((row, index) => {
      const longitude = toNumber(row[xIndex]);
      const latitude = toNumber(row[latitudeIndex]);
      const value = toNumber(row[valueIndex]);
      return {
        name: `Row ${index + 1}`,
        value: [longitude, latitude, Number.isFinite(value) ? value : 1]
      };
    }).filter(item => Number.isFinite(item.value[0]) && Number.isFinite(item.value[1]));
    const [minimum, maximum] = extent(data.map(item => item.value[2]));
    const option = baseOption(context);
    option.title.text = `${columns[valueIndex].name} by location`;
    option.tooltip = {
      trigger: 'item',
      confine: true,
      backgroundColor: theme.controlBackground,
      borderColor: theme.border,
      textStyle: { color: theme.foreground },
      formatter: params => `${params.name}<br>Lon: ${params.value[0]}<br>Lat: ${params.value[1]}<br>Value: ${params.value[2]}`
    };
    option.legend = undefined;
    option.geo = {
      map: 'world',
      roam: true,
      scaleLimit: { min: 1, max: 24 },
      itemStyle: { areaColor: theme.controlBackground, borderColor: theme.border },
      emphasis: { itemStyle: { areaColor: '#fac858' }, label: { color: theme.foreground } }
    };
    option.visualMap = {
      type: 'continuous', min: minimum, max: maximum, dimension: 2,
      right: 8, bottom: 24, calculable: true, textStyle: { color: theme.muted }
    };
    option.series = [{
      name: columns[valueIndex].name,
      type: 'scatter',
      coordinateSystem: 'geo',
      progressive: 5000,
      symbolSize: value => Math.max(4, Math.min(24, 4 + 20 * (value[2] - minimum) / Math.max(maximum - minimum, 1))),
      data
    }];
    return option;
  }

  function buildOption(context) {
    if (CARTESIAN_TYPES.has(context.chartType)) return buildCartesian(context);
    if (context.chartType === 'pie') return buildPie(context);
    if (context.chartType === 'gauge') return buildGauge(context);
    if (context.chartType === 'radar') return buildRadar(context);
    if (context.chartType === 'heatmap') return buildHeatmap(context);
    if (context.chartType === 'boxplot') return buildBoxplot(context);
    if (context.chartType === 'treemap') return buildTreemap(context);
    if (context.chartType === 'funnel') return buildFunnel(context);
    if (context.chartType === 'map') return buildMap(context);
    throw new Error(`Unsupported chart type: ${context.chartType}`);
  }

  const hasRenderableData = option => Array.isArray(option?.series)
    && option.series.some(series => Array.isArray(series.data) && series.data.length > 0);

  window.DBeaverEChartsAnalytics = Object.freeze({ buildOption, displayValue, hasRenderableData, toNumber });
})();
