# Linux validation

Use an isolated DBeaver installation and workspace. The P2 installer is shared
between Windows and Linux; SWT selects the native browser engine for each OS.

## Dependencies

The test suites need Node.js 20+, Python 3, Git, a JDK 21+ compiler, Xvfb and
Playwright's Chromium/WebKit dependencies. DBeaver uses its bundled Java runtime.
On Debian, the native SWT browser also needs `libwebkit2gtk-4.1-0`.

Install the pinned browser test dependencies from the repository:

```bash
mkdir -p .dev/browser-tests
cp dev/ci/browser/package*.json .dev/browser-tests/
npm ci --prefix .dev/browser-tests --ignore-scripts --no-audit --no-fund
node .dev/browser-tests/node_modules/playwright/cli.js install --with-deps chromium webkit
```

Install the plugin into a clean DBeaver copy with its P2 director, using the local
installer directory as the repository. Keep a separate workspace and keyring.
Close the application before changing its installed bundles.

## Automated checks

```bash
DBEAVER=/absolute/path/to/dbeaver
set -o pipefail
bash scripts/test-linux.sh "$DBEAVER" 2>&1 | tee linux-tests.log
```

The script checks source/API compatibility, Java persistence and query controls,
model and bridge behavior, chart labels, all 15 chart types with Canvas/SVG,
dashboard authoring, all eight resize edges, report interactions, live layout
previews, offline exports, EML MIME, and the installed Equinox registry.

Browser suites default to Edge on Windows and Chromium elsewhere. Set
`ECHARTS_TEST_BROWSER=webkit` to run a single browser suite with WebKit, or
`ECHARTS_TEST_BROWSERS=chromium` to limit the Linux runner to one engine.
On slow test machines, `ECHARTS_TEST_TIMEOUT_MS=120000` increases browser action
timeouts; assertions remain unchanged and the default stays at Playwright's
normal timeout.

These browser tests use controlled bridge fixtures. They complement native
SWT/WebKit checks in a running DBeaver; they do not prove native JDBC execution
by themselves. Native checks should verify real queries, loaded charts, table
pagination, draft previews and the platform error log in a dedicated workspace.

For installer validation, also test installation of a previous package,
upgrade, uninstall, and reinstall. Confirm the expected version in
`configuration/org.eclipse.equinox.simpleconfigurator/bundles.info` after each
operation.
