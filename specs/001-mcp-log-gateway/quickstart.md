# Quickstart: Guía de Validación — MCP Log Gateway

**Feature**: `001-mcp-log-gateway` | **Date**: 2026-06-07 | **Plan**: [plan.md](./plan.md)

Esta guía describe los escenarios de validación que demuestran que la feature funciona end-to-end. No incluye código de implementación; los detalles de implementación están en `tasks.md`. Los contratos de herramientas están en [`contracts/mcp-tools.md`](./contracts/mcp-tools.md).

---

## Prerrequisitos

- Node.js 24.4.1 instalado
- Dependencias instaladas: `npm install`
- Un Log Gateway API accesible (real o mock local vía Vitest)
- Variables de entorno mínimas para pruebas manuales:

```env
LOG_GATEWAY_URL=http://localhost:8080
LOG_GATEWAY_API_KEY=test_key.test_secret
LOG_LEVEL=debug
```

---

## Quality Gates (ejecutar antes de cerrar la feature)

```bash
npm run lint          # ESLint 10.4.1 — cero errores
npm run typecheck     # tsc --noEmit — cero errores de tipos
npm test              # vitest (unit + contract + integration)
npm run coverage      # cobertura ≥ 80% líneas, ramas, funciones, sentencias
```

---

## Validación de Arranque (US-001)

### Arranque correcto (CA-1)
```bash
LOG_GATEWAY_URL=http://localhost:8080 \
LOG_GATEWAY_API_KEY=test_key.test_secret \
npx tsx src/index.ts
```
**Esperado**: El proceso arranca, emite un log de info a stderr y queda en espera de conexiones MCP en stdin. Arranque < 5 s (SC-006).

### Variables obligatorias ausentes (CA-2)
```bash
npx tsx src/index.ts
```
**Esperado**: El proceso termina con mensaje claro a stderr indicando qué variable falta (`LOG_GATEWAY_URL` o `LOG_GATEWAY_API_KEY`). La API key no aparece en el mensaje de error.

### Variables OO rechazadas (FR-004)
```bash
OO_URL=http://openobserve \
LOG_GATEWAY_URL=http://localhost:8080 \
LOG_GATEWAY_API_KEY=test.secret \
npx tsx src/index.ts
```
**Esperado**: El proceso rechaza la configuración con mensaje claro indicando que `OO_URL` no está permitido.

### Variables opcionales con defaults (CA-4)
```bash
LOG_GATEWAY_URL=http://localhost:8080 \
LOG_GATEWAY_API_KEY=test.secret \
npx tsx src/index.ts
# Invocar una herramienta sin parámetros opcionales
```
**Esperado**: El servidor usa `MCP_DEFAULT_SINCE=1h`, `MCP_DEFAULT_LIMIT=100` etc. en lugar de fallar.

---

## Validación de Herramientas (tests de contrato)

Los tests de contrato en `tests/contract/` prueban cada herramienta contra un gateway simulado en memoria. Ejecutar con:

```bash
npm test -- tests/contract/
```

### `list_services` — Servicios autorizados (US-003 CA-1)
**Test**: `tests/contract/list-services.contract.test.ts`
**Gateway mock**: devuelve `ServicesInfo` con 2 servicios, `allow_q=true`, `scopes=['read']`
**Esperado**: Respuesta lista servicios, entornos, scopes y límites. No incluye API key ni hashes.

### `query_logs` — Logs recientes sin parámetros temporales (US-004 CA-1)
**Test**: `tests/contract/query-logs.contract.test.ts`
**Input**: `{ service: 'payments_api' }`
**Gateway mock**: devuelve 5 eventos con timestamps, niveles y mensajes
**Esperado**: Respuesta con eventos formateados, `sort=desc`, ventana por defecto de 1h, `request_id` del gateway incluido.

### `query_logs` — Respuesta vacía no es error (US-004 CA-4)
**Test**: `tests/contract/query-logs.contract.test.ts`
**Input**: `{ service: 'payments_api', since: '1h' }`
**Gateway mock**: devuelve `{ items: [], next_cursor: null, range_truncated: false, limit_truncated: false, request_id: 'req_1' }`
**Esperado**: Respuesta con mensaje "No se encontraron logs..." sin `isError: true`.

