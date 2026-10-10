# Report Designer

## Architecture and design review

The existing SWT browser presentation owns connections, SQL approvals, bounded
background query jobs, cancellation, theme synchronization and browser lifecycle.
The report module reuses that presentation, `DashboardConnections`,
`DashboardQueryJob`, `DashboardQueryApproval`, the 12-column layout engine and
`DBeaverEChartsAnalytics`. Report files use a separate versioned marker and editor;
dashboard files and their editor keep their existing format and behavior.

The designer is a document workbench, with a component library on the left, a
white report sheet in the center and properties on the right. The sheet is the
memorable element: an actual report, not another dashboard surrounded by cards.
Controls inherit DBeaver's theme. Reference tokens: canvas `#303030`, controls
`#383838`, text `#eeeeee`, muted `#b0b0b0`, focus `#58a6e7`, report paper `#ffffff`.
Segoe UI is the native control face (13px); the document uses a deliberate 28/20/14px
title, section and body scale. Content is left aligned; margins, grid and alignment
commands carry structure. No external fonts or frontend framework are introduced.

```text
Report Designer   Template name       Save  Undo  Refresh  Preview  Export
Components      | Report sheet                        | Properties
Text / KPI      | Title, date, logo                    | Layout / style
Chart / Table   | KPIs, independent charts and tables  | Query / columns
Section / Image | Sections, footer                    | Parameters
```

Review changed the initial dashboard-like plan: report paper remains white even
in a dark workbench, and selection/resize chrome appears only in the designer.
Preview and export use the same widget renderers. Email has a separate table-based
representation because Outlook cannot run ECharts or modern grid layouts.

## Responsibilities

- `report-model.js`: versioned templates, validation, history, parameter definitions,
  dashboard conversion and grouped grid layout. Runtime rows are never serialized.
- `report-widgets.js`: registry, text/image/shape/section/date, KPI/table and ECharts
  renderers, formatting, totals and conditional visibility.
- `report-execution.js`: reviewed source requests, parameter values, result sharing
  within a refresh, cancellation and stale-result suppression.
- `report-export.js`: offline interactive HTML, static HTML and MIME EML drafts.
- `report-designer.js`: visual editing, properties, source configuration, preview
  and composition. Native save/open dialogs stay in the SWT bridge.
- `ReportFiles`: bounded template normalization by parameters, sources, components,
  configuration and section relationships; generated report SQL.
- `DocumentFiles` / `JsonFields`: shared UTF-8 writes, SQL companion collision
  protection and optional string fields, independent of dashboard/report formats.
- `ReportParameters`: named parameters compiled to JDBC placeholders and bound
  values. Identifiers/SQL fragments cannot be parameters.
- `ReportDesignerView` / `ReportEditor`: DBeaver workbench entry and file reopening.

## Data and email boundary

Templates store connection references, SQL, parameter definitions and layout.
They do not store JDBC URLs, passwords, authorization flags or execution results.
Generation produces a snapshot with runtime parameter values and query results.
Interactive HTML embeds the bundled ECharts, map, renderer and license notices;
it has no database bridge or SQL and does not need a network connection.

The Outlook action opens a composition dialog and exports a multipart EML draft:
inline CID images, HTML without scripts and an optional interactive HTML attachment.
The plugin never calls Send. Opening a saved EML uses the registered mail client;
editing/sending depends on that client's EML support. Microsoft Graph OAuth and
classic Outlook COM automation are separate future adapters, not implicit fallbacks.

