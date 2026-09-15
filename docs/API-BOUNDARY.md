# DBeaver API boundary — 26.2.0

The plugin registers `EChartsPresentation` at
`org.jkiss.dbeaver.resultset.presentation` for `DBCResultSet` and advertises a
read-only custom presentation.

## ResultSet boundary

`DBeaverResultSetAdapter` is the only component that translates the active
DBeaver result model into the browser snapshot schema. It consumes the public
controller/model methods for visible attributes, rows, cell values, selections,
data container and site.

## Independent dashboard query boundary

`DashboardQueryJob` uses the active `DBCExecutionContext`, opens a
`DBCExecutionPurpose.USER` session and returns the same bounded snapshot schema.
It accepts one statement beginning with `SELECT`, `WITH`, `SHOW`, `EXPLAIN`,
`DESCRIBE` or `DESC` and rejects mutating keywords. This is defense in depth;
database permissions remain the authoritative access control.

## SWT boundary

`EChartsPresentation` owns the SWT Browser and every browser/configuration/theme
operation is marshalled through `runOnUiThread`. Snapshot and query jobs publish
immutable JSON and never call SWT widgets directly. This rule prevents the
`SWTException: Invalid thread access` failure from SQL worker jobs.

## Upgrade checklist

For each DBeaver target upgrade:

1. Run `scripts/validate` with the new installation's `plugins` directory.
2. Diff `IResultSetPresentation`, `AbstractPresentation` and `ResultSetModel`.
3. Verify the result-set package remains exported.
4. Exercise active ResultSet refresh and independent widget SQL in PDE.
5. Verify zoom, copy/export, theme switching and disposal.
6. Update `COMPATIBILITY.md` only after compile and runtime checks pass.
