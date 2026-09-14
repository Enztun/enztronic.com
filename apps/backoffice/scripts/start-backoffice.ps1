[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$SkipPostgres,
    [ValidateRange(1024, 65535)]
    [int]$PostgresPort = 54329,
    [string]$PostgresBin,
    # Set by the startup task, which runs without a console: failures and app output go to .runtime/logs.
    [switch]$Background
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$startLog = $null

trap {
    if ($startLog) {
        Add-Content -LiteralPath $startLog -Value "$(Get-Date -Format o) $_"
    }
    break
}

function Resolve-PostgresTool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ToolName,
        [string]$BinDirectory
    )

    $executable = "$ToolName.exe"
    $candidates = @()
    if ($BinDirectory) {
        $candidates += Join-Path $BinDirectory $executable
    }
    $candidates += "C:\Program Files\PostgreSQL\17\bin\$executable"

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $command = Get-Command $executable -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }
    throw "$executable was not found. Install PostgreSQL 17 or pass -PostgresBin."
}

function Test-Listener {
    param([int]$Port)
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
    return $null -ne $listener
}

$appRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $appRoot ".runtime"))
$dataDirectory = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot "postgres-data"))
$appPrefix = $appRoot.TrimEnd("\") + "\"
if (-not $dataDirectory.StartsWith($appPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The PostgreSQL data directory resolved outside the backoffice app."
}

$logDirectory = Join-Path $runtimeRoot "logs"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
if ($Background) {
    $startLog = Join-Path $logDirectory "start-backoffice.log"
}

if (-not $SkipPostgres) {
    if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory "PG_VERSION") -PathType Leaf)) {
        throw "Dedicated PostgreSQL data is not initialized. Run scripts/setup-local.ps1 first."
    }

    $pgCtl = Resolve-PostgresTool -ToolName "pg_ctl" -BinDirectory $PostgresBin
    $pgIsReady = Resolve-PostgresTool -ToolName "pg_isready" -BinDirectory $PostgresBin

    $null = & $pgCtl status -D $dataDirectory 2>&1
    $clusterRunning = $LASTEXITCODE -eq 0
    if (-not $clusterRunning) {
        if (Test-Listener -Port $PostgresPort) {
            throw "Port $PostgresPort is already occupied by another process."
        }

        $postgresLog = Join-Path $logDirectory "postgres.log"
        $serverOptions = "-h 127.0.0.1 -p $PostgresPort"
        & $pgCtl start -D $dataDirectory -l $postgresLog -w -t 30 -o $serverOptions
        if ($LASTEXITCODE -ne 0) {
            throw "The dedicated PostgreSQL cluster did not start. Review $postgresLog."
        }
    }

    & $pgIsReady -h 127.0.0.1 -p $PostgresPort -t 3 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Dedicated PostgreSQL is not ready on 127.0.0.1:$PostgresPort."
    }
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node -or -not $npm) {
    throw "Node.js and npm are required on PATH."
}

$nodeVersion = (& $node.Source --version).TrimStart("v")
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 20) {
    throw "Node.js 20 or newer is required. Found $nodeVersion."
}

if (Test-Listener -Port 3100) {
    throw "Port 3100 is already in use. The backoffice was not started twice."
}

Push-Location $appRoot
try {
    if ($Build) {
        & $npm.Source run build
        if ($LASTEXITCODE -ne 0) {
            throw "The production build failed."
        }
    }

    if (-not (Test-Path -LiteralPath (Join-Path $appRoot ".next\BUILD_ID") -PathType Leaf)) {
        throw "No production build exists. Run this script once with -Build."
    }

    $env:NODE_ENV = "production"
    $env:BACKOFFICE_HOST = "127.0.0.1"
    $env:BACKOFFICE_PORT = "3100"
    if ($Background) {
        $process = Start-Process -FilePath $npm.Source -ArgumentList "run", "start" -NoNewWindow -PassThru `
            -RedirectStandardOutput (Join-Path $logDirectory "backoffice.out.log") `
            -RedirectStandardError (Join-Path $logDirectory "backoffice.err.log")
        # Reading Handle keeps ExitCode available after the process exits.
        $null = $process.Handle
        $process.WaitForExit()
        $exitCode = $process.ExitCode
    }
    else {
        & $npm.Source run start
        $exitCode = $LASTEXITCODE
    }
    if ($exitCode -ne 0) {
        throw "The backoffice process exited with code $exitCode."
    }
}
finally {
    Pop-Location
}
