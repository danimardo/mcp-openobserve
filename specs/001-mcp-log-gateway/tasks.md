---
description: "Task list for MCP Log Gateway implementation"
---

# Tasks: MCP Log Gateway

**Input**: Design documents from `specs/001-mcp-log-gateway/`

**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/mcp-tools.md ✅ | quickstart.md ✅

**Tests**: Tests son OBLIGATORIOS en este proyecto. Incluir tareas failing-first de unit, contract, integration y secret-redaction para cada user story. La cobertura DEBE mantenerse en ≥80% líneas, ramas, funciones y sentencias (constitución III).

**Organization**: Tareas organizadas por user story para implementación y prueba independiente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (ficheros distintos, sin dependencias de tareas incompletas)
- **[Story]**: User story a la que pertenece la tarea (US1–US15)
- Incluir rutas de fichero exactas en las descripciones

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Inicialización del proyecto — crea el esqueleto que rellena la fase fundacional.

- [X] T001 Inicializar proyecto npm: crear package.json con `"type": "module"`, scripts (`build`, `dev`, `lint`, `typecheck`, `test`, `coverage`) y metadatos del proyecto en la raíz del repositorio
- [X]  Configurar TypeScript: crear tsconfig.json con `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true`, `"target": "ES2022"`, `outDir: ./dist`, `rootDir: ./src`
- [X]  [P] Instalar dependencias de producción: @modelcontextprotocol/sdk@1.29.0, zod@4.4.3, pino@10.3.1, pino-pretty@13.1.3
- [X]  [P] Instalar dependencias de desarrollo: tsx@4.22.4, vitest@4.1.8, @vitest/coverage-v8, eslint@10.4.1, prettier@3.8.3, @types/node@25.9.2
- [X]  [P] Configurar ESLint: crear eslint.config.js con reglas TypeScript, regla `no-console` para src/ y integración con Prettier
- [X]  [P] Configurar Prettier: crear .prettierrc con reglas de formato del proyecto
- [X]  Configurar Vitest: crear vitest.config.ts con provider de cobertura `v8`, umbrales ≥80% para lines/branches/functions/statements, y patrón de inclusión `tests/**/*.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Módulos de infraestructura compartida (logger, config, errores, gateway client, utilidades) de los que dependen TODOS los user stories.

**⚠️ CRÍTICO**: Ninguna fase de user story puede comenzar hasta completar esta fase. Tests DEBEN escribirse primero y DEBEN FALLAR antes de la implementación.

### Tests Fundacionales (escribir primero, deben FALLAR)

- [X]  [P] Escribir tests unitarios failing para mapeo de nivel en tests/unit/logger/levels.test.ts: verificar que LOG_LEVEL env controla el nivel; default en producción es `warn`; default fuera de producción es `info`; LOG_LEVEL explícito sobreescribe el default de NODE_ENV
- [X]  [P] Escribir tests unitarios failing para redacción en tests/unit/logger/redaction.test.ts: verificar que secrets/tokens/passwords/cabeceras Authorization/campos api_key aparecen como `[REDACTED]` en el output de log; campos normales pasan sin cambios
- [X]  [P] Escribir tests unitarios failing para formato de log en tests/unit/logger/format.test.ts: verificar que pino-pretty está configurado para stderr (nunca stdout); fechas renderizadas como `dd/MM/yyyy HH:mm:ss` (es-ES/Europe/Madrid); ningún fichero de src/ usa console.* directamente
- [X]  [P] Escribir tests unitarios failing para parseo de config en tests/unit/config.test.ts: LOG_GATEWAY_URL + LOG_GATEWAY_API_KEY requeridos (ausentes → error claro sin imprimir key); OO_URL/OO_USER/OO_PASSWORD/OO_ORG/OO_STREAM presentes → fallo en arranque; todas las vars opcionales parsean a sus defaults documentados; redacción aplicada en mensajes de error
- [X]  [P] Escribir tests unitarios failing para tipos de error en tests/unit/errors.test.ts: AuthError para 401; ForbiddenError para 403 con mensajes de contexto; GatewayValidationError para 400 (entrada rechazada por el gateway); RateLimitError para 429; BackendError para 502; UnavailableError para 503; TimeoutError para AbortError; NetworkError para fallo de red; request_id preservado en todos los tipos de error
- [X]  [P] Escribir tests unitarios failing para parseo de tiempo en tests/unit/time.test.ts: `since` parsea `30s`, `15m`, `1h`, `24h`, `7d` correctamente; `since` + `from`/`to` simultáneos → error de validación; solo `to` sin `from` → error de validación; `from > to` → error de validación; solo `from` → `to = now`; sin params → usa MCP_DEFAULT_SINCE (1h)
- [X] b [P] Escribir tests unitarios failing para expansión de nivel en tests/unit/time.test.ts: `expandLevel('trace')` → `['trace','debug','info','warn','error','fatal']`; `expandLevel('info')` → `['info','warn','error','fatal']`; `expandLevel('warn')` → `['warn','error','fatal']`; `expandLevel('error')` → `['error','fatal']`; `expandLevel('fatal')` → `['fatal']`; nivel inválido → error de validación (FR-014, SC-012)
- [X]  [P] Escribir tests unitarios failing para paginación en tests/unit/pagination.test.ts: `max_pages` recortado silenciosamente a MCP_MAX_PAGES; `limit` recortado silenciosamente a MCP_MAX_LIMIT; `next_cursor === null` detiene el bucle aunque `currentPage < maxPages`; alcanzar maxPages añade indicador "puede haber más resultados"
- [X]  [P] Escribir tests unitarios failing para formatters en tests/unit/formatters.test.ts: formato de éxito incluye timestamp/level/service/env/message/campos de correlación; resultado vacío devuelve texto "no se encontraron logs" explícito (no isError); formato de error incluye tipo y mensaje; respuesta truncada en MCP_RESPONSE_MAX_CHARS con marcador

### Implementación del Logger

- [X]  Implementar src/logger/levels.ts: exportar `effectiveLogLevel()` que devuelve `process.env.LOG_LEVEL` si está definido, `warn` si `NODE_ENV=production`, o `info` en caso contrario
- [X]  [P] Implementar src/logger/redaction.ts: exportar array `REDACT_PATHS` cubriendo `authorization`, `headers.authorization`, `headers.Authorization`, `apiKey`, `api_key`, `password`, `token`, `secret`, `*.authorization`, `*.token`, `*.password`, `*.apiKey`, `*.api_key` para redacción de Pino
- [X]  Implementar src/logger/format.ts: exportar objeto de configuración de transport pino-pretty con `destination: 2` (stderr), `colorize: true`, `translateTime: 'SYS:dd/MM/yyyy HH:mm:ss'`, `messageFormat: '{msg}'`; exportar helper `isDevelopment()`
- [X]  Implementar src/logger.ts: crear instancia Pino dirigida a stderr (`pino.destination(2)`) con redacción de REDACT_PATHS y censor `[REDACTED]`; en desarrollo usar transport pino-pretty configurado para stderr; exportar objeto `logger` tipado como única API de logging para el código de aplicación

### Implementación de Utilidades Core

- [X]  Implementar src/errors.ts: definir clase base `GatewayError` y subtipos — `AuthError` (401), `ForbiddenError` (403), `GatewayValidationError` (400), `RateLimitError` (429), `BackendError` (502), `UnavailableError` (503), `TimeoutError` (AbortError), `NetworkError` (fallo de red); cada uno preserva campo opcional `requestId`
- [X]  Implementar src/config.ts: parsear y validar vars de entorno con Zod; rechazar variables OO_* en arranque con mensaje claro; requerir LOG_GATEWAY_URL y LOG_GATEWAY_API_KEY (fallar con nombre de la variable ausente, sin secret en el error); aplicar todos los defaults opcionales del data-model.md entidad Config; exportar objeto `Config` tipado
- [X]  Implementar src/time.ts: exportar `resolveTimeWindow(params)` que devuelve `{ from: string, to: string }` en ISO-8601; implementar parseo de since (`^(\d+)(s|m|h|d)$`), validación de exclusión mutua, rechazo de solo-to, from-sin-to defaulting a now, y sin-params defaulting a MCP_DEFAULT_SINCE; exportar `expandLevel(level: string): string[]` que devuelve el nivel dado y todos los de mayor severidad según el orden `trace < debug < info < warn < error < fatal`; lanzar `ValidationError` si el nivel no es uno de los seis valores válidos (FR-014)
- [X]  Implementar src/pagination.ts: exportar tipo `PaginationState` y función `runPaginated(fetchPage, config)` que enforza `maxPages = min(requested, MCP_MAX_PAGES)`, `limit = min(requested, MCP_MAX_LIMIT)`, para cuando `next_cursor === null`, y establece `hasMore = true` cuando se alcanza maxPages con cursor no nulo
- [X]  Implementar src/formatters.ts: exportar `formatLogsResponse(items, meta)` para éxito, `formatEmptyResponse(service, window)` para resultado vacío (no isError), `formatErrorResponse(error)` para errores, y `truncateIfNeeded(text, maxChars)` que añade marcador de truncado; usar `Intl.DateTimeFormat` con `locale: 'es-ES'` y `timeZone: 'Europe/Madrid'` para timestamps legibles por humanos
- [X]  Implementar src/gateway-client.ts: exportar clase `GatewayClient` con métodos para cada endpoint del gateway; usar `fetch` nativa con `AbortController` para timeout (`MCP_REQUEST_TIMEOUT_MS`); ante `AbortError` hacer un único reintento tras pausa de 1–2 s; mapear códigos HTTP a subtipos de GatewayError; construir URLs desde `LOG_GATEWAY_URL + LOG_GATEWAY_API_PREFIX`; nunca incluir API key en errores ni logs

**Checkpoint**: Fundación completa — todos los tests T008–T015 deben PASAR antes de iniciar fases de user stories

---

## Phase 3: User Story 1 — Configurar y arrancar el servidor MCP (Priority: P1) 🎯 MVP

**Goal**: El servidor MCP arranca correctamente con configuración válida y falla con mensaje claro cuando falta configuración. Arranque en < 5 s.

**Independent Test**: `LOG_GATEWAY_URL` y `LOG_GATEWAY_API_KEY` definidos → proceso activo listo para llamadas MCP. Variables ausentes → proceso termina con mensaje claro identificando la variable faltante sin imprimir credenciales.

### Tests para US-001 ⚠️ (escribir primero, deben FALLAR)

- [X]  [P] [US1] Escribir test de integración failing — arranque correcto — en tests/integration/startup.test.ts: spawnear proceso con vars de entorno válidas; verificar que arranca sin error y queda en espera de stdin; verificar que stdout permanece vacío; verificar que stderr recibe log de arranque
- [X]  [P] [US1] Escribir test de integración failing — vars obligatorias ausentes — en tests/integration/startup.test.ts: spawnear sin LOG_GATEWAY_URL → proceso termina con código no-cero y stderr identifica la variable faltante; repetir para LOG_GATEWAY_API_KEY; verificar que la key nunca aparece en stderr
- [X]  [P] [US1] Escribir test de integración failing — vars OO_* rechazadas — en tests/integration/startup.test.ts: spawnear con OO_URL presente junto a vars del gateway válidas; verificar fallo en arranque con mensaje claro indicando que OO_URL no está permitido (FR-004)

### Implementación US-001

- [X]  [US1] Implementar src/index.ts: crear instancia `McpServer` con nombre y versión; cargar y validar config (fallar inmediatamente si inválida); crear `GatewayClient` con config; registrar las 8 herramientas MCP (list_services, query_logs, search_logs, get_recent_errors, summarize_errors, get_log_by_trace_or_request, check_gateway_health, get_metrics); conectar `StdioServerTransport`; emitir log de arranque a stderr vía wrapper logger; tiempo de arranque < 5 s (SC-006)

**Checkpoint**: US-001 completo — servidor arranca correctamente y falla explícitamente ante configuración inválida

---

## Phase 4: User Story 3 — Descubrir servicios y capacidades autorizadas (Priority: P1)

**Goal**: El agente puede llamar `list_services` y recibir los servicios, entornos, scopes y límites autorizados para la API key, sin ningún secreto en la respuesta. Resultado cacheado 5 min.

**Independent Test**: `list_services` con key válida → servicios, entornos, scopes, límites sin API key ni hashes. Cache hit evita segunda llamada HTTP. 403 inesperado en consulta posterior invalida la caché.

### Tests para US-003 ⚠️ (escribir primero, deben FALLAR)

- [X]  [P] [US3] Escribir tests de contrato failing para list_services en tests/contract/list-services.contract.test.ts: mock devuelve ServicesInfo con 2 servicios → respuesta incluye services/envs/scopes/limits sin API key ni hashes; mock devuelve 401 → mensaje AuthError; segunda llamada dentro de TTL devuelve caché sin petición HTTP adicional; 403 inesperado invalida la caché para siguiente llamada

### Implementación US-003

- [X]  [US3] Implementar src/tools/list-services.ts: registrar herramienta `list_services` con schema Zod vacío; llamar GET /api/v1/services vía GatewayClient; cachear resultado 5 min en variable de módulo con TTL; exportar `getCachedServices()` e `invalidateServicesCache()` para uso de search_logs y get_log_by_trace_or_request; formatear respuesta con formatters.ts; descripción de herramienta encoda política local-primero (US-002, constitución IV, FR-041)
- [X] b [P] [US2] Escribir test failing para verificación de política local-primero en tests/unit/tool-descriptions.test.ts: verificar que la propiedad `description` de cada herramienta MCP registrada contiene al menos una referencia a logs locales y al menos una referencia al uso del MCP para contexto histórico, remoto o por request_id/trace_id (US-002, constitución IV, SC-005)

**Checkpoint**: US-003 completo — list_services devuelve capacidades sin secretos y con caché funcional

---

## Phase 5: User Stories 4/5/6 — Consultar logs con filtros temporales y de nivel (Priority: P1/P2)

**Goal**: `query_logs` permite consultar logs con ventana temporal (relativa o absoluta), filtros de nivel como severidad mínima y filtros de entorno, con paginación y sort configurable.

**Independent Test**: Sin ventana temporal → usa MCP_DEFAULT_SINCE. `since` + `from` simultáneos → error de validación, sin llamada HTTP. `level=warn` → gateway recibe `warn,error,fatal`. `from > to` → error de validación. Resultado vacío → mensaje explícito sin isError.

### Tests para US-004/005/006 ⚠️ (escribir primero, deben FALLAR)

- [X]  [P] [US4] Escribir tests de contrato failing para query_logs en tests/contract/query-logs.contract.test.ts: consulta básica (solo service) → usa MCP_DEFAULT_SINCE, sort=desc; con since='1h'; con from+to ISO-8601; since+from simultáneos → error de validación, cero llamadas HTTP; solo-to → error de validación; from>to → error de validación; solo from → to=now; level=warn → gateway recibe warn,error,fatal (SC-012, FR-014); level=error → error,fatal; filtro env pasado correctamente; limit > MCP_MAX_LIMIT → recortado silenciosamente; max_pages recortado silenciosamente; items vacíos → "no se encontraron logs", isError=false; next_cursor incluido en respuesta; 401 → "API key ausente..."; 403 → "no autorizado"; 429 → "rate limit"; 502 → "gateway no pudo consultar"; request_id preservado en errores (FR-025)

### Implementación US-004/005/006

- [X]  [US4] Implementar src/tools/query-logs.ts: registrar herramienta `query_logs` con schema Zod de contracts/mcp-tools.md; llamar `resolveTimeWindow()`; expandir level como severidad mínima con `expandLevel()` (warn → warn,error,fatal); recortar limit y max_pages silenciosamente; llamar `GatewayClient.queryLogs()` con `runPaginated()`; tratar resultado vacío como no-error; formatear con formatters.ts incluyendo next_cursor, range_truncated, limit_truncated; descripción de herramienta incluye política local-primero (US-002, constitución IV)

**Checkpoint**: US-004/005/006 completo — query_logs funciona con todos los filtros, ventanas temporales y manejo de errores del gateway

---

## Phase 6: User Story 7 — Buscar texto libre en logs (Priority: P2)

**Goal**: `search_logs` pre-verifica `allow_q` antes de enviar, devuelve error informativo inmediato si está restringido, y pasa el parámetro `q` correctamente al gateway cuando está permitido.

**Independent Test**: Con `allow_q=true` en caché → gateway recibe `q=texto`. Con `allow_q=false` en caché → error inmediato sin llamada HTTP. Sin caché y gateway devuelve 403 → mensaje de error de permisos comprensible.

### Tests para US-007 ⚠️ (escribir primero, deben FALLAR)

- [X] T034 [P] [US7] Escribir tests de contrato failing para search_logs en tests/contract/search-logs.contract.test.ts: caché allow_q=true + query válida → gateway recibe parámetro q, resultados formateados; caché allow_q=false → error informativo inmediato, cero llamadas HTTP al gateway; sin caché + gateway devuelve 403 → mensaje de restricción de permisos comprensible; filtros combinados (env, level, ventana temporal) aplicados correctamente cuando allow_q=true; level=warn → gateway recibe warn,error,fatal (FR-014, SC-012)

### Implementación US-007

- [X] T035 [US7] Implementar src/tools/search-logs.ts: registrar herramienta `search_logs` con schema Zod de contracts/mcp-tools.md; pre-verificar allow_q desde `getCachedServices()`; si allow_q=false → devolver ForbiddenError informativo inmediato sin llamada HTTP (FR-007); en caso contrario llamar GatewayClient con `q=input.query`; aplicar todos los filtros; formatear respuesta; descripción de herramienta indica requisito allow_q

**Checkpoint**: US-007 completo — search_logs pre-verifica allow_q y nunca llama al gateway si está restringido

---

## Phase 7: User Stories 8/13 — Errores recientes y mensajes de error del gateway (Priority: P2)

**Goal**: `get_recent_errors` filtra automáticamente a `error` y `fatal`, incluye campos de correlación cuando existen, y comunica respuestas vacías como no-error. Todos los errores del gateway tienen mensajes diferenciados con request_id preservado.

**Independent Test**: `get_recent_errors` → gateway siempre recibe `level=error,fatal` fijo (no expuesto al agente). Sin errores en ventana → mensaje explícito sin isError. Con request_id/trace_id/span_id → campos de correlación en output. 401/403/429/502 → mensajes distintos con request_id preservado.

### Tests para US-008/013 ⚠️ (escribir primero, deben FALLAR)

- [X] T036 [P] [US8] Escribir tests de contrato failing para get_recent_errors en tests/contract/get-recent-errors.contract.test.ts: gateway siempre recibe level=error,fatal fijo (verificar que nunca se envía otro valor de level aunque expandLevel se use internamente); eventos con request_id+trace_id+span_id → campos de correlación en output; items vacíos → "no se encontraron errores", isError=false (US-008 CA-2); 401 → "API key ausente, inválida o mal configurada"; 403 sin scope → "key no tiene scope de lectura"; 403 servicio → "servicio X no está autorizado"; 429 → "rate limit o cola llena"; 502 → "gateway no pudo consultar el almacenamiento"; request_id del gateway preservado en todos los errores (FR-025)

### Implementación US-008/013

- [X] T037 [US8] Implementar src/tools/get-recent-errors.ts: registrar herramienta `get_recent_errors` con schema Zod de contracts/mcp-tools.md (sin parámetro `level` expuesto al agente); fijar expansión de nivel a `['error', 'fatal']` internamente; llamar GatewayClient; incluir campos de correlación (request_id, trace_id, span_id) cuando presentes en los items; tratar resultado vacío como no-error con mensaje explícito; formatear vía formatters.ts

**Checkpoint**: US-008/013 completo — get_recent_errors diferencia errores del gateway con mensajes comprensibles

---

## Phase 8: User Story 9 — Resumir los errores más frecuentes (Priority: P3)

**Goal**: `summarize_errors` agrupa errores por mensaje normalizado (trim + colapso de espacios), devuelve los N más frecuentes con conteo y último timestamp, e indica explícitamente cuando el resumen es parcial.

**Independent Test**: Eventos con mismo mensaje normalizado → agrupados en un único grupo con conteo correcto. Con max_pages=1 y más páginas disponibles → indicador de resumen parcial. Normalización verifica que "  foo  bar  " y "foo bar" producen el mismo grupo.

### Tests para US-009 ⚠️ (escribir primero, deben FALLAR)

- [X] T038 [P] [US9] Escribir tests de contrato failing para summarize_errors en tests/contract/summarize-errors.contract.test.ts: 3 eventos con mismo mensaje normalizado → group count=3; autopaginación 2 páginas acumula todos los eventos; max_pages=1 con next_cursor presente → indicador de resumen parcial (US-009 CA-2); items vacíos → mensaje "no se encontraron errores"; top N ordena por count descendente; verificar normalización trim+colapso-de-espacios

### Implementación US-009

- [X] T039 [US9] Implementar src/tools/summarize-errors.ts: registrar herramienta `summarize_errors` con schema Zod de contracts/mcp-tools.md incluyendo `top` (default 10, max 50); usar `runPaginated()` para obtener hasta max_pages páginas de error,fatal; agrupar por `message.trim().replace(/\s+/g, ' ')`; ordenar grupos por count desc, recortar a top N; si hasMore → añadir indicador de resumen parcial; formatear output con count, último timestamp por grupo y total de eventos analizados

**Checkpoint**: US-009 completo — summarize_errors agrupa errores correctamente e indica parcialidad cuando aplica

---

## Phase 9: User Story 10 — Buscar logs por request_id o trace_id (Priority: P3)

**Goal**: `get_log_by_trace_or_request` busca en un servicio específico o hace fan-out concurrente limitado a todos los servicios autorizados con `Promise.allSettled`. Servicios fallidos se reportan explícitamente en la respuesta, nunca en silencio.

**Independent Test**: Con `service` → solo ese servicio consultado. Sin `service` → getCachedServices + fan-out en batches de ≤5 con MCP_MAX_SERVICES_FANOUT. Sin `request_id` ni `trace_id` → error de validación sin llamada HTTP. 1 de 3 servicios devuelve 403 → resultados de 2, servicio fallido reportado, isError=false.

### Tests para US-010 ⚠️ (escribir primero, deben FALLAR)

- [X] T040 [P] [US10] Escribir tests de contrato failing para get_log_by_trace_or_request en tests/contract/get-log-by-trace-or-request.contract.test.ts: request_id+service → consulta única con filtro request_id; trace_id+service → consulta única con filtro trace_id; sin service → mock list_services + fan-out de 3 servicios con Promise.allSettled; sin request_id Y sin trace_id → error de validación, cero llamadas HTTP; fan-out: 2 OK + 1 con 403 → resultados de los 2 correctos, servicio fallido reportado, isError=false; MCP_MAX_SERVICES_FANOUT=3 con 5 servicios → solo 3 consultados (SC-007); sort=asc por defecto

### Implementación US-010

- [X] T041 [US10] Implementar src/tools/get-log-by-trace-or-request.ts: registrar herramienta con Zod `.refine()` requiriendo request_id OR trace_id; sort=asc por defecto; si service presente → única llamada GatewayClient; si sin service → `getCachedServices()`, recortar a MCP_MAX_SERVICES_FANOUT, dividir en chunks de `min(5, fanoutMax)`, `Promise.allSettled` por chunk, acumular resultados, recoger servicios fallidos; reportar failedServices y sus errores en respuesta formateada; incluir request-IDs de todas las llamadas al gateway

**Checkpoint**: US-010 completo — búsqueda por traza/petición funciona con y sin fan-out, reportando fallos parciales

---

## Phase 10: User Story 11 — Consultar la salud del gateway (Priority: P3)

**Goal**: `check_gateway_health` verifica liveness siempre y readiness opcionalmente. Un 503 de /health/ready es `not_ready` (isError=false). Gateway completamente inaccesible es isError=true. Sin API key en las llamadas a estos endpoints.

**Independent Test**: `{}` → live=ok. `{ include_ready: true }` + /health/ready devuelve 503 → live=ok, ready=not_ready, isError=false. Gateway inaccesible por red → isError=true con mensaje de conectividad.

### Tests para US-011 ⚠️ (escribir primero, deben FALLAR)

- [X] T042 [P] [US11] Escribir tests de contrato failing para check_gateway_health en tests/contract/check-gateway-health.contract.test.ts: mock /health → 200 ok, include_ready=false → "Liveness: ok ✓"; mock /health+/health/ready → 200+200 → "Liveness: ok ✓, Readiness: ready ✓"; mock /health+/health/ready → 200+503 → "Liveness: ok ✓, Readiness: not_ready", isError=false (US-011 CA-2); mock /health → error de red → isError=true con mensaje de conectividad; verificar que los endpoints se llaman sin cabecera Authorization

### Implementación US-011

- [X] T043 [US11] Implementar src/tools/check-gateway-health.ts: registrar herramienta `check_gateway_health` con schema Zod `{ include_ready: z.boolean().default(false) }`; siempre llamar GET /api/v1/health sin cabecera Authorization; si include_ready=true también llamar GET /api/v1/health/ready sin auth; 503 de ready endpoint → not_ready, isError=false; fallo de red → isError=true; formatear respuesta distinguiendo estados live/ready

**Checkpoint**: US-011 completo — check_gateway_health distingue correctamente liveness, readiness y fallos de conectividad

---

## Phase 11: User Story 14 — Consultar métricas del gateway (Priority: P3)

**Goal**: `get_metrics` devuelve texto Prometheus crudo cuando está habilitada (`MCP_ENABLE_METRICS_TOOL=true`) y mensaje informativo sin llamada HTTP cuando está deshabilitada. Nunca parsea, resume ni interpreta las métricas. Sin API key en la llamada.

**Independent Test**: `MCP_ENABLE_METRICS_TOOL=true` → texto Prometheus crudo, sin resúmenes. `MCP_ENABLE_METRICS_TOOL=false` → mensaje informativo, cero llamadas HTTP. Sin secretos ni datos de configuración en el output.

### Tests para US-014 ⚠️ (escribir primero, deben FALLAR)

- [X] T044 [P] [US14] Escribir tests de contrato failing para get_metrics en tests/contract/get-metrics.contract.test.ts: config MCP_ENABLE_METRICS_TOOL=false → mensaje informativo, cero llamadas HTTP (US-014 CA-2); config true + mock devuelve texto Prometheus → texto crudo en respuesta sin parsear, isError=false (SC-011); verificar que no hay secretos ni valores de config en el output; endpoint llamado sin cabecera Authorization

### Implementación US-014

- [X] T045 [US14] Implementar src/tools/get-metrics.ts: registrar herramienta `get_metrics` con schema Zod vacío; verificar `config.enableMetricsTool`; si false → devolver respuesta informativa sin llamada HTTP (isError=false, FR-012); si true → GET /api/v1/metrics sin cabecera auth; devolver texto Prometheus crudo sin parsear, resumir ni interpretar valores de métricas (SC-011); descripción de herramienta indica que puede estar deshabilitada con MCP_ENABLE_METRICS_TOOL=false

**Checkpoint**: US-014 completo — get_metrics respeta configuración y devuelve texto Prometheus sin parsear

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Tests de integración, validación de seguridad y quality gates finales.

- [X] T046 [P] Escribir tests de integración para redacción de secretos en tests/integration/secret-redaction.test.ts: invocar cada herramienta con mock gateway y verificar que API key, cabecera Authorization, passwords y tokens nunca aparecen en outputs de herramienta, mensajes de error ni líneas de log en stderr; probar todos los tipos de GatewayError (FR-048, SC-003, SC-010)
- [X] T047 [P] Escribir tests de integración para flujo de health en tests/integration/health.test.ts: flujo startup → check_gateway_health → list_services → query_logs contra mock gateway; verificar que stdout permanece vacío durante toda la sesión (SC-009, FR-047); todos los logs van exclusivamente a stderr
- [X] T048 Ejecutar quality gates completos y corregir cualquier fallo: `npm run lint` (cero errores), `npm run typecheck` (cero errores de tipos), `npm test` (todos los tests unit + contract + integration pasan), `npm run coverage` (≥80% líneas, ramas, funciones, sentencias — constitución III, SC-004)
- [X] T049 Ejecutar smoke test del quickstart.md: arranque con vars válidas, invocar check_gateway_health, list_services, query_logs contra gateway mock o local; verificar stdout limpio, API key ausente de todos los outputs, arranque < 5 s (SC-006)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sin dependencias — comenzar inmediatamente
- **Foundational (Phase 2)**: Depende de Phase 1 — BLOQUEA todas las fases de user stories
- **US-001 (Phase 3)**: Depende de Foundational (Phase 2)
- **US-003 (Phase 4)**: Depende de Foundational (Phase 2) — puede ejecutarse en paralelo con Phase 3
- **US-004/005/006 (Phase 5)**: Depende de Foundational (Phase 2) — puede ejecutarse en paralelo con Phases 3–4
- **US-007 (Phase 6)**: Depende de US-003 (necesita `getCachedServices` de list-services.ts)
- **US-008/013 (Phase 7)**: Depende de Foundational (Phase 2) — puede ejecutarse en paralelo con Phases 3–5
- **US-009 (Phase 8)**: Depende de Foundational (Phase 2) — independiente de otras herramientas
- **US-010 (Phase 9)**: Depende de US-003 (necesita `getCachedServices` para fan-out)
- **US-011 (Phase 10)**: Depende de Foundational (Phase 2) — independiente de otras herramientas
- **US-014 (Phase 11)**: Depende de Foundational (Phase 2) — independiente de otras herramientas
- **Polish (Phase 12)**: Depende de que todas las fases de user stories estén completas

### User Story Dependencies

- **US-001 (arranque)**: Tras Foundational — sin dependencias de otras stories
- **US-003 (list_services)**: Tras Foundational — sin dependencias de otras stories
- **US-004/005/006 (query_logs)**: Tras Foundational — sin dependencias de otras stories
- **US-007 (search_logs)**: Tras US-003 — requiere `getCachedServices()` de list-services.ts
- **US-008/013 (get_recent_errors + errores)**: Tras Foundational — sin dependencias de otras stories
- **US-009 (summarize_errors)**: Tras Foundational — sin dependencias de otras stories
- **US-010 (trace/request lookup)**: Tras US-003 — requiere `getCachedServices()` para fan-out
- **US-011 (health)**: Tras Foundational — sin dependencias de otras stories
- **US-014 (metrics)**: Tras Foundational — sin dependencias de otras stories

### Within Each User Story

1. Escribir tests — DEBEN FALLAR antes de la implementación
2. Implementar código de producción
3. Verificar que los tests ahora PASAN
4. Completar checkpoint antes de avanzar a stories dependientes

### Parallel Opportunities

- T003, T004, T005, T006 en paralelo tras T001 y T002
- T008–T015 todos en paralelo (tests de Phase 2)
- T016, T017 en paralelo; T019 tras T016–T018
- T020–T024 en paralelo; T025 tras T020
- Tras completar Foundational, US-001/003/004-5-6/008-13/009/011/014 pueden comenzar en paralelo
- US-007 y US-010 esperan a US-003 (dependencia de caché de list_services)
- T046, T047 en paralelo en Phase 12

---

## Parallel Example: Phase 2 Foundational

```bash
# Ejecutar todos los tests fundacionales en paralelo:
Task: "tests/unit/logger/levels.test.ts"       (T008)
Task: "tests/unit/logger/redaction.test.ts"    (T009)
Task: "tests/unit/logger/format.test.ts"       (T010)
Task: "tests/unit/config.test.ts"              (T011)
Task: "tests/unit/errors.test.ts"              (T012)
Task: "tests/unit/time.test.ts"                (T013)
Task: "tests/unit/pagination.test.ts"          (T014)
Task: "tests/unit/formatters.test.ts"          (T015)

