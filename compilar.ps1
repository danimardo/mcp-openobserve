# Compila mcp-openobserve: instala dependencias y transpila TypeScript a dist/
# Compatible con Windows PowerShell 5.1 y PowerShell 7+
#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Write-Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "  [X]  Error: $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "mcp-openobserve -- compilacion" -ForegroundColor Cyan
Write-Host "---------------------------------"

# -- 1. Node.js --
try {
    $nodeVersion = (node --version).ToString().TrimStart('v')
} catch {
    Write-Fail "Node.js no esta instalado. Descargalo en https://nodejs.org (version 22 o superior)."
}

$nodeMajor = [int]($nodeVersion -split '\.')[0]
if ($nodeMajor -lt 22) {
    Write-Fail "Se requiere Node.js 22 o superior. Version detectada: v$nodeVersion"
}
Write-Ok "Node.js v$nodeVersion"

# -- 2. npm --
try {
    $npmVersion = (npm --version).ToString().Trim()
} catch {
    Write-Fail "npm no esta disponible. Reinstala Node.js desde https://nodejs.org."
}
Write-Ok "npm $npmVersion"

# -- 3. Ubicacion del repositorio --
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
Set-Location $scriptDir

if (-not (Test-Path "package.json")) {
    Write-Fail "No se encontro package.json. Ejecuta este script desde la raiz del repositorio."
}
Write-Ok "Directorio: $scriptDir"

# -- 4. Instalar dependencias --
Write-Host ""
Write-Host "Instalando dependencias..."
npm install
if ($LASTEXITCODE -ne 0) { Write-Fail "npm install fallo con codigo $LASTEXITCODE" }
Write-Ok "Dependencias instaladas"

# -- 5. Compilar TypeScript --
Write-Host ""
Write-Host "Compilando TypeScript -> dist/ ..."
npm run build
if ($LASTEXITCODE -ne 0) { Write-Fail "La compilacion fallo con codigo $LASTEXITCODE. Revisa los errores de tsc arriba." }
Write-Ok "Compilacion completada"

# -- 6. Verificar artefacto --
$distFile = Join-Path $scriptDir "dist"
$distFile = Join-Path $distFile "index.js"
if (-not (Test-Path $distFile)) {
    Write-Fail "La compilacion no genero dist/index.js. Revisa los errores de tsc arriba."
}

Write-Host ""
Write-Host "---------------------------------"
Write-Host "Compilacion exitosa." -ForegroundColor Green
Write-Host ""
Write-Host "Binario listo en:"
Write-Host "  $distFile"
Write-Host ""
Write-Host "Para arrancar el servidor (PowerShell):"
Write-Host '  $env:LOG_GATEWAY_URL="http://tu-gateway.com"'
Write-Host '  $env:LOG_GATEWAY_API_KEY="tu_key.tu_secreto"'
Write-Host "  node dist/index.js"
Write-Host ""
