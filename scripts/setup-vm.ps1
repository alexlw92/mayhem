# setup-vm.ps1 — Run once on the Windows EC2 after RDP in.
# Prerequisites: League of Legends installed and burner account logged in.
#
# Usage:
#   $env:BACKEND_URL = "http://<your-ec2-ip>:3847"
#   $env:API_KEY     = "<your-api-key>"
#   .\scripts\setup-vm.ps1

param(
  [string]$BackendUrl = $env:BACKEND_URL,
  [string]$ApiKey     = $env:API_KEY,
  [string]$RepoUrl    = "https://github.com/alexlw92/mayhem.git",
  [string]$InstallDir = "C:\mayhem"
)

if (-not $BackendUrl) {
  Write-Error "Set BACKEND_URL before running (e.g. `$env:BACKEND_URL = 'http://1.2.3.4:3847'`)"
  exit 1
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Step([string]$msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ── 1. Node.js ────────────────────────────────────────────────────────────────
Step "Installing Node.js (LTS)"
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
node --version

# ── 2. PM2 ────────────────────────────────────────────────────────────────────
Step "Installing PM2"
npm install -g pm2

# ── 3. Repo ───────────────────────────────────────────────────────────────────
Step "Cloning / updating repo at $InstallDir"
if (Test-Path "$InstallDir\.git") {
  git -C $InstallDir pull origin master
} else {
  git clone $RepoUrl $InstallDir
}

Set-Location $InstallDir

# ── 4. Dependencies + build ───────────────────────────────────────────────────
Step "Installing npm dependencies"
npm install --omit=dev

Step "Building worker"
npm run worker:build

# ── 5. PM2 ecosystem file ─────────────────────────────────────────────────────
Step "Writing PM2 ecosystem config"
$ecosystemContent = @"
module.exports = {
  apps: [{
    name: 'mayhem-worker',
    script: 'dist-worker/src/worker/index.js',
    cwd: '$($InstallDir -replace "\\","/")',
    restart_delay: 10000,
    env: {
      BACKEND_URL: '$BackendUrl',
      API_KEY: '$ApiKey'
    }
  }]
}
"@
$ecosystemContent | Out-File -FilePath "$InstallDir\ecosystem.config.js" -Encoding utf8

# ── 6. Start + persist across reboots ─────────────────────────────────────────
Step "Starting worker with PM2"
pm2 start ecosystem.config.js
pm2 save

Step "Configuring PM2 to start on boot (run the printed command as Administrator)"
pm2 startup
