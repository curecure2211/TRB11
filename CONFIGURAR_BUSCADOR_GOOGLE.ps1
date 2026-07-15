$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "TRB - Configurar buscador amplio" -ForegroundColor Cyan
Write-Host "La clave se guardara solo en .env.local dentro de esta carpeta."
$key = Read-Host "Pegue su clave de Google Maps Platform"
if ([string]::IsNullOrWhiteSpace($key)) { Write-Host "No se guardo ninguna clave." -ForegroundColor Yellow; exit 1 }
$content = @(
  "TRB_GOOGLE_PLACES_API_KEY=$key",
  "TRB_GOOGLE_GEOCODING_API_KEY=$key"
)
Set-Content -Path (Join-Path $root ".env.local") -Value $content -Encoding UTF8
Write-Host "Listo. Active en Google Cloud: Places API (New) y Geocoding API." -ForegroundColor Green
Write-Host "Ahora cierre esta ventana y abra INICIAR_TRB.bat."
Read-Host "Presione Enter para terminar"
