# Compatibility matrix

| DBeaver Community | Java | OS | Status | Evidence |
|---|---:|---|---|---|
| 26.2.2 | Plugin bytecode 21; bundled runtime 25.0.4.1; development runtime 26 | Windows x86_64 | Beta tested; full runtime certification pending | Clean P2 install/upgrade/uninstall/reinstall, registry/resources and JSON/SQL preservation; Edge browser suites; native DBeaver report, SQL and email-preview scenarios |
| 26.2.2 | Plugin bytecode 21; compiler Java 21 | Linux x86_64 | Beta tested; full driver certification pending | Same P2 archive installed in Ubuntu CI; Chromium/WebKit suites; native SWT/WebKit and SQLite report/reflow/email checks on Debian 13; source validation in Ubuntu 24.04 WSL |
| 26.2.2 | Plugin bytecode 21 | macOS | Not certified | Native installation and SWT tests pending |
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

The packaged P2 lifecycle is tested separately with `scripts/test-p2-install.ps1`;
`-PreviousRepositoryZip` enables an exact version upgrade test. GitHub Actions
builds from the pinned toolchain and baseline documented in `P2-UPDATE-SITE.md`.
Browser and isolated Equinox tests supplement the native scenarios; they do not
certify every SWT lifecycle or dialog. The beta does not claim full driver or
Outlook-client certification. See [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).
