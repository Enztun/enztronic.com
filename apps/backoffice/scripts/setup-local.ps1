[CmdletBinding()]
param(
    [switch]$SkipNodeInstall,
    [switch]$SkipPythonInstall
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$appRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $appRoot '.runtime'
$dataDir = Join-Path $runtimeRoot 'postgres-data'
$logDir = Join-Path $runtimeRoot 'logs'
$postgresLog = Join-Path $logDir 'postgres.log'
$adminPasswordFile = Join-Path $runtimeRoot 'postgres-admin-password.txt'
$appPasswordFile = Join-Path $runtimeRoot 'postgres-app-password.txt'
$envFile = Join-Path $appRoot '.env.local'
$developmentEnvFile = Join-Path $appRoot '.env.development.local'
$postgresBin = 'C:\Program Files\PostgreSQL\17\bin'
$postgresPort = 54329
$databaseName = 'enztronic_backoffice'
$adminRole = 'enztronic_admin'
$appRole = 'enztronic_app'

function New-LocalSecret {
    $bytes = [byte[]]::new(36)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Protect-LocalFile([string]$Path) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $Path '/inheritance:r' "/grant:r" "${identity}:F" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not restrict permissions on $Path"
    }
}

function Invoke-PostgresTool([string]$Name, [string[]]$Arguments) {
    $tool = Join-Path $postgresBin "$Name.exe"
    if (-not (Test-Path -LiteralPath $tool)) {
        throw "Missing PostgreSQL tool: $tool"
    }

    & $tool @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path -LiteralPath $postgresBin)) {
    throw 'PostgreSQL 17 is required at C:\Program Files\PostgreSQL\17\bin.'
}

New-Item -ItemType Directory -Force -Path $runtimeRoot, $logDir | Out-Null

$clusterExists = Test-Path -LiteralPath (Join-Path $dataDir 'PG_VERSION')
if ($clusterExists -and ((-not (Test-Path $adminPasswordFile)) -or (-not (Test-Path $appPasswordFile)))) {
    throw 'The database cluster exists but its local credential file is missing. Stop here rather than resetting an unknown database.'
}

