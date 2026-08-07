# Security and performance rules

## Security

- ECharts is packaged locally; no CDN.
- No database result data is sent over HTTP.
- The BrowserFunction returns JSON as a string.
- Database values are never concatenated into JavaScript source.
- JSON control characters, quotes, backslashes, U+2028 and U+2029 are escaped.
- Binary values are represented by a metadata placeholder rather than embedded raw.
- Large integer precision is preserved by sending unsafe integers as strings.
- Arbitrary database-specific objects fall back to display text; they are not reflected/serialized recursively.
- Browser top-level navigation is restricted to the plugin's local `web/` resource root while the Java bridge is registered.
- The `BrowserFunction` is exposed only to the top-level frame; child frames are not granted access.
- Keep the browser page local and avoid adding remote scripts, fonts, telemetry or map tiles without explicit user opt-in.

## Performance

V1 intentionally limits synchronous bridge work to:

- 50,000 rows maximum.
- 1,000,000 cells maximum.

The effective row limit is the lower of the two budgets.

ECharts uses:

- Canvas by default.
- No animation for result-set charts.
- `sampling: lttb` for long line/area series.
- progressive rendering thresholds.
- large mode for large bar/scatter series where supported.
- DataZoom for navigation instead of rendering labels for every point.

## V2 performance architecture

Snapshot conversion should move off the SWT UI thread:

```text
ResultSet refresh
    -> background DBeaver Job
    -> immutable JSON/data snapshot
    -> SWT asyncExec
    -> Browser notification
    -> ECharts setOption
```

The BrowserFunction should eventually become a cheap snapshot getter rather than doing the entire conversion on demand.
