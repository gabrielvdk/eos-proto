// EOS Tracker: one environment (test or prod) = a Static Web App (site + API) + a serverless Cosmos DB account.
// Deploy once per environment, each into its own resource group (infra/deploy.ps1 does this). See docs/AZURE.md.
// Re-running is safe; note that it rewrites the app settings, so always pass the same parameters (incl. the Entra secret).

targetScope = 'resourceGroup'

@description('Which environment this is.')
@allowed(['test', 'prod'])
param env string

@description('Region. Static Web Apps exists in a few regions only; westeurope keeps everything in the EU.')
param location string = 'westeurope'

@description('Static Web Apps plan. Free is enough for Test; Standard is needed for tenant-locked sign-in (AUTH_MODE=entra).')
@allowed(['Free', 'Standard'])
param sku string = env == 'prod' ? 'Standard' : 'Free'

@description('E-mail domains that may use the app, comma-separated ("letsgrow.com" or "*@letsgrow.com"). "*" = everyone who can sign in (only with tenant-locked sign-in).')
param allowedEmailDomains string = '*@hoogendoorn.com,*@letsgrow.com'

@description('Individual e-mail addresses that may use the app, comma-separated.')
param allowedEmails string = 'gabrielvdk@gmail.com'

@description('People who are always admin (and always allowed in), comma-separated. Admins maintain the organisation and assign people to teams.')
param adminEmails string = 'gk@letsgrow.com,gabrielvdk@gmail.com'

@description('What an empty database starts with: "org" = the organisation structure only, "sample" = also fictional goals, rocks and people.')
@allowed(['org', 'sample'])
param seed string = env == 'prod' ? 'org' : 'sample'

@description('Tenant-locked sign-in (AUTH_MODE=entra): the app registration\'s client ID. Leave empty for the built-in Microsoft sign-in.')
param entraClientId string = ''

@description('Tenant-locked sign-in: the app registration\'s client secret.')
@secure()
param entraClientSecret string = ''

@description('Prefix for resource names.')
param namePrefix string = 'eostracker'

var databaseName = 'eostracker'
var cosmosName = toLower('${namePrefix}-${env}-${take(uniqueString(resourceGroup().id), 6)}') // globally unique

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: cosmosName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      { locationName: location, failoverPriority: 0, isZoneRedundant: false }
    ]
    capabilities: [
      { name: 'EnableServerless' } // pay per request: costs next to nothing at this size
    ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    minimalTlsVersion: 'Tls12'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' = {
  parent: cosmos
  name: databaseName
  properties: { resource: { id: databaseName } }
}

// the API also creates these on first use; declaring them here keeps the environment complete and visible
resource items 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: database
  name: 'items'
  properties: { resource: { id: 'items', partitionKey: { paths: ['/type'], kind: 'Hash' } } }
}

resource attachments 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: database
  name: 'attachments'
  properties: { resource: { id: 'attachments', partitionKey: { paths: ['/id'], kind: 'Hash' } } }
}

resource site 'Microsoft.Web/staticSites@2022-09-01' = {
  name: '${namePrefix}-${env}'
  location: location
  sku: { name: sku, tier: sku }
  properties: {
    stagingEnvironmentPolicy: 'Disabled' // deployments come from pushes (GitHub Actions), not pull-request previews
    allowConfigFileUpdates: true
  }
}

resource siteSettings 'Microsoft.Web/staticSites/config@2022-09-01' = {
  parent: site
  name: 'appsettings'
  properties: union({
    COSMOS_CONNECTION_STRING: cosmos.listConnectionStrings().connectionStrings[0].connectionString
    COSMOS_DATABASE: databaseName
    APP_ENV: env
    SEED: seed
    ADMIN_EMAILS: adminEmails
    ALLOWED_EMAIL_DOMAINS: allowedEmailDomains
    ALLOWED_EMAILS: allowedEmails
  }, empty(entraClientId) ? {} : {
    AZURE_CLIENT_ID: entraClientId
    AZURE_CLIENT_SECRET: entraClientSecret
  })
}

output staticWebAppName string = site.name
output url string = 'https://${site.properties.defaultHostname}'
output signInRedirectUri string = 'https://${site.properties.defaultHostname}/.auth/login/aad/callback'
output cosmosAccountName string = cosmos.name
