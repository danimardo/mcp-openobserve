# Data Model: MCP Log Gateway

**Feature**: `001-mcp-log-gateway` | **Date**: 2026-06-07 | **Plan**: [plan.md](./plan.md)

Fuente normativa: `docs/openapi.yaml` (schemas `LogEventOutput`, `QueryResult`, `ServicesInfo`, `Error`).

---

## Entidades de Dominio

### LogEvent (salida del gateway)

Evento normalizado tal como lo devuelve el gateway en `QueryResult.items`. Todos los campos son opcionales en salida porque el gateway puede devolver eventos parcialmente poblados.

| Campo | Tipo | Fuente OpenAPI | Descripción |
|---|---|---|---|
| `_timestamp` | `string` (ISO-8601) | `LogEventOutput._timestamp` | Timestamp del evento |
| `service` | `string` | `LogEventOutput.service` | Servicio emisor (`^[a-z0-9_]{3,64}$`) |
| `env` | `string` | `LogEventOutput.env` | Entorno (prod, staging, dev, test…) |
| `level` | `trace\|debug\|info\|warn\|error\|fatal` | `LogEventOutput.level` | Nivel de severidad normalizado |
| `message` | `string` | `LogEventOutput.message` | Mensaje del evento |
| `version` | `string` | `LogEventOutput.version` | Versión de la aplicación |
| `event_id` | `string` | `LogEventOutput.event_id` | ID único del evento |
| `trace_id` | `string` | `LogEventOutput.trace_id` | ID de traza distribuida |
| `span_id` | `string` | `LogEventOutput.span_id` | ID de span |
| `request_id` | `string` | `LogEventOutput.request_id` | ID de petición HTTP |
| `hostname` | `string` | `LogEventOutput.hostname` | Host emisor |
| `source` | `backend\|frontend\|unknown` | `LogEventOutput.source` | Origen normalizado por el gateway |
| `context` | `object` | `LogEventOutput.context` | Datos adicionales (objeto anidado reconstruido por el gateway) |
| `context_truncated` | `boolean` | `LogEventOutput.context_truncated` | `true` si context fue recortado en ingesta |

---

### QueryResult (respuesta del gateway a `GET /api/v1/logs`)

| Campo | Tipo | Fuente OpenAPI | Requerido | Descripción |
|---|---|---|---|---|
| `items` | `LogEvent[]` | `QueryResult.items` | Sí | Eventos de log de esta página |
| `next_cursor` | `string \| null` | `QueryResult.next_cursor` | Sí | Cursor para siguiente página; `null` si no hay más |
| `range_truncated` | `boolean` | `QueryResult.range_truncated` | Sí | `true` si la ventana fue recortada por el gateway |
| `limit_truncated` | `boolean` | `QueryResult.limit_truncated` | Sí | `true` si se aplicó el límite máximo |
| `total` | `number` | `QueryResult.total` | No | Solo si el gateway lo incluye; el MCP nunca lo solicita (FR-039) |
| `request_id` | `string` | `QueryResult.request_id` | Sí | ID de la petición al gateway para trazabilidad |

**Regla FR-040**: El MCP preserva `next_cursor`, `range_truncated`, `limit_truncated` y `total` si el gateway los devuelve, pero nunca envía `include_total=true` al gateway.

---

### ServicesInfo (respuesta de `GET /api/v1/services` + entidad de caché)

| Campo | Tipo | Fuente OpenAPI | Requerido | Descripción |
|---|---|---|---|---|
| `services` | `string[]` | `ServicesInfo.services` | Sí | Servicios autorizados para la key (no necesariamente activos) |
| `envs` | `string[]` | `ServicesInfo.envs` | Sí | Entornos autorizados |
| `scopes` | `('read'\|'write')[]` | `ServicesInfo.scopes` | Sí | Scopes de la key |
| `limits.max_query_window` | `string \| null` | `ServicesInfo.limits.max_query_window` | No | Ventana máxima; `null` para keys backend (sin límite) |
| `limits.max_limit` | `number` | `ServicesInfo.limits.max_limit` | No | Límite máximo de resultados para esta key |
| `limits.allow_q` | `boolean` | `ServicesInfo.limits.allow_q` | No | Si la key permite búsqueda textual libre |
| `limits.response_profile` | `'full'\|'frontend_reduced'` | `ServicesInfo.limits.response_profile` | No | Perfil de respuesta |
| `request_id` | `string` | `ServicesInfo.request_id` | Sí | ID de la petición al gateway |

