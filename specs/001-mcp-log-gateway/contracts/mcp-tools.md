# MCP Tool Contracts

**Feature**: `001-mcp-log-gateway` | **Date**: 2026-06-07 | **Plan**: [plan.md](../plan.md)

**Fuente normativa**: `specs/001-mcp-log-gateway/spec.md` (requisitos funcionales) + `docs/openapi.yaml` (endpoints del gateway).

---

## Convenciones Generales

- Todos los schemas de input usan Zod v4 (`zod` 4.4.3).
- Las herramientas devuelven `CallToolResult` del MCP SDK con `content: [{ type: 'text', text: '...' }]`.
- Errores de validación de input → `{ isError: true, content: [{ type: 'text', text: '<mensaje>' }] }`.
- Errores del gateway → `{ isError: true, content: [...] }` con mensaje comprensible y `request_id` si disponible.
- `level` se interpreta como severidad mínima y se expande antes de llamar al gateway (FR-014, SC-012).
- `limit` y `max_pages` se recortan silenciosamente al máximo efectivo sin devolver error (FR-018, FR-032).
- `include_total` no es un parámetro válido en ninguna herramienta en v1 (FR-039).

---

## 1. `list_services`

**Endpoint gateway**: `GET /api/v1/services`
**Requisitos**: FR-005, FR-041
**User Story**: US-003

**Descripción** (visible al agente — encoda política local-primero):
> Lista los servicios, entornos, scopes y límites autorizados para la API key configurada. Nota: lista servicios autorizados por la key, no necesariamente servicios activos. Úsala antes de consultar para verificar qué servicios y entornos están disponibles y si la key permite búsqueda textual (allow_q).

**Input schema**:
```typescript
z.object({})
```

**Params gateway generados**: ninguno (solo cabecera `Authorization: Bearer <key>`)

**Salida esperada (éxito)**:
```
Servicios autorizados (2):
  • payments_api — entornos: prod, staging
  • auth_service — entornos: prod

Scopes: read
Límites: max_limit=1000 | allow_q=true | ventana máxima: sin límite
Request-ID gateway: req_abc123
```

**Comportamientos de error**:
| Caso | isError | Mensaje |
|---|---|---|
| Gateway 401 | `true` | "API key ausente, inválida o mal configurada" |

**Notas de implementación**:
- Resultado cacheado en memoria con TTL 5 min (`src/tools/list-services.ts`)
- La caché se invalida cuando una consulta posterior devuelve 403 inesperado
- Nunca incluir en la salida la API key, hashes ni datos de otras keys

---

## 2. `query_logs`

**Endpoint gateway**: `GET /api/v1/logs`
**Requisitos**: FR-006, FR-013–FR-019, FR-026–FR-028, FR-038–FR-040
**User Stories**: US-004, US-005, US-006

**Descripción**:
> Consulta logs de un servicio con filtros opcionales de entorno, nivel, ventana temporal y paginación. Úsala para investigar eventos recientes o históricos. POLÍTICA: usa primero los logs locales del proyecto si el fallo es reciente y las rutas locales son conocidas; usa esta herramienta para histórico, entornos remotos o cuando los logs locales no bastan.

**Input schema**:
```typescript
z.object({
  service: z.string()
    .regex(/^[a-z0-9_]{3,64}$/, 'El servicio debe cumplir ^[a-z0-9_]{3,64}$'),
  env: z.string().optional(),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  since: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().optional(),
  sort: z.enum(['asc', 'desc']).default('desc'),
  max_pages: z.number().int().positive().optional(),
})
```

**Validaciones adicionales pre-gateway**:
1. `since` XOR (`from` / `to`) — mutuamente excluyentes
2. `to` sin `from` → error de validación
3. `from > to` → error de validación
4. `from` sin `to` → `to = now` (regla de la spec)
5. Sin parámetros temporales → usar `MCP_DEFAULT_SINCE`
6. `level` → expandir como severidad mínima: `level=error` → `error,fatal`
7. `limit` → `min(limit, MCP_MAX_LIMIT)` silencioso
8. `max_pages` → `min(max_pages, MCP_MAX_PAGES)` silencioso

