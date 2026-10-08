# Security and performance rules

## Security

- Browser assets are local; no result data is sent over HTTP.
- Database values are serialized as JSON data, never interpolated as JavaScript.
- Browser navigation is restricted to the local plugin resource root.
- Binary values use metadata placeholders and unsafe integers are serialized as strings.
- Dashboard imports are capped at 1 MiB and normalized to bounded collections.
- Saved SQL waits for explicit review of the query and connection. Session approvals are bound to exact SQL and connection references and are checked again in Java; they are never saved in dashboard files.
- Widget SQL permits one conservatively validated query and runs with the selected connection's database permissions in an owned isolated context.
- No remote map tiles, scripts, fonts, telemetry or iframes are loaded.

The SQL check is a conservative lexical guard, not a read-only security boundary.
It distinguishes standard strings, quoted identifiers and comments; blocks batches,
write/locking keywords, executable comments and several known side-effect functions.
Ambiguous backslash escapes and nested comments are rejected. SQL dialects and
user-defined functions can still have side effects: use database-enforced read-only
roles for operational dashboards. Approval authorizes execution with the connected
user's permissions; it does not change those permissions. See
[the readiness review](PRODUCTION-READINESS.md).

## Resource budgets

Preferences default to 50,000 rows and 1,000,000 cells per snapshot. The lower
budget determines the effective row count. Widget query snapshots obey the same
limits.

Dashboard query timeout defaults to 30 seconds (Preferences > ECharts, 1–3600).
It applies when a job starts running; waiting jobs do not use execution slots.
Java sets the driver's statement timeout and schedules a cancellation deadline.
Stop requests `DBCStatement.cancelBlock` off the UI thread. Actual interruption,
including connection opening and result fetching, depends on driver support;
an unresponsive driver can keep a slot occupied until it returns. No forced thread
termination or automatic retry after a widget error is used.

At most four widget query jobs execute at once across dashboard hosts. Each owns
and closes its isolated context, session and statement. Single-connection mode
and drivers returning the editor context are rejected rather than sharing an
editor transaction. Normal driver connection limits still apply. Snapshot budgets
are per widget; a global memory budget remains pending.

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
