# Installable P2 package

Install the plugin in a normal DBeaver Community distribution. Eclipse is needed
to build the package, but is not needed to use it.

## Instalar en DBeaver

Target de la beta: **DBeaver Community 26.2.2, Windows y Linux x86_64**.
Descarga el ZIP P2 y el checksum desde el
[release 0.6.0 beta](https://github.com/michaaels/dbeaver_echart_plugin/releases/tag/v0.6.0-beta.1).

1. Abre **Help / Ayuda → Install New Software / Instalar nuevo software**.
2. Pulsa **Add / Añadir → Archive / Archivo** y selecciona `dbeaver-echarts-<version>.zip`.
   No necesitas descomprimirlo. Ponle el nombre `DBeaver ECharts`.
3. Selecciona **DBeaver ECharts Presentation** y continúa con **Next / Siguiente**.
4. Acepta la licencia. Este paquete de prueba no está firmado; si DBeaver muestra
   la pantalla de confianza, autoriza el contenido del paquete local generado.
5. Termina la instalación y reinicia DBeaver cuando lo solicite.
6. Ejecuta un `SELECT` y abre la pestaña **ECharts** del resultado. Para un dashboard
   guardado, abre `*.echarts-dashboard.json` desde el proyecto. Cada widget permite
   editar su consulta y conexión con **Edit**.
7. En la versión 0.6.0, abre **Window → Show View → Other → ECharts → Report Designer**
   para diseñar reportes. También puedes usar **Report Designer** en la barra de un
   gráfico/dashboard y abrir plantillas `*.echarts-report.json`.

Para desinstalar: **Help → About DBeaver → Installation Details → Installed Software**,
selecciona **DBeaver ECharts Presentation** y pulsa **Uninstall**.
Instala una versión posterior desde su ZIP usando el mismo procedimiento.

Las conexiones pertenecen al workspace de DBeaver. Un workspace nuevo necesita
configurar sus conexiones y reasignarlas en los widgets importados. El paquete
no incluye contraseñas ni conexiones del desarrollador.

## Build from source

Prerequisites: Node.js, Git, a JDK 21 or newer, a DBeaver target installation,
and an Eclipse SDK/RCP installation with the Equinox P2 publisher. The publisher
JVM must satisfy the Eclipse SDK's Java requirement; it can differ from the compiler.

```powershell
node scripts/build-p2.js `
  --dbeaver "D:/apps/dbeaver" `
  --eclipse "C:/apps/eclipse" `
  --jdk "C:/Program Files/Microsoft/jdk-21.0.10.7-hotspot" `
  --publisher-jdk "C:/Program Files/Java/jdk-26.0.1"
```

The build compiles all Java sources fresh with `--release 21`, includes the
frontend and third-party notices, pins the feature to the bundle version, and
runs Equinox FeaturesAndBundlesPublisher and CategoryPublisher. It uses a private
Eclipse configuration and does not change your development installation.

Output in ignored `dist/`:

- `dbeaver-echarts-<version>.zip`: installable archive with P2 metadata at its root;
- `dbeaver-echarts-<version>/`: repository for local directory/HTTP installation;
- `dbeaver-echarts-<version>.zip.sha256`: archive checksum;
- `build-info.json` inside the archive: source commit, target, compiler and bytecode level.

The qualifier uses the HEAD commit date and hash. `--qualifier <value>` and
`--output <directory>` can override it. Existing releases are never overwritten.
Build from a clean checkout for a release: a dirty working tree is recorded in
the metadata. JAR entry dates are fixed; P2 publication metadata contains generated
timestamps, so archive hashes may differ between builds.

## Verify a real installation

The Windows test extracts a clean official distribution, installs directly from
the P2 ZIP using DBeaver's director, checks the installed bundle and resources in
an isolated Equinox registry, then uninstalls and reinstalls. It does not start
the graphical workbench or alter an existing DBeaver installation.

```powershell
$env:ECHARTS_COMPILER_JDK = "C:/Program Files/Microsoft/jdk-21.0.10.7-hotspot"
powershell -NoProfile -File scripts/test-p2-install.ps1 `
  -DistributionZip "D:/downloads/dbeaver-ce-26.2.2-windows-x86_64.zip" `
  -RepositoryZip "dist/dbeaver-echarts-<version>.zip" `
  -Destination ".dev/my-installed-test"
```

To also test a version upgrade, add `-PreviousRepositoryZip <older-package.zip>`.
The test installs the exact previous version, replaces it with the requested new
version in one P2 transaction, checks that only the new bundle is registered,
then uninstalls/reinstalls. The installed registry/resources are checked at each
stage. JSON/SQL fixtures in the isolated workspace must retain their SHA-256
checksums throughout. This checks installer preservation, not editor migrations.
A machine-readable `p2-test-result.json` is written on success.

The registry test uses the distribution's bundled Java when present.
`ECHARTS_RUNTIME_JDK` can override it. To check an existing installation without
compiling or repackaging the plugin:

```powershell
node scripts/test-plugin-registry.js "D:/apps/dbeaver" --installed
```

## GitHub Actions packages

`.github/workflows/p2-package.yml` runs on PRs, pushes to `main` and manual dispatch.
It uses a Windows 2022 runner and Java 21, downloads the fixed DBeaver 26.2.2
target and Eclipse SDK 4.40 publisher, verifies their checksums, and runs source,
query-control, DOM and headless Edge label-geometry tests. Tool versions and hashes
are recorded in `dev/ci/p2-toolchain.json`; test dependencies use a committed npm
lockfile. The publisher SDK version is independent of the DBeaver target version.

The previous package is built from the commit in `dev/ci/upgrade-baseline.json`
using a detached worktree. The current package must pass installation, upgrade,
uninstallation, reinstallation, registry/resources and JSON/SQL preservation before
it is uploaded as a downloadable Actions artifact with its checksum and test report.
The baseline currently covers the first installable 0.5.0 package; update it
intentionally when a new release becomes the supported upgrade baseline.

Open **GitHub → Actions → P2 package → successful run → Artifacts** and download
`dbeaver-echarts-p2-windows-<commit>`. Extract that Actions download, then select
the inner `dbeaver-echarts-<version>.zip` in DBeaver's **Add → Archive** dialog.
Artifacts are retained for 14 days. Published release ZIPs and checksums are also
available in GitHub Releases. The workflow does not deploy a public update site.
After Windows passes, Ubuntu installs the same archive and runs Chromium/WebKit
report and dashboard suites. Native SWT and real driver scenarios are tested
separately; they are not a complete driver certification.

This is an unsigned beta package. Signing, a hosted update site, macOS and full
SWT/driver certification remain part of the [release gate](COMPATIBILITY.md).

## Eclipse PDE alternative

Import the plugin, feature and site projects, set the supported DBeaver target,
then open `sites/org.example.dbeaver.echarts.site/category.xml` and choose **Build All**.
For publication, host the complete generated repository as static files. Public
hosting credentials and deployment are not part of the local package build.
