[CmdletBinding()]
param(
    [switch]$Prerelease,
    [switch]$Launch
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'Build-VRCNeph.ps1') -Launch:$Launch

[xml]$project = Get-Content -LiteralPath (Join-Path $projectRoot 'Source Code\VRCNeph.csproj')
$version = [string](($project.Project.PropertyGroup | Select-Object -First 1).Version)
$tag = "v$version"
$launcher = Join-Path $projectRoot 'VRCNeph.exe'

& git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Git whitespace validation failed. Release was not created.' }

$exists = $false
& gh release view $tag --json tagName | Out-Null
if ($LASTEXITCODE -eq 0) { $exists = $true }

if ($exists) {
    $release = & gh release view $tag --json assets | ConvertFrom-Json
    foreach ($obsoleteAsset in @($release.assets | Where-Object { $_.name -in @('VRCNeph-app.zip', 'VRCNeph-release.json', 'VRCNephAssets.zip') })) {
        & gh release delete-asset $tag $obsoleteAsset.name --yes
        if ($LASTEXITCODE -ne 0) { throw "Obsolete GitHub Release asset $($obsoleteAsset.name) could not be removed." }
    }
    & gh release upload $tag $launcher --clobber
    if ($LASTEXITCODE -ne 0) { throw "GitHub Release $tag assets were not updated." }
    $editArgs = @('release', 'edit', $tag, '--title', "VRCNeph $version")
    if ($Prerelease) { $editArgs += '--prerelease' }
    & gh @editArgs
    if ($LASTEXITCODE -ne 0) { throw "GitHub Release $tag metadata was not updated." }
} else {
    $releaseArgs = @('release', 'create', $tag, $launcher, '--title', "VRCNeph $version", '--generate-notes')
    if ($Prerelease) { $releaseArgs += '--prerelease' }
    & gh @releaseArgs
    if ($LASTEXITCODE -ne 0) { throw "GitHub Release $tag was not created." }
}

& gh release view $tag --json tagName,name,url,assets
if ($LASTEXITCODE -ne 0) { throw "GitHub Release $tag was created but could not be verified." }