if (-not $clusterExists) {
    if (Test-Path -LiteralPath $dataDir) {
        $existingEntries = @(Get-ChildItem -LiteralPath $dataDir -Force -ErrorAction SilentlyContinue)
        if ($existingEntries.Count -gt 0) {
            throw "Refusing to initialize the non-empty directory $dataDir"
        }
    }

    $adminPassword = New-LocalSecret
    $appPassword = New-LocalSecret
    [IO.File]::WriteAllText($adminPasswordFile, $adminPassword, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($appPasswordFile, $appPassword, [Text.UTF8Encoding]::new($false))
    Protect-LocalFile $adminPasswordFile
    Protect-LocalFile $appPasswordFile

    Invoke-PostgresTool 'initdb' @(
        '-D', $dataDir,
        '-U', $adminRole,
        '--encoding=UTF8',
        '--locale=C',
        '--auth-local=scram-sha-256',
        '--auth-host=scram-sha-256',
        "--pwfile=$adminPasswordFile"
    )

    $postgresConfig = Join-Path $dataDir 'postgresql.conf'
    $localConfig = @"

# Enztronic back-office: local access only.
listen_addresses = '127.0.0.1'
port = $postgresPort
max_connections = 30
shared_buffers = '128MB'
timezone = 'Asia/Jakarta'
log_timezone = 'Asia/Jakarta'
password_encryption = 'scram-sha-256'
"@
    [IO.File]::AppendAllText($postgresConfig, $localConfig, [Text.UTF8Encoding]::new($false))
}

$adminPassword = [IO.File]::ReadAllText($adminPasswordFile).Trim()
$appPassword = [IO.File]::ReadAllText($appPasswordFile).Trim()

$pgCtl = Join-Path $postgresBin 'pg_ctl.exe'
& $pgCtl status -D $dataDir *> $null
if ($LASTEXITCODE -ne 0) {
    Invoke-PostgresTool 'pg_ctl' @('start', '-D', $dataDir, '-l', $postgresLog, '-w', '-t', '30')
}

$previousPgPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $adminPassword
    $psql = Join-Path $postgresBin 'psql.exe'

    $roleExists = & $psql -w -h 127.0.0.1 -p $postgresPort -U $adminRole -d postgres -Atqc "SELECT 1 FROM pg_roles WHERE rolname = '$appRole'"
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect PostgreSQL roles.' }
    if ($roleExists -ne '1') {
        & $psql -w -h 127.0.0.1 -p $postgresPort -U $adminRole -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE $appRole LOGIN PASSWORD '$appPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;"
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the application database role.' }
    }
    else {
        & $psql -w -h 127.0.0.1 -p $postgresPort -U $adminRole -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE $appRole PASSWORD '$appPassword';" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not synchronize the application database password.' }
    }

    $databaseExists = & $psql -w -h 127.0.0.1 -p $postgresPort -U $adminRole -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$databaseName'"
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect PostgreSQL databases.' }
    if ($databaseExists -ne '1') {
        Invoke-PostgresTool 'createdb' @('-w', '-h', '127.0.0.1', '-p', "$postgresPort", '-U', $adminRole, '-O', $appRole, $databaseName)
    }
}
finally {
    if ($null -eq $previousPgPassword) {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
    else {
        $env:PGPASSWORD = $previousPgPassword
    }
}

$databaseUrl = "postgresql://${appRole}:${appPassword}@127.0.0.1:${postgresPort}/${databaseName}"
if (-not (Test-Path -LiteralPath $envFile)) {
    $pythonPath = Join-Path $appRoot '.venv\Scripts\python.exe'
    $localEnv = @"
# Generated by scripts/setup-local.ps1. Never commit this file.
DATABASE_URL=$databaseUrl
BACKOFFICE_HOST=127.0.0.1
BACKOFFICE_PORT=3100
CLOUDFLARE_ACCESS_TEAM_DOMAIN=
CLOUDFLARE_ACCESS_AUDIENCE=
CLOUDFLARE_ACCESS_ALLOWED_EMAILS=
CLOUDFLARE_ACCESS_DEV_BYPASS=false
CLOUDFLARE_ACCESS_DEV_EMAIL=
PDF_PYTHON_EXECUTABLE=$pythonPath
PDF_RENDERER_PATH=pdf/render_invoice.py
PDF_RENDER_TIMEOUT_MS=15000
PDF_MAX_INPUT_BYTES=1048576
PDF_MAX_OUTPUT_BYTES=10485760
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=enztronic-invoices-private
RESEND_API_KEY=
RESEND_FROM_EMAIL=
RESEND_REPLY_TO=
RESEND_BCC=
"@
    [IO.File]::WriteAllText($envFile, $localEnv, [Text.UTF8Encoding]::new($false))
    Protect-LocalFile $envFile
}

if (-not (Test-Path -LiteralPath $developmentEnvFile)) {
    $developmentEnv = @"
# Development-only Cloudflare Access bypass. Production never loads this file.
CLOUDFLARE_ACCESS_DEV_BYPASS=true
CLOUDFLARE_ACCESS_DEV_EMAIL=owner@enztronic.local
"@
    [IO.File]::WriteAllText(
        $developmentEnvFile,
        $developmentEnv,
        [Text.UTF8Encoding]::new($false)
    )
    Protect-LocalFile $developmentEnvFile
}

$env:DATABASE_URL = $databaseUrl

Push-Location $appRoot
try {
    if (-not $SkipNodeInstall) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    }

    if (-not $SkipPythonInstall) {
        $venvPython = Join-Path $appRoot '.venv\Scripts\python.exe'
        if (-not (Test-Path -LiteralPath $venvPython)) {
            & python -m venv (Join-Path $appRoot '.venv')
            if ($LASTEXITCODE -ne 0) { throw 'Could not create the local Python environment.' }
        }
        & $venvPython -m pip install --disable-pip-version-check -r (Join-Path $appRoot 'pdf\requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Python PDF dependencies failed to install.' }
    }

    & npm.cmd run db:migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
}
finally {
    Pop-Location
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Enztronic back office is initialized.' -ForegroundColor Green
Write-Host 'Start it with: npm run dev'
Write-Host 'Open: http://127.0.0.1:3100'