**Params gateway generados**:
```
service, from, to, level (expandido), env?, limit?, cursor?, sort
```

**Salida esperada (éxito con resultados)**:
```
Logs de payments_api (prod) — 3 eventos
Ventana: 2026-06-07T08:00:00Z → 2026-06-07T09:00:00Z | Orden: desc

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
07/06/2026 09:00:01  ERROR  payments_api
Payment processing failed: timeout connecting to stripe
↳ request_id: req_xyz | trace_id: trc_abc
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Paginación: next_cursor=crs_xyz | range_truncated=false | limit_truncated=false
Request-ID gateway: req_gateway_123
```

**Salida esperada (sin resultados)**:
```
No se encontraron logs para payments_api en la ventana
2026-06-07T08:00:00Z → 2026-06-07T09:00:00Z.
Request-ID gateway: req_gateway_123
```

---

## 3. `search_logs`

**Endpoint gateway**: `GET /api/v1/logs?q=...`
**Requisitos**: FR-007, FR-013–FR-019, FR-026–FR-028, FR-038–FR-040
**User Story**: US-007

**Descripción**:
> Busca logs que contengan un texto, ID de usuario, fragmento de error o cualquier cadena. Requiere que la API key tenga allow_q=true (verificar con list_services). Si allow_q=false, esta herramienta devuelve un error informativo inmediato sin contactar al gateway.

**Input schema**:
```typescript
z.object({
  service: z.string()
    .regex(/^[a-z0-9_]{3,64}$/, 'El servicio debe cumplir ^[a-z0-9_]{3,64}$'),
  query: z.string().min(1, 'El texto de búsqueda no puede estar vacío'),
  env: z.string().optional(),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  since: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().optional(),
  sort: z.enum(['asc', 'desc']).default('desc'),
  max_pages: z.number().int().positive().optional(),
})
```

**Pre-verificación de allow_q** (FR-007):
```
1. Consultar caché de list_services
2. Si allow_q === false (conocido) → devolver error informativo inmediato SIN llamar al gateway
3. Si caché no disponible → llamar al gateway; si responde 403 → comunicar como restricción de permisos
```

**Params gateway generados**:
```
service, q (= input.query), from, to, level (expandido)?, env?, limit?, cursor?, sort
```

**Error por allow_q=false**:
```
Esta API key no permite búsqueda textual libre (allow_q=false).
Usa query_logs con filtros de nivel, entorno y ventana temporal para acotar la búsqueda.
```

---

## 4. `get_recent_errors`

**Endpoint gateway**: `GET /api/v1/logs?level=error,fatal`
**Requisitos**: FR-008, FR-013–FR-019, FR-026–FR-028, FR-038–FR-040
**User Story**: US-008

**Descripción**:
> Obtiene los errores (nivel error y fatal) más recientes de un servicio. Diseñada para diagnosis rápida de problemas activos. Equivale a query_logs con level=error expandido automáticamente.

**Input schema**:
```typescript
z.object({
  service: z.string()
    .regex(/^[a-z0-9_]{3,64}$/),
  env: z.string().optional(),
  since: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().optional(),
  sort: z.enum(['asc', 'desc']).default('desc'),
  max_pages: z.number().int().positive().optional(),
})
```

**Nivel fijo**: siempre `level=error,fatal` en el gateway. No expone el parámetro `level` al agente.

**Salida incluye campos de correlación** (US-008 CA-3):
```
Errores recientes de auth_service (prod) — 2 eventos (última hora)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
07/06/2026 08:55:01  ERROR  auth_service
Token validation failed: invalid signature
↳ request_id: req_abc | trace_id: trc_xyz | span_id: sp_001
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Request-ID gateway: req_gateway_456
```

**Sin errores en la ventana** (US-008 CA-2):
```
No se encontraron errores para auth_service en la última hora.
Request-ID gateway: req_gateway_456
```

---

## 5. `summarize_errors`

