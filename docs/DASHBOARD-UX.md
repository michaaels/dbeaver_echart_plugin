# Dashboard UX direction

The dashboard is an analytical workbench inside DBeaver: SQL authors build and
monitor charts while working with their existing connections. The chart area is
the main content. Desktop window gestures and DBeaver's own theme are the visual
reference, rather than a marketing page or a separate web application's branding.

## Design plan

- Color: inherit the host canvas and foreground. Reference dark colors are canvas
  `#303030`, control surface `#383838`, text `#eeeeee`, secondary text `#b0b0b0`,
  separator `#555555`, focus/accent `#58a6e7`. Light mode uses the host's equivalents
  and a darker blue accent. Subtle surface differences encode chart vs controls.
- Type: Segoe UI Variable Text/Segoe UI for the Windows workbench; 13px controls,
  18px editable dashboard title and 13px widget titles. SQL keeps its monospace face.
  Native typography is deliberate here: readability and consistency with DBeaver.
- Layout: title and widget count first; authoring, saving and refresh below;
  file operations in a disclosure menu and renderer in Display. Flat chart panels
  have a compact header and footer, while the plot carries most of the space.

```text
Dashboard title                      3 widgets       Display
Add widget  Save dashboard  Refresh all  Review SQL   Files
Query status / active filters
+-----------------------------+---------------------------+
| Move  Widget title   Edit  × | Move  Widget title Edit × |
|          chart              |          chart            |
| connection   refresh policy | connection refresh policy |
+-----------------------------+---------------------------+
```

The first plan kept all actions as equal buttons. Review against the screenshot
showed that this preserved its main problem: controls dominated the charts.
File operations therefore move into a menu, title size is bounded, and inactive
Stop/Clear filters controls are omitted. The host's native typography remains;
introducing display fonts would make an embedded SQL tool harder to scan.

## Interaction contract

Widgets resize from all four edges and four corners. Cursor direction follows
the grabbed edge, and the opposite edge stays anchored. The 12-column layout,
minimum sizes and collision handling remain authoritative. A grid preview follows
the drag; Escape, pointer cancellation and focus loss restore the original layout.
Mouse gestures never rerun SQL. A southeast handle remains keyboard reachable,
with arrow keys for size; the move handle provides keyboard movement.

Keyboard focus, hover affordances, narrow widths and both themes are checked in
an isolated browser. SQL, connections and saved coordinates must survive editing,
save/reopen, and asynchronous results during gestures.

## Validation

`scripts/test-dashboard-resize.js` uses real headless Edge pointer events for all
eight directions, three hit positions along each border, anchored coordinates,
live chart size, Escape, keyboard controls and save/reopen without executing SQL.
The toolbar and menus are checked from 360px to 1440px in both host themes.
Chart label geometry tests cover the compact dashboard layout as well as the
result chart, with Canvas/SVG, dual axes and 90 dates.

Screenshot review removed forced map width/height bounds that stretched the
world geometry. Only vertical padding is set, so ECharts preserves its aspect
ratio. Menu positioning also adjusts at narrow widths so file commands stay
inside the viewport. Native SWT browser rendering remains a separate manual
check; these tests use the bundled frontend in headless Edge.
