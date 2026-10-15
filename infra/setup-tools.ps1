<#
.SYNOPSIS
  Installs the tools for deploying EOS Tracker to Azure from this machine. Safe to run again: what's there is skipped.
    Node.js LTS            runs the Static Web Apps CLI and installs the API's packages        (winget)
    Static Web Apps CLI    uploads the page + API (infra/deploy-app.ps1)                       (npm, for your user only)
    Azure CLI              creates the resources (infra/deploy.ps1) and looks up deploy tokens (winget; skip with -SkipAzureCli)
  The winget installers may show a Windows admin (UAC) prompt. Running this script accepts the winget source and package
  agreements on your behalf (Node.js: MIT licence; Azure CLI: MIT licence).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\infra\setup-tools.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\infra\setup-tools.ps1 -SkipAzureCli
#>
param([switch]$SkipAzureCli)
$ErrorActionPreference = 'Stop'

function Test-Tool($command) { [bool](Get-Command $command -ErrorAction SilentlyContinue) }
# newly installed tools are on PATH for new terminals only; pick them up in this one too
function Update-SessionPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Install-WithWinget($id, $label) {
  Write-Host "Installing $label (winget $id)..." -ForegroundColor Cyan
  & winget install --id $id --exact --source winget --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw "Installing $label failed (winget exit code $LASTEXITCODE)." }
  Update-SessionPath
}

if (-not (Test-Tool 'winget')) {
  throw "winget isn't available. Install 'App Installer' from the Microsoft Store, or install Node.js LTS from https://nodejs.org and the Azure CLI from https://learn.microsoft.com/cli/azure/install-azure-cli, then run this script again."
}

# 1. Node.js (20 or newer)
$nodeMajor = 0
if (Test-Tool 'node.exe') { $nodeMajor = [int]((& node.exe --version) -replace '^v(\d+).*', '$1') }
if ($nodeMajor -ge 20) { Write-Host "Node.js $(& node.exe --version) is installed." -ForegroundColor Green }
else {
  if ($nodeMajor -gt 0) { Write-Host "Node.js v$nodeMajor is too old (20 or newer is needed)." -ForegroundColor Yellow }
  Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
  if (-not (Test-Tool 'node.exe')) { throw 'Node.js was installed but is not on PATH yet: open a new terminal and run this script again.' }
}

# 2. Static Web Apps CLI
if (Test-Tool 'swa.cmd') { Write-Host "Static Web Apps CLI $(& swa.cmd --version) is installed." -ForegroundColor Green }
else {
  Write-Host 'Installing the Static Web Apps CLI (npm install -g @azure/static-web-apps-cli)...' -ForegroundColor Cyan
  & npm.cmd install -g @azure/static-web-apps-cli --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Installing the Static Web Apps CLI failed.' }
  Update-SessionPath
}

# 3. Azure CLI
if ($SkipAzureCli) { Write-Host 'Azure CLI skipped (-SkipAzureCli): pass -DeploymentToken to deploy-app.ps1.' -ForegroundColor Yellow }
elseif (Test-Tool 'az') { Write-Host 'Azure CLI is installed.' -ForegroundColor Green }
else { Install-WithWinget 'Microsoft.AzureCLI' 'the Azure CLI' }

Write-Host ''
Write-Host 'Ready. Next:' -ForegroundColor Green
if (-not $SkipAzureCli) { Write-Host '  az login                                   sign in to Azure (once)' }
Write-Host '  .\infra\deploy.ps1 -Env test               create the Test environment (once, see docs/AZURE.md)'
Write-Host '  .\infra\deploy-app.ps1 -Env test           deploy the app to Test'
Write-Host 'If a command isn''t found, open a new terminal: new tools are only on PATH there.'