**Endpoint gateway**: `GET /api/v1/logs?level=error,fatal` (con autopaginación) + agrupación local
**Requisitos**: FR-009, FR-013–FR-019, FR-026–FR-028
**User Story**: US-009

**Descripción**:
> Agrupa y cuenta los errores más frecuentes de un servicio en una ventana temporal. Devuelve los N mensajes de error más comunes con su conteo y último timestamp. Útil para priorizar qué investigar. Nota: si hay muchos datos, el resumen puede ser parcial.

**Input schema**:
```typescript
z.object({
  service: z.string()
    .regex(/^[a-z0-9_]{3,64}$/),
  env: z.string().optional(),
  since: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().optional(),
  max_pages: z.number().int().positive().optional(),
  top: z.number().int().min(1).max(50).default(10),
})
```

**Lógica de agrupación** (local, post-gateway — US-009 CA-1):
1. Recuperar hasta `max_pages` páginas de eventos `error` y `fatal`
2. Normalizar mensajes: `message.trim().replace(/\s+/g, ' ')`
3. Agrupar por mensaje normalizado, contar ocurrencias, registrar último `_timestamp`
4. Devolver los `top` N grupos más frecuentes ordenados por conteo descendente

**Indicador de parcialidad** (US-009 CA-2):
```
⚠ Resumen parcial: basado en [N] páginas de resultados. Puede haber más errores no representados.
```

**Salida esperada**:
```
Resumen de errores — payments_api (última hora)
Top 3 de 5 mensajes únicos | Basado en 47 eventos

  1. [23x] Payment processing failed: timeout connecting to stripe
     Último: 07/06/2026 08:58:30

  2. [15x] Invalid card number format
     Último: 07/06/2026 08:45:12

  3. [9x] Database connection pool exhausted
     Último: 07/06/2026 08:30:05

Request-ID gateway (última página): req_gateway_789
```

---

## 6. `get_log_by_trace_or_request`

**Endpoint gateway**: `GET /api/v1/logs?request_id=...` o `?trace_id=...`
**Requisitos**: FR-010, FR-013–FR-019, FR-026–FR-028, FR-038–FR-040
**User Story**: US-010

**Descripción**:
> Busca todos los logs asociados a un request_id o trace_id concreto. Ideal para reconstruir el flujo completo de una petición a través de servicios. Si no se especifica servicio, busca en todos los servicios autorizados hasta el límite MCP_MAX_SERVICES_FANOUT (pool concurrente de 3–5 peticiones simultáneas).

**Input schema**:
```typescript
z.object({
  request_id: z.string().optional(),
  trace_id: z.string().optional(),
  service: z.string().regex(/^[a-z0-9_]{3,64}$/).optional(),
  env: z.string().optional(),
  since: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().optional(),
  sort: z.enum(['asc', 'desc']).default('asc'),
  max_pages: z.number().int().positive().optional(),
}).refine(
  (d) => d.request_id !== undefined || d.trace_id !== undefined,
  { message: 'Se requiere request_id o trace_id (o ambos)' }
)
```

**Flujo con fan-out** (US-010 CA-3, FR-010):
```
1. Si service presente → consultar solo ese servicio
2. Si sin service:
   a. Llamar a list_services (caché)
   b. Limitar a min(len(services), MCP_MAX_SERVICES_FANOUT) servicios
   c. Pool concurrente: lotes de 3–5 con Promise.allSettled
   d. Acumular resultados; registrar servicios fallidos
   e. Reportar servicios fallidos en la respuesta (SC-007)
```

**Params gateway generados** (por servicio):
```
service, request_id?, trace_id?, from, to, limit?, cursor?, sort
```

**Salida esperada (fan-out)**:
```
Logs para request_id=req_abc123 — 3 servicios consultados

━━━ payments_api (3 eventos) ━━━
07/06/2026 08:30:01  INFO  payments_api
Payment request received
↳ trace_id: trc_xyz

...

━━━ Servicios sin resultados: auth_service ━━━
━━━ Servicios con error de consulta: notification_svc (403 Forbidden) ━━━

Request-IDs gateway: req_gw_1, req_gw_2, req_gw_3
```

