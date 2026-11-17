param(
  [string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin',
  [ValidateSet(55439)][int]$Port = 55439
)
$ErrorActionPreference = 'Stop'
if ($Port -in @(5432,54329,3100,8787)) { throw 'Use a dedicated test port.' }
$officeAppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$officeTestRoot = Join-Path $officeAppRoot ('tmp\office-verification-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $officeTestRoot) { throw 'Test directory already exists.' }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw 'Test port is occupied; existing services will not be changed.' }
New-Item -ItemType Directory -Path $officeTestRoot | Out-Null
$officeData = Join-Path $officeTestRoot 'pgdata'
$officeStarted = $false
$officeOldDb = $env:DATABASE_URL
try {
  & (Join-Path $PostgresBin 'initdb.exe') -D $officeData -U office_test --auth=trust --encoding=UTF8 --no-locale
  if ($LASTEXITCODE) { throw 'Test initdb failed.' }
  & (Join-Path $PostgresBin 'pg_ctl.exe') -D $officeData -l (Join-Path $officeTestRoot 'postgres.log') -o "-h 127.0.0.1 -p $Port" -w start
  if ($LASTEXITCODE) { throw 'Test PostgreSQL start failed.' }
  $officeStarted = $true
  foreach ($officeDatabase in @('enztronic_office_test','enztronic_office_access_test','enztronic_office_role_test','enztronic_office_dashboard_test','enztronic_office_live_test')) {
    & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $Port -U office_test $officeDatabase
    if ($LASTEXITCODE) { throw 'Test createdb failed.' }
  }
  $env:OFFICE_TEST_DATABASE_URL = "postgresql://office_test@127.0.0.1:$Port/enztronic_office_test"
  $env:OFFICE_ACCESS_TEST_DATABASE_URL = "postgresql://office_test@127.0.0.1:$Port/enztronic_office_access_test"
  $env:OFFICE_ROLE_TEST_DATABASE_URL = "postgresql://office_test@127.0.0.1:$Port/enztronic_office_role_test"
  $env:OFFICE_DASHBOARD_TEST_DATABASE_URL = "postgresql://office_test@127.0.0.1:$Port/enztronic_office_dashboard_test"
  $env:OFFICE_LIVE_TEST_DATABASE_URL = "postgresql://office_test@127.0.0.1:$Port/enztronic_office_live_test"
  Push-Location $officeAppRoot
  try { npm test; if ($LASTEXITCODE) { throw 'Office tests failed.' } }
  finally { Pop-Location }
} finally {
  if ($officeStarted) { & (Join-Path $PostgresBin 'pg_ctl.exe') -D $officeData -m fast -w stop }
  $env:DATABASE_URL = $officeOldDb
  Remove-Item Env:OFFICE_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:OFFICE_ACCESS_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:OFFICE_ROLE_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:OFFICE_DASHBOARD_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:OFFICE_LIVE_TEST_DATABASE_URL -ErrorAction SilentlyContinue
}
# Keep logs/data for inspection. Cleanup is explicit and must stay in this test root.
Write-Output "Verification files retained at $officeTestRoot"
