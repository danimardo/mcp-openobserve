<!--
Sync Impact Report
Version change: 1.1.0 -> 1.2.0
Modified principles:
- I. Gateway-Only, Read-Only MCP: unchanged
- II. Contract-First Integration: updated to make specs/* normative and docs/historias.md a customer-reference source
- III. Test-First Quality: unchanged
- IV. Agent Ergonomics and Local-Logs First: unchanged
- V. Security, Privacy, and Least Privilege: unchanged
- VI. Logging and Debugging Standard: unchanged
Added sections:
- Normative/reference source hierarchy for spec-kit artifacts
Removed sections:
- None
Templates requiring updates:
- .specify/templates/plan-template.md: updated
- .specify/templates/spec-template.md: reviewed, no mandatory structural change
- .specify/templates/tasks-template.md: updated
- .specify/templates/checklist-template.md: reviewed, no mandatory structural change
Follow-up TODOs:
- None
-->

# MCP Log Gateway Constitution

## Core Principles

### I. Gateway-Only, Read-Only MCP

The project MUST implement a Model Context Protocol server that consumes the Log
Gateway API and MUST NOT call OpenObserve directly. OpenObserve credentials,
organization names, stream names, SQL queries, and Basic Auth settings are outside
the MCP boundary.

The MCP MUST expose only read operations. It MUST NOT ingest logs, modify logs,
delete logs, create streams, administer API keys, or call `POST /api/v1/logs` or
`POST /api/v1/logs/batch`. Every tool MUST be traceable to one of these allowed
gateway endpoints:

- `GET /api/v1/logs`
- `GET /api/v1/services`
- `GET /api/v1/health`
- `GET /api/v1/health/ready`
- `GET /api/v1/metrics`

Any feature that requires writing to the gateway, direct OpenObserve access, SQL
execution, or API-key administration is constitutionally out of scope unless this
constitution is amended first.

### II. Contract-First Integration

Feature specifications under `specs/` and the gateway contract in
`docs/openapi.yaml` are authoritative for product and API behavior.
`docs/historias.md` is a customer-reference source used for traceability and
context, not a parallel normative contract. The MCP MUST translate tool inputs
into documented gateway query parameters; it MUST NOT infer undocumented gateway
behavior or depend on OpenObserve internals.

All MCP tools MUST validate inputs before making HTTP requests. Validation MUST
cover service names, time windows, levels, pagination, and mutually exclusive
fields such as `since` versus `from`/`to`. Error responses from the gateway MUST
be preserved in meaning, including HTTP status and gateway `request_id` when
available.

Any change to gateway-facing behavior MUST update or reference the corresponding
contract before implementation. If implementation, the active feature spec under
`specs/`, and `docs/openapi.yaml` disagree, development MUST stop for
clarification or a documented contract amendment. If `docs/historias.md`
disagrees with the active feature spec, the feature spec wins and the difference
MUST be noted as a conscious interpretation of the customer reference.

### III. Test-First Quality

Tests are mandatory. Every user story MUST have tests written before production
code for that story, and those tests MUST fail for the expected reason before the
implementation is added. The minimum accepted coverage for the MCP codebase is
80% lines, 80% branches, 80% functions, and 80% statements.

The test suite MUST include:

- Unit tests for configuration, validation, time conversion, pagination, error
  mapping, redaction, formatting, and summarization.
- Contract-style tests for each MCP tool against a mocked Log Gateway API.
- Integration tests for health, services, and log-query flows against a local or
  mocked gateway.
- Regression tests proving that secrets are not printed, returned, snapshotted,
  or logged.

A feature is not complete until `npm run lint`, `npm run typecheck`, `npm test`,
and `npm run coverage` pass. Coverage exceptions require a written justification
in the implementation plan and MUST NOT apply to security, configuration,
validation, or gateway-client code.

### IV. Agent Ergonomics and Local-Logs First

The MCP exists for centralized, historical, remote, frontend, or correlated log
investigations. It MUST NOT train agents to use the centralized gateway for every
"mira los logs" request.

Agent guidance, tool descriptions, and examples MUST encode this decision policy:

- Use local project log files first for recent local development failures when
  local log paths are known.
- Use the MCP when the user explicitly asks for MCP, OpenObserve, gateway, or
  centralized logs.
- Use the MCP for historical windows, remote environments, frontend logs, and
  searches by `request_id`, `trace_id`, or `span_id`.
- If both local and centralized logs can help, start with the cheaper and more
  direct source, then explain why escalation to MCP is useful.

Tool output MUST be concise, structured, and useful to an AI agent. Log responses
MUST include readable text plus essential metadata: result count, gateway
`request_id`, pagination state, truncation flags, service, environment,
timestamp, level, message, and correlation identifiers when present.

### V. Security, Privacy, and Least Privilege

The MCP MUST use exactly one Log Gateway API key per configured environment. The
token MUST be supplied through `LOG_GATEWAY_API_KEY`, sent only as
`Authorization: Bearer <token>`, and never printed, returned, snapshotted, logged,
or included in thrown errors.

The MCP MUST reject or ignore direct OpenObserve configuration variables:

- `OO_URL`
- `OO_USER`
- `OO_PASSWORD`
- `OO_ORG`
- `OO_STREAM`

The MCP MUST apply least privilege and safe defaults:

- Require a read-capable gateway key.
- Respect gateway-provided services, environments, scopes, and limits.
- Use bounded `limit`, `max_pages`, timeouts, and fan-out.
- Never accept raw SQL, arbitrary URLs, arbitrary headers, or arbitrary file
  paths through MCP tool inputs.
- Redact secrets from diagnostics.
- Treat `401`, `403`, `429`, `502`, and readiness failures as distinct operator
  signals.

### VI. Logging and Debugging Standard

All application logging MUST go through a shared logger wrapper module. Feature
code MUST NOT import, instantiate, configure, or call logging libraries directly.
The wrapper is the only logging API available to application code.

Required technology decisions:

- Server-side logging MUST use Pino.
- Developer-oriented server log rendering SHOULD use `pino-pretty` or an
  equivalent wrapper-owned formatter.
- Client-side logging, if client code exists in this repository in the future,
  MUST use `loglevel`.
- Shared logger wrapper modules MUST centralize levels, redaction, formatting,
  environment-variable handling, and transport decisions.

Forbidden patterns:

- Application code MUST NOT call `console.log`, `console.debug`,
  `console.info`, `console.warn`, or `console.error`.
- Application code MUST NOT depend directly on `pino`, `pino-pretty`, or
  `loglevel`.
- Logs MUST NOT include secrets, Bearer tokens, passwords, API keys, session IDs,
  cookies, authorization headers, raw credentials, or unnecessary personal data.
- Debug logs MUST NOT dump full HTTP headers, full request/response bodies, full
  environment objects, or unbounded log contexts.

Logging levels MUST be explicit and consistent:

- `trace`: very detailed diagnostic flow, disabled by default outside local
  debugging.
- `debug`: diagnostic information useful during development.
- `info`: normal lifecycle events and high-level operation outcomes.
- `warn`: recoverable anomalies, truncation, fallback behavior, or degraded
  behavior.
- `error`: failed operations requiring attention but not immediate process exit.
- `fatal`: unrecoverable startup/runtime failure before controlled shutdown.

Logging MUST be controlled by environment variables:

- `LOG_LEVEL` controls server-side logging.
- `PUBLIC_LOG_LEVEL` controls client-side logging if client code exists.

Production MUST default to minimal log noise. The default production server level
MUST be `warn` unless a feature specification explicitly justifies `info`.
Non-production server environments MAY default to `info`; local debugging MAY use
`debug` or `trace` explicitly. Client production logging MUST default to `warn`
or stricter.

The project MUST present human-readable logs during local development and
debugging. Server log output intended for developers SHOULD use Spanish-localized
date and time formatting with locale `es-ES` and time zone `Europe/Madrid`
instead of raw Unix timestamps whenever logs are rendered for human inspection.
Machine-oriented structured logs MAY keep their native timestamp representation
for transport or ingestion, but developer-facing output MUST follow the localized
formatting standard consistently across the codebase.

Because this project is an MCP stdio server, server logs MUST NOT be written to
stdout during MCP operation. stdout is reserved for MCP protocol messages. Server
logs MUST be sent to stderr or another explicitly configured destination.

Logging behavior MUST be testable. Tests MUST prove level selection, redaction,
localized developer formatting, stdout avoidance for stdio operation, and wrapper
usage boundaries.

## Technology Baseline and Versions

The implementation MUST use this baseline unless a future constitutional
amendment changes it:

| Area | Required version / constraint | Notes |
|---|---:|---|
| Runtime | Node.js `24.4.1` | Local runtime baseline verified for this project |
| Package manager | npm `11.4.2` | Use `package-lock.json`; no pnpm/yarn unless amended |
| Language | TypeScript `6.0.3` | Strict mode required |
| Module system | ESM | Use `.js` import specifiers in emitted TypeScript style |
| MCP SDK | `@modelcontextprotocol/sdk` `1.29.0` | stdio MCP server |
| Validation | `zod` `4.4.3` | All tool inputs and config parsing |
| Server logging | `pino` `10.3.1` | Required server logger behind wrapper |
| Server log rendering | `pino-pretty` `13.1.3` | Developer-facing local rendering |
| Client logging | `loglevel` `1.9.2` | Required if client code is added |
| TS execution | `tsx` `4.22.4` | Development execution only |
| Test runner | `vitest` `4.1.8` | Unit, contract, and integration tests |
| Linting | ESLint `10.4.1` | No disabled rules without local justification |
| Formatting | Prettier `3.8.3` | Repository-wide formatting |
| Node typings | `@types/node` `25.9.2` | Match current runtime typing baseline |
| Transport | MCP stdio | No HTTP server in the MCP |
| HTTP client | Native `fetch` | No axios/request dependency |
| Storage | None | MCP stores no domain data |

Dependency policy:

- Runtime dependencies MUST be limited to the MCP SDK, validation libraries,
  constitution-approved logging libraries, and small utilities justified in the
  implementation plan.
- Development dependencies MUST support typing, testing, linting, formatting, or
  local execution.
- A lockfile MUST be committed and dependency updates MUST pass the full quality
  gate.
- New dependencies require a documented reason, security review, and simpler
  alternative considered.

## Architecture and Code Organization

The codebase MUST keep a clear separation between protocol, gateway access,
domain logic, and presentation formatting.

Required structure:

```text
src/
  index.ts
  config.ts
  gateway-client.ts
  errors.ts
  formatters.ts
  logger.ts
  logger/
    redaction.ts
    levels.ts
    format.ts
  pagination.ts
  time.ts
  tools/
    list-services.ts
    query-logs.ts
    search-logs.ts
    get-recent-errors.ts
    summarize-errors.ts
    get-log-by-trace-or-request.ts
    check-gateway-health.ts
    get-metrics.ts
tests/
  unit/
  contract/
  integration/
```

Responsibilities:

- `index.ts` wires configuration, client, tools, and stdio transport only.
- `config.ts` validates environment variables and redacts secrets in errors.
- `gateway-client.ts` owns HTTP calls, URL construction, timeout handling, and
  gateway error mapping.
- `logger.ts` and `logger/` own all logging-library usage, level mapping,
  redaction, localized developer formatting, and destination selection.
- `tools/` modules own MCP schemas and convert tool inputs to gateway calls.
- `formatters.ts` owns agent-facing text and structured response shaping.
- `time.ts` owns relative and absolute time-window parsing.
- `pagination.ts` owns cursor and `max_pages` behavior.
- Tests mirror the source structure and MUST NOT depend on real production
  credentials.

Presentation rules:

- Tool descriptions and outputs are the user interface of this MCP.
- Output MUST be readable in plain text and safe for agent consumption.
- Long log messages and contexts MUST be truncated with explicit markers.
- Empty result sets are valid outcomes, not technical errors.

## Operational Standards

Configuration MUST use environment variables only. Required variables:

| Variable | Requirement |
|---|---|
| `LOG_GATEWAY_URL` | Required gateway base URL |
| `LOG_GATEWAY_API_KEY` | Required Bearer token for protected read endpoints |

Optional variables and defaults:

| Variable | Default |
|---|---:|
| `LOG_GATEWAY_API_PREFIX` | `/api/v1` |
| `LOG_LEVEL` | `warn` in production, `info` outside production |
| `PUBLIC_LOG_LEVEL` | `warn` |
| `MCP_DEFAULT_ENV` | empty |
| `MCP_DEFAULT_SINCE` | `1h` |
| `MCP_DEFAULT_LIMIT` | `100` |
| `MCP_MAX_LIMIT` | `1000` |
| `MCP_MAX_PAGES` | `5` |
| `MCP_REQUEST_TIMEOUT_MS` | `15000` |
| `MCP_ENABLE_METRICS_TOOL` | `true` |
| `MCP_MAX_SERVICES_FANOUT` | `20` |
| `MCP_RESPONSE_MAX_CHARS` | `50000` |

Runtime behavior:

- All gateway calls MUST use a timeout.
- Pagination MUST default to one page and MUST never loop indefinitely.
- Fan-out across services MUST be bounded.
- `GET /api/v1/services` MAY be cached briefly, but cache invalidation MUST occur
  on relevant permission errors.
- Retries MUST NOT be aggressive. `429` MUST be surfaced clearly instead of
  hidden behind repeated calls.
- The MCP MUST run without persistent storage.

## Development Workflow and Quality Gates

Spec-kit artifacts MUST stay aligned:

- Feature specifications MUST reference this constitution and MAY reference
  `docs/historias.md` as customer context.
- Implementation plans MUST include a Constitution Check with every principle.
- Task files MUST include tests as first-class tasks, not optional polish.
- Any violation MUST be listed in Complexity Tracking with a concrete reason and
  a rejected simpler alternative.

Mandatory gates before implementation:

1. Contract source identified: active feature spec under `specs/` plus
   `docs/openapi.yaml`; `docs/historias.md` is used as customer reference when
   relevant.
2. User stories independently testable.
3. Security boundary verified: no OpenObserve direct access and no write tools.
4. Tool schemas defined with validation and error behavior.
5. Test plan includes unit, contract, integration, and secret-redaction tests.
6. Logging design uses the shared wrapper only, defines level defaults, and
   proves no MCP logs are emitted to stdout.

Mandatory gates before completion:

1. `npm run lint` passes.
2. `npm run typecheck` passes.
3. `npm test` passes.
4. `npm run coverage` passes with at least 80% for lines, branches, functions,
   and statements.
5. Manual smoke test demonstrates MCP startup and at least one mocked or local
   gateway read flow.
6. Logging tests prove redaction, level control, localized developer timestamps,
   and no direct console usage in application code.
7. Documentation includes setup, environment variables, tool list, local-logs
   decision policy, and troubleshooting.

## Governance

This constitution supersedes conflicting guidance in specs, plans, tasks,
implementation notes, and ad hoc agent instructions. If another artifact conflicts
with this file, this file wins unless amended.

Amendments require:

- A documented rationale.
- A semantic version bump.
- An update to the Sync Impact Report.
- Review of `.specify/templates/plan-template.md`,
  `.specify/templates/spec-template.md`, `.specify/templates/tasks-template.md`,
  and `.specify/templates/checklist-template.md`.
- Migration notes for existing specs or code affected by the change.

Versioning rules:

- MAJOR for incompatible changes to architecture, security boundaries, testing
  requirements, or allowed gateway operations.
- MINOR for new principles, new mandatory sections, or materially expanded
  governance.
- PATCH for clarifications that do not change obligations.

All reviews MUST verify constitution compliance. Work that cannot pass a
constitutional gate MUST stop until the relevant spec, plan, or constitution is
changed explicitly.

**Version**: 1.2.0 | **Ratified**: 2026-06-07 | **Last Amended**: 2026-06-07
