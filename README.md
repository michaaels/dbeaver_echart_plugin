# DBeaver ECharts Presentation — prototype 0.1.0

A read-only DBeaver Community ResultSet presentation backed by Apache ECharts.

## Pinned baseline

- DBeaver Community: **26.1.3**
- Java: **21**
- Apache ECharts: **6.1.0**
- ECharts asset: `dist/echarts.min.js`
- Pinned ECharts Git blob: `3b8ed4bcd17f7c838d86d4920af588f1a0aeb389`

The DBeaver API baseline is intentionally pinned. Do not develop against DBeaver `devel` and assume binary compatibility.

## What V1 already implements

- A real `org.jkiss.dbeaver.resultset.presentation` extension named **ECharts**.
- Uses the active DBeaver ResultSet model. It does **not** open a second JDBC connection.
- Reads visible leaf attributes and already-fetched rows through a single adapter class.
- Local SWT `Browser` frontend.
- Java → JavaScript bridge with `BrowserFunction`.
- JSON is returned as a string and parsed by JavaScript; database values are never interpolated as executable JavaScript.
- Line, area, bar, scatter and pie charts.
- Automatic initial X/Y inference based on DBeaver data kinds.
- Canvas renderer by default; SVG selectable.
- DataZoom, restore and image export through ECharts toolbox.
- Progressive/large-series settings for larger result sets.
- 50,000 row budget and 1,000,000 cell budget to protect the SWT UI thread.
- Safe handling of nulls, dates, binary values, non-finite floats and integers above JavaScript's safe integer range.
- No CDN, analytics or network calls from the chart frontend.
- Browser navigation is restricted to the local plugin resource root while the Java bridge is active.
- V1 declares itself read-only: no edit/navigation/panel capabilities are advertised.

## Architecture

```text
DBeaver ResultSet
      │
      ▼
IResultSetController / ResultSetModel
      │
      ▼
DBeaverResultSetAdapter  <-- only DBeaver-specific data boundary
      │
      ▼
JSON DTO (schemaVersion=1)
      │
      ▼
BrowserFunction: dbeaverGetDataset()
      │
      ▼
SWT Browser
      │
      ├── index.html
      ├── chart.js
      └── echarts.min.js 6.1.0
             │
             ├── Canvas
             └── SVG
```

## Vendor the exact ECharts runtime

The runtime is intentionally not downloaded at plugin startup.

Windows PowerShell 5.1+:

```powershell
.\scripts\vendor-echarts.ps1
.\scripts\validate.ps1
```

Linux/macOS:

```bash
./scripts/vendor-echarts.sh
./scripts/validate.sh
```

Both scripts download the exact 6.1.0 distribution and verify the Git blob SHA before moving it into the plugin. The source package also carries the Apache ECharts `LICENSE`, `NOTICE`, and referenced d3 BSD license for redistribution.

Expected destination:

```text
plugins/org.example.dbeaver.echarts/web/js/echarts.min.js
```

## ResultSet DTO

The browser receives a schema-versioned structure similar to:

```json
{
  "schemaVersion": 1,
  "columns": [
    {"index": 0, "name": "ts", "kind": "DATETIME"},
    {"index": 1, "name": "traffic", "kind": "NUMERIC"}
  ],
  "rows": [
    ["2026-08-07T10:00:00Z", 1234.5]
  ],
  "rowCount": 1,
  "exportedRowCount": 1,
  "truncated": false,
  "maxRows": 50000,
  "maxCells": 1000000,
  "effectiveMaxRows": 50000
}
```

Rows are arrays rather than JSON objects because SQL result sets can contain duplicate column labels.

## Project layout

```text
plugins/org.example.dbeaver.echarts/
├── META-INF/MANIFEST.MF
├── plugin.xml
├── build.properties
├── src/org/example/dbeaver/echarts/
│   ├── EChartsPresentation.java
│   ├── DBeaverResultSetAdapter.java
│   ├── JsonWriter.java
│   └── WebAssets.java
├── web/
│   ├── index.html
│   ├── css/plugin.css
│   └── js/
│       ├── chart.js
│       └── echarts.min.js      # vendored, not fetched at runtime
└── third-party/echarts/
    ├── LICENSE
    └── README.md

features/org.example.dbeaver.echarts.feature/
└── feature.xml
```

## Development strategy

Start with Eclipse PDE against DBeaver 26.1.3. Once the API-level prototype launches inside the target product, freeze the dependency set and add a reproducible Tycho/P2 CI build. See `docs/BUILD.md`.

## Compatibility policy

All DBeaver-specific result-set access is intentionally concentrated in:

`DBeaverResultSetAdapter.java`

Presentation lifecycle coupling is concentrated in:

`EChartsPresentation.java`

When DBeaver changes its ResultSet API, update these two classes first. Keep `chart.js` and the browser DTO independent of DBeaver internals.

## Current limitations

- The ECharts binary still has to be vendored with the supplied script before packaging.
- This environment does not contain a full DBeaver 26.1.3 PDE target, so a complete OSGi/PDE compilation has not been executed here.
- Data conversion currently happens synchronously when JavaScript calls `dbeaverGetDataset()`. The row/cell budget limits the risk. V2 should move snapshot construction to a background DBeaver job and publish immutable snapshots to the UI thread.
- Only one Y series is supported in V1.
- Pie charts aggregate values by category in JavaScript.
- Scatter requires numeric-convertible X and Y values.
- No saved chart definitions or multi-widget dashboards yet.

## Next milestones

1. Compile/run against a real DBeaver 26.1.3 PDE target.
2. Add DBeaver preference page for row/cell limits and default renderer.
3. Preserve chart configuration per SQL editor/result source.
4. Add multiple Y series and secondary axes.
5. Add chart configuration persistence with a versioned JSON schema.
6. Add dashboard editor with multiple widgets.
7. Add scheduled refresh through DBeaver's execution infrastructure rather than a JavaScript timer.
8. Add cross-filter and drill-down events through a second BrowserFunction bridge.
9. Add optional geographic charts.
10. Evaluate ECharts GL as a separate optional bundle only after Canvas profiling shows a real need.
