(() => {
  'use strict';
  const FORMAT = 'dbeaver-echarts-report';
  const TYPES = ['heading', 'text', 'image', 'kpi', 'chart', 'table', 'line', 'rectangle', 'section', 'header', 'footer', 'date'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const text = (value, max = 200) => typeof value === 'string' ? value.slice(0, max) : '';
  const number = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  const color = (value, fallback) => /^#[\da-f]{6}$/i.test(value) || value === 'transparent' ? value : fallback;
  const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const layout = window.DBeaverDashboardLayout;
  const BOUNDS = Object.freeze({ minWidth: 1, minHeight: 1, maxHeight: 80 });
  const image = value => typeof value === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 2_800_000 ? value : '';

  function create(title = 'Untitled report') {
    return { format: FORMAT, schemaVersion: 1, title, description: '', category: '', defaultTemplate: false,
      page: { width: 960, margin: 24, gap: 8, background: '#ffffff', grid: true }, parameters: [], sources: [], widgets: [] };
  }
  function source(input) {
    return { id: text(input.id) || id('source'), name: text(input.name) || 'Query', kind: 'savedQuery',
      project: text(input.project), connection: text(input.connection), connectionId: text(input.connectionId),
      sql: text(input.sql, 100_000), maxRows: Math.round(number(input.maxRows, 0, 100_000, 0)) };
  }
  function widget(type = 'text') {
    if (!TYPES.includes(type)) throw new Error('Unsupported report component.');
    const titles = { heading: 'Report title', text: 'Paragraph', image: 'Logo', kpi: 'Indicator', chart: 'Chart', table: 'Data table',
      line: 'Separator', rectangle: 'Rectangle', section: 'Section', header: 'Header', footer: 'Footer', date: 'Generated date' };
    return { id: id('component'), type, title: titles[type], parentId: null, sourceId: '',
      layout: { x: 0, y: 0, width: ['heading', 'text', 'line', 'section', 'header', 'footer'].includes(type) ? 12 : 6,
        height: type === 'chart' || type === 'table' ? 8 : type === 'section' ? 12 : type === 'line' || type === 'date' ? 1 : type === 'heading' || type === 'header' || type === 'footer' ? 2 : 3 },
      style: { color: '#243447', background: 'transparent', borderColor: '#d5dce3', borderWidth: 0, padding: ['line', 'date'].includes(type) ? 0 : 12,
        fontSize: type === 'heading' ? 28 : 14, fontFamily: 'Segoe UI', align: 'left' },
      config: { text: type === 'heading' ? 'Report title' : type === 'text' ? 'Write the report narrative here.' : '',
        image: '', alt: '', column: '', aggregate: 'sum', numberFormat: 'number', decimals: 2, prefix: '', suffix: '',
        columns: [], totals: false, groupBy: '', pageSize: 20, sortColumn: '', sortDirection: 'asc',
        chart: { chartType: 'line', xColumn: null, yColumns: [], yAxes: {}, marks: {}, colors: [], legend: true },
        visibility: { enabled: false, column: '', operator: 'notEmpty', value: '' } } };
  }
  function normalize(input) {
    if (!input || input.format !== FORMAT || input.schemaVersion !== 1 || !Array.isArray(input.widgets) || !Array.isArray(input.sources)) {
      throw new Error('Unsupported report template. Choose an ECharts report JSON.');
    }
    if (JSON.stringify(input).length > 8_388_608 || input.widgets.length > 64 || input.sources.length > 24) {
      throw new Error('A report supports up to 64 components, 24 queries and 8 MiB of template content.');
    }
    const result = create(text(input.title) || 'Untitled report');
    result.description = text(input.description, 2000); result.category = text(input.category, 80);
    result.defaultTemplate = input.defaultTemplate === true;
    result.page = { width: Math.round(number(input.page?.width, 480, 1600, 960)), margin: number(input.page?.margin, 0, 80, 24),
      gap: number(input.page?.gap, 0, 32, 8), background: color(input.page?.background, '#ffffff'), grid: input.page?.grid !== false };
    const parameters = Array.isArray(input.parameters) ? input.parameters : [];
    if (parameters.length > 32) throw new Error('A report supports up to 32 parameters.');
    const names = new Set();
    result.parameters = parameters.map(parameter => {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(parameter.name) || names.has(parameter.name)
        || !['text', 'number', 'date', 'boolean'].includes(parameter.type)) throw new Error('Invalid or duplicate parameter.');
      names.add(parameter.name);
      return { name: parameter.name, label: text(parameter.label) || parameter.name, type: parameter.type, default: text(String(parameter.default ?? ''), 2000) };
    });
    const sourceIds = new Set();
    result.sources = input.sources.map(item => {
      const normalized = source(item);
      if (sourceIds.has(normalized.id)) throw new Error('Duplicate query ID.');
      sourceIds.add(normalized.id); return normalized;
    });
    const widgetIds = new Set();
    result.widgets = input.widgets.map(item => {
      if (!TYPES.includes(item.type) || !text(item.id) || widgetIds.has(item.id)) throw new Error('Invalid or duplicate component.');
      widgetIds.add(item.id);
      const normalized = widget(item.type), config = item.config || {}, style = item.style || {};
      Object.assign(normalized, { id: item.id, title: text(item.title) || normalized.title, parentId: text(item.parentId) || null,
        sourceId: text(item.sourceId), layout: layout.normalizeLayout(item.layout, BOUNDS) });
      normalized.style = { color: color(style.color, '#243447'), background: color(style.background, 'transparent'), borderColor: color(style.borderColor, '#d5dce3'),
        borderWidth: number(style.borderWidth, 0, 8, 0), padding: number(style.padding, 0, 64, normalized.style.padding), fontSize: number(style.fontSize, 10, 72, normalized.style.fontSize),
        fontFamily: ['Segoe UI', 'Arial', 'Georgia', 'Consolas'].includes(style.fontFamily) ? style.fontFamily : 'Segoe UI',
        align: ['left', 'center', 'right'].includes(style.align) ? style.align : 'left' };
      normalized.config = { ...normalized.config, text: text(config.text, 20_000), image: image(config.image), alt: text(config.alt),
        column: text(config.column), aggregate: ['sum', 'average', 'count', 'first', 'min', 'max'].includes(config.aggregate) ? config.aggregate : 'sum',
        numberFormat: ['number', 'currency', 'percent', 'date', 'text'].includes(config.numberFormat) ? config.numberFormat : 'number',
        decimals: number(config.decimals, 0, 8, 2), prefix: text(config.prefix, 40), suffix: text(config.suffix, 40),
        totals: config.totals === true, groupBy: text(config.groupBy), pageSize: Math.round(number(config.pageSize, 5, 200, 20)),
        sortColumn: text(config.sortColumn), sortDirection: config.sortDirection === 'desc' ? 'desc' : 'asc' };
      normalized.config.columns = (Array.isArray(config.columns) ? config.columns : []).slice(0, 100).map(column => ({
        name: text(column.name), label: text(column.label) || text(column.name), format: ['number', 'currency', 'percent', 'date', 'text'].includes(column.format) ? column.format : 'text',
        width: number(column.width, 0, 1000, 0), align: ['left', 'center', 'right'].includes(column.align) ? column.align : 'left',
        total: column.total === true, rule: { enabled: column.rule?.enabled === true, operator: ['gt', 'lt', 'eq'].includes(column.rule?.operator) ? column.rule.operator : 'gt',
          value: number(column.rule?.value, -1e15, 1e15, 0), color: color(column.rule?.color, '#b42318'), background: color(column.rule?.background, '#fff2ef') } }));
      const chart = config.chart || {};
      normalized.config.chart = { chartType: text(chart.chartType) || 'line', xColumn: text(chart.xColumn) || null,
        yColumns: (Array.isArray(chart.yColumns) ? chart.yColumns : []).slice(0, 12).map(name => text(name)),
        yAxes: Object.fromEntries(Object.entries(chart.yAxes || {}).filter(([name, side]) => name.length <= 200 && ['left', 'right'].includes(side))),
        marks: { markLine: chart.marks?.markLine === true, markArea: chart.marks?.markArea === true, visualMap: chart.marks?.visualMap === true },
        colors: (Array.isArray(chart.colors) ? chart.colors : []).filter(value => /^#[\da-f]{6}$/i.test(value)).slice(0, 12), legend: chart.legend !== false };
      normalized.config.visibility = { enabled: config.visibility?.enabled === true, column: text(config.visibility?.column),
        operator: ['notEmpty', 'gt', 'lt', 'eq'].includes(config.visibility?.operator) ? config.visibility.operator : 'notEmpty', value: text(String(config.visibility?.value ?? '')) };
      return normalized;
    });
    for (const item of result.widgets) {
      if (item.sourceId && !sourceIds.has(item.sourceId)) throw new Error(`Missing query for ${item.title}.`);
      let ancestor = item, depth = 0;
      while (ancestor.parentId) {
        ancestor = result.widgets.find(parent => parent.id === ancestor.parentId);
        if (!ancestor || !['section', 'header', 'footer'].includes(ancestor.type) || ancestor.id === item.id || ++depth > 3) {
          throw new Error('Invalid or cyclic report section.');
        }
      }
    }
    place(result.widgets, input.priorityId);
    return result;
  }
  function place(widgets, priorityId) {
    const groups = new Set(widgets.map(item => item.parentId || null));
    for (const parent of groups) layout.placeWidgets(widgets.filter(item => (item.parentId || null) === parent), priorityId, BOUNDS);
  }
  function fromDashboard(dashboard) {
    const result = create(dashboard.title || 'Report from dashboard');
    for (const item of dashboard.widgets || []) {
      const query = source({ ...item.source, id: id('source'), name: item.source?.name || item.title });
      const component = widget('chart');
      Object.assign(component, { title: item.title, sourceId: query.id, layout: layout.normalizeLayout(item.layout) });
      component.config.chart = clone(item.chart);
      result.sources.push(query); result.widgets.push(component);
    }
    return normalize(result);
  }
  function signature(source, values) {
    return JSON.stringify([source.sql, source.project, source.connectionId, source.connection, source.maxRows,
      Object.entries(values || {}).sort(([a], [b]) => a.localeCompare(b))]);
  }
  function runtimeSource(template, source, values) {
    const parameters = {};
    for (const parameter of template.parameters) {
      const value = values[parameter.name] ?? parameter.default;
      if (parameter.type === 'number' && (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(value)) || !Number.isFinite(Number(value)))) throw new Error(`Enter a number for ${parameter.label}.`);
      if (parameter.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || !Number.isFinite(Date.parse(value))
        || new Date(value).toISOString().slice(0, 10) !== String(value))) throw new Error(`Enter a date for ${parameter.label}.`);
      if (parameter.type === 'boolean' && !['true', 'false'].includes(String(value))) throw new Error(`Choose true or false for ${parameter.label}.`);
      if (String(value).length > 2000) throw new Error(`Parameter ${parameter.label} is too long.`);
      parameters[parameter.name] = { type: parameter.type, value: String(value) };
    }
    return { ...clone(source), parameters };
  }
  function history(document, limit = 80, maxBytes = 24 * 1024 * 1024) {
    let current = normalize(document), undo = [], redo = [], lastMerge = null;
    function trim(items) {
      let bytes = 0;
      for (let i = items.length - 1; i >= 0; i--) {
        bytes += JSON.stringify(items[i]).length * 2;
        if (items.length - i > limit || bytes > maxBytes) return items.slice(i + 1);
      }
      return items;
    }
    return {
      get: () => current,
      replace(value) { current = normalize(value); undo = []; redo = []; lastMerge = null; return current; },
      change(action, mergeKey) {
        const before = clone(current), draft = clone(current); action(draft);
        const after = normalize(draft);
        if (JSON.stringify(before) !== JSON.stringify(after)) { if (!mergeKey || mergeKey !== lastMerge) undo.push(before); undo = trim(undo); redo = []; current = after; lastMerge = mergeKey || null; }
        return current;
      },
      undo() { lastMerge = null; if (undo.length) { redo.push(current); redo = trim(redo); current = undo.pop(); } return current; },
      redo() { lastMerge = null; if (redo.length) { undo.push(current); undo = trim(undo); current = redo.pop(); } return current; },
      canUndo: () => undo.length > 0, canRedo: () => redo.length > 0
    };
  }
  window.DBeaverReportModel = Object.freeze({ FORMAT, TYPES, BOUNDS, create, widget, source, normalize, fromDashboard, clone, id,
    history, place, signature, runtimeSource, image });
})();