---

## 7. `check_gateway_health`

**Endpoints gateway**: `GET /api/v1/health`, `GET /api/v1/health/ready`
**Requisitos**: FR-011
**User Story**: US-011

**Descripción**:
> Comprueba si el Log Gateway está vivo y, opcionalmente, listo para aceptar consultas. Úsala para diagnosticar problemas de conectividad antes de concluir que no hay logs o que el MCP está mal configurado.

**Input schema**:
```typescript
z.object({
  include_ready: z.boolean().default(false),
})
```

**Lógica**:
- Siempre llama a `GET /api/v1/health` (liveness — sin API key requerida)
- Si `include_ready=true` → también llama a `GET /api/v1/health/ready` (sin API key)
- Respuesta `503` de `/health/ready` → `not_ready`, no es un error técnico del MCP (`isError: false`)
- Gateway no disponible → `isError: true` con mensaje de conectividad

**Salida (gateway vivo y listo)**:
```
Estado del gateway:
  • Liveness: ok ✓
  • Readiness: ready ✓
```

**Salida (gateway vivo pero no listo)**:
```
Estado del gateway:
  • Liveness: ok ✓
  • Readiness: not_ready — el gateway está vivo pero no puede servir consultas aún
```

**Error (gateway no disponible)**:
```
Error de conectividad: No se pudo conectar al gateway en http://localhost:8080.
Comprueba que LOG_GATEWAY_URL es correcto y el gateway está corriendo.
```

---

## 8. `get_metrics`

**Endpoint gateway**: `GET /api/v1/metrics`
**Requisitos**: FR-012, SC-011
**User Story**: US-014

**Descripción**:
> Obtiene las métricas Prometheus del Log Gateway. Solo disponible si MCP_ENABLE_METRICS_TOOL=true. Útil para diagnosticar rate limiting, cola llena o fallos de backend. Devuelve el texto Prometheus crudo sin parsear ni resumir.

**Input schema**:
```typescript
z.object({})
```

**Lógica**:
1. Si `MCP_ENABLE_METRICS_TOOL=false` → respuesta informativa inmediata sin llamar al gateway
2. Si habilitado → `GET /api/v1/metrics` (endpoint público, sin API key)
3. Devolver texto Prometheus crudo (SC-011: nunca resumir ni parsear en v1)
4. La salida no debe incluir secretos ni configuración sensible

**Salida cuando está deshabilitado** (`isError: false`):
```
La herramienta de métricas está deshabilitada (MCP_ENABLE_METRICS_TOOL=false).
Para habilitarla, configura MCP_ENABLE_METRICS_TOOL=true al arrancar el servidor.
```

**Salida cuando está habilitado**:
```
Métricas del gateway (formato Prometheus):

# HELP gateway_requests_total Total de peticiones recibidas
# TYPE gateway_requests_total counter
gateway_requests_total{method="GET",endpoint="/api/v1/logs"} 1234
...
```

---

## Matriz de Herramientas vs. Endpoints

| Herramienta | Endpoint gateway | Auth requerida | FR principal |
|---|---|---|---|
| `list_services` | `GET /api/v1/services` | Sí | FR-005 |
| `query_logs` | `GET /api/v1/logs` | Sí | FR-006 |
| `search_logs` | `GET /api/v1/logs?q=` | Sí | FR-007 |
| `get_recent_errors` | `GET /api/v1/logs?level=error,fatal` | Sí | FR-008 |
| `summarize_errors` | `GET /api/v1/logs?level=error,fatal` | Sí | FR-009 |
| `get_log_by_trace_or_request` | `GET /api/v1/logs?request_id=` / `?trace_id=` | Sí | FR-010 |
| `check_gateway_health` | `GET /api/v1/health`, `GET /api/v1/health/ready` | No | FR-011 |
| `get_metrics` | `GET /api/v1/metrics` | No | FR-012 |

Ninguna herramienta usa `POST`, `PUT`, `PATCH` ni `DELETE`. Ninguna herramienta accede a endpoints de OpenObserve directamente.
