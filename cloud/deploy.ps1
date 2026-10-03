# First deploy (and later updates) of the relay + dashboard.
#
#   npx wrangler login        (once, opens the browser)
#   .\deploy.ps1 -Room marlon-crew
#
# Creates the D1 database on first run and writes its id into
# wrangler.jsonc, applies migrations, sets ROOMS and SESSION_KEY once
# (kept in ..\..\zugang.txt, outside the repo) and deploys. Prints the
# invite link at the end.
param(
    [string]$Room = "marlon-crew"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$access = Join-Path (Resolve-Path "..\..") "zugang.txt"

if ($Room -notmatch '^[a-z0-9-]{3,32}$') { throw "Raum-Code: 3-32 Zeichen, a-z, 0-9, Bindestrich" }
npx wrangler whoami | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Erst 'npx wrangler login' ausführen." }
if (-not (Test-Path node_modules)) { npm install }

# D1: create once, remember the id.
$config = Get-Content wrangler.jsonc -Raw
if ($config -match '"database_id":\s*"0{8}-0{4}-0{4}-0{4}-0{12}"') {
    $out = npx wrangler d1 create a2dps 2>&1 | Out-String
    $id = [regex]::Match($out, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}').Value
    if (-not $id) { Write-Host $out; throw "Keine database_id in der Ausgabe gefunden." }
    $config = $config -replace '"database_id":\s*"0{8}-0{4}-0{4}-0{4}-0{12}"', "`"database_id`": `"$id`""
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot "wrangler.jsonc"), $config, (New-Object Text.UTF8Encoding $false))
    Write-Host "D1 angelegt: $id"
}
npx wrangler d1 migrations apply a2dps --remote
if ($LASTEXITCODE -ne 0) { throw "Migration fehlgeschlagen" }

$out = npx wrangler deploy 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Write-Host $out; throw "Deploy fehlgeschlagen" }

# Secrets: generated once, never printed to the console.
$rand = { node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))" }
if (-not (Test-Path $access)) {
    $secret = & $rand
    $session = & $rand
    [IO.File]::WriteAllLines($access, [string[]]@("RAUM=$Room", "PASSWORT=$secret", "SESSION_KEY=$session"))
    "${Room}:$secret" | npx wrangler secret put ROOMS
    $session | npx wrangler secret put SESSION_KEY
}
$values = @{}
Get-Content $access | ForEach-Object { $k, $v = $_.TrimStart([char]0xFEFF) -split '=', 2; $values[$k] = $v }

$url = [regex]::Match($out, 'https://[^\s]+\.workers\.dev').Value
if ($url) {
    $invite = "$url/#/join/$($values.RAUM)/$($values.PASSWORT)"
    if (-not (Select-String -Path $access -Pattern '^LINK=' -Quiet)) { [IO.File]::AppendAllText($access, "LINK=$invite`r`n") }
    Write-Host ""
    Write-Host "Dashboard: $url"
    Write-Host "Einladungslink steht in $access (privat weitergeben)."
}