**Caché** (`src/tools/list-services.ts`):
- TTL: 5 minutos en memoria
- Invalidación: ante 403 inesperado en consulta que debería ser autorizada según el caché
- Contenido del caché: solo `ServicesInfo`; nunca se cachea la API key ni hashes de key

---

### TimeWindow (resultado de `src/time.ts`)

Representa la ventana temporal resuelta a partir de los parámetros del agente, lista para enviar al gateway.

| Campo | Tipo | Descripción |
|---|---|---|
| `from` | `string` (ISO-8601 con zona horaria) | Inicio de ventana |
| `to` | `string` (ISO-8601 con zona horaria) | Fin de ventana |

**Algoritmo de construcción** (FR-015, FR-016, US-005):

```
1. Si since Y (from O to) → error de validación: "since y from/to son mutuamente excluyentes"
2. Si solo to sin from → error de validación: "Si se especifica to, debe especificarse from"
3. Si from > to → error de validación: "from debe ser anterior a to"
4. Si solo from sin to → to = ahora (ISO-8601)
5. Si since → from = ahora - since, to = ahora
6. Si nada → usar MCP_DEFAULT_SINCE (por defecto "1h"): from = ahora - 1h, to = ahora
```

**Formato `since`**: `<número><unidad>` donde unidad ∈ `{s, m, h, d}`.
Ejemplos válidos: `30s`, `15m`, `1h`, `24h`, `7d`.

---

### PaginationState (interno de `src/pagination.ts`)

Estado de control de autopaginación con `max_pages`.

| Campo | Tipo | Descripción |
|---|---|---|
| `currentPage` | `number` | Página actual (1-based) |
| `maxPages` | `number` | `min(requestedMaxPages, MCP_MAX_PAGES)` — siempre efectivo |
| `cursor` | `string \| null` | Cursor para próxima petición; `null` en primera página |
| `accumulated` | `LogEvent[]` | Items acumulados de todas las páginas hasta ahora |
| `hasMore` | `boolean` | Indica si el gateway devolvió `next_cursor` no nulo |

**Reglas de paginación** (FR-017–FR-019, US-012):
1. `max_pages` se recorta silenciosamente al máximo efectivo — sin error (FR-018)
2. `limit` se recorta silenciosamente al `min(solicitado, effectiveMaxLimit)` — sin error (FR-032)
3. Si `next_cursor === null` → parar, aunque `currentPage < maxPages` (FR-019)
4. Si `currentPage === maxPages` → parar e indicar en la respuesta que puede haber más resultados
5. Nunca bucles indefinidos — el bucle tiene cota `maxPages` (FR-019)

---

### Config (entidad validada de `src/config.ts`)

Configuración del servidor MCP construida y validada al arrancar desde variables de entorno.

#### Variables obligatorias (fallo explícito si faltan — FR-002)

| Variable | Descripción |
|---|---|
| `LOG_GATEWAY_URL` | URL base del gateway (sin trailing slash) |
| `LOG_GATEWAY_API_KEY` | Bearer token en formato `key_id.secret` |

#### Variables opcionales y sus defaults (FR-003, FR-029–FR-037)

| Variable | Default | Descripción |
|---|---|---|
| `LOG_GATEWAY_API_PREFIX` | `/api/v1` | Prefijo de ruta API |
| `LOG_LEVEL` | `warn` (prod) / `info` (resto) | Nivel de logging del servidor |
| `PUBLIC_LOG_LEVEL` | `warn` | Nivel de logging cliente (sin efecto en v1 servidor) |
| `MCP_DEFAULT_ENV` | `''` (vacío) | Entorno por defecto si el agente no especifica |
| `MCP_DEFAULT_SINCE` | `1h` | Ventana temporal por defecto |
| `MCP_DEFAULT_LIMIT` | `100` | Límite de resultados por defecto |
| `MCP_MAX_LIMIT` | `1000` | Límite máximo efectivo — recorte silencioso |
| `MCP_MAX_PAGES` | `5` | Páginas máximas para autopaginación — recorte silencioso |
| `MCP_REQUEST_TIMEOUT_MS` | `15000` | Timeout HTTP en ms + 1 reintento ante AbortError |
| `MCP_ENABLE_METRICS_TOOL` | `true` | Habilita/deshabilita herramienta `get_metrics` |
| `MCP_MAX_SERVICES_FANOUT` | `20` | Máximo de servicios en fan-out por traza |
| `MCP_RESPONSE_MAX_CHARS` | `50000` | Caracteres máximos en respuesta de herramienta |

#### Variables rechazadas (fallo al arrancar — FR-004)

