# Compatibility matrix

| DBeaver Community | Java | OS | Status | Evidence |
|---|---:|---|---|---|
| 26.2.2 | Plugin bytecode 21; bundled runtime 25.0.4.1; development runtime 26 | Windows x86_64 | Compile, P2 installation and isolated registry verified; complete SWT runtime gate pending | Fresh P2 ZIP installed/uninstalled/reinstalled in an official clean distribution; installed frontend/resources and registry verified with bundled Java; headless Edge chart/dashboard tests |
| 26.2.0 (2026-08-30) | 21 | Windows x86_64 | Compile verified; runtime release gate pending | Java target compile and compatibility smoke tests |
| 26.1.x | 21 | Windows/Linux/macOS | Not certified | A separate target compile and runtime validation are required |
| 26.0.x and older | 21 | Windows/Linux/macOS | Not certified | Run `scripts/smoke-tests` against the target installation |

Certification requires:

1. `scripts/validate.ps1 -DBeaverPlugins <installation>/plugins` or the shell equivalent;
2. launching the PDE runtime and executing a query while ECharts is selected;
3. verifying chart zoom, dashboard saved queries, copy/export, theme switching and PNG export.
4. installing the generated P2 release in a clean DBeaver distribution, without workspace classes;
5. testing connection loss, query cancellation, editor save/reopen and upgrade from the previous release.

The plugin does not claim compatibility with a DBeaver target until both the
compile-time smoke test and the runtime checklist pass.

The packaged P2 installation is tested separately with `scripts/test-p2-install.ps1`.
The browser and isolated Equinox tests do not certify the SWT browser lifecycle
or native dialogs. See [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).
