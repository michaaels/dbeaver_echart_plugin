$ErrorActionPreference = 'Stop'

$Version = '6.1.0'
$ExpectedBlob = '3b8ed4bcd17f7c838d86d4920af588f1a0aeb389'
$Root = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $Root 'plugins\org.example.dbeaver.echarts\web\js\echarts.min.js'
$Tmp = "$Dest.tmp"
$Url = "https://raw.githubusercontent.com/apache/echarts/$Version/dist/echarts.min.js"

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Dest) | Out-Null
try {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Tmp
    $ActualBlob = (& git hash-object $Tmp).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'git hash-object failed' }
    if ($ActualBlob -ne $ExpectedBlob) {
        throw "ECharts integrity check failed. Expected $ExpectedBlob, got $ActualBlob"
    }
    Move-Item -Force $Tmp $Dest
    Write-Host "Vendored Apache ECharts $Version -> $Dest"
}
finally {
    if (Test-Path $Tmp) { Remove-Item -Force $Tmp }
}