`OO_URL`, `OO_USER`, `OO_PASSWORD`, `OO_ORG`, `OO_STREAM` — el servidor detecta estas variables y falla con mensaje claro indicando que la configuración directa de OpenObserve no está permitida.

---

### GatewayError (tipos en `src/errors.ts`)

Clasificación de errores del gateway para mensajería comprensible al agente (FR-024, FR-025).

| Código HTTP / Tipo | Clase interna | Mensaje al agente |
|---|---|---|
| 400 | `ValidationError` | "Parámetros de consulta inválidos: {detail del gateway}" |
| 401 | `AuthError` | "API key ausente, inválida o mal configurada" |
| 403 — sin scope read | `ForbiddenError` | "La key no tiene scope de lectura" |
| 403 — servicio no autorizado | `ForbiddenError` | "El servicio '{service}' no está autorizado para esta key" |
| 403 — entorno no autorizado | `ForbiddenError` | "El entorno '{env}' no está autorizado para esta key" |
| 403 — allow_q restringido | `ForbiddenError` | "Esta API key no permite búsqueda textual libre (allow_q=false)" |
| 429 | `RateLimitError` | "Rate limit o cola llena — espera antes de reintentar" |
| 502 | `BackendError` | "El gateway no pudo consultar el almacenamiento de logs" |
| 503 | `UnavailableError` | "El gateway no está disponible en este momento" |
| AbortError (timeout) | `TimeoutError` | "La petición superó el timeout de {ms}ms y el reintento también falló" |
| Error de red | `NetworkError` | "No se pudo conectar al gateway en {url}: {reason}" |

**Regla FR-025**: Todos los errores preservan `request_id` del gateway en la respuesta cuando está disponible en el cuerpo del error.

---

### ToolResponse (formato de salida de herramientas — `src/formatters.ts`)

Estructura estándar de respuesta legible para el agente (FR-026, FR-027, FR-028).

#### Éxito con resultados

```
Logs de [servicio] ([env]) — [N] eventos [from] → [to]
Orden: [asc|desc] | Página [X] de [max_pages máx.]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[timestamp]  [NIVEL]  [servicio]
[mensaje]
↳ request_id: [valor] | trace_id: [valor si presente]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Paginación: next_cursor=[token] | Sin más páginas
Truncado: range_truncated=[bool], limit_truncated=[bool]
Request-ID gateway: [request_id]
```

#### Sin resultados (no es error técnico — FR-027)

```
No se encontraron logs para [servicio] en la ventana [from] → [to].
Request-ID gateway: [request_id]
```

#### Error de herramienta (isError: true)

```
Error [tipo]: [mensaje comprensible]
Request-ID gateway: [request_id si disponible]
```

#### Truncado por MCP_RESPONSE_MAX_CHARS (FR-028)

Se añade al final de la respuesta:
```
... [respuesta truncada — {N} caracteres adicionales omitidos]
```

---

## Reglas de Validación de Entrada

### Universales (todas las herramientas — pre-gateway)

| Parámetro | Validación | Resultado si falla |
|---|---|---|
| `service` | Regex `^[a-z0-9_]{3,64}$` | Error: "El nombre de servicio debe cumplir ^[a-z0-9_]{3,64}$" |
| `level` | ∈ `{trace,debug,info,warn,error,fatal}` | Error: "Nivel de log inválido: '{valor}'. Valores: trace,debug,info,warn,error,fatal" |
| `since` + `from`/`to` simultáneos | Mutuamente excluyentes | Error: "since y from/to son mutuamente excluyentes" |
| Solo `to` sin `from` | Rechazado | Error: "Si se especifica to, también debe especificarse from" |
| `from > to` | Rechazado | Error: "from debe ser anterior a to" |
| `limit` > `MCP_MAX_LIMIT` | Recorte silencioso | Ninguno — se aplica `min(limit, effectiveMax)` |
| `max_pages` > `MCP_MAX_PAGES` | Recorte silencioso | Ninguno — se aplica `min(max_pages, MCP_MAX_PAGES)` |
| `include_total` presente | Rechazado o ignorado | Error/Info: "include_total no está soportado en v1" |

### Específicas por herramienta

| Herramienta | Validación adicional |
|---|---|
| `search_logs` | Verificar `allow_q` en caché de `/services` antes de llamar al gateway (FR-007) |
| `get_log_by_trace_or_request` | Al menos uno de `request_id` o `trace_id` debe estar presente (FR-010) |
| `get_metrics` | Verificar `MCP_ENABLE_METRICS_TOOL=true` antes de cualquier llamada al gateway (FR-012) |
