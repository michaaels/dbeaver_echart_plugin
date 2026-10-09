(() => {
  'use strict';
  const model = window.DBeaverReportModel;
  function create(bridge, onChange = () => {}) {
    let epoch = 0, requests = new Map(), snapshots = {}, errors = {}, loading = new Set(), generatedAt = null;
    let queue = [], currentDocument = null, currentValues = {}, stopped = false;
    const state = () => ({ snapshots, errors, loading, generatedAt, running: requests.size, pending: queue.length });
    function notify() { onChange(state()); }
    function reset() {
      epoch++; stopped = true;
      for (const id of requests.keys()) bridge.cancel?.(id, true);
      bridge.reset?.(); requests.clear(); queue = [];
      snapshots = {}; errors = {}; loading = new Set(); generatedAt = null; notify();
    }
    function review(document, values, sourceId) {
      model.runtimeSource(document, {}, values);
      const used = new Set(document.widgets.map(widget => widget.sourceId).filter(Boolean));
      const selected = document.sources.filter(source => used.has(source.id) && (!sourceId || source.id === sourceId));
      if (!selected.length) return [];
      const combined = new Map();
      for (const source of selected) {
        if (!source.sql.trim() || (!source.connection && !source.connectionId)) throw new Error(`Configure the SQL and connection for ${source.name}.`);
        const runtime = model.runtimeSource(document, source, values);
        const key = model.signature(runtime, runtime.parameters);
        if (!combined.has(key)) combined.set(key, { id: `report-query-${epoch}-${combined.size}-${Date.now().toString(36)}`, sql: source.sql,
          source: runtime, sourceIds: [], key, epoch });
        combined.get(key).sourceIds.push(source.id);
      }
      return [...combined.values()];
    }
    function run(document, values, reviewed) {
      if (requests.size || queue.length) throw new Error('Stop the current refresh before starting another.');
      const expected = review(document, values);
      const matches = new Set(reviewed.map(query => query.key)).size === reviewed.length && reviewed.every(query => expected.some(item =>
        item.key === query.key && query.epoch === epoch && item.sql === query.sql
        && JSON.stringify(item.source) === JSON.stringify(query.source) && JSON.stringify(item.sourceIds) === JSON.stringify(query.sourceIds)));
      if (!matches) throw new Error('Report queries or parameters changed. Review them again.');
      if (reviewed.length && bridge.approve?.(JSON.stringify(reviewed.map(({ id, sql, source }) => ({ id, sql, source })))) !== true) {
        throw new Error('DBeaver did not approve these report queries.');
      }
      currentDocument = model.clone(document); currentValues = model.clone(values); stopped = false;
      reviewed.forEach(query => query.sourceIds.forEach(id => { delete errors[id]; }));
      loading = new Set(reviewed.flatMap(query => query.sourceIds)); queue = [...reviewed];
      if (!reviewed.length) generatedAt = new Date().toISOString();
      pump(); notify();
    }
    function pump() {
      while (!stopped && queue.length && requests.size < 4) {
        const query = queue.shift(); requests.set(query.id, query);
        try {
          if (bridge.execute?.(query.id, query.sql, JSON.stringify(query.source)) !== true) receiveError(query.id, 'The query could not start. Check the connection and review SQL again.');
        } catch (error) { receiveError(query.id, error.message); }
      }
    }
    function finish(query) {
      requests.delete(query.id); query.sourceIds.forEach(id => loading.delete(id));
      pump();
      if (!requests.size && !queue.length && !stopped) generatedAt = new Date().toISOString();
      notify();
    }
    function receive(id, snapshot) {
      const query = requests.get(id);
      if (!query || query.epoch !== epoch) return false;
      if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.columns) || !Array.isArray(snapshot.rows) || snapshot.error) {
        return receiveError(id, snapshot?.error || 'Invalid report query result.');
      }
      // Strip JDBC source metadata from the runtime dataset used in exported HTML.
      const clean = { schemaVersion: 1, columns: snapshot.columns.map(({ name, kind }) => ({ name, kind })), rows: model.clone(snapshot.rows),
        rowCount: snapshot.rows.length, truncated: snapshot.truncated === true, effectiveMaxRows: snapshot.effectiveMaxRows };
      query.sourceIds.forEach(sourceId => { snapshots[sourceId] = clean; delete errors[sourceId]; });
      finish(query); return true;
    }
    function receiveError(id, message) {
      const query = requests.get(id);
      if (!query || query.epoch !== epoch) return false;
      query.sourceIds.forEach(sourceId => { errors[sourceId] = String(message); });
      finish(query); return true;
    }
    function stop() {
      stopped = true; epoch++;
      for (const query of requests.values()) { bridge.cancel?.(query.id, true); query.sourceIds.forEach(id => { errors[id] = 'Refresh cancelled. Previous data is retained.'; }); }
      queue.forEach(query => query.sourceIds.forEach(id => { errors[id] = 'Refresh cancelled.'; }));
      requests.clear(); queue = []; loading.clear(); notify();
    }
    function reconcile(document, values) {
      const same = currentDocument && JSON.stringify(document.sources) === JSON.stringify(currentDocument.sources)
        && JSON.stringify(document.parameters) === JSON.stringify(currentDocument.parameters) && JSON.stringify(values) === JSON.stringify(currentValues);
      if (currentDocument && !same) reset();
      currentDocument = model.clone(document); currentValues = model.clone(values);
      const used = new Set(document.sources.map(source => source.id));
      for (const sourceId of Object.keys(snapshots)) if (!used.has(sourceId)) delete snapshots[sourceId];
    }
    function ready(document) {
      if (requests.size || queue.length) throw new Error('Wait for the report queries to finish.');
      for (const widget of document.widgets) {
        const needsData = ['chart', 'kpi', 'table'].includes(widget.type) || widget.config.visibility.enabled;
        if (!needsData) continue;
        const fail = message => { throw new Error(`${widget.title}: ${message}`); };
        if (!widget.sourceId) fail('Assign a query before exporting.');
        const snapshot = snapshots[widget.sourceId];
        if (errors[widget.sourceId] || !snapshot) fail(errors[widget.sourceId] || 'Refresh data before exporting.');
        const has = name => snapshot.columns.some(column => column.name === name);
        if (widget.type === 'chart') {
          const chart = widget.config.chart;
          if (!has(chart.xColumn) || !chart.yColumns.length || chart.yColumns.some(name => !snapshot.columns.some(column => column.name === name && column.kind === 'NUMERIC'))) {
            fail('Configure the category and numeric series in Chart properties.');
          }
        }
        if (widget.type === 'kpi' && widget.config.aggregate !== 'count' && !has(widget.config.column)) fail('Choose a value column in Properties.');
        if (widget.type === 'table' && (!snapshot.columns.length || widget.config.columns.some(column => !has(column.name))
          || widget.config.groupBy && !has(widget.config.groupBy) || widget.config.sortColumn && !has(widget.config.sortColumn))) fail('Review the selected table columns, grouping and sorting.');
        if (widget.config.visibility.enabled && !has(widget.config.visibility.column)) fail('Choose a column for conditional visibility.');
      }
      return state();
    }
    function seed(sourceId, snapshot) {
      if (!snapshot || !Array.isArray(snapshot.columns) || !Array.isArray(snapshot.rows)) return;
      snapshots[sourceId] = { schemaVersion: 1, columns: snapshot.columns.map(({ name, kind }) => ({ name, kind })), rows: model.clone(snapshot.rows),
        rowCount: snapshot.rows.length, truncated: snapshot.truncated === true, effectiveMaxRows: snapshot.effectiveMaxRows };
      delete errors[sourceId]; generatedAt = new Date().toISOString(); notify();
    }
    return Object.freeze({ state, reset, review, run, receive, receiveError, stop, reconcile, ready, seed });
  }
  window.DBeaverReportExecution = Object.freeze({ create });
})();
