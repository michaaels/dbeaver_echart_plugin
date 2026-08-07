$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$XmlFiles = @(
    'plugins\org.example.dbeaver.echarts\plugin.xml',
    'features\org.example.dbeaver.echarts.feature\feature.xml',
    'plugins\org.example.dbeaver.echarts\.project',
    'plugins\org.example.dbeaver.echarts\.classpath',
    'features\org.example.dbeaver.echarts.feature\.project'
)
foreach ($File in $XmlFiles) {
    [xml](Get-Content -Raw -LiteralPath $File) | Out-Null
    Write-Host "XML OK: $File"
}

$Node = Get-Command node -ErrorAction SilentlyContinue
if ($Node) {
    & node --check 'plugins\org.example.dbeaver.echarts\web\js\chart.js'
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax validation failed' }
    Write-Host 'JavaScript OK: chart.js'
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
    'plugins\org.example.dbeaver.echarts\third-party\echarts\licenses\LICENSE-d3'
)
foreach ($File in $LegalFiles) {
    if (-not (Test-Path -LiteralPath $File)) { throw "Missing $File" }
    if ((Get-Item -LiteralPath $File).Length -eq 0) { throw "Empty $File" }
}
Write-Host 'Third-party notices OK'
