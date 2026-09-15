param(
    [string]$Version = 'apache-echarts-examples-gh-pages'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Uri = 'https://raw.githubusercontent.com/apache/echarts-examples/gh-pages/public/data/asset/geo/world.json'
$ExpectedHash = '049B334579E5A42D5D16C72D014D380E048E39FC1504049F212ACB589484D2FA'
$Temporary = Join-Path ([IO.Path]::GetTempPath()) ('echarts-world-' + [Guid]::NewGuid().ToString('N') + '.json')
$Destination = Join-Path $Root 'plugins\org.example.dbeaver.echarts\web\js\world-map.js'

try {
    Invoke-WebRequest -Uri $Uri -OutFile $Temporary -UseBasicParsing
    $ActualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Temporary).Hash
    if ($ActualHash -ne $ExpectedHash) {
        throw "Unexpected world map hash. Expected $ExpectedHash, got $ActualHash"
    }
    $GeoJson = Get-Content -Raw -LiteralPath $Temporary
    $Generated = "(() => { 'use strict'; window.echarts.registerMap('world', $GeoJson); })();`n"
    [IO.File]::WriteAllText($Destination, $Generated, [Text.UTF8Encoding]::new($false))
    Write-Host "Vendored world map: $Version ($ActualHash)"
} finally {
    Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue
}
