# delete-projectmaps.ps1
#
# Deletes all project maps for a Uniform project.
#
# Required environment variables:
#   UNIFORM_API_KEY
#   UNIFORM_HOST
#   UNIFORM_PROJECT_ID
#
# Azure DevOps example (pipeline variables set as secret env vars):
#   - powershell: ./delete-projectmaps.ps1
#     env:
#       UNIFORM_API_KEY:    $(UNIFORM_API_KEY)
#       UNIFORM_HOST:       $(UNIFORM_HOST)
#       UNIFORM_PROJECT_ID: $(UNIFORM_PROJECT_ID)

$ErrorActionPreference = 'Stop'

function Get-RequiredEnv($name) {
    $value = [System.Environment]::GetEnvironmentVariable($name)
    if (-not $value) {
        Write-Error "Error: $name environment variable is required."
        exit 1
    }
    return $value
}

$apiKey    = Get-RequiredEnv 'UNIFORM_API_KEY'
$host      = ([System.Uri](Get-RequiredEnv 'UNIFORM_HOST')).GetLeftPart([System.UriPartial]::Authority)
$projectId = Get-RequiredEnv 'UNIFORM_PROJECT_ID'

$headers = @{ 'uniform-api-key' = $apiKey }

# Get all project maps
$response = Invoke-RestMethod -Uri "$host/api/v1/project-map?projectId=$projectId" -Method Get -Headers $headers
$maps = if ($response.projectMaps) { $response.projectMaps } else { $response }

if (-not $maps -or $maps.Count -eq 0) {
    Write-Host 'No project maps found.'
    exit 0
}

Write-Host "Deleting $($maps.Count) project map(s)..."
foreach ($map in $maps) {
    $body = @{ projectId = $projectId; projectMapId = $map.id } | ConvertTo-Json
    Invoke-RestMethod -Uri "$host/api/v1/project-map" -Method Delete -Headers $headers -Body $body -ContentType 'application/json' | Out-Null
    $label = if ($map.name) { "$($map.id) ($($map.name))" } else { $map.id }
    Write-Host "  Deleted: $label"
}
Write-Host 'Done.'