### `query_logs` — Validación de since+from mutuamente excluyentes (US-005 CA-3)
**Test**: `tests/contract/query-logs.contract.test.ts`
**Input**: `{ service: 'payments_api', since: '1h', from: '2026-06-07T08:00:00Z' }`
**Esperado**: Error de validación antes de llamar al gateway. Ninguna petición HTTP al mock.

### `query_logs` — Solo to sin from (US-005 CA-4)
**Input**: `{ service: 'payments_api', to: '2026-06-07T09:00:00Z' }`
**Esperado**: Error de validación. Ninguna petición HTTP al mock.

### `query_logs` — level como severidad mínima (SC-012, FR-014)
**Input**: `{ service: 'payments_api', level: 'warn' }`
**Esperado**: El gateway mock recibe `level=warn,error,fatal`. Verificar en los tests de contrato que el param generado es correcto.

### `search_logs` — Key con allow_q=true (US-007 CA-1)
**Test**: `tests/contract/search-logs.contract.test.ts`
**Caché de list_services**: `allow_q=true`
**Input**: `{ service: 'payments_api', query: 'timeout' }`
**Gateway mock**: devuelve 3 eventos
**Esperado**: El gateway recibe `q=timeout`. Resultados formateados con los 3 eventos.

### `search_logs` — Key con allow_q=false, error inmediato (US-007 CA-2)
**Caché de list_services**: `allow_q=false`
**Input**: `{ service: 'payments_api', query: 'timeout' }`
**Esperado**: Error informativo inmediato. El gateway mock no recibe ninguna petición.

### `get_recent_errors` — Con errores y campos de correlación (US-008 CA-1, CA-3)
**Test**: `tests/contract/get-recent-errors.contract.test.ts`
**Input**: `{ service: 'auth_service', since: '2h' }`
**Gateway mock**: devuelve 3 eventos de nivel `error`/`fatal` con `request_id` y `trace_id`
**Esperado**: Solo eventos de error/fatal. Los campos de correlación aparecen en la salida.

### `get_recent_errors` — Sin errores (US-008 CA-2)
**Gateway mock**: devuelve `items: []`
**Esperado**: "No se encontraron errores para auth_service..." sin `isError: true`.

### `summarize_errors` — Resumen parcial (US-009 CA-2)
**Test**: `tests/contract/summarize-errors.contract.test.ts`
**Configuración**: gateway mock devuelve 2 páginas con `next_cursor` en primera y `null` en segunda
**Input**: `{ service: 'payments_api', max_pages: 1 }`
**Esperado**: Respuesta indica explícitamente que el resumen es parcial.

### `get_log_by_trace_or_request` — Sin request_id ni trace_id (US-010 validación)
**Test**: `tests/contract/get-log-by-trace-or-request.contract.test.ts`
**Input**: `{ service: 'payments_api' }`
**Esperado**: Error de validación "Se requiere request_id o trace_id". Ninguna petición al gateway.

### `get_log_by_trace_or_request` — Fan-out con servicios fallidos (US-010 CA-3, edge case spec)
**Input**: `{ request_id: 'req_abc123' }` (sin service)
**Gateway mock**: 3 servicios — 2 responden OK, 1 devuelve 403
**Esperado**: Resultados de los 2 servicios correctos. El servicio fallido aparece reportado en la respuesta. No `isError: true` por el fallo parcial.

### `check_gateway_health` — Gateway vivo (US-011 CA-1)
**Test**: `tests/contract/check-gateway-health.contract.test.ts`
**Input**: `{}`
**Gateway mock**: `GET /health` devuelve `{ status: 'ok' }`
**Esperado**: "Liveness: ok ✓"

### `check_gateway_health` — Gateway vivo pero no listo (US-011 CA-2)
**Input**: `{ include_ready: true }`
**Gateway mock**: `/health` → `200 ok`, `/health/ready` → `503 not_ready`
**Esperado**: Respuesta distingue entre live=ok y ready=not_ready. No `isError: true`.

