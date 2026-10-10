param(
    [Parameter(Mandatory = $true)][string]$DistributionZip,
    [Parameter(Mandatory = $true)][string]$RepositoryZip,
    [string]$PreviousRepositoryZip,
    [string]$Destination = (Join-Path $PSScriptRoot "../.dev/p2-installed-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))")
)
$ErrorActionPreference = 'Stop'
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw "Destination already exists: $destinationPath. Use a fresh directory." }
$distribution = (Resolve-Path -LiteralPath $DistributionZip).Path
$repository = (Resolve-Path -LiteralPath $RepositoryZip).Path
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Read-Package([string]$File) {
    $zip = [IO.Compression.ZipFile]::OpenRead($File)
    try {
        $entry = $zip.GetEntry('build-info.json')
        if (!$entry) { throw "Package has no build-info.json: $File" }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $metadata = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($metadata.version -notmatch '^\d+\.\d+\.\d+\.[A-Za-z0-9_-]+$') { throw 'Invalid package version' }
        if ($metadata.installIU -ne 'org.example.dbeaver.echarts.feature.feature.group') { throw 'Unexpected feature ID' }
        return $metadata
    } finally { $zip.Dispose() }
}
$current = Read-Package $repository
$previousFile = $null
if ($PreviousRepositoryZip) {
    $previousFile = (Resolve-Path -LiteralPath $PreviousRepositoryZip).Path
    $previous = Read-Package $previousFile
    $before = $previous.version.Split('.', 4)
    $after = $current.version.Split('.', 4)
    $baseComparison = ([version]($after[0..2] -join '.')).CompareTo([version]($before[0..2] -join '.'))
    if ($baseComparison -lt 0 -or ($baseComparison -eq 0 -and [StringComparer]::Ordinal.Compare($after[3], $before[3]) -le 0)) {
        throw 'The upgrade package must have a greater OSGi version than the previous package'
    }
}
Expand-Archive -LiteralPath $distribution -DestinationPath $destinationPath
$product = Join-Path $destinationPath 'dbeaver'
$runtime = Join-Path $product 'jre/bin/java.exe'
$launcher = @(Get-ChildItem -LiteralPath (Join-Path $product 'plugins') -Filter 'org.eclipse.equinox.launcher_*.jar')
if (!(Test-Path -LiteralPath $runtime) -or $launcher.Count -ne 1) { throw 'Expected an official Windows DBeaver ZIP with bundled Java and Equinox launcher' }
$group = 'org.example.dbeaver.echarts.feature.feature.group'
$keyring = Join-Path $destinationPath 'test-secure-storage'
$workspace = Join-Path $destinationPath 'director-workspace'
function Invoke-Director([string]$Archive, [string[]]$Operation) {
    $repoUri = 'jar:' + ([Uri]$Archive).AbsoluteUri + '!/'
    # Bypass DBeaver's executable wrapper, which appends the user's shared keyring.
    & $runtime '--enable-native-access=ALL-UNNAMED' -jar $launcher[0].FullName -nosplash -consoleLog -install $product -configuration (Join-Path $product 'configuration') -data $workspace '-eclipse.keyring' $keyring -application org.eclipse.equinox.p2.director -repository $repoUri @Operation
    if ($LASTEXITCODE -ne 0) { throw "P2 director failed: $LASTEXITCODE" }
}
function Assert-Installed([string]$Version) {
    $info = Get-Content (Join-Path $product 'configuration/org.eclipse.equinox.simpleconfigurator/bundles.info')
    $installed = @($info | Where-Object { $_.StartsWith('org.example.dbeaver.echarts,') })
    if (!$Version) {
        if ($installed.Count -ne 0) { throw 'Plugin is still installed after uninstall' }
    } elseif ($installed.Count -ne 1 -or $installed[0].Split(',')[1] -ne $Version) {
        throw "Expected exactly one installed bundle with version $Version"
    }
}
function Assert-Registry {
    & node (Join-Path $PSScriptRoot 'test-plugin-registry.js') $product --installed
    if ($LASTEXITCODE -ne 0) { throw 'Installed bundle registry test failed' }
}
# Store fixtures in the isolated workspace; never copy the user's database credentials.
$dashboardDirectory = Join-Path $workspace 'General/Dashboards/ECharts'
New-Item -ItemType Directory -Force -Path $dashboardDirectory | Out-Null
$savedFiles = @{}
foreach ($name in @('control-ventas.echarts-dashboard.json', 'control-ventas.echarts-dashboard.sql')) {
    $fixture = Join-Path $PSScriptRoot "../dev/dashboards/$name"
    $saved = Join-Path $dashboardDirectory $name
    Copy-Item -LiteralPath $fixture -Destination $saved
    $savedFiles[$saved] = (Get-FileHash -LiteralPath $saved -Algorithm SHA256).Hash
}
function Assert-Preserved {
    foreach ($file in $savedFiles.Keys) {
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $savedFiles[$file]) { throw "Saved dashboard/report changed: $file" }
    }
}
$reportDirectory = Join-Path $workspace 'General/Reports/ECharts'
New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null
foreach ($name in @('daily-sales.echarts-report.json', 'daily-sales.echarts-report.sql')) {
    $saved = Join-Path $reportDirectory $name
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "../dev/reports/$name") -Destination $saved
    $savedFiles[$saved] = (Get-FileHash -LiteralPath $saved -Algorithm SHA256).Hash
}
if ($previousFile) {
    Invoke-Director $previousFile @('-installIU', "$group/$($previous.version)", '-tag', 'echarts-previous')
    Assert-Installed $previous.version
    Assert-Registry
    # One P2 transaction replaces the old root with the requested new root.
    Invoke-Director $repository @('-uninstallIU', "$group/$($previous.version)", '-installIU', "$group/$($current.version)", '-tag', 'echarts-upgrade')
} else {
    Invoke-Director $repository @('-installIU', "$group/$($current.version)", '-tag', 'echarts-install')
}
Assert-Installed $current.version
Assert-Registry
Assert-Preserved
Invoke-Director $repository @('-uninstallIU', $group, '-tag', 'echarts-uninstall')
Assert-Installed ''
Assert-Preserved
Invoke-Director $repository @('-installIU', "$group/$($current.version)", '-tag', 'echarts-reinstall')
Assert-Installed $current.version
Assert-Registry
Assert-Preserved
$summary = [ordered]@{ current = $current.version; previous = $(if ($previousFile) { $previous.version } else { $null }); installed = $true; upgraded = [bool]$previousFile; uninstalled = $true; reinstalled = $true; registry = $true; dashboardFilesPreserved = $true; reportFilesPreserved = $true }
$summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destinationPath 'p2-test-result.json') -Encoding UTF8
Write-Host "P2 lifecycle, installed registry/assets and dashboard preservation OK: $product"
