param([string]$Destination = (Join-Path $PSScriptRoot '../.dev/ci-target'))
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = [IO.Path]::GetFullPath($Destination)
$specification = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../dev/ci/p2-toolchain.json') | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $root | Out-Null
foreach ($name in @('dbeaver', 'eclipse')) {
    $dependency = $specification.$name
    $archive = Join-Path $root $dependency.file
    if (!(Test-Path -LiteralPath $archive)) {
        Write-Host "Downloading $name $($dependency.version)"
        Invoke-WebRequest -UseBasicParsing -Uri $dependency.url -OutFile $archive -TimeoutSec 600
    }
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm $dependency.algorithm).Hash
    if ($hash -ne $dependency.checksum) { throw "Checksum mismatch for $($dependency.file); no extraction performed" }
    $extraction = Join-Path $root $name
    $marker = Join-Path $extraction '.verified-archive'
    if (!(Test-Path -LiteralPath $extraction)) {
        Expand-Archive -LiteralPath $archive -DestinationPath $extraction
        Set-Content -LiteralPath $marker -Value $hash -Encoding ASCII
    } elseif (!(Test-Path -LiteralPath $marker) -or (Get-Content -Raw -LiteralPath $marker).Trim() -ne $hash) {
        throw "Incomplete or different extraction at $extraction; use a fresh Destination"
    }
    if (!(Test-Path -LiteralPath (Join-Path $extraction "$($dependency.home)/configuration/config.ini"))) { throw "Extracted $name configuration is missing" }
    Write-Host "Verified $name $($dependency.version): $(Join-Path $extraction $dependency.home)"
}
