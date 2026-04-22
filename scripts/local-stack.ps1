param(
  [ValidateSet("up", "down", "status")]
  [string]$Action = "status",
  [switch]$SkipBuild,
  [switch]$KeepInfra
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot ".codex-relay-runtime"
$LogDir = Join-Path $RuntimeDir "logs"
$PidFile = Join-Path $RuntimeDir "pids.json"

$Services = @(
  @{
    Name = "api"
    Command = "pnpm --filter @codex-relay/api start"
    Url = "http://localhost:4000/health"
    Match = @("@codex-relay/api start", "apps\api\dist\main.js")
    WindowStyle = "Hidden"
  },
  @{
    Name = "web"
    Command = "pnpm --filter @codex-relay/web start"
    Url = "http://localhost:3000"
    Match = @("@codex-relay/web start", "next\dist\bin\next")
    WindowStyle = "Hidden"
  },
  @{
    Name = "connector"
    Command = "pnpm --filter @codex-relay/connector start"
    Url = $null
    Match = @("@codex-relay/connector start", "apps\connector\dist\index.js")
    WindowStyle = "Minimized"
  }
)

function Ensure-RuntimeDirs {
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}

function Read-State {
  if (-not (Test-Path $PidFile)) {
    return @()
  }

  $raw = Get-Content -Raw -Path $PidFile | ConvertFrom-Json
  if ($raw -is [System.Array]) {
    return $raw
  }

  return @($raw)
}

function Save-State([array]$State) {
  $State | ConvertTo-Json -Depth 4 | Set-Content -Path $PidFile -Encoding UTF8
}

function Invoke-Pnpm([string[]]$CommandArgs) {
  & pnpm.cmd @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm $($CommandArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Stop-ProcessTree([int]$ProcessId) {
  try {
    & taskkill /PID $ProcessId /T /F *> $null
  } catch {
  }
}

function Stop-ByPort([int]$Port) {
  $connections = @()

  try {
    $connections = @(Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop)
  } catch {
    return
  }

  foreach ($connection in $connections) {
    if ($connection.OwningProcess) {
      Stop-ProcessTree -ProcessId ([int]$connection.OwningProcess)
    }
  }
}

function Find-ServiceProcesses($Service) {
  Get-CimInstance Win32_Process |
    Where-Object {
      $process = $_
      $process.CommandLine -and
      $process.CommandLine -like "*open_source*" -and
      (($Service.Match | Where-Object {
        $pattern = $_
        $pattern -and $process.CommandLine -like "*$pattern*"
      }).Count -gt 0)
    } |
    Select-Object -Property ProcessId, Name, CommandLine
}

function Start-ServiceProcess($Service) {
  $logPath = Join-Path $LogDir "$($Service.Name).log"
  $command = "$($Service.Command) >> `"$logPath`" 2>&1"
  $windowStyle = if ($Service.WindowStyle) { $Service.WindowStyle } else { "Hidden" }

  $process = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", $command `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle $windowStyle `
    -PassThru

  return @{
    name = $Service.Name
    pid = $process.Id
    logPath = $logPath
    startedAt = (Get-Date).ToString("o")
  }
}

function Wait-Http([string]$Url, [int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -UseBasicParsing $Url | Out-Null
      return $true
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  return $false
}

function Get-ServiceSnapshot($Service, $State) {
  $entry = $State | Where-Object { $_.name -eq $Service.Name } | Select-Object -First 1
  $trackedProcess = $null
  if ($entry) {
    $trackedProcess = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
  }

  $matched = @(Find-ServiceProcesses $Service)

  [PSCustomObject]@{
    Name = $Service.Name
    TrackedPid = if ($entry) { [int]$entry.pid } else { $null }
    IsRunning = [bool]$trackedProcess
    LogPath = if ($entry) { $entry.logPath } else { $null }
    ExtraPids = @($matched | ForEach-Object { $_.ProcessId } | Where-Object { $_ -ne $entry.pid })
  }
}

function Stop-ManagedProcesses {
  $state = Read-State
  foreach ($entry in $state) {
    if ($entry.pid) {
      Stop-ProcessTree -ProcessId ([int]$entry.pid)
    }
  }

  foreach ($service in $Services) {
    $matches = @(Find-ServiceProcesses $service)
    foreach ($match in $matches) {
      Stop-ProcessTree -ProcessId ([int]$match.ProcessId)
    }
  }

  Stop-ByPort -Port 3000
  Stop-ByPort -Port 4000

  if (Test-Path $PidFile) {
    Remove-Item -Force $PidFile
  }
}

function Show-Status {
  $state = Read-State
  Write-Host "Services:"
  foreach ($service in $Services) {
    $snapshot = Get-ServiceSnapshot -Service $service -State $state
    $status = if ($snapshot.IsRunning) { "running" } else { "stopped" }
    $extras = if ($snapshot.ExtraPids.Count) { " extra=$($snapshot.ExtraPids -join ',')" } else { "" }
    $logInfo = if ($snapshot.LogPath) { " log=$($snapshot.LogPath)" } else { "" }
    $pidInfo = if ($snapshot.TrackedPid) { " pid=$($snapshot.TrackedPid)" } else { "" }
    Write-Host " - $($snapshot.Name): $status$pidInfo$extras$logInfo"
  }

  Write-Host ""
  Write-Host "Doctor:"
  node (Join-Path $ProjectRoot "scripts\doctor.mjs")
}

Ensure-RuntimeDirs

switch ($Action) {
  "up" {
    Stop-ManagedProcesses
    Invoke-Pnpm @("infra:up")
    Invoke-Pnpm @("prisma:push")
    if (-not $SkipBuild) {
      Invoke-Pnpm @("build")
    }

    $state = @()
    foreach ($service in $Services) {
      $state += Start-ServiceProcess -Service $service
    }
    Save-State -State $state

    if (-not (Wait-Http -Url "http://localhost:4000/health")) {
      throw "API did not become ready on http://localhost:4000/health"
    }

    if (-not (Wait-Http -Url "http://localhost:3000")) {
      throw "Web did not become ready on http://localhost:3000"
    }

    Start-Sleep -Seconds 4
    Show-Status
  }
  "down" {
    Stop-ManagedProcesses
    if (-not $KeepInfra) {
      Invoke-Pnpm @("infra:down")
    }
    Write-Host "Local stack stopped."
  }
  "status" {
    Show-Status
  }
}
