# Security and performance rules

## Security

- Browser assets are local; no result data is sent over HTTP.
- Database values are serialized as JSON data, never interpolated as JavaScript.
- Browser navigation is restricted to the local plugin resource root.
- Binary values use metadata placeholders and unsafe integers are serialized as strings.
- Dashboard imports are capped at 1 MiB and normalized to bounded collections.
- Widget SQL permits one conservatively validated read-only statement and runs with the active connection's permissions.
- No remote map tiles, scripts, fonts, telemetry or iframes are loaded.

The current SQL check is a heuristic, not a read-only security boundary. It
accepts some `SELECT` statements with side effects and can reject harmless
keywords inside literals. Imported saved dashboards currently execute their
queries on opening, using the connected user's permissions. A production
release needs a reviewed trust/execution policy and database-enforced permissions;
see [the readiness review](PRODUCTION-READINESS.md).

## Resource budgets

Preferences default to 50,000 rows and 1,000,000 cells per snapshot. The lower
budget determines the effective row count. Widget query snapshots obey the same
limits.

ECharts defaults to Canvas, disables animation for result charts, uses LTTB
sampling for long lines, progressive thresholds and large modes where supported.
Native `dataZoom` provides navigation without producing a label for every point.

## Thread model

```text
Result/query worker -> immutable JSON -> Display.asyncExec -> SWT Browser -> ECharts
```

Never access `Browser`, controls, theme objects or dialogs from a snapshot or SQL
job. The browser-side interval policy may request work, but Java owns query job
lifecycle and cancellation.

## GL policy

ECharts GL is optional and not packaged in 0.5. The profiling rationale and
reconsideration criteria are documented in `GL-DECISION.md`.
