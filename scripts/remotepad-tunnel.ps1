# SSH tunnel from Windows to RemotePad on a remote Linux host.
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$RemoteHost,
  [ValidateSet('dev', 'prod')]
  [string]$Mode = $(if ($env:REMOTEPAD_MODE) { $env:REMOTEPAD_MODE } else { 'dev' })
)

$root = if ($env:REMOTEPAD_ROOT) { $env:REMOTEPAD_ROOT } else { Split-Path $PSScriptRoot -Parent }
$settingsPath = if ($env:REMOTEPAD_SETTINGS) { $env:REMOTEPAD_SETTINGS } else { Join-Path $root 'settings.json' }
$defaults = @{ host = '127.0.0.1'; port = 3847; uiPort = 5173 }
$file = $defaults.Clone()
if (Test-Path $settingsPath) {
  try {
    $raw = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if ($raw.host) { $file.host = [string]$raw.host }
    if ($raw.port) { $file.port = [int]$raw.port }
    if ($raw.uiPort) { $file.uiPort = [int]$raw.uiPort }
  } catch {
    # keep defaults
  }
}

$uiPort = if ($env:REMOTEPAD_UI_PORT) { [int]$env:REMOTEPAD_UI_PORT } else { [int]$file.uiPort }
$apiPort = if ($env:REMOTEPAD_PORT) { [int]$env:REMOTEPAD_PORT } else { [int]$file.port }

if ($Mode -eq 'prod') {
  Write-Host "Tunnel -> http://127.0.0.1:${apiPort} (production)"
  ssh -N -L "${apiPort}:127.0.0.1:${apiPort}" $RemoteHost
  exit $LASTEXITCODE
}

Write-Host "Tunnel -> http://127.0.0.1:${uiPort} (dev)"
ssh -N `
  -L "${uiPort}:127.0.0.1:${uiPort}" `
  -L "${apiPort}:127.0.0.1:${apiPort}" `
  $RemoteHost
