# Prototype status — 0.1.0

## Verified in this workspace

- XML files are well-formed.
- `chart.js` passes `node --check`.
- Linux vendoring script passes `bash -n`.
- Standalone `JsonWriter.java` compiles with Java 21.
- Browser assets contain no HTTP(S) dependency.
- ECharts legal material includes Apache ECharts `LICENSE`, `NOTICE` and the referenced d3 BSD license.
- DBeaver-facing code was checked against the source of DBeaver Community 26.1.3 for:
  - `IResultSetPresentation`
  - `AbstractPresentation`
  - `IResultSetController#getModel()`
  - `ResultSetModel#getVisibleLeafAttributes()`
  - `ResultSetModel#getRowCount()`
  - `ResultSetModel#getRow(int)`
  - `ResultSetModel#getCellValue(...)`
  - `ResultSetPresentationDescriptor` and `type="custom"`

## Still requires a real DBeaver target

A complete PDE/OSGi compile and launch has not been run in this workspace because the DBeaver 26.1.3 target platform/bundles are not installed here. That is the next hard gate before calling 0.1.0 installable.

## ECharts binary

`web/js/echarts.min.js` is intentionally accepted only when its Git blob equals:

`3b8ed4bcd17f7c838d86d4920af588f1a0aeb389`

Run one of the vendoring scripts on a network-enabled development machine before launching or packaging the plugin.
