# Research: MCP Log Gateway

**Feature**: `001-mcp-log-gateway` | **Date**: 2026-06-07 | **Plan**: [plan.md](./plan.md)

## Decisiones Técnicas

### 1. MCP SDK 1.29.0 — Registro de Herramientas

**Decisión**: Usar `server.registerTool(name, { description, inputSchema }, handler)` del SDK de alto nivel (`McpServer`).

**Patrón verificado con Context7**:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'mcp-log-gateway', version: '1.0.0' });

server.registerTool(
  'query_logs',
  {
    description: 'Consulta logs de un servicio...',
    inputSchema: z.object({ service: z.string(), since: z.string().optional() })
  },
  async (args): Promise<CallToolResult> => {
    try {
      const result = await gatewayClient.queryLogs(args);
      return { content: [{ type: 'text', text: formatLogs(result) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: mapError(err) }],
        isError: true
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Regla clave**: Errores de ejecución de herramienta → `isError: true` en `CallToolResult` (el agente puede ver el error y corregirse). Errores de protocolo (herramienta no encontrada, servidor mal configurado) → `ProtocolError` (excepción, no en resultado). Esta distinción es fundamental para la ergonomía del agente.

**Alternativa considerada**: `Server` de bajo nivel con `setRequestHandler`. Rechazado porque `McpServer` gestiona automáticamente validación de schemas Zod, serialización del protocolo y manejo de errores de protocolo.

**Rationale**: El SDK de alto nivel reduce boilerplate sustancial y garantiza compatibilidad con el protocolo MCP sin gestión manual de mensajes JSON-RPC.

---

### 2. Zod v4.4.3 — Cambios Respecto a v3 Relevantes para el Proyecto

**Decisión**: Usar la API de Zod v4 en todos los schemas de validación. Los cambios de API son incompatibles con v3.

**Cambios materiales verificados**:

| Patrón | Zod v3 | Zod v4 |
|---|---|---|
| Error de tipo y requerido | `{ required_error, invalid_type_error }` | `{ error: (issue) => string }` |
| Error map personalizado | `errorMap: (issue, ctx) => ({ message })` | `error: (issue) => string \| undefined` |
| Enum nativo TypeScript | `z.nativeEnum(MyEnum)` (deprecated) | `z.enum(MyEnum)` directamente |
| Precedencia de error map | Contextual > Schema | Schema > Contextual |
| `.parse()` / `.safeParse()` | disponibles | siguen disponibles igual |

**Patrón de error personalizado en v4**:
```typescript
const ServiceNameSchema = z.string({
  error: (issue) => issue.input === undefined
    ? 'El parámetro service es obligatorio'
    : 'El nombre de servicio debe ser una cadena de texto'
}).regex(/^[a-z0-9_]{3,64}$/, {
  error: () => 'El servicio debe cumplir el formato ^[a-z0-9_]{3,64}$'
});

const LevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
```

**Nota importante**: El MCP SDK internamente usa Zod para validar tool inputs. Al usar Zod v4 es necesario verificar que la versión del SDK es compatible. La constitución fija `@modelcontextprotocol/sdk` 1.29.0 y `zod` 4.4.3; la compatibilidad está garantizada por las versiones fijadas.

**Rationale**: La constitución fija explícitamente `zod` 4.4.3. Los cambios de API documentados arriba deben aplicarse consistentemente en todos los schemas del proyecto.

---

### 3. Pino 10.3.1 — Stderr y Redacción de Secretos

**Decisión**: Logger exclusivamente dirigido a stderr (FD 2) con lista de rutas de redacción configurada en el wrapper.

**Configuración base del wrapper** (`src/logger.ts`):
```typescript
import pino from 'pino';

const REDACT_PATHS = [
  'authorization',
  'headers.authorization',
  'headers.Authorization',
  'apiKey',
  'api_key',
  'password',
  'token',
  'secret',
  '*.authorization',
  '*.token',
  '*.password',
  '*.apiKey',
  '*.api_key',
];

const logger = pino(
  {
    level: effectiveLevel,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' }
  },
  pino.destination(2)  // FD 2 = stderr, nunca stdout
);
```

**En desarrollo con pino-pretty a stderr**:
```typescript
const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    destination: 2,        // stderr
    colorize: true,
    translateTime: 'SYS:dd/MM/yyyy HH:mm:ss',  // es-ES compatible
  }
});
const logger = pino({ level: effectiveLevel, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, transport);
```

**Regla crítica**: Nunca `destination: 1` (stdout) en el MCP. El protocolo stdio ocupa stdout para mensajes JSON-RPC del protocolo MCP.

**Alternativa considerada**: `pino.multistream()` combinando stdout + stderr. Rechazado porque el MCP nunca debe escribir en stdout bajo ninguna circunstancia.

**Rationale**: `pino.destination(2)` dirige todos los logs a stderr. Los tests de integración verifican que stdout permanece limpio durante la operación MCP stdio.

---

### 4. TypeScript 6.0.3 — Configuración ESM

**Decisión**: `"module": "NodeNext"` con `"moduleResolution": "NodeNext"` en tsconfig. Todos los imports con extensión `.js`.

**`tsconfig.json` base**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**`package.json` requerido**:
```json
{
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "lint": "eslint src tests",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "coverage": "vitest run --coverage"
  }
}
```

**Regla de imports ESM**: En TypeScript con ESM, los imports deben usar extensión `.js` aunque el fichero fuente sea `.ts`:
```typescript
import { formatLogs } from './formatters.js';
import { logger } from './logger.js';
```

**Rationale**: La constitución fija TypeScript 6.0.3 con ESM. `NodeNext` es el modo correcto para Node.js moderno con ESM nativo.

---

### 5. Fan-out Concurrente en `get_log_by_trace_or_request`

**Decisión**: Pool concurrente acotado de 3–5 peticiones simultáneas usando `Promise.allSettled` por lotes.

**Patrón**:
```typescript
const BATCH_SIZE = Math.min(5, config.maxServicesFanout);

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function fanOutQuery(services: string[], params: QueryParams): Promise<FanOutResult> {
  const limited = services.slice(0, config.maxServicesFanout);
  const chunks = chunkArray(limited, BATCH_SIZE);
  const accumulated: LogEvent[] = [];
  const failedServices: string[] = [];

  for (const chunk of chunks) {
    const settled = await Promise.allSettled(
      chunk.map(svc => gatewayClient.queryLogs({ ...params, service: svc }))
    );
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        accumulated.push(...result.value.items);
      } else {
        failedServices.push(chunk[i]);
      }
    }
  }

  return { items: accumulated, failedServices };
}
```

**Regla clave**: `Promise.allSettled` (no `Promise.all`) para que un fallo parcial no cancele las consultas a los demás servicios. Los servicios fallidos se reportan explícitamente en la respuesta (edge case del spec: "no falla silenciosamente").

**Alternativa considerada**: Ejecución secuencial (`for...of`). Rechazado por latencia inaceptable con 20 servicios × 15 s de timeout cada uno.

**Rationale**: El pool de 3–5 peticiones simultáneas equilibra velocidad y carga sobre el gateway. SC-007 garantiza el límite de `MCP_MAX_SERVICES_FANOUT`.

---

### 6. Caché de `/api/v1/services`

**Decisión**: Caché en memoria simple con TTL de 5 minutos, invalidada ante errores 403 inesperados en consultas.

**Patrón**:
```typescript
interface ServicesCache {
  data: ServicesInfo;
  expiresAt: number;
}

let cache: ServicesCache | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function getCachedServices(): Promise<ServicesInfo> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data;
  }
  const data = await gatewayClient.listServices();
  cache = { data, expiresAt: Date.now() + TTL_MS };
  return data;
}

export function invalidateServicesCache(): void {
  cache = null;
}
```

La invalidación se llama cuando una consulta devuelve 403 a un servicio que el caché marcaba como autorizado.

**Alternativa considerada**: Sin caché (llamar siempre a `/services` antes de cada consulta). Rechazado porque `search_logs` necesita verificar `allow_q` antes de cada petición, generando latencia y carga innecesarias.

**Alternativa considerada**: Librería `node-cache`. Rechazado — dependencia innecesaria; el caché en memoria de ~10 líneas cubre exactamente el requisito.

---

### 7. Estrategia de Reintento en Timeout

**Decisión**: Un único reintento tras pausa de 1–2 s cuando `AbortController` cancela la petición por timeout. Si el reintento también falla, error definitivo de timeout. Sin reintentos en otros errores.

**Patrón** (`src/gateway-client.ts`):
```typescript
async function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
  const attempt = (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    return fetch(url, { ...opts, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  };

  try {
    return await attempt();
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    if (isTimeout) {
      const pause = 1000 + Math.random() * 1000;
      await new Promise(r => setTimeout(r, pause));
      return await attempt(); // falla definitivamente si vuelve a agotar timeout
    }
    throw err;
  }
}
```

**Nota**: `fetch` nativa disponible en Node.js 18+. `AbortController` es la API estándar para timeout de fetch. Sin dependencias de `axios` ni `node-fetch`.

**Regla**: 429 y 502 no se reintentan — se comunican directamente al agente (FR-024). El reintento solo aplica a AbortError por timeout (FR-034).

---

### 8. Nivel de Logging por Entorno

**Decisión**: `LOG_LEVEL` controla el nivel efectivo; el default depende de si `NODE_ENV` es `production`.

| `NODE_ENV` | `LOG_LEVEL` no definido | Nivel efectivo |
|---|---|---|
| `production` | — | `warn` |
| cualquier otro / no definido | — | `info` |
| cualquiera | definido | valor de `LOG_LEVEL` |

**Patrón** (`src/logger/levels.ts`):
```typescript
export function effectiveLogLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  return process.env.NODE_ENV === 'production' ? 'warn' : 'info';
}
```

**Rationale**: FR-045, constitution VI. Mínimo ruido en producción; información operativa en desarrollo.

---

### 9. Normalización de Severidad Mínima

**Decisión**: Los filtros de `level` del agente se interpretan como severidad mínima y se expanden antes de llamar al gateway.

Orden de severidad: `trace(0) < debug(1) < info(2) < warn(3) < error(4) < fatal(5)`

**Expansión antes de llamar al gateway**:
```typescript
const SEVERITY_ORDER = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

function expandLevel(level: string): string[] {
  const idx = SEVERITY_ORDER.indexOf(level);
  return idx >= 0 ? SEVERITY_ORDER.slice(idx) : [level];
}

// level="error" → "error,fatal"
// level="warn"  → "warn,error,fatal"
// get_recent_errors siempre → "error,fatal"
```

**Rationale**: SC-012 y FR-014. El gateway acepta niveles separados por coma en el parámetro `level` (schema `openapi.yaml`).

---

### 10. Localización de Timestamps en Desarrollo

**Decisión**: `pino-pretty` con `translateTime` configurado para locale `es-ES`, zona horaria `Europe/Madrid`.

**Patrón** (`src/logger/format.ts`):
```typescript
const prettyOptions = {
  destination: 2,
  colorize: true,
  translateTime: 'SYS:dd/MM/yyyy HH:mm:ss',
  messageFormat: '{msg}',
};
```

Para timestamp localizado completo en inspección humana, el wrapper puede usar `Intl.DateTimeFormat` con `locale: 'es-ES'` y `timeZone: 'Europe/Madrid'` al formatear campos de fecha en la salida legible para el agente (diferente de los logs internos de Pino).

**Rationale**: FR-049, constitution VI. Los logs de pino-pretty usan `SYS:` para respetar la zona horaria del sistema (configurada como Europe/Madrid). Machine-readable logs conservan timestamp ISO-8601 nativo.

---

## Decisiones Descartadas

| Alternativa | Motivo de rechazo |
|---|---|
| `axios` como cliente HTTP | Sin justificación; `fetch` nativa disponible en Node.js 18+ — constitución prohíbe dependencias no justificadas |
| `Promise.race` para fan-out | No permite recolectar resultados parciales; descartado en favor de `Promise.allSettled` |
| `node-cache` lib para caché | Dependencia innecesaria; implementación directa de ~10 líneas es suficiente |
| Logs a fichero además de stderr | Sin requisito en spec ni constitución; añadiría complejidad de rotación y mantenimiento |
| `winston` como logger | La constitución fija Pino explícitamente — no se puede cambiar sin enmienda constitucional |
| `Promise.all` para fan-out | Un servicio fallido cancela todo el fan-out; inaceptable dado el edge case de spec |
| `Server` de bajo nivel del MCP SDK | `McpServer` gestiona automáticamente lo que se haría manualmente con `Server` |
