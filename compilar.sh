#!/usr/bin/env bash
# Compila mcp-openobserve: instala dependencias y transpila TypeScript a dist/
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
fail() { echo -e "${RED}✗ Error:${NC} $*" >&2; exit 1; }

echo -e "${BOLD}mcp-openobserve — compilación${NC}"
echo "─────────────────────────────────"

# ── 1. Node.js ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  fail "Node.js no está instalado. Descárgalo en https://nodejs.org (versión 22 o superior)."
fi

NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Se requiere Node.js 22 o superior. Versión detectada: v${NODE_VERSION}"
fi
ok "Node.js v${NODE_VERSION}"

# ── 2. npm ────────────────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  fail "npm no está disponible. Reinstala Node.js desde https://nodejs.org."
fi
ok "npm $(npm --version)"

# ── 3. package.json ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "package.json" ]; then
  fail "No se encontró package.json. Ejecuta este script desde la raíz del repositorio."
fi
ok "Directorio: $SCRIPT_DIR"

# ── 4. Instalar dependencias ──────────────────────────────────────────────────
echo ""
echo "Instalando dependencias..."
npm install --prefer-offline 2>&1 | tail -3
ok "Dependencias instaladas"

# ── 5. Compilar TypeScript ────────────────────────────────────────────────────
echo ""
echo "Compilando TypeScript → dist/ ..."
npm run build
ok "Compilación completada"

# ── 6. Verificar artefacto ────────────────────────────────────────────────────
if [ ! -f "dist/index.js" ]; then
  fail "La compilación no generó dist/index.js. Revisa los errores de tsc arriba."
fi

echo ""
echo -e "${BOLD}─────────────────────────────────${NC}"
echo -e "${GREEN}Compilación exitosa.${NC}"
echo ""
echo "Binario listo en:"
echo "  $(pwd)/dist/index.js"
echo ""
echo "Para arrancar el servidor:"
echo "  LOG_GATEWAY_URL=http://tu-gateway.com \\"
echo "  LOG_GATEWAY_API_KEY=tu_key.tu_secreto \\"
echo "  node dist/index.js"
