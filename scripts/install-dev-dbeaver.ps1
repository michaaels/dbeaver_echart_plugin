param([string]$Version = 'latest')
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Api = if ($Version -eq 'latest') { 'https://api.github.com/repos/dbeaver/dbeaver/releases/latest' } else { "https://api.github.com/repos/dbeaver/dbeaver/releases/tags/$Version" }
$Release = Invoke-RestMethod -Uri $Api -Headers @{ 'User-Agent' = 'dbeaver-echarts-development' }
if ($Release.prerelease -or $Release.draft) { throw 'Expected a stable DBeaver release.' }
$Asset = $Release.assets | Where-Object name -Like '*windows-x86_64.zip' | Select-Object -First 1
if (-not $Asset -or $Asset.digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Windows ZIP or official SHA-256 digest is missing.' }
$Downloads = Join-Path $Root '.dev\downloads'
$Install = Join-Path $Root ('.dev\dbeaver-' + $Release.tag_name)
$Archive = Join-Path $Downloads $Asset.name
New-Item -ItemType Directory -Force -Path $Downloads | Out-Null
Write-Host "Official DBeaver Community release: $($Release.tag_name)"
if (-not (Test-Path -LiteralPath $Archive)) {
    & curl.exe --fail --location --retry 3 --silent --show-error --output $Archive $Asset.browser_download_url
    if ($LASTEXITCODE -ne 0) { throw 'DBeaver download failed.' }
}
$Actual = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Actual -ne $Asset.digest.Substring(7)) { throw 'DBeaver archive SHA-256 does not match the official release.' }
Write-Host "SHA-256 verified: $Actual"
if (-not (Test-Path -LiteralPath (Join-Path $Install 'dbeaver\dbeaver.exe'))) {
    Expand-Archive -LiteralPath $Archive -DestinationPath $Install
}
$Installation = Join-Path $Install 'dbeaver'
& (Join-Path $PSScriptRoot 'configure-eclipse.ps1') -DBeaverHome $Installation
