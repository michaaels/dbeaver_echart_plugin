param(
    [string]$DBeaverPlugins = $env:DBEAVER_PLUGINS
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Assert-Contains([string]$File, [string]$Pattern) {
    if (-not (Select-String -LiteralPath $File -Pattern $Pattern -Quiet)) {
        throw "Compatibility contract missing in ${File}: ${Pattern}"
    }
}

$PluginXml = [xml](Get-Content -Raw -LiteralPath 'plugins\org.example.dbeaver.echarts\plugin.xml')
$Presentation = $PluginXml.plugin.extension | Where-Object { $_.point -eq 'org.jkiss.dbeaver.resultset.presentation' }
$Preferences = $PluginXml.plugin.extension | Where-Object { $_.point -eq 'org.eclipse.ui.preferencePages' }
if (-not $Presentation.presentation) { throw 'Result-set presentation extension is missing' }
if (-not $Preferences.page) { throw 'ECharts preference page extension is missing' }

$Manifest = 'plugins\org.example.dbeaver.echarts\META-INF\MANIFEST.MF'
Assert-Contains $Manifest 'org.eclipse.core.runtime'
Assert-Contains $Manifest 'org.eclipse.core.jobs'
Assert-Contains $Manifest 'org.eclipse.jface'
Assert-Contains $Manifest 'org.eclipse.swt'
Assert-Contains $Manifest 'org.eclipse.ui'
Assert-Contains $Manifest 'org.jkiss.dbeaver.ui.editors.data'
Assert-Contains $Manifest 'org.osgi.service.prefs'

$PresentationJava = 'plugins\org.example.dbeaver.echarts\src\org\example\dbeaver\echarts\EChartsPresentation.java'
$AdapterJava = 'plugins\org.example.dbeaver.echarts\src\org\example\dbeaver\echarts\DBeaverResultSetAdapter.java'
$JobJava = 'plugins\org.example.dbeaver.echarts\src\org\example\dbeaver\echarts\EChartsSnapshotJob.java'
$DashboardJobJava = 'plugins\org.example.dbeaver.echarts\src\org\example\dbeaver\echarts\DashboardQueryJob.java'
$PreferencesJava = 'plugins\org.example.dbeaver.echarts\src\org\example\dbeaver\echarts\EChartsPreferencePage.java'
Assert-Contains $PresentationJava 'new EChartsSnapshotJob'
Assert-Contains $PresentationJava 'IThemeManager'
Assert-Contains $PresentationJava 'dbeaverSaveConfiguration'
Assert-Contains $PresentationJava 'dbeaverBrowserReady'
Assert-Contains $PresentationJava 'onBrowserReady'
Assert-Contains $PresentationJava 'runOnUiThread'
Assert-Contains $PresentationJava 'currentDisplay.asyncExec'
Assert-Contains $PresentationJava 'dbeaverRefreshResult'
Assert-Contains $PresentationJava 'dbeaverImportDashboard'
Assert-Contains $PresentationJava 'dbeaverExportDashboard'
Assert-Contains $PresentationJava 'dbeaverExecuteWidgetQuery'
Assert-Contains $AdapterJava 'copySelection'
Assert-Contains $JobJava 'extends Job'
Assert-Contains $DashboardJobJava 'extends AbstractJob'
Assert-Contains $DashboardJobJava 'isReadOnlyQuery'
Assert-Contains $DashboardJobJava 'DBCExecutionPurpose.USER'
Assert-Contains $PreferencesJava 'IWorkbenchPreferencePage'

$ChartJs = 'plugins\org.example.dbeaver.echarts\web\js\chart.js'
$AnalyticsJs = 'plugins\org.example.dbeaver.echarts\web\js\analytics.js'
Assert-Contains $ChartJs 'setSnapshot'
Assert-Contains $ChartJs 'setTheme'
Assert-Contains $ChartJs 'setConfigurationJson'
Assert-Contains $ChartJs 'dbeaverSaveConfiguration'
Assert-Contains $ChartJs 'dbeaverBrowserReady'
Assert-Contains $ChartJs 'preferredYNames'
Assert-Contains $AnalyticsJs 'useCategoryAxis'
Assert-Contains $AnalyticsJs 'saveAsImage'
Assert-Contains $AnalyticsJs 'dataZoom'
Assert-Contains $AnalyticsJs 'buildGauge'
Assert-Contains $AnalyticsJs 'buildRadar'
Assert-Contains $AnalyticsJs 'buildHeatmap'
Assert-Contains $AnalyticsJs 'buildBoxplot'
Assert-Contains $AnalyticsJs 'buildTreemap'
Assert-Contains $AnalyticsJs 'buildFunnel'
Assert-Contains $AnalyticsJs 'buildMap'
$DashboardJs = 'plugins\org.example.dbeaver.echarts\web\js\dashboard.js'
Assert-Contains $DashboardJs 'createDashboard'
Assert-Contains $DashboardJs 'refreshPolicy'
Assert-Contains $DashboardJs 'dashboard.filters'
Assert-Contains $DashboardJs 'drillDown'

if ($DBeaverPlugins) {
    if (-not (Test-Path -LiteralPath $DBeaverPlugins -PathType Container)) {
        throw "DBeaver plugin directory does not exist: $DBeaverPlugins"
    }
    $DataBundle = Get-ChildItem -LiteralPath $DBeaverPlugins -Filter 'org.jkiss.dbeaver.ui.editors.data_*.jar' |
        Select-Object -First 1
    if (-not $DataBundle) { throw 'DBeaver data editor bundle was not found in the target' }
    $Entries = jar tf $DataBundle.FullName
    foreach ($Entry in @(
        'org/jkiss/dbeaver/ui/controls/resultset/IResultSetPresentation.class',
        'org/jkiss/dbeaver/ui/controls/resultset/IResultSetController.class',
        'org/jkiss/dbeaver/ui/controls/resultset/AbstractPresentation.class',
        'org/jkiss/dbeaver/ui/controls/resultset/ResultSetCopySettings.class'
    )) {
        if ($Entries -notcontains $Entry) { throw "DBeaver target API class is missing: $Entry" }
    }
    Write-Host "DBeaver target API OK: $($DataBundle.Name)"

    $Javac = Get-Command javac -ErrorAction SilentlyContinue
    if ($Javac) {
        $CompileDir = Join-Path ([IO.Path]::GetTempPath()) ('dbeaver-echarts-smoke-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path $CompileDir | Out-Null
        try {
            $Sources = Get-ChildItem -LiteralPath 'plugins\org.example.dbeaver.echarts\src' -Recurse -Filter '*.java' |
                ForEach-Object FullName
            & javac -encoding UTF-8 --release 21 -cp (Join-Path $DBeaverPlugins '*') -d $CompileDir $Sources
            if ($LASTEXITCODE -ne 0) { throw 'Java sources do not compile against the supplied DBeaver target' }
            Write-Host 'Java source compatibility OK: supplied DBeaver target'
            & javac -encoding UTF-8 --release 21 -cp ($CompileDir + ';' + (Join-Path $DBeaverPlugins '*')) -d $CompileDir 'scripts\tests\DashboardFilesTest.java' 'scripts\tests\DashboardQueryControlsTest.java' 'scripts\tests\ReportFilesTest.java' 'scripts\tests\ReportParametersTest.java'
            if ($LASTEXITCODE -ne 0) { throw 'Dashboard file tests failed to compile' }
            & java -cp ($CompileDir + ';' + (Join-Path $DBeaverPlugins '*')) org.example.dbeaver.echarts.DashboardFilesTest
            if ($LASTEXITCODE -ne 0) { throw 'Dashboard file tests failed' }
            & java -cp ($CompileDir + ';' + (Join-Path $DBeaverPlugins '*')) org.example.dbeaver.echarts.DashboardQueryControlsTest
            if ($LASTEXITCODE -ne 0) { throw 'Dashboard query controls failed' }
            & java -cp ($CompileDir + ';' + (Join-Path $DBeaverPlugins '*')) org.example.dbeaver.echarts.ReportFilesTest
            if ($LASTEXITCODE -ne 0) { throw 'Report file tests failed' }
            & java -cp ($CompileDir + ';' + (Join-Path $DBeaverPlugins '*')) org.example.dbeaver.echarts.ReportParametersTest
            if ($LASTEXITCODE -ne 0) { throw 'Report parameter tests failed' }
        } finally {
            $resolved = (Resolve-Path -LiteralPath $CompileDir).Path
            $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
            if (!$resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing cleanup outside temporary directory: $resolved" }
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host 'SKIP: javac is not installed; target source compile was not run'
    }
}

Write-Host 'Compatibility smoke tests OK: extension, bridge and DBeaver API contracts'
