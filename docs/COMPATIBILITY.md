# Compatibility matrix

| DBeaver Community | Java | OS | Status | Evidence |
|---|---:|---|---|---|
| 26.2.0 (2026-08-30) | 21 | Windows x86_64 | Compile verified; runtime release gate pending | Java target compile and compatibility smoke tests |
| 26.1.x | 21 | Windows/Linux/macOS | Expected, not yet certified | Public ResultSet/DBC APIs only |
| 26.0.x and older | 21 | Windows/Linux/macOS | Not certified | Run `scripts/smoke-tests` against the target installation |

Certification requires:

1. `scripts/validate.ps1 -DBeaverPlugins <installation>/plugins` or the shell equivalent;
2. launching the PDE runtime and executing a query while ECharts is selected;
3. verifying chart zoom, dashboard saved queries, copy/export, theme switching and PNG export.

The plugin does not claim compatibility with a DBeaver target until both the
compile-time smoke test and the runtime checklist pass.
