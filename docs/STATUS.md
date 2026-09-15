# Implementation status — 0.5.0

Roadmap versions 0.1 through 0.5 are implemented. The project currently includes:

- SWT-safe asynchronous snapshot publication; no browser call is made from a SQL worker thread.
- V0.2 DBeaver integration hardening.
- V0.3 analytical chart builders and automated option tests.
- V0.4 dashboards, persisted schema and bounded read-only SQL widget jobs.
- V0.5 geographic charts, dashboard import/export and a P2 site project.
- A documented decision not to bundle ECharts GL after 50,000-row option-build profiling.

## Verified target

DBeaver Community 26.2.0, Java 21, Windows x86_64:

- Java sources compile against the installed DBeaver plugin set.
- XML, JavaScript and shell source checks pass.
- Analytical option and dashboard normalization tests pass.
- Extension, BrowserFunction and API compatibility smoke tests pass.
- The frontend contains no HTTP(S) runtime dependency.

Runtime launch testing in Eclipse remains the release gate for each target build.
The P2 project is ready to generate a repository, but this source repository does
not imply that a public update URL has been deployed.
