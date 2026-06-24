# Implementation Plan: MCP Log Gateway

**Branch**: `001-mcp-log-gateway` | **Date**: 2026-06-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-mcp-log-gateway/spec.md`

## Summary

Servidor MCP de solo lectura (stdio) que actúa como intermediario entre agentes IA y el Log Gateway API existente. El agente invoca herramientas MCP; el servidor las traduce a peticiones HTTP autenticadas (Bearer) contra el gateway; el gateway devuelve logs de OpenObserve. El MCP expone 8 herramientas de consulta: `list_services`, `query_logs`, `search_logs`, `get_recent_errors`, `summarize_errors`, `get_log_by_trace_or_request`, `check_gateway_health` y `get_metrics`. Toda la validación de entrada usa Zod v4; el fan-out concurrente usa `Promise.allSettled` con pool acotado; el logging va a stderr vía Pino 10 a través del wrapper compartido.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (strict, ESM con especificadores `.js`) + Node.js 24.4.1

**Primary Dependencies**:
- `@modelcontextprotocol/sdk` 1.29.0 — stdio transport y registro de herramientas con Zod
- `zod` 4.4.3 — validación de entradas de herramientas y parsing de configuración
- `pino` 10.3.1 — logger JSON de servidor, destino stderr (FD 2)
- `pino-pretty` 13.1.3 — renderizado humanizado en desarrollo

**Development Dependencies**:
- `tsx` 4.22.4 — ejecución en desarrollo
- `vitest` 4.1.8 — runner de tests (unit, contract, integration)
- `eslint` 10.4.1 + `prettier` 3.8.3
- `@types/node` 25.9.2

**Storage**: N/A — sin almacenamiento persistente; caché TTL ~5 min en memoria solo para `/api/v1/services`

**Testing**: Vitest 4.1.8 — unit, contract (gateway mock), integration, redaction regression

**Target Platform**: Node.js 24.4.1, proceso stdio, sin servidor HTTP propio

**Project Type**: MCP stdio server

**Performance Goals**:
- Respuesta de herramienta < 15 s (SC-001) — incluye timeout 15 s + 1 reintento único
- Arranque < 5 s (SC-006)

**Constraints**:
- Cobertura ≥ 80% líneas, ramas, funciones, sentencias (constitution III)
- Logs nunca escritos en stdout durante operación MCP stdio (FR-047)
- Sin acceso directo a OpenObserve; solo endpoints GET del Log Gateway API (constitution I)
- Sin almacenamiento persistente (constitution — Operational Standards)
- Sin SQL, URLs arbitrarias ni herramientas de escritura (FR-020, FR-021)

**Scale/Scope**: Herramienta de desarrollador individual; un proceso por sesión de agente; sin concurrencia de usuarios múltiples

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Gateway-only, read-only MCP**: ✅ Solo endpoints GET del Log Gateway API (`/logs`, `/services`, `/health`, `/health/ready`, `/metrics`). Ninguna herramienta escribe, modifica ni borra datos. Variables `OO_*` rechazadas al arrancar (FR-004). Ninguna herramienta implementa `POST /api/v1/logs` ni `POST /api/v1/logs/batch`.
- **Contract-first integration**: ✅ Spec normativo: `specs/001-mcp-log-gateway/spec.md`. Contrato de API: `docs/openapi.yaml`. Referencia de cliente: `docs/historias.md`. Toda herramienta tiene endpoint mapeado en el contrato. Validación de inputs pre-HTTP (FR-013–FR-016). Conflictos entre spec y openapi.yaml detienen el desarrollo.
- **Test-first quality**: ✅ Tests escritos antes del código de producción por historia de usuario. Gates: `npm run lint`, `npm run typecheck`, `npm test`, `npm run coverage` ≥ 80%. Tipos: unit, contract (mock), integration, secret-redaction. Las excepciones de cobertura requieren justificación escrita.
- **Agent ergonomics and local-logs first**: ✅ Descripciones de herramientas incluyen política local-primero: logs locales para fallos recientes con rutas conocidas; MCP para histórico, remoto, correlación por IDs o solicitud explícita del usuario (constitution IV, US-002, FR-005–FR-012).
- **Security and least privilege**: ✅ API key solo vía `LOG_GATEWAY_API_KEY`, solo como Bearer en `Authorization`. Nunca impresa, devuelta ni incluida en errores (FR-022). Paginación/fan-out/timeout acotados (FR-017–FR-019, FR-034, FR-036). Gateway determina scopes autorizados (FR-023). Sin SQL, sin URLs arbitrarias, sin headers arbitrarios (FR-021).
- **Logging and debugging standard**: ✅ Wrapper `src/logger.ts` única API de logging para código de aplicación. Pino 10 → stderr (FD 2). Redacción de secrets, tokens, passwords, Authorization headers (FR-048). Fechas `es-ES`/`Europe/Madrid` en renderizado para humanos (FR-049). Sin `console.*` ni imports directos de pino en código de aplicación (FR-043, FR-044). Tests prueban todos los invariantes (SC-009, SC-010).
- **Technology baseline**: ✅ Node.js 24.4.1, TypeScript 6.0.3 strict+ESM con especificadores `.js`, `zod` 4.4.3, `pino` 10.3.1, `pino-pretty` 13.1.3, `vitest` 4.1.8, ESLint 10.4.1, Prettier 3.8.3, `@types/node` 25.9.2. Estructura de directorios exacta de la constitución. HTTP client: `fetch` nativa (Node.js 18+).

*Re-check post Phase 1: todos los contratos de herramientas en `contracts/mcp-tools.md` mapean a endpoints GET del gateway definidos en `docs/openapi.yaml`. Data model en `data-model.md` usa solo campos del esquema `QueryResult`, `ServicesInfo` y `LogEventOutput`. Ninguna violación constitucional.*

## Project Structure

### Documentation (this feature)

```text
specs/001-mcp-log-gateway/
├── plan.md              # Este fichero
├── research.md          # Phase 0: decisiones técnicas y patrones
├── data-model.md        # Phase 1: entidades, validaciones, estados
├── quickstart.md        # Phase 1: guía de validación end-to-end
├── contracts/
│   └── mcp-tools.md     # Phase 1: contratos de herramientas MCP
└── tasks.md             # Phase 2 (/speckit-tasks — no creado aquí)
```

### Source Code (repository root)

```text
src/
├── index.ts                              # Wire: config + client + tools + stdio transport
├── config.ts                             # Env var parsing, validación, redacción en errores
├── gateway-client.ts                     # HTTP, URL, timeout, reintento único, error mapping
├── errors.ts                             # Tipos de error del dominio MCP
├── formatters.ts                         # Texto legible para agente, truncado, metadatos paginación
├── logger.ts                             # Wrapper de logging (única API para código de aplicación)
├── logger/
│   ├── redaction.ts                      # Rutas de redacción Pino (secrets, tokens, headers)
│   ├── levels.ts                         # Mapeo LOG_LEVEL env → nivel Pino efectivo
│   └── format.ts                         # Formateo es-ES/Europe/Madrid, pino-pretty config
├── pagination.ts                         # Cursor, max_pages, autopaginación, límite máximo
├── time.ts                               # since (relativo), from/to (ISO-8601), validación
└── tools/
    ├── list-services.ts                  # GET /services — caché TTL 5 min + invalidación
    ├── query-logs.ts                     # GET /logs — filtros, ventana, paginación
    ├── search-logs.ts                    # GET /logs?q= — verifica allow_q pre-envío
    ├── get-recent-errors.ts              # GET /logs?level=error,fatal
    ├── summarize-errors.ts               # GET /logs?level=error,fatal + agrupación local
    ├── get-log-by-trace-or-request.ts    # GET /logs?request_id= o ?trace_id=, fan-out
    ├── check-gateway-health.ts           # GET /health, GET /health/ready
    └── get-metrics.ts                    # GET /metrics — habilitación configurable

tests/
├── unit/
│   ├── config.test.ts
│   ├── time.test.ts
│   ├── pagination.test.ts
│   ├── formatters.test.ts
│   ├── errors.test.ts
│   └── logger/
│       ├── redaction.test.ts
│       ├── levels.test.ts
│       └── format.test.ts
├── contract/
│   ├── list-services.contract.test.ts
│   ├── query-logs.contract.test.ts
│   ├── search-logs.contract.test.ts
│   ├── get-recent-errors.contract.test.ts
│   ├── summarize-errors.contract.test.ts
│   ├── get-log-by-trace-or-request.contract.test.ts
│   ├── check-gateway-health.contract.test.ts
│   └── get-metrics.contract.test.ts
└── integration/
    ├── startup.test.ts
    ├── health.test.ts
    └── secret-redaction.test.ts
```

**Structure Decision**: Single project (estructura única). El MCP es un proceso stdio sin frontend ni API HTTP propia. La estructura replica exactamente el layout mandado por la constitución (`src/`, `src/logger/`, `src/tools/`, `tests/unit/`, `tests/contract/`, `tests/integration/`).

## Complexity Tracking

> No hay violaciones constitucionales. Todos los principios se cumplen sin excepciones ni justificaciones requeridas.
