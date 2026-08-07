# Build and run strategy

## Phase 1 — PDE development target (recommended now)

Use DBeaver Community **26.1.3** as the compatibility target and Java 21.

1. Obtain the DBeaver 26.1.3 source or a matching Eclipse/PDE target.
2. Import `plugins/org.example.dbeaver.echarts` as an existing Eclipse plug-in project.
3. Import `features/org.example.dbeaver.echarts.feature` as a feature project.
4. Run `scripts/vendor-echarts.ps1` on Windows or `scripts/vendor-echarts.sh` elsewhere.
5. Resolve the target platform and confirm no unresolved bundle imports.
6. Launch the DBeaver product from PDE.
7. Execute a query returning at least one category/date and one numeric column.
8. Select the `ECharts` result-set presentation.

## Phase 2 — reproducible CI build

Do this only after Phase 1 compiles and launches:

- Pin the DBeaver/P2 target repository or a generated target definition.
- Add Tycho reactor build.
- Build the bundle and feature.
- Generate a P2 repository.
- Add Windows/Linux/macOS smoke tests where practical.
- Verify the ECharts Git blob during CI.

Do not make CI download an unpinned `latest` ECharts asset.

## Installation target

Final releases should be a P2 repository so users can install from:

`Help -> Install New Software`

The feature is already separated from the plugin to support that packaging path.