### `get_metrics` — Herramienta deshabilitada (US-014 CA-2)
**Test**: `tests/contract/get-metrics.contract.test.ts`
**Configuración**: `MCP_ENABLE_METRICS_TOOL=false`
**Input**: `{}`
**Esperado**: Mensaje informativo de herramienta deshabilitada. Sin petición al gateway.

### `get_metrics` — Habilitada, texto Prometheus crudo (US-014 CA-1, SC-011)
**Configuración**: `MCP_ENABLE_METRICS_TOOL=true`
**Gateway mock**: devuelve texto Prometheus de ejemplo
**Esperado**: Texto Prometheus crudo sin resúmenes ni parseo. No incluye secretos.

---

## Validación de Seguridad

### API key nunca visible en outputs (US-001 CA-3, SC-003, SC-010)
```bash
npm test -- tests/integration/secret-redaction.test.ts
```
**Esperado**: 100% de los tests de redacción pasan. La API key no aparece en ningún output de herramienta, mensaje de error ni log del servidor.

### Logs no escritos en stdout (FR-047, SC-009)
```bash
npm test -- tests/integration/startup.test.ts
```
**Esperado**: 100% de los tests de stdout pasan. stdout permanece limpio durante la operación MCP. Los logs van exclusivamente a stderr.

### Formato de logs con locale es-ES (FR-049)
```bash
npm test -- tests/unit/logger/format.test.ts
```
**Esperado**: Las fechas en logs de desarrollo usan formato `dd/MM/yyyy HH:mm:ss` (es-ES) no timestamps Unix crudos.

---

## Validación de Paginación (US-012)

### Primera página con cursor (CA-1)
**Test**: incluido en tests de contrato de `query_logs`
**Input**: `{ service: 'payments_api' }` (sin cursor)
**Gateway mock**: devuelve `next_cursor: 'crs_abc'`
**Esperado**: La respuesta MCP incluye el cursor para la siguiente petición.

### Autopaginación con max_pages=2 (CA-2)
**Input**: `{ service: 'payments_api', max_pages: 2 }`
**Gateway mock**: página 1 devuelve 5 items + `next_cursor`; página 2 devuelve 3 items + `null`
**Esperado**: La respuesta combina 8 items totales.

### max_pages excede MCP_MAX_PAGES (SC-008, FR-018)
**Input**: `{ service: 'payments_api', max_pages: 100 }` con `MCP_MAX_PAGES=5`
**Esperado**: El MCP recorta a 5 páginas máximo. No devuelve error de validación.

### Se alcanza max_pages sin agotar resultados (US-012 CA-3)
**Input**: `{ service: 'payments_api', max_pages: 2 }`
**Gateway mock**: devuelve `next_cursor` no nulo al final de la página 2
**Esperado**: Respuesta indica "puede haber más resultados disponibles".

---

## Validación de Errores del Gateway (US-013)

Ejecutar tests de contrato para errores HTTP:

```bash
npm test -- tests/contract/query-logs.contract.test.ts
```

| Código HTTP | Mensaje esperado en respuesta MCP |
|---|---|
| 401 | "API key ausente, inválida o mal configurada" |
| 403 (sin scope read) | "La key no tiene scope de lectura" |
| 403 (servicio) | "El servicio '...' no está autorizado para esta key" |
| 429 | "Rate limit o cola llena — espera antes de reintentar" |
| 502 | "El gateway no pudo consultar el almacenamiento de logs" |

**Regla**: Todos los errores preservan `request_id` del gateway cuando está disponible en el cuerpo del error (FR-025).

---

## Smoke Test Manual (gate previo a completar la feature)

Contra un gateway real o mock local corriendo en `http://localhost:8080`:

1. Arrancar el servidor MCP: `LOG_GATEWAY_URL=http://localhost:8080 LOG_GATEWAY_API_KEY=<key> npx tsx src/index.ts`
2. Invocar `check_gateway_health` — verificar respuesta live=ok
3. Invocar `list_services` — verificar servicios y permisos listados
4. Invocar `query_logs` con un servicio real — verificar eventos formateados
5. Verificar que stdout permanece limpio durante toda la sesión (solo stderr tiene logs)
6. Verificar que la API key no aparece en ningún output
