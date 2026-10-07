param(
    [string]$DBeaverPlugins = $env:DBEAVER_PLUGINS
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$XmlFiles = @(
    'plugins\org.example.dbeaver.echarts\plugin.xml',
    'features\org.example.dbeaver.echarts.feature\feature.xml',
    'plugins\org.example.dbeaver.echarts\.project',
    'plugins\org.example.dbeaver.echarts\.classpath',
    'features\org.example.dbeaver.echarts.feature\.project',
    'sites\org.example.dbeaver.echarts.site\.project',
    'sites\org.example.dbeaver.echarts.site\category.xml'
)
foreach ($File in $XmlFiles) {
    [xml](Get-Content -Raw -LiteralPath $File) | Out-Null
    Write-Host "XML OK: $File"
}

$FeatureVersion = ([xml](Get-Content -Raw -LiteralPath 'features\org.example.dbeaver.echarts.feature\feature.xml')).feature.version
$SiteVersion = ([xml](Get-Content -Raw -LiteralPath 'sites\org.example.dbeaver.echarts.site\category.xml')).site.feature.version
$ManifestVersion = ([regex]::Match(
    (Get-Content -Raw -LiteralPath 'plugins\org.example.dbeaver.echarts\META-INF\MANIFEST.MF'),
    '(?m)^Bundle-Version:\s*(\S+)'
)).Groups[1].Value
if ($FeatureVersion -ne $ManifestVersion -or $SiteVersion -ne $FeatureVersion) {
    throw "Version mismatch: bundle=$ManifestVersion feature=$FeatureVersion site=$SiteVersion"
}
Write-Host "Version alignment OK: $FeatureVersion"

$Node = Get-Command node -ErrorAction SilentlyContinue
if ($Node) {
    $JavaScriptFiles = Get-ChildItem -LiteralPath 'plugins\org.example.dbeaver.echarts\web\js' -Filter '*.js' |
        Where-Object { $_.Name -ne 'echarts.min.js' }
    foreach ($JavaScriptFile in $JavaScriptFiles) {
        & node --check $JavaScriptFile.FullName
        if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax validation failed: $($JavaScriptFile.Name)" }
        Write-Host "JavaScript OK: $($JavaScriptFile.Name)"
    }
    & node 'scripts\test-analytics.js'
    if ($LASTEXITCODE -ne 0) { throw 'Analytical chart option tests failed' }
    & node 'scripts\test-dashboard.js'
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard schema tests failed' }
    if (Test-Path -LiteralPath '.dev\browser-tests\node_modules\linkedom') {
        & node 'scripts\test-dashboard-bridge.js'
        if ($LASTEXITCODE -ne 0) { throw 'Dashboard DOM/bridge tests failed' }
    } else {
        Write-Host 'SKIP: DOM/bridge tests require npm install --prefix .dev/browser-tests linkedom@0.18.13'
    }
} else {
    Write-Host 'SKIP: node is not installed'
}

$Javac = Get-Command javac -ErrorAction SilentlyContinue
if ($Javac) {
    $Tmp = Join-Path ([IO.Path]::GetTempPath()) ('dbeaver-echarts-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
    try {
        & javac -d $Tmp 'plugins\org.example.dbeaver.echarts\src\org\example\dbeaver\echarts\JsonWriter.java'
        if ($LASTEXITCODE -ne 0) { throw 'JsonWriter.java compilation failed' }
        Write-Host 'Java OK (standalone): JsonWriter.java'
    } finally {
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Tmp
    }
} else {
    Write-Host 'SKIP: javac is not installed'
}

$WebFiles = Get-ChildItem -Recurse -File 'plugins\org.example.dbeaver.echarts\web' |
    Where-Object { $_.Name -ne 'echarts.min.js' }
$NetworkMatches = $WebFiles | Select-String -Pattern 'https?://' -CaseSensitive:$false
if ($NetworkMatches) {
    $NetworkMatches | ForEach-Object { Write-Host $_ }
    throw 'Browser frontend contains a network URL'
}
Write-Host 'Offline frontend OK: no HTTP(S) URLs in web/'

$ECharts = 'plugins\org.example.dbeaver.echarts\web\js\echarts.min.js'
if (Test-Path -LiteralPath $ECharts) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'git is required to verify echarts.min.js'
    }
    $Expected = '3b8ed4bcd17f7c838d86d4920af588f1a0aeb389'
    $Actual = (& git hash-object $ECharts).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'git hash-object failed' }
    if ($Actual -ne $Expected) { throw "Wrong ECharts blob. Expected $Expected, got $Actual" }
    Write-Host "ECharts OK: Git blob $Actual"
} else {
    Write-Host 'ECharts pending: run scripts\vendor-echarts.ps1'
}

$LegalFiles = @(
    'plugins\org.example.dbeaver.echarts\third-party\echarts\LICENSE',
    'plugins\org.example.dbeaver.echarts\third-party\echarts\NOTICE',
    'plugins\org.example.dbeaver.echarts\third-party\echarts\licenses\LICENSE-d3',
    'plugins\org.example.dbeaver.echarts\third-party\world-map\LICENSE',
    'plugins\org.example.dbeaver.echarts\third-party\world-map\README.md'
)
foreach ($File in $LegalFiles) {
    if (-not (Test-Path -LiteralPath $File)) { throw "Missing $File" }
    if ((Get-Item -LiteralPath $File).Length -eq 0) { throw "Empty $File" }
}
Write-Host 'Third-party notices OK'

$WorldMap = 'plugins\org.example.dbeaver.echarts\web\js\world-map.js'
if (-not (Test-Path -LiteralPath $WorldMap)) { throw 'World map is missing; run scripts\vendor-world-map.ps1' }
if (-not (Select-String -LiteralPath $WorldMap -SimpleMatch "registerMap('world'" -Quiet)) {
    throw 'World map asset does not register the expected map'
}
$ExpectedWorldMapHash = '6DB6D347F43ECF7D1E83AABE468E35ABA886249F12B0BD89130BF8E6FDAC756B'
$ActualWorldMapHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $WorldMap).Hash
if ($ActualWorldMapHash -ne $ExpectedWorldMapHash) {
    throw "Wrong world map asset. Expected $ExpectedWorldMapHash, got $ActualWorldMapHash"
}
Write-Host "World map asset OK: SHA-256 $ActualWorldMapHash"

if ($DBeaverPlugins) {
    & (Join-Path $PSScriptRoot 'smoke-tests.ps1') -DBeaverPlugins $DBeaverPlugins
} else {
    & (Join-Path $PSScriptRoot 'smoke-tests.ps1')
}
