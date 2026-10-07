param(
    [Parameter(Mandatory = $true)][string]$DBeaverHome,
    [string]$JdkHome = 'C:\Program Files\Microsoft\jdk-21.0.10.7-hotspot',
    [string]$RuntimeJdkHome = 'C:\Program Files\Java\jdk-26.0.1',
    [switch]$SkipCompile
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$DBeaverPath = (Resolve-Path -LiteralPath $DBeaverHome).Path
$JdkPath = (Resolve-Path -LiteralPath $JdkHome).Path
$RuntimeJdkPath = (Resolve-Path -LiteralPath $RuntimeJdkHome).Path
$Plugins = Join-Path $DBeaverPath 'plugins'
$Javac = Join-Path $JdkPath 'bin\javac.exe'
if (-not (Test-Path -LiteralPath (Join-Path $DBeaverPath 'configuration\config.ini'))) {
    throw 'DBeaverHome must point to an unpacked DBeaver installation.'
}
if (-not (Test-Path -LiteralPath $Javac)) { throw 'JdkHome must contain bin\javac.exe.' }
$Output = Join-Path $Root '.dev\classes'
New-Item -ItemType Directory -Path $Output -Force | Out-Null
$Sources = Get-ChildItem -LiteralPath (Join-Path $Root 'plugins\org.example.dbeaver.echarts\src') -Recurse -Filter '*.java' |
    ForEach-Object FullName
if (-not $SkipCompile) {
    & $Javac -encoding UTF-8 --release 21 -cp (Join-Path $Plugins '*') -d $Output $Sources
    if ($LASTEXITCODE -ne 0) { throw 'Plugin does not compile against this DBeaver installation.' }
    Write-Host 'Java 21 compilation OK: all plugin sources'
}
$Escape = { param([string]$Value) [Security.SecurityElement]::Escape($Value) }
$TargetPath = (& $Escape $DBeaverPath).Replace('\', '/')
$JreName = Split-Path -Leaf $JdkPath
$JreContainer = & $Escape "org.eclipse.jdt.launching.JRE_CONTAINER/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/$JreName"
$RuntimeJreName = Split-Path -Leaf $RuntimeJdkPath
$RuntimeContainer = & $Escape "org.eclipse.jdt.launching.JRE_CONTAINER/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/$RuntimeJreName"
$Dev = Join-Path $Root 'dev'
$Utf8 = [Text.UTF8Encoding]::new($false)
$Target = @"
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?pde version="3.8"?>
<target name="DBeaver local - ECharts" sequenceNumber="1">
  <locations><location path="$TargetPath" type="Profile"/></locations>
  <environment><os>win32</os><ws>win32</ws><arch>x86_64</arch></environment>
  <targetJRE path="$JreContainer"/>
</target>
"@
# JREs are registered in Eclipse under their directory name by default.
# If your Installed JRE has another name, select JavaSE-21 on the launch Main tab.
$Launch = @'
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<launchConfiguration type="org.eclipse.pde.ui.RuntimeWorkbench">
  <booleanAttribute key="append.args" value="true"/>
  <booleanAttribute key="automaticAdd" value="true"/>
  <booleanAttribute key="automaticValidate" value="true"/>
  <booleanAttribute key="default" value="true"/>
  <booleanAttribute key="clearws" value="false"/>
  <booleanAttribute key="askclear" value="true"/>
  <booleanAttribute key="clearConfig" value="true"/>
  <booleanAttribute key="useDefaultConfig" value="true"/>
  <booleanAttribute key="useDefaultConfigArea" value="true"/>
  <booleanAttribute key="useProduct" value="true"/>
  <stringAttribute key="product" value="org.jkiss.dbeaver.ui.app.standalone.product"/>
  <stringAttribute key="application" value="org.jkiss.dbeaver.ui.app.standalone.standalone"/>
  <stringAttribute key="location" value="${workspace_loc}/../dbeaver-echarts-runtime"/>
  <stringAttribute key="org.eclipse.jdt.launching.JRE_CONTAINER" value="__JRE__"/>
  <stringAttribute key="org.eclipse.jdt.launching.WORKING_DIRECTORY" value="__TARGET__"/>
  <stringAttribute key="org.eclipse.jdt.launching.PROGRAM_ARGUMENTS" value="-consoleLog"/>
  <stringAttribute key="org.eclipse.jdt.launching.VM_ARGUMENTS" value="-Xms128m -Xmx1024m -Dfile.encoding=UTF-8 -Djava.library.path=&quot;__TARGET__&quot; --enable-native-access=ALL-UNNAMED --add-opens=java.base/java.lang=ALL-UNNAMED --add-opens=java.base/java.nio=ALL-UNNAMED --add-opens=java.base/java.util=ALL-UNNAMED"/>
</launchConfiguration>
'@
$Launch = $Launch.Replace('__JRE__', $RuntimeContainer).Replace('__TARGET__', $TargetPath)
[IO.File]::WriteAllText((Join-Path $Dev 'DBeaver-local.target'), $Target, $Utf8)
[IO.File]::WriteAllText((Join-Path $Dev 'DBeaver-ECharts-local.launch'), $Launch, $Utf8)
Write-Host "Target: $Dev\DBeaver-local.target"
Write-Host "Launch: $Dev\DBeaver-ECharts-local.launch"
Write-Host "Import dev/, plugins/, features/ and sites/ as Eclipse projects; open the target and click Set as Active Target Platform."
