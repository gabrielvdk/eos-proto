<#
.SYNOPSIS
  Creates or updates one EOS Tracker environment in Azure (resource group + Static Web App + Cosmos DB).
  Needs the Azure CLI (az) and a signed-in session (az login). Optional: the GitHub CLI (gh) to store the deployment token.

  Who may use the app defaults to *@hoogendoorn.com, *@letsgrow.com and gabrielvdk@gmail.com (-AllowedEmailDomains / -AllowedEmails);
  who is always admin defaults to gk@letsgrow.com and gabrielvdk@gmail.com (-AdminEmails).

.EXAMPLE
  ./infra/deploy.ps1 -Env test -SetGitHubSecrets
.EXAMPLE
  ./infra/deploy.ps1 -Env prod -EntraTenantId <tenant> -EntraClientId <id> -EntraClientSecret <secret> -SetGitHubSecrets

  Re-running is safe. It rewrites the app settings, so pass the same parameters again (including the Entra secret for prod).
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('test', 'prod')][string]$Env,
  [string]$Location = 'westeurope',
  [ValidateSet('', 'Free', 'Standard')][string]$Sku = '',
  [string]$AllowedEmailDomains = '*@hoogendoorn.com,*@letsgrow.com',
  [string]$AllowedEmails = 'gabrielvdk@gmail.com',
  [string]$AdminEmails = 'gk@letsgrow.com,gabrielvdk@gmail.com',
  [ValidateSet('', 'org', 'sample')][string]$Seed = '',
  [string]$EntraTenantId = '',
  [string]$EntraClientId = '',
  [string]$EntraClientSecret = '',
  [string]$ResourceGroup = "rg-eostracker-$Env",
  [string]$Repo = 'gabrielvdk/eos-proto',
  [switch]$SetGitHubSecrets
)
$ErrorActionPreference = 'Stop'
function Invoke-Az { $out = & az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed" }; $out }

if (-not $AllowedEmailDomains -and -not $AllowedEmails) {
  Write-Warning 'No -AllowedEmailDomains / -AllowedEmails given: nobody will have access until you set them.'
}
if ($EntraClientId -and -not $EntraTenantId) { throw '-EntraClientId needs -EntraTenantId as well.' }

# an existing group is used as it is: re-creating it would drop its tags (and policies may require tags, e.g. 'Team')
if ((Invoke-Az group exists --name $ResourceGroup) -eq 'true') {
  Write-Host "Resource group $ResourceGroup exists: using it."
} else {
  Write-Host "Resource group $ResourceGroup ($Location)..."
  Invoke-Az group create --name $ResourceGroup --location $Location --output none
}

$params = @("env=$Env", "location=$Location")
if ($Sku) { $params += "sku=$Sku" }
if ($Seed) { $params += "seed=$Seed" }
if ($AllowedEmailDomains) { $params += "allowedEmailDomains=$AllowedEmailDomains" }
if ($AllowedEmails) { $params += "allowedEmails=$AllowedEmails" }
if ($AdminEmails) { $params += "adminEmails=$AdminEmails" }
if ($EntraClientId) { $params += "entraClientId=$EntraClientId"; $params += "entraClientSecret=$EntraClientSecret" }

Write-Host 'Deploying infra/main.bicep (takes a few minutes)...'
$outputs = Invoke-Az deployment group create --resource-group $ResourceGroup --name "eostracker-$Env" `
  --template-file "$PSScriptRoot/main.bicep" --parameters $params --query properties.outputs --output json | ConvertFrom-Json

$siteName = $outputs.staticWebAppName.value
$token = Invoke-Az staticwebapp secrets list --name $siteName --resource-group $ResourceGroup --query properties.apiKey --output tsv
$authMode = if ($EntraClientId) { 'entra' } else { 'builtin' }

if ($SetGitHubSecrets) {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'The GitHub CLI (gh) is not installed; set the secret and variables by hand (see below).' }
  Write-Host "Storing the deployment token and variables in GitHub environment '$Env' of $Repo..."
  $token | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo $Repo --env $Env
  gh variable set AUTH_MODE --repo $Repo --env $Env --body $authMode
  if ($EntraTenantId) { gh variable set ENTRA_TENANT_ID --repo $Repo --env $Env --body $EntraTenantId }
  gh variable set AZURE_DEPLOY --repo $Repo --body true
}

Write-Host ''
Write-Host "Done: $Env environment" -ForegroundColor Green
Write-Host "  Site:               $($outputs.url.value)"
Write-Host "  Static Web App:     $siteName"
Write-Host "  Cosmos DB account:  $($outputs.cosmosAccountName.value)"
Write-Host "  Sign-in redirect:   $($outputs.signInRedirectUri.value)   (for the Entra app registration)"
if (-not $SetGitHubSecrets) {
  Write-Host ''
  Write-Host "Next, in GitHub ($Repo > Settings > Environments > $Env):"
  Write-Host '  secret   AZURE_STATIC_WEB_APPS_API_TOKEN = (az staticwebapp secrets list --name' $siteName '--query properties.apiKey -o tsv)'
  Write-Host "  variable AUTH_MODE = $authMode"
  if ($EntraTenantId) { Write-Host "  variable ENTRA_TENANT_ID = $EntraTenantId" }
  Write-Host 'and once, under Settings > Secrets and variables > Actions > Variables:  AZURE_DEPLOY = true'
}
Write-Host ''
Write-Host "Then deploy by pushing: main -> test, production -> prod (git push origin main:production)."