Microsoft documents opening EML in new Outlook and Outlook on the web:
[EML support](https://support.microsoft.com/en-us/outlook/mail/open-eml-msg-and-oft-files-in-new-outlook-and-outlook-on-the-web).
Opening a message is not a guarantee that every client treats it as an editable draft.

## Use

Open **Window > Show View > Other > ECharts > Report Designer**, or use
**Report Designer** in the chart/dashboard toolbar to reuse its chart definitions.
Add components, select them to edit properties, and configure sources in **Data**.
Sources use named placeholders such as `:start_date`, with typed values in
**Parameters**. Review SQL before refreshing or generating a report.
Save templates under `Reports/ECharts` as `.echarts-report.json` with a generated
`.echarts-report.sql` companion. The JSON is authoritative.

Click a library component to append it without displacing existing content, or drag
it onto the sheet/section to choose a position. Before dropping, a live component
preview shows the exact footprint at the current zoom and moves the existing
components to show the complete resulting layout. Moving or resizing an existing
component also previews collision displacement. Releasing commits that layout;
Escape or leaving the sheet restores the original positions without changing the
template, creating an undo entry or executing SQL. Repeated hover plans from the
original layout, and hit-testing uses original section positions to avoid drift.
An undersized section shows an invalid preview and asks for more height.
Selecting a section before clicking
adds the component inside it. Deleting components closes vertical gaps in the
affected section, retaining columns, sizes and row alignment. **Close gaps** repairs
whitespace in existing templates, including nested sections. Both actions support
undo/redo; opening a template preserves its saved positions. Drag its
selected title strip to move it; every edge and corner resizes it. Arrow keys move
the component, and the southeast resize handle also supports arrow keys. Shift-click
selects multiple components for alignment. Ctrl+C/V/D, Delete and Ctrl+Z/Y support
copy, paste, duplicate, delete and undo/redo. Zoom affects editing, not saved sizes.
Layout uses 12 columns and 24px rows with configurable spacing; up to three nested
sections are supported. Headers/footers are normal reusable sections, not repeating
print-page elements.

**Templates** filters saved reports by name/category. **Use template** and
**Duplicate template** create a new report in the workbench view, preserving the
current file editor. Import/export definitions from the library/Export menu.
Set a template as the default in Report properties, then save it under Reports/ECharts.
Rename/delete templates through DBeaver's Files navigator; remove a generated SQL
companion as well when deleting its template. The JSON is the editable definition;
changes to the generated SQL companion do not change queries in the report.

The sample [daily sales template](../dev/reports/daily-sales.echarts-report.json)
uses the existing `echarts_test_sales` table. Open it and select your own connection
in **Data**. It stores no runtime rows or developer connection identifier.

Use **Preview** for the last successful data snapshot, **Generate report** to
refresh reviewed sources, and **Export HTML** for an offline interactive file or
static email-compatible version. **Outlook draft** lets you review recipients,
subject, message, inline report and attachment before saving an EML.
The static preview appears below the draft fields at the full available width.
The content scrolls while Save and Cancel remain visible. Leaving the Message field updates the preview with the same escaped message
included in the EML. The sandboxed preview has no scripts or database bridge.

Charts are grouped by purpose and use the same catalog in dashboards and reports.
**Horizontal bar** handles long category names; **Stacked bar** and **Stacked area**
compare parts of a total on a shared axis. Use values with the same units for stacks.
Repeated categories are summed for bars and stacks. Chart editing includes a guide
for each type, including the longitude/latitude/value mapping for maps. Histogram
and candlestick are not offered until their builders and data mappings are supported.

## Validation and practical limits

Automated checks cover the following boundaries:

| Area | Evidence |
| --- | --- |
| Model and engine | `test-report-model.js`: schema, imported chart options/SQL, section cycles, bounded history, typed values, query sharing, four-query queue, errors, empty results, cancellation and obsolete results |
| Native files/parameters | `ReportFilesTest` and `ReportParametersTest`: UTF-8 JSON/SQL, unknown-field stripping, default pointer lifecycle, collision protection, lexical placeholders, typed JDBC setters through the actual job adapter and approval invalidation |
| Visual authoring | `test-report-designer.js`: image, text/date, chart preview/dual axes, KPI/table reuse, totals/subtotals, pagination, column headers/conditional color/visibility, properties, keyboard layout, undo, duplication, save/reopen and export |
| Mouse and lifecycle | `test-report-interactions.js`: all eight resize directions, full edge hit surfaces, anchored edges, ECharts dimensions, Escape, zoom, move, empty-section drag/drop, copying descendants, failed refresh and 360–1440px windows |
| Portable output | Generated HTML reopened with Edge network access disabled; ECharts, KPI/table and local assets checked. Static HTML checked for no scripts/canvas/grid. `test-report-eml.py` independently decodes MIME, Unicode, two inline PNG/CIDs and the byte-identical HTML attachment |
| Existing functionality | Existing analytical chart, labels, dashboard schema/layout/bridge/authoring and query timeout/cancellation suites |
| Chart catalog | `test-chart-catalog.js`: identical 15-type catalog in reports/dashboards, 30 Canvas/SVG renders and image exports; `test-analytics.js`: category aggregation, stacking and shared axes |
| Email preview and flow | Native WebView2 reproduces the blocked `about:srcdoc` navigation. `BrowserNavigationTest` permits only child srcdoc while retaining external/top-level navigation restrictions. Browser tests check loaded preview images, message text, checkbox alignment, delete compaction and undo/redo |
| Packaging | P2 lifecycle checks install/upgrade/uninstall/reinstall, installed report view/editor/content type/assets and unchanged JSON/SQL fixtures for dashboards and reports |

Browser integration uses deterministic query/connection bridge fixtures, not a live
database. Java tests compile against DBeaver Community 26.2.2 and exercise its API
adapter with controlled sessions. Manual acceptance in the actual SWT workbench,
with real driver connections and each Outlook version, remains required before
calling this a production release. The ZIP is a test build, not a signed release.

Limits: 64 components, 24 source definitions, 32 parameters, 8 MiB template and
32 MiB generated output. SQL runs in isolated, bounded background jobs with at most
four concurrent requests, using the lower of a source row limit and the global
preference. Identical source requests share one execution during each refresh;
explicit refresh obtains fresh results. Undo history is capped at 80 entries and
approximately 24 MiB. Charts/observers/jobs are released when pages close.

Named values bind as text, decimal, ISO date or boolean; they cannot replace SQL
identifiers or fragments. Existing conservative read-only SQL validation applies.
Parameterized sources require JDBC drivers exposing DBeaver's bounded statement
adapter. Strings with ambiguous backslash quoting and raw `?` placeholders are
rejected. Multi-statement scripts and write/locking operations are unsupported.

Number/date display follows browser locale; currency is USD. Tables paginate in
the editor/interactive HTML. Static email preserves the selected page, configured
rows per page and table height; it never expands the entire query automatically.
Increase **Rows per page** and provide enough **Height (rows)** to include more.
The email shows a row-range summary instead of inactive pagination buttons.
Group subtotals apply to the displayed rows; the grand total covers the snapshot.
Email uses the configured sheet width and bounds the actual rendered rows because
mail clients cannot reliably clip overflowing tables. Very narrow mail windows
can wrap cell text differently from the designer.
Graph OAuth, desktop COM and real mail submission are not implemented. Exporting
HTML intentionally includes the selected data and runtime parameter values for
sharing, but omits SQL, connection identifiers and database credentials.

Visual review corrected the email renderer's mixed-width rows with explicit grid
column spans, preserved descendant styles before removing CSS classes, and retained
chart headings/logos. The report sheet remains legible in both host themes, and
resize chrome never appears in exports.