# Tras escribir los tests del logger, implementación en paralelo:
Task: "src/logger/levels.ts"    (T016)
Task: "src/logger/redaction.ts" (T017)
# T018 tras T016-T017; T019 tras T018
```

## Parallel Example: Tras completar Foundational

```bash
# Todas estas fases pueden iniciarse simultáneamente:
Task: Phase 3 — US-001 (T026–T029 — startup)
Task: Phase 4 — US-003 (T030–T031 — list_services)
Task: Phase 5 — US-004/5/6 (T032–T033 — query_logs)
Task: Phase 7 — US-008/13 (T036–T037 — get_recent_errors)
Task: Phase 8 — US-009 (T038–T039 — summarize_errors)
Task: Phase 10 — US-011 (T042–T043 — check_gateway_health)
Task: Phase 11 — US-014 (T044–T045 — get_metrics)
# US-007 (Phase 6) y US-010 (Phase 9) esperan a que US-003 esté completo
```

---

## Implementation Strategy

### MVP First (User Stories 1, 3, 4/5/6)

1. Completar Phase 1: Setup
2. Completar Phase 2: Foundational (CRÍTICO — bloquea todas las stories)
3. Completar Phase 3: US-001 (arranque + config)
4. Completar Phase 4: US-003 (list_services)
5. Completar Phase 5: US-004/005/006 (query_logs)
6. **PARAR Y VALIDAR**: Ejecutar quality gates, probar con gateway mock
7. Demo: el agente puede consultar logs de cualquier servicio autorizado

### Incremental Delivery

1. Setup + Foundational → Infraestructura lista
2. US-001 + US-003 + US-004/5/6 → **MVP: consulta básica de logs** (stories P1)
3. US-007 + US-008/13 → **Búsqueda y diagnóstico de errores** (stories P2)
4. US-009 + US-010 + US-011 + US-014 → **Funcionalidades avanzadas** (stories P3)
5. Polish → Quality gate, smoke test, completado

### Solo Developer Strategy

Trabajar secuencialmente en orden de prioridad:
1. Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 (P1 completo — MVP)
2. Phase 6 → Phase 7 (herramientas P2 completas)
3. Phase 8 → Phase 9 → Phase 10 → Phase 11 (herramientas P3 completas)
4. Phase 12 (polish y validación)

---

## Notes

- **[P]** indica tareas sobre ficheros distintos sin dependencias de tareas incompletas
- **[Story]** mapea cada tarea a su user story para trazabilidad (US1=US-001, US3=US-003, etc.)
- Tests DEBEN escribirse primero y DEBEN FALLAR antes de comenzar la implementación (constitución III)
- Hacer commit tras cada grupo lógico o checkpoint
- Parar en cualquier checkpoint para validar independientemente
- Todo el código de src/ DEBE usar el wrapper `src/logger.ts` — sin `console.*`, sin imports directos de `pino` (FR-043, FR-044)
- Todos los imports con extensión `.js` (requisito ESM NodeNext — research.md §4)
- US-002 (política local-primero) se encoda en las descripciones de las herramientas, no en código separado (constitución IV)
- US-012 (paginación) está implementado en `src/pagination.ts` en Phase 2 Foundational y ejercitado por todos los tests de contrato de herramientas que usan autopaginación
- US-013 (errores del gateway) está implementado en `src/errors.ts` y `src/gateway-client.ts` en Phase 2 Foundational y verificado en cada fase de herramienta
- US-015 (logging) está implementado en `src/logger.ts` y `src/logger/` en Phase 2 Foundational
