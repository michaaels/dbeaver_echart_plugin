# ECharts GL decision

ECharts GL is not bundled in version 0.5.

The current geographic view is a progressive 2D `geo` scatter plot and the
preferences cap snapshots at 50,000 rows by default. Run
`node scripts/profile-analytics.js 50000` when changing those limits. The bundle
may be reconsidered only when reproducible rendering profiles show that Canvas
cannot meet the interaction target and a 3D/WebGL visualization has a concrete
product requirement.

Avoiding the GL bundle keeps startup, distribution size, driver compatibility
and third-party maintenance costs lower. This is an explicit conditional roadmap
decision, not a missing runtime dependency.

Reference profile on 2026-09-15 with Node.js and 50,000 rows:

| Option builder | Time | Points |
|---|---:|---:|
| line, two series | 46.3 ms | 50,000 per series |
| scatter | 33.5 ms | 50,000 |
| world map | 40.4 ms | 50,000 |

The process reported 33.1 MiB heap in use. These numbers measure option creation,
not SWT Browser paint time, so the PDE runtime remains the final interaction gate.
