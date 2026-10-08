param(
    [Parameter(Mandatory = $true)][string]$DistributionZip,
    [Parameter(Mandatory = $true)][string]$RepositoryZip,
    [string]$Destination = (Join-Path $PSScriptRoot "../.dev/p2-installed-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))")
)
$ErrorActionPreference = 'Stop'
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw "Destination already exists: $destinationPath. Use a fresh directory." }
$distribution = (Resolve-Path -LiteralPath $DistributionZip).Path
$repository = (Resolve-Path -LiteralPath $RepositoryZip).Path
$repoUri = 'jar:' + ([Uri]$repository).AbsoluteUri + '!/'
Expand-Archive -LiteralPath $distribution -DestinationPath $destinationPath
$product = Join-Path $destinationPath 'dbeaver'
$runtime = Join-Path $product 'jre/bin/java.exe'
$launcher = @(Get-ChildItem -LiteralPath (Join-Path $product 'plugins') -Filter 'org.eclipse.equinox.launcher_*.jar')
if (!(Test-Path -LiteralPath $runtime) -or $launcher.Count -ne 1) { throw 'Expected an official Windows DBeaver ZIP with bundled Java and Equinox launcher' }
$group = 'org.example.dbeaver.echarts.feature.feature.group'
$keyring = Join-Path $destinationPath 'test-secure-storage'
$workspace = Join-Path $destinationPath 'director-workspace'
function Invoke-Director([string[]]$Operation) {
    # Bypass DBeaver's executable wrapper, which appends the user's shared keyring.
    & $runtime '--enable-native-access=ALL-UNNAMED' -jar $launcher[0].FullName -nosplash -consoleLog -install $product -configuration (Join-Path $product 'configuration') -data $workspace '-eclipse.keyring' $keyring -application org.eclipse.equinox.p2.director -repository $repoUri @Operation
    if ($LASTEXITCODE -ne 0) { throw "P2 director failed: $LASTEXITCODE" }
}
function Assert-Installed([bool]$Expected) {
    $info = Get-Content (Join-Path $product 'configuration/org.eclipse.equinox.simpleconfigurator/bundles.info')
    $present = [bool]($info | Where-Object { $_.StartsWith('org.example.dbeaver.echarts,') })
    if ($present -ne $Expected) { throw "Unexpected plugin state in bundles.info: $present" }
}
Invoke-Director @('-installIU', $group, '-tag', 'echarts-install')
Assert-Installed $true
& node (Join-Path $PSScriptRoot 'test-plugin-registry.js') $product --installed
if ($LASTEXITCODE -ne 0) { throw 'Installed bundle registry test failed' }
Invoke-Director @('-uninstallIU', $group, '-tag', 'echarts-uninstall')
Assert-Installed $false
Invoke-Director @('-installIU', $group, '-tag', 'echarts-reinstall')
Assert-Installed $true
Write-Host "P2 archive install, registry/assets, uninstall and reinstall OK: $product"
