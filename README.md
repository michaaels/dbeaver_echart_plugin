# DBeaver ECharts Presentation — 0.5.0

An independent DBeaver Community plugin for result charts and saved dashboards,
backed by Apache ECharts.
The codebase is organized as a normal Eclipse PDE plugin and keeps DBeaver APIs,
data conversion, chart construction and dashboards in separate modules.

## Capabilities

- Native ECharts interaction: tooltip, selection zoom, data zoom, restore and PNG download.
- Line, area, bar, scatter, pie, gauge, radar, heatmap, boxplot, treemap and funnel charts.
- Multiple Y series, dual axes, `visualMap`, `markLine` and `markArea`.
- Canvas and SVG renderers with DBeaver theme synchronization.
- Geographic scatter charts using a locally packaged world map.
- Multi-widget dashboards with persisted JSON configuration.
- Standalone widget authoring: SQL and connection per chart, query preview, columns, series and axes.
- Active-result and independent read-only SQL sources per widget.
- Manual, result-driven and interval refresh policies.
- Shared filters, cross-filter events and drill-down.
- Dashboard JSON import/export.
- Session SQL review, isolated query contexts, configurable timeout and Stop controls.
- Preferences, background snapshots, copy/export integration and compatibility smoke tests.

The browser frontend is fully local. It has no CDN, telemetry or runtime network dependency.

## Architecture

```text
DBeaver ResultSet / active execution context
              |
              v
DBeaverResultSetAdapter / DashboardQueryJob
              |
              v
       versioned JSON snapshots
              |
              v
EChartsPresentation (SWT Browser bridge, UI-thread boundary)
              |
              v
 chart.js -> analytics.js / dashboard.js -> Apache ECharts
```

Important boundaries:

- `DBeaverResultSetAdapter` is the ResultSet-to-DTO boundary.
- `DashboardQueryJob` executes one approved, conservatively validated widget query in an isolated context.
- `DashboardQueryApproval` binds session approval to the SQL and connection reference.
- `EChartsPresentation` owns SWT lifecycle and marshals browser calls to the UI thread.
- `analytics.js` contains pure chart-option builders.
- `dashboard.js` owns the versioned dashboard model and view rendering.
- `widget-editor.js` owns detached widget drafts, preview data and chart configuration.

## Development baseline

- Java 21
- Apache ECharts 6.1.0
- Verified compile and registry target: DBeaver Community 26.2.2 on Windows x86_64

See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) before widening the supported range.
Production release as an independent plugin still has open requirements;
see [the readiness review](docs/PRODUCTION-READINESS.md).

## Validate

Windows:

```powershell
.\scripts\validate.ps1 -DBeaverPlugins C:\dbeaver\plugins
```

Linux/macOS:

```bash
DBEAVER_PLUGINS=/opt/dbeaver/plugins ./scripts/validate.sh
```

The validation checks XML, all custom JavaScript, chart/dashboard behavior,
third-party assets, extension contracts and Java compilation against the supplied
DBeaver installation.

## Eclipse PDE workflow

For a browser preview with sample data and automatic reload, run
`node scripts/preview.js` and open `http://127.0.0.1:8765`.
See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the local Eclipse target,
launch configuration, portable DBeaver setup and sample SQL workflow.

Import these projects into the Eclipse workspace:

- `plugins/org.example.dbeaver.echarts`
- `features/org.example.dbeaver.echarts.feature`
- `sites/org.example.dbeaver.echarts.site`

Set the DBeaver installation as the target, clean the workspace and launch the
DBeaver product. Detailed steps are in [docs/BUILD.md](docs/BUILD.md).

## Distribution

The feature and update-site projects produce an installable P2 repository. The
repository definition is versioned; hosting is intentionally external to this
source tree. See [docs/P2-UPDATE-SITE.md](docs/P2-UPDATE-SITE.md).

## Third-party assets

ECharts and the world GeoJSON are pinned and packaged locally. Their licenses,
notices, hashes and refresh scripts live under `third-party/` and `scripts/`.
Never replace them with an unpinned `latest` download.

## Dashboards guardados

**Save dashboard** conserva SQL y configuración en `Dashboards/ECharts`, como
JSON versionado y copia `.sql`. **Open dashboard** abre un editor independiente
del resultado SQL. Consulta [la guía de dashboards](docs/DASHBOARDS.md).

Arrastra un widget desde su cabecera y redimensiónalo desde la esquina inferior
derecha. Sus posiciones y tamaños se conservan en el JSON del dashboard.

Desde el dashboard, **Add widget** crea un gráfico con su propio SQL y conexión.
**Edit** modifica uno existente; **Run preview** carga sus columnas para elegir
tipo de gráfico, categoría, series y ejes. **Apply widget** aplica el borrador
y **Save dashboard** lo guarda junto con los demás gráficos.
