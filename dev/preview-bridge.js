(() => {
  'use strict';
  const key = 'dbeaver-echarts-development-configuration';
  const regions = ['Costa', 'Sierra', 'Amazonía'];
  const columns = [
    {index:0,name:'fecha',kind:'DATETIME'}, {index:1,name:'region',kind:'STRING'},
    {index:2,name:'ventas',kind:'NUMERIC'}, {index:3,name:'costos',kind:'NUMERIC'},
    {index:4,name:'longitud',kind:'NUMERIC'}, {index:5,name:'latitud',kind:'NUMERIC'}
  ];
  const rows = Array.from({length:90}, (_, i) => [
    new Date(Date.UTC(2026, 8, Math.floor(i / 3) + 1)).toISOString(), regions[i % 3],
    Math.round(1000 + (i % 3) * 350 + Math.sin(i / 6) * 200 + i * 8),
    Math.round(600 + (i % 3) * 160 + Math.cos(i / 8) * 100 + i * 4),
    [-79.9,-78.5,-77.8][i % 3], [-2.2,-0.2,-1.1][i % 3]
  ]);
  const snapshot = {schemaVersion:1,columns,rows,rowCount:rows.length,exportedRowCount:rows.length,truncated:false,defaultRenderer:'canvas',source:{schemaVersion:1,kind:'activeResultSet',name:'Datos de ejemplo',connection:'Vista previa',sql:'-- Datos de ejemplo; no se ejecuta SQL'}};
  function publish() { window.DBeaverECharts.setSnapshot(snapshot); }
  window.dbeaverBrowserReady = () => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) window.DBeaverECharts.setConfigurationJson(saved);
    } catch (error) { console.warn('Preview configuration unavailable:', error); }
    publish();
  };
  window.dbeaverGetDataset = () => JSON.stringify(snapshot);
  window.dbeaverSaveConfiguration = configuration => { localStorage.setItem(key, configuration); return true; };
  window.dbeaverRefreshResult = () => { publish(); return true; };
  window.dbeaverExecuteWidgetQuery = widgetId => {
    setTimeout(() => window.DBeaverECharts.setWidgetError(widgetId, 'La vista previa usa datos de ejemplo. Prueba las consultas SQL dentro de DBeaver.'), 0);
    return true;
  };
  // Preview approvals never grant access to a database; query execution reports sample-only mode.
  window.dbeaverApproveWidgetQueries = () => true;
  window.dbeaverCancelWidgetQuery = () => true;
  window.dbeaverResetDashboardQueries = () => true;
  window.dbeaverExportDashboard = json => {
    const url = URL.createObjectURL(new Blob([json], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'preview.echarts-dashboard.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  };
  window.dbeaverImportDashboard = () => window.prompt('Pega el JSON del dashboard para previsualizarlo:');
  window.dbeaverListConnections = () => JSON.stringify([]);
  window.dbeaverSaveDashboard = window.dbeaverExportDashboard;
  window.dbeaverOpenDashboard = () => {
    const json = window.dbeaverImportDashboard();
    if (json) window.DBeaverECharts.loadDashboard(JSON.parse(json), true);
    return Boolean(json);
  };
  window.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.textContent = 'Vista previa de desarrollo · 90 filas de ejemplo · Guarda HTML, CSS o JavaScript para ver los cambios automáticamente.';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:5px 12px;background:#17324d;color:#fff;font:12px system-ui;z-index:10000;pointer-events:none';
    document.body.appendChild(banner);
  }, {once:true});
  const events = new EventSource('/__preview/events');
  events.onmessage = () => window.location.reload();
})();
