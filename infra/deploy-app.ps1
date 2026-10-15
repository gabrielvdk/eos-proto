<#
.SYNOPSIS
  Deploys EOS Tracker (the page + the API) from this machine to an existing Static Web App: no GitHub needed.
  The resources must exist already (infra/deploy.ps1 or the portal, see docs/AZURE.md).

  Needs (once; .\infra\setup-tools.ps1 installs them):
    Node.js LTS (20 or newer)   winget install OpenJS.NodeJS.LTS            (then open a new terminal)
    Static Web Apps CLI         npm install -g @azure/static-web-apps-cli
    Azure CLI (optional)        winget install Microsoft.AzureCLI, then az login
                                — only to look up the deployment token; or pass -DeploymentToken yourself
                                (portal: Static Web App > Overview > Manage deployment token)
  The API itself runs on Node.js 22 in Azure (azure/staticwebapp.config.json); the local version only runs the tools.

.EXAMPLE
  ./infra/deploy-app.ps1 -Env test
.EXAMPLE
  ./infra/deploy-app.ps1 -Env prod -AuthMode entra -EntraTenantId <tenant id>
.EXAMPLE
  ./infra/deploy-app.ps1 -Env test -DeploymentToken <token>      # without the Azure CLI
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('test', 'prod')][string]$Env,
  [string]$ResourceGroup = "rg-eostracker-$Env",
  [string]$Name = "eostracker-$Env",
  [ValidateSet('builtin', 'entra')][string]$AuthMode = 'builtin',
  [string]$EntraTenantId = '',
  [string]$DeploymentToken = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# the .cmd shims, not the .ps1 ones: those are blocked when scripts from npm aren't allowed to run
function Assert-Tool($command, $hint) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "'$command' wasn't found. $hint" }
}
Assert-Tool 'node.exe' 'Install Node.js LTS: run .\infra\setup-tools.ps1, or winget install OpenJS.NodeJS.LTS (then open a new terminal).'
Assert-Tool 'npm.cmd' 'npm comes with Node.js: install Node.js LTS (.\infra\setup-tools.ps1).'
Assert-Tool 'swa.cmd' 'Install the Static Web Apps CLI: run .\infra\setup-tools.ps1, or npm install -g @azure/static-web-apps-cli'
if ($AuthMode -eq 'entra' -and -not $EntraTenantId) { throw '-AuthMode entra needs -EntraTenantId.' }

# 1. the deployment token of the Static Web App
if (-not $DeploymentToken) {
  Assert-Tool 'az' 'Install the Azure CLI (winget install Microsoft.AzureCLI) and run az login, or pass -DeploymentToken.'
  Write-Host "Reading the deployment token of $Name..."
  $DeploymentToken = az staticwebapp secrets list --name $Name --resource-group $ResourceGroup --query properties.apiKey --output tsv
  if ($LASTEXITCODE -ne 0 -or -not $DeploymentToken) { throw "Couldn't read the deployment token of $Name in $ResourceGroup (az login? the right subscription?)." }
}

# 2. the site: index.html + the Static Web Apps config (with tenant-locked sign-in when AuthMode is entra), like the GitHub workflow
$dist = Join-Path $root 'dist'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory $dist | Out-Null
Copy-Item (Join-Path $root 'index.html') $dist
$config = Get-Content (Join-Path $root 'azure/staticwebapp.config.json') -Raw | ConvertFrom-Json
if ($AuthMode -eq 'entra') {
  $registration = [pscustomobject]@{
    openIdIssuer            = "https://login.microsoftonline.com/$EntraTenantId/v2.0"
    clientIdSettingName     = 'AZURE_CLIENT_ID'
    clientSecretSettingName = 'AZURE_CLIENT_SECRET'
  }
  $auth = [pscustomobject]@{ identityProviders = [pscustomobject]@{ azureActiveDirectory = [pscustomobject]@{ registration = $registration } } }
  $config | Add-Member -NotePropertyName auth -NotePropertyValue $auth -Force
  Write-Host "Sign-in: your Entra tenant only ($EntraTenantId)"
} else {
  Write-Host 'Sign-in: built-in Microsoft provider (access via ALLOWED_EMAIL_DOMAINS / ALLOWED_EMAILS)'
}
$json = $config | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText((Join-Path $dist 'staticwebapp.config.json'), $json, (New-Object Text.UTF8Encoding $false)) # UTF-8 without BOM

# 3. the API's packages (swa deploy uploads the api folder as it is; it doesn't install them)
Write-Host 'Installing the API packages...'
Push-Location (Join-Path $root 'api')
try {
  & npm.cmd install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
} finally { Pop-Location }

# 4. upload site + API
Write-Host "Deploying to $Name..."
& swa.cmd deploy $dist --api-location (Join-Path $root 'api') --api-language node --api-version 22 --deployment-token $DeploymentToken --env production
if ($LASTEXITCODE -ne 0) { throw 'swa deploy failed.' }

Write-Host ''
Write-Host "Done: $Env is updated." -ForegroundColor Green
if (Get-Command 'az' -ErrorAction SilentlyContinue) {
  $hostName = az staticwebapp show --name $Name --resource-group $ResourceGroup --query defaultHostname --output tsv 2>$null
  if ($hostName) { Write-Host "  https://$hostName" }
}
