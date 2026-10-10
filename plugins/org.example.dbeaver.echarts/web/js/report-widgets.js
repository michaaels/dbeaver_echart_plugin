(() => {
  'use strict';
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  };
  const THEME = { background: '#ffffff', foreground: '#243447', muted: '#657487', border: '#d5dce3', grid: '#e5eaf0', controlBackground: '#f6f8fa' };
  const registry = new Map();
  function register(type, definition) {
    if (registry.has(type) || typeof definition.render !== 'function') throw new Error('Invalid report renderer registration.');
    registry.set(type, definition);
  }
  function numeric(value) { return value !== null && value !== '' && Number.isFinite(Number(value)); }
  function format(value, config = {}) {
    if (value === null || value === undefined) return '—';
    const type = config.format || config.numberFormat || 'text';
    if (type === 'date') {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }).format(date) : String(value);
    }
    if (['number', 'currency', 'percent'].includes(type) && numeric(value)) {
      const decimals = config.decimals ?? 2;
      return new Intl.NumberFormat(undefined, { style: type === 'currency' ? 'currency' : type === 'percent' ? 'percent' : 'decimal',
        ...(type === 'currency' ? { currency: 'USD' } : {}), minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(value));
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  function aggregate(snapshot, column, method) {
    const index = snapshot?.columns.findIndex(item => item.name === column) ?? -1;
    const values = snapshot?.rows.map(row => row[index]) || [];
    if (method === 'count') return snapshot?.rows.length || 0;
    if (method === 'first') return values[0] ?? null;
    const numbers = values.filter(numeric).map(Number);
    if (!numbers.length) return null;
    if (method === 'min') return numbers.reduce((minimum, value) => Math.min(minimum, value), Infinity);
    if (method === 'max') return numbers.reduce((maximum, value) => Math.max(maximum, value), -Infinity);
    const sum = numbers.reduce((total, value) => total + value, 0);
    return method === 'average' ? sum / numbers.length : sum;
  }
  function visible(widget, snapshot) {
    const rule = widget.config.visibility;
    if (!rule?.enabled) return true;
    if (!snapshot) return true;
    const index = snapshot.columns.findIndex(column => column.name === rule.column);
    const value = snapshot.rows[0]?.[index];
    if (rule.operator === 'notEmpty') return value !== null && value !== undefined && value !== '';
    return rule.operator === 'eq' ? String(value) === rule.value : numeric(value) && (rule.operator === 'gt' ? Number(value) > Number(rule.value) : Number(value) < Number(rule.value));
  }
  function chartOption(widget, snapshot) {
    const config = widget.config.chart, columns = snapshot.columns;
    const xIndex = columns.findIndex(column => column.name === config.xColumn);
    const yIndices = config.yColumns.map(name => columns.findIndex(column => column.name === name && column.kind === 'NUMERIC')).filter(index => index >= 0);
    if (xIndex < 0 || !yIndices.length) throw new Error('Choose a category and numeric series in Chart properties.');
    const option = window.DBeaverEChartsAnalytics.buildOption({ rows: snapshot.rows, columns, rowCount: snapshot.rows.length, xIndex, yIndices,
      yAxes: Object.fromEntries(yIndices.map(index => [index, config.yAxes[columns[index].name] || 'left'])),
      chartType: config.chartType, marks: config.marks, theme: { ...THEME, background: widget.style.background === 'transparent' ? '#ffffff' : widget.style.background }, dashboard: true });
    option.animation = false;
    if (config.colors?.length) option.color = config.colors;
    if (option.legend) option.legend.show = config.legend !== false;
    return option;
  }
  function requireData(body, snapshot) {
    if (!snapshot) { body.append(node('p', 'Configure a query, then refresh data.', 'report-placeholder')); return false; }
    if (!snapshot.rows.length) { body.append(node('p', 'The query returned no rows.', 'report-placeholder')); return false; }
    return true;
  }
  function templateText(text, context) {
    return String(text || '').replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, name) =>
      name === 'generated_date' ? format(context.generatedAt || new Date().toISOString(), { format: 'date' }) : String(context.parameters?.[name] ?? match));
  }
  register('heading', { label: 'Heading', icon: 'H', render(body, widget, snapshot, context) {
    body.append(node('h2', templateText(widget.config.text || widget.title, context), 'report-heading'));
  } });
  register('text', { label: 'Text', icon: 'T', render(body, widget, snapshot, context) {
    body.append(node('p', templateText(widget.config.text, context), 'report-paragraph'));
  } });
  register('date', { label: 'Generated date', icon: 'D', render(body, widget, snapshot, context) {
    body.append(node('p', `${widget.config.prefix || 'Generated: '}${format(context.generatedAt || new Date().toISOString(), { format: 'date' })}`, 'report-date'));
  } });
  register('image', { label: 'Image / logo', icon: '▧', render(body, widget, snapshot, context) {
    if (!widget.config.image) { body.append(node('p', 'Choose a local image in Properties.', 'report-placeholder')); return; }
    const image = node('img'); image.src = widget.config.image; image.alt = widget.config.alt || widget.title; image.className = 'report-image';
    if (context.allRows) image.style.maxHeight = `${widget.layout.height * 24}px`;
    body.append(image);
  } });
  register('line', { label: 'Separator', icon: '—', render(body, widget) {
    const line = node('hr'); line.style.borderColor = widget.style.borderColor; body.append(line);
  } });
  register('rectangle', { label: 'Rectangle', icon: '□', render(body) { body.classList.add('report-rectangle'); } });
  for (const [type, label, icon] of [['section', 'Section', '▤'], ['header', 'Header', '⌃'], ['footer', 'Footer', '⌄']]) {
    register(type, { label, icon, container: true, render(body, widget, snapshot, context) {
      if (widget.config.text) body.append(node('p', templateText(widget.config.text, context), 'report-section-label'));
    } });
  }
  register('kpi', { label: 'KPI', icon: '#', render(body, widget, snapshot) {
    body.append(node('div', widget.title, 'report-kpi-label'));
    if (!requireData(body, snapshot)) return;
    const value = aggregate(snapshot, widget.config.column, widget.config.aggregate);
    body.append(node('div', `${widget.config.prefix}${format(value, widget.config)}${widget.config.suffix}`, 'report-kpi-value'));
  } });
  register('chart', { label: 'ECharts chart', icon: '▥', render(body, widget, snapshot, context) {
    body.append(node('h3', widget.title, 'report-chart-title'));
    if (!requireData(body, snapshot)) return;
    if (context.chartImages?.[widget.id]) {
      const image = node('img'); image.src = context.chartImages[widget.id]; image.alt = widget.title; image.className = 'report-image report-chart-image'; body.append(image); return;
    }
    const target = node('div', undefined, 'report-chart'); body.append(target);
    const chart = window.echarts.init(target, null, { renderer: 'canvas' });
    try { chart.setOption(chartOption(widget, snapshot), { notMerge: true }); }
    catch (error) { chart.dispose(); target.replaceChildren(node('p', error.message, 'report-placeholder')); return; }
    context.charts?.set(widget.id, chart);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => chart.resize()) : null;
    observer?.observe(target);
    return () => { observer?.disconnect(); chart.dispose(); context.charts?.delete(widget.id); };
  } });
  function tableColumns(widget, snapshot) {
    return (widget.config.columns.length ? widget.config.columns : snapshot.columns.map(column => ({ name: column.name, label: column.name,
      format: column.kind === 'NUMERIC' ? 'number' : column.kind === 'DATETIME' ? 'date' : 'text', align: column.kind === 'NUMERIC' ? 'right' : 'left', total: column.kind === 'NUMERIC', width: 0 })))
      .filter(column => snapshot.columns.some(item => item.name === column.name));
  }
  function sortedRows(widget, snapshot) {
    const index = snapshot.columns.findIndex(column => column.name === widget.config.sortColumn), rows = [...snapshot.rows];
    if (index >= 0) rows.sort((a, b) => (numeric(a[index]) && numeric(b[index]) ? Number(a[index]) - Number(b[index]) : String(a[index] ?? '').localeCompare(String(b[index] ?? '')))
      * (widget.config.sortDirection === 'desc' ? -1 : 1));
    return rows;
  }
  register('table', { label: 'SQL table', icon: '▦', render(body, widget, snapshot, context) {
    body.append(node('h3', widget.title, 'report-widget-title'));
    if (!requireData(body, snapshot)) return;
    const columns = tableColumns(widget, snapshot), rows = sortedRows(widget, snapshot);
    if (!columns.length) { body.append(node('p', 'Select table columns in Properties.', 'report-placeholder')); return; }
    let page = Math.min(Math.max(0, Math.floor(context.tablePages?.[widget.id] || 0)), Math.max(0, Math.ceil(rows.length / widget.config.pageSize) - 1));
    if (context.tablePages) context.tablePages[widget.id] = page;
    let rowLimit = widget.config.pageSize;
    const table = node('table', undefined, 'report-table'), head = node('thead'), headRow = node('tr'), tbody = node('tbody');
    columns.forEach(column => {
      const cell = node('th', column.label); cell.scope = 'col'; cell.style.textAlign = column.align;
      if (column.width) cell.style.width = `${column.width}px`;
      headRow.append(cell);
    });
    head.append(headRow); table.append(head, tbody);
    const wrap = node('div', undefined, 'report-table-wrap'); wrap.append(table); body.append(wrap);
    function addRow(row, className) {
      const line = node('tr', undefined, className);
      columns.forEach(column => {
        const index = snapshot.columns.findIndex(item => item.name === column.name), value = row[index];
        const cell = node('td', format(value, { ...column, decimals: widget.config.decimals }));
        cell.style.textAlign = column.align;
        const rule = column.rule;
        if (rule?.enabled && numeric(value) && (rule.operator === 'eq' ? Number(value) === rule.value : rule.operator === 'gt' ? Number(value) > rule.value : Number(value) < rule.value)) {
          cell.style.color = rule.color; cell.style.backgroundColor = rule.background;
        }
        line.append(cell);
      }); tbody.append(line);
    }
    let grandTotals;
    function totalRow(group, label) {
      const calculate = () => snapshot.columns.map(column => {
        const config = columns.find(item => item.name === column.name);
        return config?.total ? aggregate({ ...snapshot, rows: group }, column.name, 'sum') : null;
      });
      const totals = group === rows ? (grandTotals ||= calculate()) : calculate();
      const heading = node('tr', undefined, 'report-total'), cell = node('td', label); cell.colSpan = columns.length; heading.append(cell); tbody.append(heading);
      addRow(totals, 'report-total');
    }
    const groupIndex = snapshot.columns.findIndex(column => column.name === widget.config.groupBy);
    function renderRows() {
      tbody.replaceChildren();
      const shown = rows.slice(page * widget.config.pageSize, page * widget.config.pageSize + rowLimit);
      if (groupIndex >= 0) {
        const groups = new Map();
        for (const row of shown) { const key = String(row[groupIndex] ?? ''); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
        for (const [key, group] of groups) { group.forEach(row => addRow(row)); if (widget.config.totals) totalRow(group, `Subtotal: ${key}`); }
      } else shown.forEach(row => addRow(row));
      if (widget.config.totals) totalRow(rows, 'Total');
    }
    renderRows();
    if (context.staticTable) {
      const summary = node('p', 'Rows shown in this email', 'report-table-summary'); body.append(summary);
      // Bound the rows themselves: Outlook cannot reliably clip an overflowing table.
      // The export body has the same configured pixel height as the designer component.
      const available = wrap.clientHeight;
      if (available <= 0) { rowLimit = 0; renderRows(); }
      if (available > 0 && table.getBoundingClientRect().height > available) {
        let low = 0, high = rowLimit;
        while (low < high) {
          rowLimit = Math.ceil((low + high) / 2); renderRows();
          if (table.getBoundingClientRect().height <= available) low = rowLimit; else high = rowLimit - 1;
        }
        rowLimit = low; renderRows();
      }
      const start = page * widget.config.pageSize;
      summary.textContent = rowLimit ? `Rows ${start + 1}–${Math.min(start + rowLimit, rows.length)} of ${rows.length}` : 'Increase the table height to show data rows.';
    } else if (rows.length > widget.config.pageSize) {
      const controls = node('div', undefined, 'report-pagination'), previous = node('button', 'Previous'), next = node('button', 'Next'), status = node('span');
      previous.type = next.type = 'button';
      function update() { previous.disabled = page === 0; next.disabled = (page + 1) * widget.config.pageSize >= rows.length; status.textContent = `${page + 1} / ${Math.ceil(rows.length / widget.config.pageSize)} · ${rows.length} rows`; }
      const setPage = value => { page = value; if (context.tablePages) context.tablePages[widget.id] = page; renderRows(); update(); };
      previous.onclick = () => setPage(page - 1); next.onclick = () => setPage(page + 1);
      controls.append(previous, status, next); body.append(controls); update();
    }
    if (snapshot.truncated) body.append(node('p', `Partial result: limited to ${snapshot.effectiveMaxRows} rows.`, 'report-truncated'));
  } });
  function applyStyle(body, widget) {
    const style = widget.style;
    Object.assign(body.style, { color: style.color, backgroundColor: style.background, border: `${style.borderWidth}px solid ${style.borderColor}`,
      padding: `${style.padding}px`, fontSize: `${style.fontSize}px`, fontFamily: style.fontFamily, textAlign: style.align });
  }
  function renderWidget(body, widget, snapshot, context) {
    applyStyle(body, widget);
    const definition = registry.get(widget.type);
    if (!definition) throw new Error('Unknown report component.');
    if (context.errors?.[widget.sourceId]) body.append(node('p', context.errors[widget.sourceId], 'report-data-error'));
    if (context.loading?.has(widget.sourceId)) body.append(node('p', 'Refreshing data…', 'report-loading'));
    return definition.render(body, widget, snapshot, context);
  }
  function renderReport(root, report, snapshots, context = {}) {
    const cleanup = [];
    root.replaceChildren(); root.className = 'report-paper';
    Object.assign(root.style, { width: `${report.page.width}px`, padding: `${report.page.margin}px`, background: report.page.background });
    function group(parentId, parent) {
      const grid = node('div', undefined, 'report-grid'); grid.style.gap = `${report.page.gap}px`; parent.append(grid);
      const widgets = report.widgets.filter(widget => (widget.parentId || null) === parentId).sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
      for (const widget of widgets) {
        const snapshot = snapshots[widget.sourceId];
        if (!context.designer && !visible(widget, snapshot)) continue;
        const frame = node('article', undefined, 'report-component'); frame.dataset.componentId = widget.id;
        Object.assign(frame.style, { gridColumn: `${widget.layout.x + 1} / span ${widget.layout.width}`, gridRow: `${widget.layout.y + 1} / span ${widget.layout.height}` });
        const body = node('div', undefined, 'report-component-body'); frame.append(body); grid.append(frame);
        try { const dispose = renderWidget(body, widget, snapshot, context); if (dispose) cleanup.push(dispose); }
        catch (error) { body.append(node('p', error.message, 'report-data-error')); }
        if (registry.get(widget.type)?.container) group(widget.id, body);
        context.decorate?.(frame, widget, grid);
      }
    }
    group(null, root);
    return () => cleanup.splice(0).forEach(dispose => dispose());
  }
  window.DBeaverReportWidgets = Object.freeze({ register, registry, node, format, aggregate, visible, chartOption, tableColumns, renderWidget, renderReport });
})();
