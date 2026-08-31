[CmdletBinding()]
param(
    [switch]$Prerelease,
    [switch]$Launch
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'Build-VRCNeph.ps1') -Launch:$Launch

$manifestPath = Join-Path $projectRoot 'artifacts\release\VRCNeph-release.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$tag = "v$($manifest.version)"
$launcher = Join-Path $projectRoot 'VRCNeph.exe'
$package = Join-Path $projectRoot 'artifacts\release\VRCNeph-app.zip'

& git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Git whitespace validation failed. Release was not created.' }

$exists = $false
& gh release view $tag --json tagName | Out-Null
if ($LASTEXITCODE -eq 0) { $exists = $true }

if ($exists) {
    & gh release upload $tag $launcher $package $manifestPath --clobber
    if ($LASTEXITCODE -ne 0) { throw "GitHub Release $tag assets were not updated." }
    $editArgs = @('release', 'edit', $tag, '--title', "VRCNeph $($manifest.version)")
    if ($Prerelease) { $editArgs += '--prerelease' }
    & gh @editArgs
    if ($LASTEXITCODE -ne 0) { throw "GitHub Release $tag metadata was not updated." }
} else {
    $releaseArgs = @('release', 'create', $tag, $launcher, $package, $manifestPath, '--title', "VRCNeph $($manifest.version)", '--generate-notes')
    if ($Prerelease) { $releaseArgs += '--prerelease' }
    & gh @releaseArgs
    if ($LASTEXITCODE -ne 0) { throw "GitHub Release $tag was not created." }
}

& gh release view $tag --json tagName,name,url,assets
if ($LASTEXITCODE -ne 0) { throw "GitHub Release $tag was created but could not be verified." }
