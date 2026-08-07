# DBeaver API boundary — 26.1.3

## Extension point

`org.jkiss.dbeaver.resultset.presentation`

V1 registers a `type="custom"` presentation for `org.jkiss.dbeaver.model.exec.DBCResultSet`.

Important: in DBeaver 26.1.3 `ResultSetPresentationDescriptor` reads `type` and immediately converts it with `PresentationType.valueOf(...)`. Keep `type="custom"` explicit even if an older extension schema does not show all runtime attributes.

## Exported package used

Bundle:

`org.jkiss.dbeaver.ui.editors.data`

Package:

`org.jkiss.dbeaver.ui.controls.resultset`

DBeaver 26.1.3 exports this package in its OSGi manifest.

## ResultSet methods consumed

Only these model operations are required by the adapter:

```text
IResultSetController.getModel()
ResultSetModel.getVisibleLeafAttributes()
ResultSetModel.getRowCount()
ResultSetModel.getRow(int)
ResultSetModel.getCellValue(DBDAttributeBinding, DBDValueRow)
DBDAttributeBinding.getName()
DBDAttributeBinding.getDataKind()
```

Avoid adding dependencies on spreadsheet/grid implementation classes unless necessary.

## Presentation lifecycle methods implemented

`EChartsPresentation` extends `AbstractPresentation` and implements the remaining read-only behavior:

```text
createPresentation
getControl
refreshData
formatData
clearMetaData
updateValueView
changeMode
getCurrentAttribute
copySelection
dispose
```

`AbstractPresentation` remains responsible for the common selection/navigation/state defaults.

## Upgrade rule

For every DBeaver target upgrade:

1. Diff `IResultSetPresentation.java`.
2. Diff `AbstractPresentation.java`.
3. Diff `ResultSetModel.java` methods listed above.
4. Diff `ResultSetPresentationDescriptor.java`.
5. Verify `org.jkiss.dbeaver.ui.controls.resultset` is still exported.
6. Launch the plugin against the exact new DBeaver target.
7. Only then widen the supported-version range.
