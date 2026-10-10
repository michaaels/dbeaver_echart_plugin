(() => {
  'use strict';
  const M = window.DBeaverReportModel, W = window.DBeaverReportWidgets, P = window.DBeaverReportProperties, L = window.DBeaverDashboardLayout;
  const $ = id => document.getElementById(id), node = W.node;
  const history = M.history(M.create());
  let selected = new Set(), clipboard = null, values = {}, saved = JSON.stringify(history.get()), persistTimer = null;
  let cleanup = null, previewCleanup = null, gesture = null, canvasRefreshPending = false, zoom = 1, reviewed = [], generating = false, sourceSelection = null, assets = null, email = null, discardAction = null;
  const charts = new Map();
  let tablePages = {}, libraryDrag = null, dropPreview = null;
  let theme = { background: '#ffffff', foreground: '#243447', muted: '#657487', border: '#d5dce3', grid: '#e5eaf0', controlBackground: '#f3f3f3', dark: false };
  const execution = window.DBeaverReportExecution.create({
    approve: json => window.dbeaverApproveWidgetQueries?.(json), execute: (id, sql, source) => window.dbeaverExecuteWidgetQuery?.(id, sql, source),
    cancel: (id, revoke) => window.dbeaverCancelWidgetQuery?.(id, revoke), reset: () => window.dbeaverResetDashboardQueries?.()
  }, state => {
    if (!gesture && !libraryDrag) { renderCanvas(); renderProperties(); }
    else canvasRefreshPending = true;
    $('stopReport').hidden = !state.running && !state.pending;
    if (state.running || state.pending) status(`${state.running} queries running${state.pending ? ` · ${state.pending} queued` : ''}`);
    else if (Object.keys(state.errors).length) status('Some queries failed. The design is retained; inspect Data and refresh again.', true);
    else if (state.generatedAt) status(`Data updated · ${new Date(state.generatedAt).toLocaleString()}`);
    if (generating && !state.running && !state.pending) {
      generating = false;
      try { execution.ready(history.get()); showPreview(); } catch (error) { status(error.message, true); }
    }
  });
  const current = () => history.get();
  const first = () => current().widgets.find(widget => selected.has(widget.id));
  function status(message, error = false) { $('reportStatus').textContent = message; $('reportStatus').dataset.error = String(error); }
  function dirty() { return JSON.stringify(current()) !== saved; }
  function notifyChanges() {
    $('reportDirty').textContent = dirty() ? 'Unsaved' : '';
    window.dbeaverDashboardChanged?.();
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => window.dbeaverSaveConfiguration?.(JSON.stringify(current())), 250);
  }
  function change(action, options = {}) {
    try {
      history.change(action, options.mergeKey);
      execution.reconcile(current(), values);
      selected = new Set([...selected].filter(id => current().widgets.some(widget => widget.id === id)));
      notifyChanges(); renderControls(); renderCanvas();
      if (options.render !== false) { renderProperties(); renderLayers(); }
      return true;
    } catch (error) { status(error.message, true); return false; }
  }
  function renderControls() {
    if (document.activeElement !== $('reportTitle')) $('reportTitle').value = current().title;
    $('undoReport').disabled = !history.canUndo(); $('redoReport').disabled = !history.canRedo();
    $('reportDirty').textContent = dirty() ? 'Unsaved' : '';
  }
  function select(id, multiple = false) {
    if (!multiple) selected.clear();
    if (id) { if (multiple && selected.has(id)) selected.delete(id); else selected.add(id); }
    document.querySelectorAll('#reportCanvas .report-component').forEach(element => element.classList.toggle('selected', selected.has(element.dataset.componentId)));
    renderProperties(); renderLayers();
  }
  function renderProperties() {
    $('propertiesHeading').textContent = selected.size ? `${first()?.type || 'Component'} properties` : 'Report properties';
    P.render($('componentProperties'), current(), selected, execution.state().snapshots, {
      change, duplicate: () => { copy(); paste(); }, copy, paste, remove, align, order,
      showData, editChart, refreshSource: id => review(false, id), pickImage
    });
  }
  function renderLayers() {
    $('reportLayers').replaceChildren();
    for (const widget of [...current().widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)) {
      const control = P.button(`${widget.parentId ? '↳ ' : ''}${widget.title}`, event => select(widget.id, event.shiftKey));
      control.setAttribute('aria-pressed', String(selected.has(widget.id))); control.dataset.layerId = widget.id; $('reportLayers').append(control);
    }
  }
  function layoutPreview() {
    // Plan from the saved layout each time, never from previously displaced DOM.
    // Placement is the same routine used by history.change on commit.
    const baseline = M.clone(current().widgets), stageHeight = $('reportStage').style.height;
    const frames = new Map([...$('reportCanvas').querySelectorAll('[data-component-id]')].map(frame => [frame.dataset.componentId, frame]));
    let key = '', planned = null;
    function apply(widgets) {
      for (const widget of widgets) {
        const frame = frames.get(widget.id); if (!frame) continue;
        const layout = widget.layout;
        frame.style.gridColumn = `${layout.x + 1} / span ${layout.width}`;
        frame.style.gridRow = `${layout.y + 1} / span ${layout.height}`;
        const original = baseline.find(item => item.id === widget.id).layout;
        frame.toggleAttribute('data-layout-preview', JSON.stringify(layout) !== JSON.stringify(original));
      }
    }
    return {
      show(widget, insert = false) {
        const nextKey = JSON.stringify([widget.id, widget.parentId, widget.layout, insert]);
        if (nextKey !== key) {
          planned = M.clone(baseline);
          if (insert) planned.push(M.clone(widget));
          else planned.find(item => item.id === widget.id).layout = { ...widget.layout };
          M.place(planned, widget.id); key = nextKey;
        }
        apply(planned);
      },
      restore() { apply(baseline); $('reportStage').style.height = stageHeight; }
    };
  }
  function resizeStage() { $('reportStage').style.height = `${Math.max(480, $('reportCanvas').scrollHeight) * zoom}px`; }
  function clearDropPreview(end = false) {
    dropPreview?.layouts.restore();
    dropPreview?.dispose?.(); dropPreview?.frame.remove(); dropPreview = null;
    if (end) {
      libraryDrag = null; $('reportCanvas').removeAttribute('data-library-drag');
      if (canvasRefreshPending) { renderCanvas(); renderProperties(); }
    }
  }
  function dropCandidate(event, grid, type = libraryDrag?.type) {
    if (!M.TYPES.includes(type) || !grid) return null;
    const widget = libraryDrag?.type === type ? M.clone(libraryDrag.widget) : M.widget(type);
    const box = grid.getBoundingClientRect(), gap = current().page.gap;
    widget.parentId = grid.closest('.report-component')?.dataset.componentId || null;
    widget.layout = L.normalizeLayout({ ...widget.layout,
      x: Math.floor((event.clientX - box.x) / ((box.width + gap * zoom) / 12)),
      y: Math.floor((event.clientY - box.y) / ((24 + gap) * zoom)) }, M.BOUNDS);
    let valid = true;
    if (widget.parentId) {
      const rows = Math.floor((box.height / zoom + gap) / (24 + gap));
      valid = widget.layout.height <= rows;
      widget.layout.y = Math.min(widget.layout.y, Math.max(0, rows - widget.layout.height));
    }
    return { grid, widget, valid };
  }
  function previewDrop(event, grid) {
    const candidate = dropCandidate(event, grid); if (!candidate) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = candidate.valid ? 'copy' : 'none';
    const { widget, valid } = candidate;
    if (dropPreview?.grid !== grid) {
      clearDropPreview();
      const frame = node('article', undefined, 'report-component report-drop-preview'), body = node('div', undefined, 'report-component-body');
      frame.setAttribute('aria-hidden', 'true'); frame.append(body); grid.append(frame);
      const label = node('div', undefined, 'report-drop-label'); frame.append(label);
      const dispose = W.renderWidget(body, widget, null, { designer: true });
      dropPreview = { frame, label, grid, dispose, layouts: layoutPreview() };
    }
    if (valid) dropPreview.layouts.show(widget, true);
    else dropPreview.layouts.restore();
    const gap = current().page.gap, pitch = (grid.getBoundingClientRect().width / zoom + gap) / 12;
    Object.assign(dropPreview.frame.style, { left: `${widget.layout.x * pitch}px`, top: `${widget.layout.y * (24 + gap)}px`,
      width: `${widget.layout.width * pitch - gap}px`, height: `${widget.layout.height * (24 + gap) - gap}px` });
    dropPreview.frame.dataset.invalid = String(!valid);
    dropPreview.label.textContent = valid ? `${W.registry.get(widget.type).label} · ${widget.layout.width} columns × ${widget.layout.height} rows` : 'Increase the section height to fit this component';
    resizeStage();
  }
  function commitDrop(event, grid) {
    const type = libraryDrag?.type || event.dataTransfer.getData('application/x-echarts-report-component');
    const candidate = dropCandidate(event, grid, type); if (!candidate) return;
    event.preventDefault(); event.stopPropagation(); clearDropPreview(true);
    if (!candidate.valid) { status('Increase the section height before adding this component.', true); return; }
    add(type, candidate.widget.layout, candidate.widget.parentId);
  }
  function renderCanvas() {
    if (!$('reportCanvas')) return;
    canvasRefreshPending = false;
    cleanup?.(); charts.clear();
    const state = execution.state();
    clearDropPreview();
    cleanup = W.renderReport($('reportCanvas'), current(), state.snapshots, { ...state, charts, tablePages, parameters: values, designer: true, decorate });
    // Delegated drop handling uses the original geometry to avoid target drift.
    for (const grid of $('reportCanvas').querySelectorAll('.report-grid')) {
      grid.style.position = 'relative';
    }
    $('reportCanvas').classList.toggle('show-grid', current().page.grid);
    $('reportCanvas').style.transform = `scale(${zoom})`;
    $('reportStage').style.width = `${current().page.width * zoom}px`;
    resizeStage();
    $('reportCanvas').style.minHeight = '480px';
    $('reportEmpty').hidden = current().widgets.length > 0;
  }
  function render() { renderControls(); renderCanvas(); renderProperties(); renderLayers(); }
  function add(type, position, parentId = null) {
    if (!position) parentId = W.registry.get(first()?.type)?.container ? first().id : first()?.parentId || null;
    const widget = M.widget(type); widget.parentId = parentId;
    if (position) Object.assign(widget.layout, position);
    else widget.layout.y = Math.max(0, ...current().widgets.filter(item => item.parentId === parentId).map(item => item.layout.y + item.layout.height));
    selected = new Set([widget.id]);
    if (change(draft => { draft.widgets.push(widget); draft.priorityId = widget.id; })) {
      status(`Added ${W.registry.get(type).label}${parentId ? ' to the section' : ' at the end'}. Edit its properties on the right.`);
      $('reportCanvas').querySelector(`[data-component-id="${widget.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  function descendants(ids) {
    const result = new Set(ids); let changed = true;
    while (changed) { changed = false; for (const widget of current().widgets) if (result.has(widget.parentId) && !result.has(widget.id)) { result.add(widget.id); changed = true; } }
    return result;
  }
  function copy() {
    const ids = descendants(selected), widgets = current().widgets.filter(widget => ids.has(widget.id));
    if (!widgets.length) return;
    const sources = current().sources.filter(source => widgets.some(widget => widget.sourceId === source.id));
    clipboard = M.clone({ widgets, sources, parameters: current().parameters }); status(`Copied ${widgets.length} components.`);
  }
  function paste() {
    if (!clipboard) { status('Select a component and copy it first.'); return; }
    const idMap = new Map(clipboard.widgets.map(widget => [widget.id, M.id('component')]));
    const pasted = clipboard.widgets.map(widget => ({ ...M.clone(widget), id: idMap.get(widget.id), parentId: idMap.get(widget.parentId) || null,
      layout: { ...widget.layout, y: widget.layout.y + (idMap.has(widget.parentId) ? 0 : widget.layout.height) } }));
    selected = new Set(pasted.map(widget => widget.id));
    change(draft => {
      for (const source of clipboard.sources) {
        const existing = draft.sources.find(item => item.id === source.id);
        if (!existing) draft.sources.push(M.clone(source));
        else if (JSON.stringify(existing) !== JSON.stringify(source)) throw new Error('A copied query has changed. Copy the components again.');
      }
      for (const parameter of clipboard.parameters) {
        const existing = draft.parameters.find(item => item.name === parameter.name);
        if (!existing) draft.parameters.push(M.clone(parameter));
        else if (existing.type !== parameter.type) throw new Error('The copied parameter type conflicts with this template.');
      }
      draft.widgets.push(...pasted);
    });
  }
  function remove() {
    const ids = descendants(selected);
    if (!ids.size) return;
    change(draft => {
      const parents = new Set(draft.widgets.filter(widget => ids.has(widget.id)).map(widget => widget.parentId || null));
      draft.widgets = draft.widgets.filter(widget => !ids.has(widget.id)); M.compact(draft.widgets, parents);
    });
    selected.clear(); renderProperties(); status('Component deleted. Space reclaimed; Undo restores the previous layout.');
  }
  function align(direction) {
    const widgets = current().widgets.filter(widget => selected.has(widget.id));
    if (widgets.length < 2) { status('Shift-click at least two components to align them.'); return; }
    if (new Set(widgets.map(widget => widget.parentId)).size !== 1) { status('Align components within the same section.', true); return; }
    change(draft => {
      const group = draft.widgets.filter(widget => selected.has(widget.id));
      const left = Math.min(...group.map(widget => widget.layout.x)), right = Math.max(...group.map(widget => widget.layout.x + widget.layout.width));
      const top = Math.min(...group.map(widget => widget.layout.y)), bottom = Math.max(...group.map(widget => widget.layout.y + widget.layout.height));
      let x = 0; const gap = (12 - group.reduce((sum, widget) => sum + widget.layout.width, 0)) / (group.length - 1);
      if (direction === 'distribute' && gap < 0) throw new Error('Reduce component widths before distributing them horizontally.');
      for (const widget of group.sort((a, b) => a.layout.x - b.layout.x)) {
        if (direction === 'left') widget.layout.x = left;
        if (direction === 'right') widget.layout.x = right - widget.layout.width;
        if (direction === 'top') widget.layout.y = top;
        if (direction === 'bottom') widget.layout.y = bottom - widget.layout.height;
        if (direction === 'distribute') { widget.layout.x = Math.round(x); x += widget.layout.width + gap; }
      }
    });
  }
  function order(direction) {
    const item = first(); if (!item) return;
    const peers = current().widgets.filter(widget => widget.parentId === item.parentId).sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
    const index = peers.findIndex(widget => widget.id === item.id), other = peers[index + direction]; if (!other) return;
    change(draft => { const selected = draft.widgets.find(widget => widget.id === item.id), peer = draft.widgets.find(widget => widget.id === other.id);
      const a = { ...selected.layout }, b = { ...peer.layout }; selected.layout.x = b.x; selected.layout.y = b.y; peer.layout.x = a.x; peer.layout.y = a.y; draft.priorityId = selected.id; });
  }
  function decorate(frame, widget, grid) {
    frame.classList.toggle('selected', selected.has(widget.id)); frame.tabIndex = 0;
    frame.setAttribute('aria-label', `${W.registry.get(widget.type).label}: ${widget.title}`);
    frame.dataset.conditionHidden = String(!W.visible(widget, execution.state().snapshots[widget.sourceId]));
    frame.addEventListener('pointerdown', event => {
      if (event.target.closest('.report-component') === frame && !event.target.closest('.report-resize, .report-move')) select(widget.id, event.shiftKey);
    });
    const toolbar = node('div', undefined, 'report-component-toolbar'), move = P.button(`⠿ ${widget.title}`, () => {}, 'report-move');
    move.title = 'Drag to move; arrow keys move the component'; toolbar.append(move); frame.append(toolbar);
    move.addEventListener('pointerdown', event => startGesture(event, frame, widget, grid, 'move', move));
    function keyboard(event, edge = '') {
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta || gesture) return; event.preventDefault(); event.stopPropagation();
      change(draft => {
        const item = draft.widgets.find(item => item.id === widget.id);
        item.layout = edge ? L.resizeLayout(item.layout, edge, ...delta, M.BOUNDS) : L.normalizeLayout({ ...item.layout, x: item.layout.x + delta[0], y: item.layout.y + delta[1] }, M.BOUNDS);
        draft.priorityId = widget.id;
      });
      const updated = $('reportCanvas').querySelector(`[data-component-id="${CSS.escape(widget.id)}"]`);
      updated?.querySelector(edge ? `[data-edge="${edge}"]` : '.report-move')?.focus();
    }
    move.addEventListener('keydown', event => keyboard(event));
    frame.addEventListener('keydown', event => { if (event.target === frame) keyboard(event); });
    for (const edge of ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']) {
      const handle = P.button('', () => {}, `report-resize edge-${edge}`); handle.dataset.edge = edge; handle.tabIndex = edge === 'se' ? 0 : -1;
      handle.setAttribute('aria-label', `Resize ${widget.title} from ${edge}`);
      handle.addEventListener('pointerdown', event => startGesture(event, frame, widget, grid, edge, handle));
      handle.addEventListener('keydown', event => keyboard(event, edge)); frame.append(handle);
    }
  }
  function startGesture(event, frame, widget, grid, edge, handle) {
    if (gesture || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); event.stopPropagation(); select(widget.id);
    const origin = grid.getBoundingClientRect(), initial = { ...widget.layout }, x = event.clientX, y = event.clientY, pointerId = event.pointerId;
    const pitch = (origin.width + current().page.gap * zoom) / 12, rowPitch = (24 + current().page.gap) * zoom;
    let candidate = initial;
    const guide = node('div', undefined, 'report-drag-guide'); frame.append(guide); document.body.classList.add('report-dragging');
    const layouts = layoutPreview();
    const scroll = $('reportCanvas').closest('.report-canvas-scroll'); let latest = event, moved = false;
    function update(pointer) {
      latest = pointer; const box = grid.getBoundingClientRect();
      const dx = Math.round((pointer.clientX - x - box.x + origin.x) / pitch), dy = Math.round((pointer.clientY - y - box.y + origin.y) / rowPitch);
      candidate = edge === 'move' ? L.normalizeLayout({ ...initial, x: initial.x + dx, y: initial.y + dy }, M.BOUNDS) : L.resizeLayout(initial, edge, dx, dy, M.BOUNDS);
      layouts.show({ ...widget, layout: candidate }); resizeStage();
    }
    function finish(commit) {
      gesture = null; clearInterval(timer); document.body.classList.remove('report-dragging'); guide.remove();
      document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true); document.removeEventListener('keydown', escape, true); window.removeEventListener('blur', cancel);
      handle.removeEventListener('lostpointercapture', cancel);
      try { handle.releasePointerCapture(pointerId); } catch (error) { /* Capture may have ended in the native browser. */ }
      layouts.restore();
      if (commit) change(draft => { draft.widgets.find(item => item.id === widget.id).layout = candidate; draft.priorityId = widget.id; });
      else renderCanvas();
    }
    function move(pointer) { if (pointer.pointerId === pointerId) { pointer.preventDefault(); moved ||= Math.hypot(pointer.clientX - x, pointer.clientY - y) > 3; update(pointer); } }
    function up(pointer) { if (pointer.pointerId === pointerId) { update(pointer); finish(true); } }
    function cancel(pointer) { if (!pointer || pointer.type === 'blur' || pointer.pointerId === pointerId) finish(false); }
    function escape(key) { if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); finish(false); } }
    const timer = setInterval(() => {
      if (!moved) return; const box = scroll.getBoundingClientRect();
      const step = (value, start, end) => value < start + 28 ? -12 : value > end - 28 ? 12 : 0;
      const left = scroll.scrollLeft, top = scroll.scrollTop; scroll.scrollLeft += step(latest.clientX, box.left, box.right); scroll.scrollTop += step(latest.clientY, box.top, box.bottom);
      if (left !== scroll.scrollLeft || top !== scroll.scrollTop) update(latest);
    }, 30);
    gesture = { cancel: () => finish(false) };
    document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('keydown', escape, true); window.addEventListener('blur', cancel); handle.addEventListener('lostpointercapture', cancel);
    try { handle.setPointerCapture(pointerId); } catch (error) { /* Document events are the fallback. */ }
  }
  function showDialog(id) { $(id).showModal(); }
  function loadReport(input, asNew = false) {
    const normalized = M.normalize(typeof input === 'string' ? JSON.parse(input) : input);
    gesture?.cancel(); clearDropPreview(true); tablePages = {}; window.DBeaverWidgetEditor.close(); execution.reset(); history.replace(normalized); selected.clear();
    values = Object.fromEntries(normalized.parameters.map(parameter => [parameter.name, parameter.default])); saved = asNew ? '' : JSON.stringify(current());
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    generating = false; render(); status('Template ready. Review SQL before refreshing its data.');
  }
  function createDocument(document) {
    // A new report opens in the workbench view, keeping a file editor's input intact.
    if (typeof window.dbeaverNewReport === 'function') {
      if (window.dbeaverNewReport(JSON.stringify(document)) !== true) status('New report cancelled.');
      return;
    }
    discardThen(() => { loadReport(document, true); notifyChanges(); });
  }
  function discardThen(action) {
    if (!dirty()) { action(); return; }
    discardAction = action; showDialog('reportConfirmDialog');
  }
  function save(as = false) {
    const path = window.dbeaverSaveReport?.(JSON.stringify(current()), as);
    if (path) { saved = JSON.stringify(current()); renderControls(); status(`Template saved: ${path}`); }
    else status('Template was not saved.');
  }
  function review(generate = false, sourceId) {
    try {
      if (execution.state().running || execution.state().pending) throw new Error('Stop the current refresh first.');
      reviewed = execution.review(current(), values, sourceId); generating = generate;
      if (!reviewed.length) { execution.run(current(), values, []); if (!generate) status('This report has no query-backed components.'); return; }
      $('reportReviewQueries').replaceChildren();
      for (const query of reviewed) {
        const section = node('section', undefined, 'report-review-query');
        section.append(node('h3', query.source.name), node('p', `${query.source.project || 'Project'} / ${query.source.connection || query.source.connectionId}`), node('pre', query.sql));
        for (const [name, parameter] of Object.entries(query.source.parameters)) section.append(node('p', `${name} (${parameter.type}): ${parameter.value}`));
        section.append(node('p', `${query.sourceIds.length} source definitions share this result. Row limit: ${query.source.maxRows || 'DBeaver ECharts preference'}.`));
        $('reportReviewQueries').append(section);
      }
      if ($('reportDataDialog').open) $('reportDataDialog').close(); showDialog('reportReviewDialog');
    } catch (error) { generating = false; status(error.message, true); }
  }
  function showData(sourceId) { sourceSelection = sourceId || first()?.sourceId || current().sources[0]?.id || null; renderSources(); showDialog('reportDataDialog'); }
  function connections() { try { return JSON.parse(window.dbeaverListConnections?.() || '[]'); } catch (error) { return []; } }
  function renderSources() {
    $('reportSourceList').replaceChildren();
    for (const source of current().sources) $('reportSourceList').append(P.button(source.name, () => { sourceSelection = source.id; renderSources(); }));
    const form = $('reportSourceForm'); form.replaceChildren();
    const source = current().sources.find(source => source.id === sourceSelection);
    if (!source) { form.append(node('p', 'Add a query, then assign it to charts, tables or KPIs.')); return; }
    const update = (name, value, textEdit = false) => change(draft => { draft.sources.find(source => source.id === sourceSelection)[name] = value; }, { mergeKey: textEdit ? `${sourceSelection}.${name}` : undefined, render: !textEdit });
    const available = connections(), choices = [['', 'Choose connection'], ...available.map((item, index) => [String(index), `${item.project} / ${item.connection}`])];
    let selectedConnection = String(available.findIndex(item => item.connectionId === source.connectionId && item.project === source.project));
    if (selectedConnection === '-1') { selectedConnection = source.connection || source.connectionId ? 'retained' : ''; if (selectedConnection) choices.push(['retained', `${source.project} / ${source.connection || source.connectionId}`]); }
    form.append(P.field('Query name', source.name, 'text', value => update('name', value, true)),
      P.field('Connection', selectedConnection, 'select', value => {
        if (value === 'retained') return;
        change(draft => Object.assign(draft.sources.find(source => source.id === sourceSelection), available[Number(value)] && value !== '' ? available[Number(value)] : { project: '', connectionId: '', connection: '' }));
      }, choices), P.field('SQL', source.sql, 'textarea', value => update('sql', value, true)), P.field('Maximum rows (0 = preference)', source.maxRows, 'number', value => update('maxRows', value)));
    const error = execution.state().errors[source.id]; if (error) form.append(node('p', error, 'report-data-error'));
    const count = current().widgets.filter(widget => widget.sourceId === source.id).length;
    form.append(node('p', `${count} components use this query.`, 'report-placeholder'), P.button('Review and refresh this query', () => review(false, source.id)));
    const remove = P.button('Delete query', () => { change(draft => { draft.sources = draft.sources.filter(item => item.id !== source.id); }); sourceSelection = current().sources[0]?.id; renderSources(); });
    remove.disabled = count > 0; remove.title = count ? 'Assign a different query to its components before deleting this query.' : 'Delete unused query'; form.append(remove);
  }
  function renderParameters() {
    $('reportParameterList').replaceChildren();
    current().parameters.forEach((parameter, index) => {
      const row = node('div', undefined, 'report-parameter-row');
      const definition = (name, value) => {
        const before = parameter.name;
        if (!change(draft => {
          const item = draft.parameters[index]; item[name] = value;
          if (name === 'name' && item.label === before) item.label = value;
          if (name === 'type' && value === 'boolean' && !['true', 'false'].includes(item.default)) item.default = 'false';
        })) return;
        if (name === 'name') { values[value] = values[before]; delete values[before]; }
        if (name === 'type' && value === 'boolean' && !['true', 'false'].includes(String(values[before]))) values[before] = 'false';
        execution.reconcile(current(), values); renderParameters();
      };
      const name = P.field('Name', parameter.name, 'text', () => {}); name.querySelector('input').addEventListener('change', event => definition('name', event.target.value));
      row.append(name, P.field('Type', parameter.type, 'select', value => definition('type', value), ['text', 'number', 'date', 'boolean']));
      const defaultField = P.field('Default value', parameter.default, 'text', () => {}); defaultField.querySelector('input').addEventListener('change', event => definition('default', event.target.value)); row.append(defaultField);
      row.append(P.field('Current value', values[parameter.name] ?? parameter.default, parameter.type === 'date' ? 'date' : parameter.type === 'boolean' ? 'select' : 'text', value => {
        values[parameter.name] = value; execution.reconcile(current(), values); renderCanvas();
      }, [['false', 'false'], ['true', 'true']]), P.button('Remove', () => {
        delete values[parameter.name]; change(draft => { draft.parameters.splice(index, 1); }); renderParameters();
      })); $('reportParameterList').append(row);
    });
  }
  function pickImage() {
    const item = first(); if (!item) return;
    const image = window.dbeaverReportPickImage?.();
    if (!image) return;
    if (!M.image(image)) { status('Choose a PNG, JPEG, GIF or WebP image under 2 MiB.', true); return; }
    change(draft => { draft.widgets.find(widget => widget.id === item.id).config.image = image; });
  }
  function editChart() {
    const item = first(); if (!item || item.type !== 'chart') return;
    const existing = current().sources.find(source => source.id === item.sourceId), source = existing || M.source({ id: M.id('source') });
    window.DBeaverWidgetEditor.open({ widget: { id: item.id, title: item.title, source, chart: item.config.chart, refreshPolicy: { mode: 'manual', intervalSeconds: 0 } },
      snapshot: execution.state().snapshots[item.sourceId], isNew: !existing, theme: { ...theme, background: '#ffffff', foreground: '#243447', muted: '#657487', controlBackground: '#f6f8fa' }, renderer: 'canvas',
      runPreview(id, source) {
        const runtime = M.runtimeSource(current(), source, values);
        if (window.dbeaverApproveWidgetQueries?.(JSON.stringify([{ id, sql: source.sql, source: runtime }])) !== true
          || window.dbeaverExecuteWidgetQuery?.(id, source.sql, JSON.stringify(runtime)) !== true) throw new Error('Could not run the chart preview. Check the connection and parameter values.');
      }, cancelPreview: id => window.dbeaverCancelWidgetQuery?.(id, true),
      save(draft, snapshot, approved) {
        const sourceId = existing?.id || source.id;
        const ok = change(document => {
          const widget = document.widgets.find(widget => widget.id === item.id), query = M.source({ ...draft.source, id: sourceId });
          if (existing) Object.assign(document.sources.find(source => source.id === sourceId), query); else document.sources.push(query);
          widget.sourceId = sourceId; widget.title = draft.title; widget.config.chart = { ...widget.config.chart, ...draft.chart };
        });
        if (!ok) throw new Error('The chart could not be applied. Check the report limits.');
        if (snapshot && (approved || existing && JSON.stringify(source) === JSON.stringify(draft.source))) execution.seed(sourceId, snapshot);
      }
    });
  }
  function showPreview() {
    previewCleanup?.(); const state = execution.state();
    $('reportPreviewStatus').textContent = state.generatedAt ? `Data snapshot: ${new Date(state.generatedAt).toLocaleString()}` : 'Design preview. Refresh data to populate SQL components.';
    showDialog('reportPreviewDialog');
    previewCleanup = W.renderReport($('reportPreviewCanvas'), current(), state.snapshots, { ...state, tablePages, parameters: values });
  }
  function exportAssets() {
    if (!assets) assets = JSON.parse(window.dbeaverReportExportAssets?.() || 'null');
    if (!assets) throw new Error('Bundled export assets are unavailable.'); return assets;
  }
  function exports() {
    const state = execution.ready(current()), context = { generatedAt: state.generatedAt || new Date().toISOString(), parameters: values, tablePages: { ...tablePages } };
    return { interactive: () => window.DBeaverReportExport.interactive(current(), state.snapshots, context, exportAssets()),
      email: () => window.DBeaverReportExport.emailHtml(current(), state.snapshots, context, window.DBeaverReportExport.chartImages(charts)) };
  }
  function exportFile(content, kind, open = false) {
    const result = window.dbeaverExportReport?.(content, kind, current().title, open);
    if (result) { const info = typeof result === 'string' ? JSON.parse(result) : result; status(kind === 'eml' ? `Draft saved${info.opened ? ' and opened in the mail client' : ''}. Email was not sent: ${info.path}` : `Report exported: ${info.path}`); }
    else status('Export cancelled or unavailable.');
  }
  function composeEmail() {
    try {
      if (!current().widgets.length) throw new Error('Add a component before composing an email draft.');
      const generated = exports(); email = { html: generated.email(), interactive: generated.interactive };
      $('reportEmailError').textContent = ''; $('reportEmailSubject').value = current().title; updateEmailPreview(); showDialog('reportEmailDialog');
    }
    catch (error) { status(error.message, true); }
  }
  function updateEmailPreview() {
    if (email) $('reportEmailPreview').srcdoc = window.DBeaverReportExport.withMessage(email.html, $('reportEmailMessage').value);
  }
  function templates() {
    let entries = []; try { entries = JSON.parse(window.dbeaverListReportTemplates?.() || '[]'); } catch (error) { status(error.message, true); }
    function filter() {
      const search = $('reportTemplateSearch').value.toLowerCase(); $('reportTemplateList').replaceChildren();
      for (const entry of entries.filter(entry => `${entry.title} ${entry.category}`.toLowerCase().includes(search))) {
        const row = node('div', undefined, 'report-template-entry'), details = node('div'); details.append(node('strong', entry.title), node('p', entry.category || 'Uncategorized'), node('p', entry.description));
        row.append(details, P.button('Use template', () => { const document = window.dbeaverLoadReportTemplate?.(entry.path); if (document) { $('reportTemplateDialog').close(); createDocument(typeof document === 'string' ? JSON.parse(document) : document); } }));
        $('reportTemplateList').append(row);
      }
      if (!$('reportTemplateList').children.length) $('reportTemplateList').append(node('p', 'No matching templates. Save your report to Reports/ECharts first.'));
    }
    $('reportTemplateSearch').oninput = filter; filter(); showDialog('reportTemplateDialog');
  }
  function setTheme(value) {
    theme = { ...theme, ...value }; document.documentElement.style.colorScheme = theme.dark ? 'dark' : 'light'; document.body.classList.toggle('dark-theme', theme.dark);
    for (const [name, value] of Object.entries({ bg: theme.background, fg: theme.foreground, muted: theme.muted, border: theme.border, 'control-bg': theme.controlBackground })) document.documentElement.style.setProperty(`--${name}`, value);
    window.DBeaverWidgetEditor.setAppearance({ ...theme, background: '#ffffff', foreground: '#243447', muted: '#657487', controlBackground: '#f6f8fa' }, 'canvas');
  }
  function init() {
    for (const [type, definition] of W.registry) {
      const control = P.button('', () => add(type)); control.dataset.componentType = type; control.draggable = true;
      control.append(node('span', definition.icon, 'component-icon'), node('span', definition.label));
      control.addEventListener('dragstart', event => { clearDropPreview(true); libraryDrag = { type, widget: M.widget(type) }; $('reportCanvas').setAttribute('data-library-drag', ''); event.dataTransfer.setData('application/x-echarts-report-component', type); event.dataTransfer.effectAllowed = 'copy'; }); $('componentLibrary').append(control);
      control.addEventListener('dragend', () => clearDropPreview(true));
    }
    $('reportCanvas').addEventListener('pointerdown', event => { if (!event.target.closest('.report-component')) select(null); });
    const dropGrid = event => {
      // Hit-test before displacement; a moved section must not capture the next
      // dragover just because the preview placed it under the pointer.
      dropPreview?.layouts.restore();
      // A stable transparent surface receives native drag events while siblings
      // move underneath it. Temporarily bypass it to identify the real section.
      $('reportCanvas').removeAttribute('data-library-drag');
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (libraryDrag) $('reportCanvas').setAttribute('data-library-drag', '');
      const container = target?.closest('#reportCanvas .report-component'), component = current().widgets.find(widget => widget.id === container?.dataset.componentId);
      return component && W.registry.get(component.type)?.container ? container.querySelector('.report-grid') : target?.closest('#reportCanvas .report-grid') || $('reportCanvas').querySelector('.report-grid');
    };
    $('reportCanvas').addEventListener('dragover', event => previewDrop(event, dropGrid(event)));
    $('reportCanvas').addEventListener('drop', event => {
      if (!event.defaultPrevented) commitDrop(event, dropGrid(event));
    });
    $('reportCanvas').addEventListener('dragleave', event => {
      const box = $('reportCanvas').getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) clearDropPreview();
    });
    document.addEventListener('dragend', () => clearDropPreview(true));
    document.addEventListener('dragover', event => { if (!event.target.closest('#reportCanvas')) clearDropPreview(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && libraryDrag) clearDropPreview(true); });
    window.addEventListener('blur', () => clearDropPreview(true));
    const click = (id, action) => $(id).addEventListener('click', () => { try { action(); } catch (error) { status(error.message, true); } });
    click('newReport', () => createDocument(M.create()));
    click('openReport', () => window.dbeaverOpenReport?.());
    click('saveReport', () => save());
    click('duplicateReport', () => { const copy = M.clone(current()); copy.title += ' (copy)'; copy.defaultTemplate = false; createDocument(copy); });
    click('importReport', () => { const document = window.dbeaverImportReport?.(); if (document) createDocument(typeof document === 'string' ? JSON.parse(document) : document); });
    click('undoReport', () => { history.undo(); execution.reconcile(current(), values); notifyChanges(); render(); });
    click('redoReport', () => { history.redo(); execution.reconcile(current(), values); notifyChanges(); render(); });
    click('compactReport', () => { if (change(draft => M.compact(draft.widgets))) status('Vertical gaps closed. Columns and sizes retained; Undo restores the previous layout.'); });
    $('reportTitle').addEventListener('input', () => change(draft => { draft.title = $('reportTitle').value; }, { mergeKey: 'report.title', render: false }));
    $('reportZoom').addEventListener('change', () => { zoom = Number($('reportZoom').value); renderCanvas(); });
    click('reportData', () => showData()); click('reportParameters', () => { renderParameters(); showDialog('reportParameterDialog'); });
    click('addReportSource', () => { const source = M.source({ name: `Query ${current().sources.length + 1}` }); if (change(draft => { draft.sources.push(source); })) { sourceSelection = source.id; renderSources(); } });
    click('addReportParameter', () => { let index = 1; while (current().parameters.some(parameter => parameter.name === `parameter_${index}`)) index++;
      const name = `parameter_${index}`; if (change(draft => { draft.parameters.push({ name, label: name, type: 'text', default: '' }); })) { values[name] = ''; renderParameters(); } });
    click('refreshReport', () => review()); click('generateReport', () => review(true)); click('stopReport', () => { generating = false; execution.stop(); });
    click('runReportQueries', () => { $('reportReviewDialog').close(); try { execution.run(current(), values, reviewed); } catch (error) { generating = false; throw error; } });
    $('reportReviewDialog').addEventListener('cancel', () => { generating = false; });
    click('previewReport', showPreview); click('exportReport', () => showDialog('reportExportDialog')); click('outlookReport', composeEmail); click('reportTemplates', templates);
    $('reportEmailMessage').addEventListener('change', updateEmailPreview);
    click('saveReportExport', () => {
      const mode = $('reportExportFormat').value; exportFile(mode === 'template' ? JSON.stringify(current()) : exports()[mode](), mode); $('reportExportDialog').close();
    });
    click('saveReportEmail', () => {
      try {
      const content = window.DBeaverReportExport.eml({ to: $('reportEmailTo').value, cc: $('reportEmailCc').value, subject: $('reportEmailSubject').value,
        message: $('reportEmailMessage').value, html: email.html, attachment: $('reportEmailAttach').checked ? email.interactive() : null, title: current().title });
      exportFile(content, 'eml', $('reportEmailOpen').checked); $('reportEmailDialog').close();
      } catch (error) { $('reportEmailError').textContent = error.message; }
    });
    click('reportConfirmDiscard', () => { $('reportConfirmDialog').close(); const action = discardAction; discardAction = null; action?.(); });
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => { $(button.dataset.close).close(); if (button.dataset.close === 'reportReviewDialog') generating = false; }));
    $('reportPreviewDialog').addEventListener('close', () => { previewCleanup?.(); previewCleanup = null; });
    document.addEventListener('keydown', event => {
      if (gesture) return;
      const control = event.ctrlKey || event.metaKey, typing = event.target.closest('input,textarea,select,[contenteditable=true]');
      if (control && event.key.toLowerCase() === 's') { event.preventDefault(); save(); return; }
      if (typing || document.querySelector('dialog[open]')) return;
      if (control && event.key.toLowerCase() === 'z') { event.preventDefault(); $(event.shiftKey ? 'redoReport' : 'undoReport').click(); }
      else if (control && event.key.toLowerCase() === 'y') { event.preventDefault(); $('redoReport').click(); }
      else if (control && event.key.toLowerCase() === 'c') { event.preventDefault(); copy(); }
      else if (control && event.key.toLowerCase() === 'v') { event.preventDefault(); paste(); }
      else if (control && event.key.toLowerCase() === 'd') { event.preventDefault(); copy(); paste(); }
      else if (event.key === 'Delete' && selected.size) { event.preventDefault(); remove(); }
      else if (event.key === 'Escape') select(null);
    });
    render(); window.dbeaverBrowserReady?.();
  }
  window.DBeaverECharts = Object.freeze({ loadReport, reportDocument: () => M.clone(current()), setTheme,
    markReportSaved: () => { saved = JSON.stringify(current()); renderControls(); },
    setWidgetSnapshot: (id, snapshot) => window.DBeaverWidgetEditor.receiveSnapshot(id, snapshot) || execution.receive(id, snapshot),
    setWidgetError: (id, message) => window.DBeaverWidgetEditor.receiveError(id, message) || execution.receiveError(id, message),
    setLoading: () => {}, setSnapshot: () => {}, setError: message => status(message, true), dispose: () => { gesture?.cancel(); canvasRefreshPending = false; clearDropPreview(true); execution.stop(); cleanup?.(); previewCleanup?.(); window.DBeaverWidgetEditor.close(); } });
  window.addEventListener('pagehide', () => { window.clearTimeout(persistTimer); window.DBeaverECharts.dispose(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
