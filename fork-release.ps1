# Fork release: builds the MSI and publishes it with latest.json as a GitHub
# release on maarloms/A2Tools-DPS-Meter. The app's update check
# (public/src/js/checkRelease.js) reads releases/latest/download/latest.json.
#
#   1. Raise "version" in src-tauri/tauri.conf.json
#   2. .\fork-release.ps1 -Notes "Was ist neu"
#
# Needs: Rust, Node, gh (logged in). -DryRun builds and stages without publishing.
param(
    [string]$Notes = "",
    [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$Repo = "maarloms/A2Tools-DPS-Meter"
Set-Location $PSScriptRoot
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

$version = (Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
Write-Host "Release $tag"

if (-not $DryRun) {
    if (git status --porcelain -- . ':!src-tauri/Cargo.toml' ':!cloud') { throw "Uncommitted changes: commit first." }
    if (gh release view $tag --repo $Repo 2>$null) { throw "$tag already exists: raise the version." }
}

Get-Process a2tools-dps-meter, "AION 2 DPS Meter" -ErrorAction SilentlyContinue | Stop-Process -Force
npx tauri build --bundles msi
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

$msi = Get-ChildItem "src-tauri\target\release\bundle\msi\*_${version}_x64_*.msi" | Select-Object -First 1
if (-not $msi) { throw "No MSI for $version found" }

# GitHub turns spaces in asset names into dots; give it a clean name.
$stage = Join-Path $env:TEMP "aion2-dps-release-$version"
New-Item -ItemType Directory -Force $stage | Out-Null
$asset = "AION2-DPS-Meter_${version}_x64.msi"
Copy-Item $msi.FullName (Join-Path $stage $asset) -Force
[ordered]@{
    version = $version
    msiUrl  = "https://github.com/$Repo/releases/download/$tag/$asset"
    notes   = $Notes
} | ConvertTo-Json | ForEach-Object {
    # No BOM: the app's JSON.parse rejects one, and Windows PowerShell 5 writes it.
    [IO.File]::WriteAllText((Join-Path $stage "latest.json"), $_, (New-Object Text.UTF8Encoding $false))
}

if ($DryRun) { Write-Host "Dry run: staged in $stage"; exit 0 }

$body = if ($Notes) { $Notes } else { "AION 2 DPS Meter $version" }
gh release create $tag (Join-Path $stage $asset) (Join-Path $stage "latest.json") `
    --repo $Repo --target fork/main --title "AION 2 DPS Meter $version" --notes $body
if ($LASTEXITCODE -ne 0) { throw "gh release failed" }
Write-Host "Published: https://github.com/$Repo/releases/tag/$tag"
