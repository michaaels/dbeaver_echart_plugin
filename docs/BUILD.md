# Build and run

## Eclipse PDE development

Use Java 21 and a supported DBeaver Community installation as the target platform.

1. Import the plugin, feature and site directories as existing Eclipse projects.
2. Configure the DBeaver installation as the PDE target platform.
3. Refresh and clean all three projects.
4. Confirm that the plugin has no unresolved bundle imports.
5. Launch the DBeaver product from PDE.
6. Execute a query with category/date and numeric columns, then select **ECharts**.
7. Verify native zoom, restore, PNG download, dashboard mode and a read-only widget query.

Before launch, run:

```powershell
.\scripts\validate.ps1 -DBeaverPlugins C:\dbeaver\plugins
```

The validation compiles every Java source against the selected target. To make
Eclipse pick up newly added classes during local debugging, clean the plugin
project rather than relying on stale contents in `bin/`.

## Third-party assets

The repository carries pinned runtime assets. To refresh them intentionally:

```powershell
.\scripts\vendor-echarts.ps1
.\scripts\vendor-world-map.ps1
```

The scripts verify the expected hashes before replacing existing files.

## P2 repository

Open `sites/org.example.dbeaver.echarts.site/category.xml` in PDE and choose
**Build All**. The generated P2 directory can be served as static content and
installed through DBeaver's **Help → Install New Software** dialog.

For reproducible CI, pin the DBeaver target repository, run `scripts/validate`,
build the plugin and feature, then publish the generated update site. Do not use
an unpinned DBeaver or ECharts `latest` dependency.
