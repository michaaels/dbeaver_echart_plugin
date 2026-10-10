(() => {
  'use strict';
  const W = window.DBeaverReportWidgets, M = window.DBeaverReportModel, node = W.node;
  function button(text, action, className) { const control = node('button', text, className); control.type = 'button'; control.addEventListener('click', action); return control; }
  function field(label, value, type, action, options = []) {
    const row = node('label', label), control = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
    if (type === 'select') options.forEach(option => control.append(new Option(Array.isArray(option) ? option[1] : option, Array.isArray(option) ? option[0] : option)));
    else if (type !== 'textarea') control.type = type;
    if (type === 'checkbox') { control.checked = Boolean(value); row.className = 'report-check'; }
    else control.value = value ?? '';
    control.setAttribute('aria-label', label);
    control.addEventListener(['text', 'textarea', 'color'].includes(type) ? 'input' : 'change', () => action(type === 'checkbox' ? control.checked : type === 'number' ? Number(control.value) : control.value));
    row.append(control); return row;
  }
  function section(root, title) { const body = node('section', undefined, 'report-property-section'); body.append(node('h3', title)); root.append(body); return body; }
  function render(root, report, selectedIds, snapshots, hooks) {
    const openColumns = new Set([...root.querySelectorAll('.report-column-config[open]')].map(element => element.dataset.columnName));
    root.replaceChildren();
    const selected = report.widgets.filter(widget => selectedIds.has(widget.id));
    const item = selected[0];
    const change = (action, key, textEdit = false) => hooks.change(action, { mergeKey: key, render: !textEdit });
    if (!item) {
      root.append(field('Description', report.description, 'textarea', value => change(draft => { draft.description = value; }, 'report.description', true)),
        field('Category', report.category, 'text', value => change(draft => { draft.category = value; }, 'report.category', true)),
        field('Default template for new reports', report.defaultTemplate, 'checkbox', value => change(draft => { draft.defaultTemplate = value; })));
      const grid = node('div', undefined, 'report-property-grid');
      for (const [name, label] of [['width', 'Sheet width (px)'], ['margin', 'Margins (px)'], ['gap', 'Component spacing (px)']]) {
        grid.append(field(label, report.page[name], 'number', value => change(draft => { draft.page[name] = value; })));
      }
      root.append(grid, field('Paper color', report.page.background, 'color', value => change(draft => { draft.page.background = value; }, 'page.background', true)),
        field('Show alignment grid', report.page.grid, 'checkbox', value => change(draft => { draft.page.grid = value; })));
      return;
    }
    const actions = node('div', undefined, 'report-property-actions');
    actions.append(button('Duplicate', hooks.duplicate), button('Copy', hooks.copy), button('Paste', hooks.paste), button('Delete', hooks.remove)); root.append(actions);
    if (selected.length > 1) {
      root.append(node('p', `${selected.length} components selected. Shift-click adds to the selection.`));
      const align = section(root, 'Align selected components');
      for (const [key, title] of [['left', 'Left edges'], ['right', 'Right edges'], ['top', 'Top edges'], ['bottom', 'Bottom edges'], ['distribute', 'Distribute horizontally']]) align.append(button(title, () => hooks.align(key)));
    }
    function update(fieldName, value, key, textEdit = false) {
      change(draft => { const widget = draft.widgets.find(widget => widget.id === item.id); fieldName(widget, value); draft.priorityId = item.id; }, key && `${item.id}.${key}`, textEdit);
    }
    root.append(field('Component title', item.title, 'text', value => update((widget, value) => { widget.title = value; }, value, 'title', true)));
    const position = section(root, 'Position and size'), grid = node('div', undefined, 'report-property-grid');
    for (const [name, label] of [['x', 'Column'], ['y', 'Row'], ['width', 'Width (columns)'], ['height', 'Height (rows)']]) {
      grid.append(field(label, item.layout[name], 'number', value => update((widget, value) => { widget.layout[name] = value; }, value)));
    }
    position.append(grid, node('p', '12 columns. Rows are 24 px plus spacing.', 'report-placeholder'));
    const containers = report.widgets.filter(widget => ['section', 'header', 'footer'].includes(widget.type) && widget.id !== item.id);
    position.append(field('Section', item.parentId || '', 'select', value => update((widget, value) => { widget.parentId = value || null; widget.layout.x = 0; widget.layout.y = 0; }, value),
      [['', 'Report sheet'], ...containers.map(widget => [widget.id, widget.title])]), button('Move earlier', () => hooks.order(-1)), button('Move later', () => hooks.order(1)));
    const style = section(root, 'Appearance');
    style.append(field('Text color', item.style.color, 'color', value => update((widget, value) => { widget.style.color = value; }, value, 'color', true)),
      field('Background', item.style.background === 'transparent' ? '#ffffff' : item.style.background, 'color', value => update((widget, value) => { widget.style.background = value; }, value, 'background', true)),
      field('Transparent background', item.style.background === 'transparent', 'checkbox', value => update((widget, value) => { widget.style.background = value ? 'transparent' : '#ffffff'; }, value)));
    const styleGrid = node('div', undefined, 'report-property-grid');
    for (const [name, label] of [['fontSize', 'Font size'], ['padding', 'Padding'], ['borderWidth', 'Border width']]) styleGrid.append(field(label, item.style[name], 'number', value => update((widget, value) => { widget.style[name] = value; }, value)));
    style.append(styleGrid, field('Font', item.style.fontFamily, 'select', value => update((widget, value) => { widget.style.fontFamily = value; }, value), ['Segoe UI', 'Arial', 'Georgia', 'Consolas']),
      field('Alignment', item.style.align, 'select', value => update((widget, value) => { widget.style.align = value; }, value), ['left', 'center', 'right']),
      field('Border color', item.style.borderColor, 'color', value => update((widget, value) => { widget.style.borderColor = value; }, value, 'borderColor', true)));
    if (['text', 'heading', 'section', 'header', 'footer'].includes(item.type)) {
      section(root, 'Content').append(field('Text', item.config.text, 'textarea', value => update((widget, value) => { widget.config.text = value; }, value, 'text', true)),
        node('p', 'Use {{generated_date}} or a parameter name such as {{start_date}}.', 'report-placeholder'));
    }
    if (item.type === 'image') section(root, 'Image').append(button('Choose local image', hooks.pickImage),
      field('Alternative text', item.config.alt, 'text', value => update((widget, value) => { widget.config.alt = value; }, value, 'alt', true)));
    if (item.type === 'date') root.append(field('Label before date', item.config.prefix, 'text', value => update((widget, value) => { widget.config.prefix = value; }, value, 'prefix', true)));
    if (['chart', 'kpi', 'table'].includes(item.type)) {
      const data = section(root, 'Data');
      data.append(field('Query', item.sourceId, 'select', value => update((widget, value) => { widget.sourceId = value; }, value), [['', 'Choose a query'], ...report.sources.map(source => [source.id, source.name])]),
        button('Configure queries', hooks.showData), button('Refresh this query', () => hooks.refreshSource(item.sourceId)));
    }
    const snapshot = snapshots[item.sourceId], names = snapshot?.columns.map(column => [column.name, column.name]) || [];
    const config = (name, value, textEdit = false) => update((widget, value) => { widget.config[name] = value; }, value, textEdit ? name : null, textEdit);
    if (item.type === 'chart') {
      const body = section(root, 'Chart'); body.append(button('Configure chart and preview SQL', hooks.editChart),
        field('Show legend', item.config.chart.legend, 'checkbox', value => update((widget, value) => { widget.config.chart.legend = value; }, value)),
        field('Series colors (hex, comma separated)', item.config.chart.colors.join(', '), 'text', value => update((widget, value) => { widget.config.chart.colors = value.split(',').map(value => value.trim()); }, value, 'chart.colors', true)));
    }
    if (item.type === 'kpi') {
      const body = section(root, 'Indicator');
      body.append(field('Value column', item.config.column, 'select', value => config('column', value), [['', 'Choose a column'], ...names]),
        field('Calculation', item.config.aggregate, 'select', value => config('aggregate', value), ['sum', 'average', 'count', 'first', 'min', 'max']),
        field('Number format', item.config.numberFormat, 'select', value => config('numberFormat', value), ['number', 'currency', 'percent', 'text']),
        field('Decimal places', item.config.decimals, 'number', value => config('decimals', value)),
        field('Prefix', item.config.prefix, 'text', value => config('prefix', value, true)), field('Suffix', item.config.suffix, 'text', value => config('suffix', value, true)));
    }
    if (item.type === 'table') {
      const body = section(root, 'Table');
      body.append(field('Rows per page', item.config.pageSize, 'number', value => config('pageSize', value)),
        field('Decimal places', item.config.decimals, 'number', value => config('decimals', value)),
        field('Sort by', item.config.sortColumn, 'select', value => config('sortColumn', value), [['', 'Query order'], ...names]),
        field('Sort direction', item.config.sortDirection, 'select', value => config('sortDirection', value), ['asc', 'desc']),
        field('Show totals / subtotals', item.config.totals, 'checkbox', value => config('totals', value)),
        field('Subtotal group', item.config.groupBy, 'select', value => config('groupBy', value), [['', 'No grouping'], ...names]));
      body.append(node('p', 'Email keeps the selected page and fits rows to the table height. Increase Rows per page and Height to show more.', 'report-placeholder'));
      if (snapshot) {
        const chosen = W.tableColumns(item, snapshot);
        for (const column of snapshot.columns) {
          const existing = chosen.find(config => config.name === column.name), details = node('details', undefined, 'report-column-config');
          details.dataset.columnName = column.name; details.open = openColumns.has(column.name);
          details.append(node('summary', column.name));
          function changeColumn(action, key, textEdit = false) {
            update((widget) => {
              if (!widget.config.columns.length) widget.config.columns = M.clone(chosen);
              const selected = widget.config.columns.find(config => config.name === column.name);
              action(widget, selected);
            }, null, key && `column.${column.name}.${key}`, textEdit);
          }
          details.append(field('Include column', Boolean(existing), 'checkbox', value => changeColumn((widget, selected) => {
            if (!value) { if (widget.config.columns.length === 1) throw new Error('A table must include at least one column.'); widget.config.columns = widget.config.columns.filter(config => config.name !== column.name); }
            else if (!selected) widget.config.columns.push({ name: column.name, label: column.name, format: 'text', width: 0, align: 'left', total: false });
          })));
          if (existing) {
            details.append(field('Column heading', existing.label, 'text', value => changeColumn((widget, selected) => { selected.label = value; }, 'label', true)),
              field('Column format', existing.format, 'select', value => changeColumn((widget, selected) => { selected.format = value; }), ['text', 'number', 'currency', 'percent', 'date']),
              field('Column width (px; 0 = automatic)', existing.width, 'number', value => changeColumn((widget, selected) => { selected.width = value; })),
              field('Column alignment', existing.align, 'select', value => changeColumn((widget, selected) => { selected.align = value; }), ['left', 'center', 'right']),
              field('Sum in totals', existing.total, 'checkbox', value => changeColumn((widget, selected) => { selected.total = value; })),
              field('Conditional color', existing.rule?.enabled, 'checkbox', value => changeColumn((widget, selected) => { selected.rule ||= {}; selected.rule.enabled = value; })),
              field('Rule comparison', existing.rule?.operator || 'gt', 'select', value => changeColumn((widget, selected) => { selected.rule ||= {}; selected.rule.operator = value; }), [['gt', 'Greater than'], ['lt', 'Less than'], ['eq', 'Equal to']]),
              field('Rule threshold', existing.rule?.value || 0, 'number', value => changeColumn((widget, selected) => { selected.rule ||= {}; selected.rule.value = value; })),
              field('Rule text color', existing.rule?.color || '#b42318', 'color', value => changeColumn((widget, selected) => { selected.rule ||= {}; selected.rule.color = value; })),
              field('Rule background', existing.rule?.background || '#fff2ef', 'color', value => changeColumn((widget, selected) => { selected.rule ||= {}; selected.rule.background = value; })));
          }
          body.append(details);
        }
      } else body.append(node('p', 'Refresh data to choose and format columns.', 'report-placeholder'));
    }
    if (item.sourceId) {
      const body = section(root, 'Conditional visibility');
      body.append(field('Show only when condition matches', item.config.visibility.enabled, 'checkbox', value => update((widget, value) => { widget.config.visibility.enabled = value; }, value)),
        field('Condition column (first row)', item.config.visibility.column, 'select', value => update((widget, value) => { widget.config.visibility.column = value; }, value), [['', 'Choose a column'], ...names]),
        field('Condition', item.config.visibility.operator, 'select', value => update((widget, value) => { widget.config.visibility.operator = value; }, value), [['notEmpty', 'Not empty'], ['gt', 'Greater than'], ['lt', 'Less than'], ['eq', 'Equals']]),
        field('Compare to', item.config.visibility.value, 'text', value => update((widget, value) => { widget.config.visibility.value = value; }, value, 'visibility.value', true)));
    }
  }
  window.DBeaverReportProperties = Object.freeze({ field, button, section, render });
})();
