[CmdletBinding()]
param(
    [switch]$Launch
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceProject = Join-Path $projectRoot 'Source Code\VRCNeph.csproj'
$launcherProject = Join-Path $projectRoot 'Launcher\VRCNeph.Launcher.csproj'
$artifacts = Join-Path $projectRoot 'artifacts\release'
$appPublish = Join-Path $artifacts 'app'
$packagePath = Join-Path $artifacts 'VRCNeph-app.zip'
$launcherPublish = Join-Path $artifacts 'launcher'
$rootExe = Join-Path $projectRoot 'VRCNeph.exe'

[xml]$project = Get-Content -LiteralPath $sourceProject
$version = [string](($project.Project.PropertyGroup | Select-Object -First 1).Version)
if ([string]::IsNullOrWhiteSpace($version)) { throw 'VRCNeph.csproj is missing its Version property.' }

New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
foreach ($path in @($appPublish, $launcherPublish)) {
    if (Test-Path -LiteralPath $path) {
        $resolved = (Resolve-Path -LiteralPath $path).Path
        $workspace = (Resolve-Path -LiteralPath $projectRoot).Path
        if (-not $resolved.StartsWith($workspace, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to clean outside VRCNeph: $resolved" }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
Remove-Item -LiteralPath $packagePath -Force -ErrorAction SilentlyContinue

& dotnet publish $sourceProject -c Release -r win-x64 --self-contained false '-p:PublishSingleFile=false' -o $appPublish
if ($LASTEXITCODE -ne 0) { throw "VRCNeph app publish failed with exit code $LASTEXITCODE." }
Set-Content -LiteralPath (Join-Path $appPublish '.vrcneph-package-version') -Value $version -NoNewline -Encoding utf8
Compress-Archive -Path (Join-Path $appPublish '*') -DestinationPath $packagePath -Force

& dotnet publish $launcherProject -c Release -r win-x64 -o $launcherPublish ("-p:Version={0}" -f $version)
if ($LASTEXITCODE -ne 0) { throw "VRCNeph launcher publish failed with exit code $LASTEXITCODE." }
$launcherExe = Join-Path $launcherPublish 'VRCNeph.exe'
if (-not (Test-Path -LiteralPath $launcherExe)) { throw 'The launcher publish did not produce VRCNeph.exe.' }
Copy-Item -LiteralPath $launcherExe -Destination $rootExe -Force

$hash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
@{
    version = $version
    package = 'VRCNeph-app.zip'
    sha256 = $hash
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifacts 'VRCNeph-release.json') -Encoding utf8

Write-Host "Built VRCNeph $version"
Write-Host "Launcher: $rootExe"
Write-Host "Release package: $packagePath"
if ($Launch) { Start-Process -FilePath $rootExe -ArgumentList ('--package "{0}"' -f $packagePath) -WorkingDirectory $projectRoot }
