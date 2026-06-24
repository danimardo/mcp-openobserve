# 🚀 MCP Log Gateway para OpenObserve (Log Gateway API)

Un servidor del **Model Context Protocol (MCP)** de solo lectura que actúa como un puente inteligente y seguro entre tus asistentes de Inteligencia Artificial (Claude, Gemini, GPT, etc.) y un **Log Gateway API** centralizado.

Este servidor permite que la IA consulte, filtre, busque y analice los logs de tus aplicaciones distribuidas directamente desde la interfaz del chat o el terminal, eliminando la necesidad de interactuar manualmente con complejas consolas de observabilidad.

---

## 💡 ¿Por qué existe este proyecto y qué problemas resuelve?

Cuando trabajamos con asistentes de IA en tareas de depuración, desarrollo o soporte, el flujo tradicional para investigar problemas suele ser ineficiente y fragmentado:

1. **La fatiga del "copiar y pegar"**: Tienes que salir de tu editor de código o chat, abrir el navegador, loguearte en OpenObserve u otra consola de logs, redactar consultas SQL o filtros complejos, copiar las líneas de logs y volver al chat para pegarlas.
2. **Brechas de seguridad**: Compartir credenciales maestras de bases de datos o tokens de administración de OpenObserve con el modelo de IA o en archivos de configuración locales es un riesgo alto.
3. **Falta de contexto distribuido**: Correlacionar logs entre múltiples microservicios requiere consultar varias pantallas, buscar manualmente por identificadores de traza (`trace_id` o `request_id`) y ordenar cronológicamente la información.

### 🌟 ¿Para qué sirve y en qué te ayuda en tu día a día?

* **Depuración interactiva sin fricciones**: Simplemente pregúntale a la IA: *"¿Por qué está fallando el servicio de pagos?"* o *"Busca logs de error de payments_api en la última hora"*. La IA usará el MCP para consultar el Log Gateway de forma automática y autónoma.
* **Correlación automática (Fan-Out)**: Si le das un `request_id` o `trace_id`, el MCP interrogará de forma paralela y controlada a todos los servicios autorizados y compondrá un flujo temporal limpio de lo que ocurrió a través de toda tu arquitectura distribuida.
* **Agrupación y resumen inteligente**: La herramienta `summarize_errors` permite consolidar y contar errores idénticos o similares, permitiéndote priorizar las incidencias reales sin ahogarte en miles de líneas repetidas de logs redundantes.
* **Seguridad y privacidad por diseño**:
  * **Acceso acotado**: El servidor solo permite operaciones de lectura (`GET`). No hay herramientas de escritura, modificación o borrado de logs.
  * **Aislamiento**: El servidor nunca interactúa con OpenObserve directamente. Todo pasa por el Log Gateway API usando un token Bearer específico para el entorno.
  * **Redacción automática**: El sistema de logs del servidor y las respuestas del MCP redactan automáticamente API keys, passwords, session tokens y cualquier cabecera `Authorization` para que nunca se guarden ni expongan.
* **Ergonomía de agentes**: Ayuda a la IA a seguir la política de **"logs locales primero"**: si el error es local y reproducible, revisará los archivos locales del proyecto antes de consultar el gateway histórico para reducir costes y latencia.

---

## Tabla de contenidos

- [Arquitectura](#arquitectura)
- [Requisitos previos](#requisitos-previos)
- [Instalación](#instalación)
- [Configuración](#configuración)
- [Iniciar el servidor](#iniciar-el-servidor)
- [Integración con agentes IA](#integración-con-agentes-ia)
  - [Claude Code CLI](#claude-code-cli)
  - [Claude Desktop](#claude-desktop)
  - [Codex CLI (OpenAI)](#codex-cli-openai)
  - [Gemini CLI](#gemini-cli)
  - [Antigravity CLI](#antigravity-cli)
  - [Cualquier cliente MCP compatible](#cualquier-cliente-mcp-compatible)
- [Herramientas disponibles](#herramientas-disponibles)
  - [list\_services](#list_services)
  - [query\_logs](#query_logs)
  - [search\_logs](#search_logs)
  - [get\_recent\_errors](#get_recent_errors)
  - [summarize\_errors](#summarize_errors)
  - [get\_log\_by\_trace\_or\_request](#get_log_by_trace_or_request)
  - [check\_gateway\_health](#check_gateway_health)
  - [get\_metrics](#get_metrics)
- [Ventanas temporales](#ventanas-temporales)
- [Filtrado por nivel (severidad mínima)](#filtrado-por-nivel-severidad-mínima)
- [Paginación](#paginación)
- [Política de decisión: logs locales vs. MCP](#política-de-decisión-logs-locales-vs-mcp)
- [Seguridad](#seguridad)
- [Solución de problemas](#solución-de-problemas)
- [Desarrollo y contribución](#desarrollo-y-contribución)

---

## Arquitectura

```
Agente IA (Claude / GPT / Gemini / ...)
        │  llamada a herramienta MCP
        ▼
┌─────────────────────────┐
│   mcp-openobserve       │  ← este servidor (stdio)
│   (MCP stdio server)    │
│                         │
│  • Valida entradas Zod  │
│  • Construye URLs HTTP  │
│  • Gestiona paginación  │
│  • Redacta secretos     │
└──────────┬──────────────┘
           │  GET /api/v1/...  Authorization: Bearer <key>
           ▼
┌─────────────────────────┐
│   Log Gateway API       │  ← tu gateway centralizado
│   (REST HTTP)           │
└──────────┬──────────────┘
           │
           ▼
    OpenObserve / almacenamiento de logs
```

El MCP **nunca** accede directamente a OpenObserve ni acepta credenciales de OpenObserve (`OO_URL`, `OO_USER`, `OO_PASSWORD`, etc.). Solo habla con el Log Gateway API mediante una única API key de lectura.

---

## Requisitos previos

| Componente | Versión mínima |
|---|---|
| Node.js | 22.x (recomendado: 24.4.1) |
| npm | 10.x (recomendado: 11.x) |
| Log Gateway API | compatible con OpenAPI en `docs/openapi.yaml` |

---

## Instalación

### Requisitos previos

- **Node.js 22 o superior** — [nodejs.org](https://nodejs.org)
- **npm 10 o superior** — incluido con Node.js
- Acceso a un **Log Gateway API** compatible con el contrato OpenAPI incluido en `docs/openapi.yaml`

### Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/mcp-openobserve.git
cd mcp-openobserve
```

### Compilar

El repositorio **no incluye la carpeta `dist/`** (está en `.gitignore`). Es obligatorio compilar antes de usar el servidor en producción.

Se incluyen scripts listos para cada plataforma:

**Linux / macOS:**
```bash
chmod +x compilar.sh
./compilar.sh
```

**Windows (PowerShell):**
```powershell
.\compilar.ps1
```

Ambos scripts realizan los pasos siguientes:

1. Verifican que Node.js ≥ 22 y npm estén disponibles.
2. Ejecutan `npm install` para instalar todas las dependencias.
3. Ejecutan `npm run build`, que invoca `tsc` y transpila `src/` a `dist/`.
4. Verifican que `dist/index.js` existe antes de reportar éxito.

El resultado es:

```
dist/
├── index.js          ← punto de entrada del servidor MCP
├── config.js
├── gateway-client.js
├── logger.js
├── types.js
└── tools/
    ├── check-gateway-health.js
    ├── get-log-by-trace-or-request.js
    ├── get-metrics.js
    ├── get-recent-errors.js
    ├── list-services.js
    ├── query-logs.js
    ├── search-logs.js
    └── summarize-errors.js
```

#### Compilar manualmente (sin el script)

Si prefieres ejecutar los pasos tú mismo:

```bash
npm install
npm run build
# El servidor queda en dist/index.js
```

### Uso sin compilar (modo desarrollo)

Puedes ejecutar el servidor directamente con `tsx` sin compilar:

```bash
npx tsx src/index.ts
```

Esto es útil para desarrollo local o pruebas rápidas. No recomendado para producción.

---

## Configuración

El servidor se configura exclusivamente mediante variables de entorno. No hay archivo de configuración ni flags de CLI.

### Variables obligatorias

| Variable | Descripción |
|---|---|
| `LOG_GATEWAY_URL` | URL base del Log Gateway API. Ejemplo: `http://log-gateway.internal:8080` |
| `LOG_GATEWAY_API_KEY` | API key de lectura del gateway. Formato: `key_id.secret_value` |

Si cualquiera de estas variables está ausente, el servidor **termina inmediatamente** con un mensaje de error claro que indica qué variable falta. La API key **nunca** aparece en el mensaje de error.

### Variables opcionales

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `LOG_GATEWAY_API_PREFIX` | `/api/v1` | Prefijo de la API del gateway. Cámbialo si tu gateway usa un prefijo diferente. |
| `LOG_LEVEL` | `warn` (producción) / `info` (dev) | Nivel de logs del servidor. Valores: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Los logs van **siempre** a stderr, nunca a stdout. |
| `PUBLIC_LOG_LEVEL` | `warn` | Nivel de logging público (reservado para futuros componentes cliente). |
| `MCP_DEFAULT_ENV` | *(vacío)* | Entorno por defecto cuando el agente no especifica `env`. Ejemplo: `prod`. |
| `MCP_DEFAULT_SINCE` | `1h` | Ventana temporal por defecto cuando el agente no especifica tiempo. Ejemplo: `30m`, `6h`, `7d`. |
| `MCP_DEFAULT_LIMIT` | `100` | Número de resultados por página por defecto. |
| `MCP_MAX_LIMIT` | `1000` | Límite máximo de resultados permitido. Si el agente pide más, se recorta silenciosamente. |
| `MCP_MAX_PAGES` | `5` | Número máximo de páginas en autopaginación. Si el agente pide más, se recorta silenciosamente. |
| `MCP_REQUEST_TIMEOUT_MS` | `15000` | Timeout HTTP en milisegundos. Tras un timeout, se realiza un único reintento. |
| `MCP_ENABLE_METRICS_TOOL` | `true` | Habilita o deshabilita la herramienta `get_metrics`. Valores: `true`, `false`. |
| `MCP_MAX_SERVICES_FANOUT` | `20` | Número máximo de servicios consultados en paralelo en `get_log_by_trace_or_request`. |
| `MCP_RESPONSE_MAX_CHARS` | `50000` | Longitud máxima de la respuesta MCP en caracteres. Las respuestas más largas se truncan. |

### Variables rechazadas

Las siguientes variables hacen que el servidor falle inmediatamente al arrancar. Son credenciales directas de OpenObserve y no están permitidas:

- `OO_URL`
- `OO_USER`
- `OO_PASSWORD`
- `OO_ORG`
- `OO_STREAM`

Si necesitas conectar con OpenObserve, usa el Log Gateway API como intermediario.

### Ejemplo de archivo `.env` para desarrollo

```env
LOG_GATEWAY_URL=http://localhost:8080
LOG_GATEWAY_API_KEY=mk_dev.tu_secreto_aqui
LOG_LEVEL=debug
MCP_DEFAULT_SINCE=2h
MCP_DEFAULT_ENV=staging
MCP_ENABLE_METRICS_TOOL=true
```

---

## Iniciar el servidor

### Modo producción (desde el build)

```bash
LOG_GATEWAY_URL=http://tu-gateway.com \
LOG_GATEWAY_API_KEY=tu_key.tu_secreto \
node dist/index.js
```

### Modo desarrollo (sin compilar)

```bash
LOG_GATEWAY_URL=http://localhost:8080 \
LOG_GATEWAY_API_KEY=dev_key.dev_secret \
LOG_LEVEL=debug \
npx tsx src/index.ts
```

El servidor emite un mensaje de inicio a stderr y queda en espera de mensajes MCP por stdin. No abre ningún puerto HTTP ni socket propio.

### Verificación de arranque

```bash
# Verifica que arranca correctamente (debería imprimir logs a stderr y quedarse en espera)
LOG_GATEWAY_URL=http://localhost:8080 LOG_GATEWAY_API_KEY=test.key node dist/index.js

# Verifica que falla correctamente sin vars obligatorias
node dist/index.js
# → Error: Variable de entorno obligatoria no definida: LOG_GATEWAY_URL
```

---

## Integración con agentes IA

El servidor implementa el protocolo MCP sobre **stdio** (stdin/stdout). Para usarlo con un agente IA, hay que indicarle al cliente MCP cómo lanzar el proceso y qué variables de entorno pasar.

---

### Claude Code CLI

Claude Code soporta servidores MCP definidos en `.claude/settings.json` dentro del directorio del proyecto, o en `~/.claude/settings.json` para configuración global.

#### Configuración en el proyecto (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "log-gateway": {
      "command": "node",
      "args": ["/ruta/absoluta/a/mcp-openobserve/dist/index.js"],
      "env": {
        "LOG_GATEWAY_URL": "http://tu-gateway.interno:8080",
        "LOG_GATEWAY_API_KEY": "tu_key_id.tu_secreto",
        "MCP_DEFAULT_ENV": "prod",
        "MCP_DEFAULT_SINCE": "2h"
      }
    }
  }
}
```

#### Configuración global (`~/.claude/settings.json`)

```json
{
  "mcpServers": {
    "log-gateway": {
      "command": "node",
      "args": ["/home/usuario/mcp-openobserve/dist/index.js"],
      "env": {
        "LOG_GATEWAY_URL": "http://logs.miempresa.com",
        "LOG_GATEWAY_API_KEY": "prod_key.mi_secreto_seguro",
        "LOG_LEVEL": "warn",
        "MCP_MAX_PAGES": "10",
        "MCP_ENABLE_METRICS_TOOL": "true"
      }
    }
  }
}
```

#### Con npx / tsx (sin compilar)

```json
{
  "mcpServers": {
    "log-gateway": {
      "command": "npx",
      "args": ["tsx", "/ruta/a/mcp-openobserve/src/index.ts"],
      "env": {
        "LOG_GATEWAY_URL": "http://localhost:8080",
        "LOG_GATEWAY_API_KEY": "dev_key.secreto"
      }
    }
  }
}
```

#### Verificar que Claude Code detecta el servidor

```bash
# En el directorio del proyecto con .claude/settings.json configurado
claude mcp list
# Debe aparecer: log-gateway

# Ver herramientas disponibles
claude mcp tools log-gateway
```

#### Uso desde el chat de Claude Code

Una vez configurado, el agente puede usar las herramientas directamente:

```
# El agente usará automáticamente la herramienta correcta según el contexto
"¿Cuáles son los errores recientes de payments_api?"
"Busca logs con la palabra 'timeout' en auth_service"
"Dame el flujo completo de la petición con request_id req_abc123"
"¿Está el gateway funcionando?"
```

---

### Claude Desktop

Para Claude Desktop (macOS y Windows), el archivo de configuración es:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "log-gateway": {
      "command": "node",
      "args": ["C:\\ruta\\a\\mcp-openobserve\\dist\\index.js"],
      "env": {
        "LOG_GATEWAY_URL": "http://tu-gateway.com",
        "LOG_GATEWAY_API_KEY": "tu_key.tu_secreto",
        "MCP_DEFAULT_SINCE": "1h",
        "MCP_DEFAULT_ENV": "prod"
      }
    }
  }
}
```

Reinicia Claude Desktop después de modificar la configuración. El servidor aparecerá en el menú de herramientas.

---

### Codex CLI (OpenAI)

Codex CLI de OpenAI admite servidores MCP a través de su archivo de configuración. Crea o edita `~/.codex/config.yaml`:

```yaml
mcpServers:
  log-gateway:
    command: node
    args:
      - /ruta/a/mcp-openobserve/dist/index.js
    env:
      LOG_GATEWAY_URL: http://tu-gateway.com
      LOG_GATEWAY_API_KEY: tu_key.tu_secreto
      MCP_DEFAULT_SINCE: 1h
      MCP_MAX_PAGES: "5"
```

O en formato JSON si tu versión lo requiere (`~/.codex/config.json`):

```json
{
  "mcpServers": {
    "log-gateway": {
      "command": "node",
      "args": ["/ruta/a/mcp-openobserve/dist/index.js"],
      "env": {
        "LOG_GATEWAY_URL": "http://tu-gateway.com",
        "LOG_GATEWAY_API_KEY": "tu_key.tu_secreto"
      }
    }
  }
}
```

#### Arrancar Codex con el servidor MCP

```bash
codex --mcp-server log-gateway "¿Cuáles son los últimos errores de payments_api?"
```

---

### Gemini CLI

Google Gemini CLI (`@google/gemini-cli`) soporta servidores MCP a través de su archivo de configuración en `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "log-gateway": {
      "command": "node",
      "args": ["/ruta/a/mcp-openobserve/dist/index.js"],
      "env": {
        "LOG_GATEWAY_URL": "http://tu-gateway.interno",
        "LOG_GATEWAY_API_KEY": "tu_key.tu_secreto",
        "MCP_DEFAULT_SINCE": "2h",
        "MCP_DEFAULT_ENV": "prod",
        "MCP_ENABLE_METRICS_TOOL": "true"
      }
    }
  }
}
```

También puedes añadir la configuración en `gemini.json` en el directorio del proyecto para que sea específica del repositorio:

```json
{
  "mcpServers": {
    "log-gateway": {
      "command": "node",
      "args": ["./dist/index.js"],
      "cwd": "/ruta/a/mcp-openobserve",
      "env": {
        "LOG_GATEWAY_URL": "http://localhost:8080",
        "LOG_GATEWAY_API_KEY": "dev_key.secreto"
      }
    }
  }
}
```

#### Uso desde Gemini CLI

```bash
# Arrancar Gemini con el servidor MCP activo
gemini

# En el chat
> ¿Hay errores recientes en auth_service?
> Busca logs con "NullPointerException" en orders_api
> Muéstrame las métricas del gateway
```

---

### Antigravity CLI

Para Antigravity CLI y cualquier cliente compatible con el protocolo MCP, añade el servidor en su archivo de configuración de servidores MCP. La estructura estándar es:

```json
{
  "mcpServers": {
    "log-gateway": {
      "command": "node",
      "args": ["/ruta/absoluta/a/mcp-openobserve/dist/index.js"],
      "env": {
        "LOG_GATEWAY_URL": "http://tu-gateway.com",
        "LOG_GATEWAY_API_KEY": "tu_key.tu_secreto"
      }
    }
  }
}
```

Consulta la documentación específica de tu cliente para la ubicación del archivo de configuración.

---

### Cualquier cliente MCP compatible

El servidor implementa el protocolo MCP estándar sobre **stdio**. Para conectarlo con cualquier cliente compatible:

**Comando de arranque:**
```
node /ruta/a/dist/index.js
```

**Variables de entorno requeridas:**
```
LOG_GATEWAY_URL=http://tu-gateway.com
LOG_GATEWAY_API_KEY=tu_key.tu_secreto
```

**Protocolo:** MCP sobre stdio (stdin/stdout), JSON-RPC 2.0, SDK `@modelcontextprotocol/sdk` 1.29.0.

---

## Herramientas disponibles

El servidor expone 8 herramientas MCP. Todas son de **solo lectura** y no modifican ningún dato.

---

### `list_services`

Lista los servicios, entornos, scopes y límites autorizados para la API key configurada.

> **Cuándo usarla**: antes de cualquier consulta para descubrir qué servicios están disponibles, en qué entornos, y si la key permite búsqueda textual libre (`allow_q`).

**Parámetros**: ninguno.

**Ejemplo de invocación:**
```json
{}
```

**Ejemplo de respuesta:**
```
Servicios autorizados (3):
  • payments_api — entornos: prod, staging
  • auth_service — entornos: prod
  • notification_svc — entornos: prod, dev

Scopes: read
Límites: max_limit=1000 | allow_q=true | ventana máxima: sin límite
Request-ID gateway: req_abc123_def456
```

**Notas importantes:**
- El resultado se cachea en memoria durante 5 minutos para evitar peticiones repetidas al gateway.
- Lista servicios **autorizados por la key**, no necesariamente todos los servicios activos en el sistema.
- Si la key no tiene scope `read`, ninguna herramienta de consulta podrá funcionar.
- `allow_q=false` indica que esta key no puede usar `search_logs`. Usa `query_logs` con filtros en su lugar.

---

### `query_logs`

Consulta logs de un servicio con filtros opcionales de entorno, nivel, ventana temporal y paginación. Es la herramienta de uso general para investigar eventos.

> **Cuándo usarla**: para investigar eventos históricos, ver qué pasó en un servicio durante una ventana de tiempo, o cuando los logs locales del proyecto no contienen la información necesaria.

**Parámetros:**

| Parámetro | Tipo | Requerido | Valor por defecto | Descripción |
|---|---|---|---|---|
| `service` | string | Sí | — | Nombre del servicio. Formato: `^[a-z0-9_]{3,64}$` |
| `env` | string | No | `MCP_DEFAULT_ENV` | Entorno a consultar. Ej: `prod`, `staging` |
| `level` | string | No | todos | Nivel mínimo de severidad. Valores: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `since` | string | No | `MCP_DEFAULT_SINCE` | Ventana relativa al momento actual. Ej: `30m`, `1h`, `6h`, `2d` |
| `from` | string | No | — | Inicio de ventana absoluta en ISO-8601. Ej: `2026-06-07T08:00:00Z` |
| `to` | string | No | ahora | Fin de ventana absoluta en ISO-8601. Solo válido si se proporciona `from`. |
| `limit` | integer | No | `MCP_DEFAULT_LIMIT` | Número máximo de resultados. Se recorta a `MCP_MAX_LIMIT` si excede. |
| `cursor` | string | No | — | Token de paginación. Obtenido del `next_cursor` de una respuesta anterior. |
| `sort` | `asc`/`desc` | No | `desc` | Orden de los resultados. `desc` = más reciente primero. |
| `max_pages` | integer | No | 1 | Número de páginas a recuperar automáticamente. Se recorta a `MCP_MAX_PAGES`. |

**Reglas de validación:**
- `since` y `from`/`to` son mutuamente excluyentes. No se pueden usar juntos.
- `to` sin `from` → error de validación.
- `from > to` → error de validación.
- `from` sin `to` → se usa `to = ahora`.
- Sin parámetros temporales → se usa `MCP_DEFAULT_SINCE`.
- `level` se trata como **severidad mínima**: `level=warn` devuelve `warn`, `error` y `fatal`.

**Ejemplos:**

```json
// Logs recientes de payments_api (última hora, sin filtros)
{
  "service": "payments_api"
}

// Logs de error de las últimas 3 horas
{
  "service": "payments_api",
  "level": "error",
  "since": "3h"
}

// Logs de producción en una ventana temporal específica
{
  "service": "auth_service",
  "env": "prod",
  "from": "2026-06-07T02:00:00Z",
  "to": "2026-06-07T03:00:00Z",
  "sort": "asc"
}

// Primeras 2 páginas de logs de warning (autopaginación)
{
  "service": "orders_api",
  "level": "warn",
  "since": "6h",
  "max_pages": 2,
  "limit": 50
}
```

**Ejemplo de respuesta:**
```
Logs de payments_api (prod) — 3 eventos
Ventana: 2026-06-07T08:00:00Z → 2026-06-07T09:00:00Z | Orden: desc

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
07/06/2026 08:58:30  ERROR  payments_api
Payment processing failed: timeout connecting to stripe after 5000ms
↳ request_id: req_xyz789 | trace_id: trc_abc123

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
07/06/2026 08:45:12  WARN   payments_api
Retry attempt 2/3 for payment req_xyz789
↳ request_id: req_xyz789

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
07/06/2026 08:30:01  INFO   payments_api
Payment request received from customer cust_456

Paginación: next_cursor=crs_abc | range_truncated=false | limit_truncated=false
Request-ID gateway: req_gw_123456
```

---

### `search_logs`

Busca logs que contengan un texto libre, ID de usuario, fragmento de mensaje de error o cualquier cadena. Requiere que la API key tenga `allow_q=true`.

> **Cuándo usarla**: cuando no conoces el nivel ni la ventana exacta del evento que buscas, o cuando necesitas buscar por un ID de cliente, un fragmento de error o cualquier texto arbitrario.

**Parámetros:**

| Parámetro | Tipo | Requerido | Valor por defecto | Descripción |
|---|---|---|---|---|
| `service` | string | Sí | — | Nombre del servicio. Formato: `^[a-z0-9_]{3,64}$` |
| `query` | string | Sí | — | Texto a buscar en los logs. No puede estar vacío. |
| `env` | string | No | `MCP_DEFAULT_ENV` | Entorno a consultar. |
| `level` | string | No | todos | Nivel mínimo de severidad. |
| `since` | string | No | `MCP_DEFAULT_SINCE` | Ventana relativa al momento actual. |
| `from` | string | No | — | Inicio de ventana absoluta. |
| `to` | string | No | ahora | Fin de ventana absoluta. |
| `limit` | integer | No | `MCP_DEFAULT_LIMIT` | Número máximo de resultados. |
| `cursor` | string | No | — | Token de paginación. |
| `sort` | `asc`/`desc` | No | `desc` | Orden de los resultados. |
| `max_pages` | integer | No | 1 | Páginas a recuperar automáticamente. |

**Comportamiento especial:**
Antes de enviar la petición al gateway, el servidor verifica si `allow_q=false` en el caché de `list_services`. Si está restringida, devuelve un error informativo **sin realizar ninguna llamada HTTP** al gateway.

```
Esta API key no permite búsqueda textual libre (allow_q=false).
Usa query_logs con filtros de nivel, entorno y ventana temporal para acotar la búsqueda.
```

**Ejemplos:**

```json
// Buscar logs con un mensaje de error específico
{
  "service": "auth_service",
  "query": "invalid signature",
  "since": "2h"
}

// Buscar un ID de cliente en los últimos 3 días
{
  "service": "payments_api",
  "query": "cust_12345",
  "since": "3d",
  "level": "error"
}

// Buscar en producción una excepción concreta
{
  "service": "orders_api",
  "query": "NullPointerException",
  "env": "prod",
  "from": "2026-06-06T00:00:00Z",
  "to": "2026-06-07T00:00:00Z",
  "sort": "asc",
  "max_pages": 3
}
```

---

### `get_recent_errors`

Obtiene los errores (`error` y `fatal`) más recientes de un servicio. Es un atajo de `query_logs` con nivel mínimo `error` fijado automáticamente.

> **Cuándo usarla**: como primer paso en cualquier sesión de depuración. "¿Qué ha fallado recientemente en payments_api?" es el caso de uso ideal.

**Parámetros:**

| Parámetro | Tipo | Requerido | Valor por defecto | Descripción |
|---|---|---|---|---|
| `service` | string | Sí | — | Nombre del servicio. |
| `env` | string | No | `MCP_DEFAULT_ENV` | Entorno a consultar. |
| `since` | string | No | `MCP_DEFAULT_SINCE` | Ventana relativa. |
| `from` | string | No | — | Inicio de ventana absoluta. |
| `to` | string | No | ahora | Fin de ventana absoluta. |
| `limit` | integer | No | `MCP_DEFAULT_LIMIT` | Número máximo de resultados. |
| `cursor` | string | No | — | Token de paginación. |
| `sort` | `asc`/`desc` | No | `desc` | Orden de los resultados. |
| `max_pages` | integer | No | 1 | Páginas a recuperar automáticamente. |

> El parámetro `level` **no está expuesto**. El nivel se fija internamente a `error,fatal` siempre. Esto garantiza que el agente nunca pida accidentalmente todos los niveles cuando solo quiere errores.

**Ejemplos:**

```json
// Errores de la última hora (configuración por defecto)
{
  "service": "auth_service"
}

// Errores de las últimas 4 horas en producción
{
  "service": "payments_api",
  "env": "prod",
  "since": "4h",
  "sort": "desc"
}

// Errores en una ventana temporal concreta
{
  "service": "orders_api",
  "from": "2026-06-07T00:00:00Z",
  "to": "2026-06-07T06:00:00Z",
  "sort": "asc"
}
```

**Ejemplo de respuesta (con errores):**
```
Errores recientes de auth_service (prod) — 2 eventos (última hora)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
07/06/2026 08:55:01  ERROR  auth_service
Token validation failed: invalid signature for key kid_abc
↳ request_id: req_abc123 | trace_id: trc_xyz789 | span_id: sp_001

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
07/06/2026 08:42:15  FATAL  auth_service
Database connection pool exhausted — all 50 connections in use
↳ request_id: req_def456

Request-ID gateway: req_gw_456789
```

**Ejemplo de respuesta (sin errores):**
```
No se encontraron errores para auth_service en la última hora.
Request-ID gateway: req_gw_456789
```

---

### `summarize_errors`

Agrupa y cuenta los errores más frecuentes de un servicio en una ventana temporal. Devuelve los N mensajes de error más comunes, ordenados por frecuencia.

> **Cuándo usarla**: para priorizar qué problema investigar primero. En lugar de leer cientos de logs individuales, obtén un resumen de los errores más repetidos.

**Parámetros:**

| Parámetro | Tipo | Requerido | Valor por defecto | Descripción |
|---|---|---|---|---|
| `service` | string | Sí | — | Nombre del servicio. |
| `env` | string | No | `MCP_DEFAULT_ENV` | Entorno a consultar. |
| `since` | string | No | `MCP_DEFAULT_SINCE` | Ventana relativa. |
| `from` | string | No | — | Inicio de ventana absoluta. |
| `to` | string | No | ahora | Fin de ventana absoluta. |
| `limit` | integer | No | `MCP_DEFAULT_LIMIT` | Resultados por página en cada consulta al gateway. |
| `max_pages` | integer | No | 1 | Páginas a recuperar para acumular eventos antes de agrupar. |
| `top` | integer | No | `10` | Número de grupos a devolver (máximo: 50). |

**Cómo funciona:**
1. El servidor recupera hasta `max_pages` páginas de eventos `error` y `fatal`.
2. Normaliza los mensajes (recorta espacios al inicio/fin y colapsa espacios internos múltiples).
3. Agrupa los eventos por mensaje normalizado.
4. Ordena los grupos por frecuencia (descendente) y devuelve los `top` N.
5. Si hay más datos de los que se han leído, indica que el resumen es **parcial**.

**Ejemplos:**

```json
// Top 10 errores de la última hora (configuración por defecto)
{
  "service": "payments_api"
}

// Top 5 errores de las últimas 6 horas con más datos
{
  "service": "payments_api",
  "since": "6h",
  "max_pages": 5,
  "top": 5
}

// Resumen de errores de ayer en producción
{
  "service": "auth_service",
  "env": "prod",
  "from": "2026-06-06T00:00:00Z",
  "to": "2026-06-06T23:59:59Z",
  "max_pages": 10,
  "top": 20
}
```

**Ejemplo de respuesta:**
```
Resumen de errores — payments_api (última hora)
Top 3 de 5 mensajes únicos | Basado en 47 eventos

  1. [23x] Payment processing failed: timeout connecting to stripe
     Último: 07/06/2026 08:58:30

  2. [15x] Invalid card number format
     Último: 07/06/2026 08:45:12

  3. [9x] Database connection pool exhausted
     Último: 07/06/2026 08:30:05

Request-ID gateway (última página): req_gw_789012

⚠ Resumen parcial: basado en 1 página de resultados. Puede haber más errores no representados.
  Incrementa max_pages para un análisis más completo.
```

---

### `get_log_by_trace_or_request`

Busca todos los logs asociados a un `request_id` o `trace_id` concreto. Si no se especifica servicio, busca en todos los servicios autorizados de forma concurrente.

> **Cuándo usarla**: para reconstruir el flujo completo de una petición HTTP que pasó por múltiples servicios, o para encontrar todos los logs relacionados con un identificador de traza distribuida.

**Parámetros:**

| Parámetro | Tipo | Requerido | Valor por defecto | Descripción |
|---|---|---|---|---|
| `request_id` | string | Condicional* | — | ID de petición a buscar. |
| `trace_id` | string | Condicional* | — | ID de traza distribuida a buscar. |
| `service` | string | No | — | Si se omite, busca en todos los servicios autorizados (fan-out). |
| `env` | string | No | `MCP_DEFAULT_ENV` | Entorno a consultar. |
| `since` | string | No | `MCP_DEFAULT_SINCE` | Ventana relativa. |
| `from` | string | No | — | Inicio de ventana absoluta. |
| `to` | string | No | ahora | Fin de ventana absoluta. |
| `limit` | integer | No | `MCP_DEFAULT_LIMIT` | Resultados por página. |
| `cursor` | string | No | — | Token de paginación. |
| `sort` | `asc`/`desc` | No | `asc` | `asc` por defecto (flujo cronológico de la petición). |
| `max_pages` | integer | No | 1 | Páginas a recuperar por servicio. |

> (*) Se requiere **al menos uno** de `request_id` o `trace_id`. Si se omiten ambos, el servidor devuelve un error de validación sin llamar al gateway.

**Fan-out automático (sin `service`):**

Cuando no se especifica un servicio, el servidor:
1. Llama a `list_services` para obtener los servicios autorizados (usa caché si está disponible).
2. Limita a `MCP_MAX_SERVICES_FANOUT` servicios (por defecto: 20).
3. Consulta todos en paralelo, en lotes de 3–5 peticiones simultáneas.
4. Combina los resultados y reporta qué servicios fallaron (si alguno).

Los servicios que devuelven error **no causan `isError: true`** en la respuesta. Los resultados disponibles se devuelven con una nota sobre los servicios fallidos.

**Ejemplos:**

```json
// Buscar por request_id en un servicio específico
{
  "request_id": "req_xyz789abc",
  "service": "payments_api",
  "sort": "asc"
}

// Buscar por trace_id en todos los servicios (fan-out)
{
  "trace_id": "trc_abc123def456",
  "sort": "asc",
  "since": "6h"
}

// Buscar tanto por request_id como por trace_id en producción
{
  "request_id": "req_xyz789",
  "trace_id": "trc_abc123",
  "env": "prod",
  "from": "2026-06-07T08:00:00Z",
  "to": "2026-06-07T09:00:00Z",
  "sort": "asc"
}
```

**Ejemplo de respuesta (fan-out, 3 servicios):**
```
Logs para request_id=req_xyz789abc — 3 servicios consultados

━━━ payments_api (3 eventos) ━━━
07/06/2026 08:30:01  INFO  payments_api
Payment request received from customer cust_456
↳ trace_id: trc_abc123

07/06/2026 08:30:02  INFO  payments_api
Calling stripe API for payment authorization

07/06/2026 08:30:07  ERROR payments_api
Stripe timeout after 5000ms

━━━ auth_service (1 evento) ━━━
07/06/2026 08:29:58  INFO  auth_service
JWT validated for user_789 — scope: payment:write

━━━ Servicios con error de consulta: notification_svc ━━━

Request-IDs gateway: req_gw_001, req_gw_002, req_gw_003
```

---

### `check_gateway_health`

Comprueba si el Log Gateway está vivo (`liveness`) y, opcionalmente, si está listo para servir consultas (`readiness`).

> **Cuándo usarla**: cuando las consultas al gateway fallan y no está claro si el problema es de configuración del MCP, de la red, o del propio gateway.

**Parámetros:**

| Parámetro | Tipo | Requerido | Valor por defecto | Descripción |
|---|---|---|---|---|
| `include_ready` | boolean | No | `false` | Si `true`, también verifica el endpoint de readiness. |

> Los endpoints de salud (`/health` y `/health/ready`) **no requieren API key**. Las peticiones se realizan sin cabecera `Authorization`.

**Comportamiento:**
- `include_ready=false`: solo llama a `GET /api/v1/health` (1 petición HTTP).
- `include_ready=true`: llama a `GET /api/v1/health` y a `GET /api/v1/health/ready` (2 peticiones HTTP).
- Si `/health/ready` devuelve `503` (no listo), la respuesta indica `not_ready` pero **no es un error técnico** (`isError: false`). El gateway está vivo pero aún no puede servir consultas.
- Si el gateway no es accesible (error de red), `isError: true` con mensaje de conectividad.

**Ejemplos:**

```json
// Solo verificar liveness
{}

// Verificar liveness y readiness
{
  "include_ready": true
}
```

**Ejemplos de respuesta:**

```
// Gateway vivo
Estado del gateway:
  • Liveness: ok ✓

// Gateway vivo y listo
Estado del gateway:
  • Liveness: ok ✓
  • Readiness: ready ✓

// Gateway vivo pero no listo aún
Estado del gateway:
  • Liveness: ok ✓
  • Readiness: not_ready — el gateway está vivo pero no puede servir consultas aún

// Gateway no accesible (isError: true)
Error de conectividad: No se pudo conectar al gateway en http://localhost:8080.
Comprueba que LOG_GATEWAY_URL es correcto y el gateway está corriendo.
```

---

### `get_metrics`

Obtiene las métricas Prometheus del Log Gateway en formato de texto crudo.

> **Cuándo usarla**: para diagnosticar rate limiting, ver el estado de la cola de peticiones, o analizar el rendimiento del gateway. Requiere `MCP_ENABLE_METRICS_TOOL=true` (valor por defecto).

**Parámetros**: ninguno.

**Comportamiento:**
- Si `MCP_ENABLE_METRICS_TOOL=false`: devuelve un mensaje informativo **sin llamar al gateway** (`isError: false`).
- Si habilitado: llama a `GET /api/v1/metrics` sin API key (endpoint público) y devuelve el texto Prometheus crudo sin parsear ni resumir.

**Ejemplo de invocación:**
```json
{}
```

**Ejemplo de respuesta (habilitada):**
```
Métricas del gateway (formato Prometheus):

# HELP gateway_requests_total Total de peticiones recibidas
# TYPE gateway_requests_total counter
gateway_requests_total{method="GET",endpoint="/api/v1/logs"} 45823
gateway_requests_total{method="GET",endpoint="/api/v1/services"} 1234

# HELP gateway_queue_depth Profundidad actual de la cola de peticiones
# TYPE gateway_queue_depth gauge
gateway_queue_depth 3

# HELP gateway_request_duration_seconds Latencia de peticiones
# TYPE gateway_request_duration_seconds histogram
gateway_request_duration_seconds_bucket{le="0.1"} 38291
...
```

**Respuesta cuando está deshabilitada:**
```
La herramienta de métricas está deshabilitada (MCP_ENABLE_METRICS_TOOL=false).
Para habilitarla, configura MCP_ENABLE_METRICS_TOOL=true al arrancar el servidor.
```

---

## Ventanas temporales

Las herramientas de consulta de logs aceptan ventanas temporales en dos formatos:

### Ventana relativa (`since`)

Expresa tiempo desde el momento actual hacia atrás:

| Valor | Descripción |
|---|---|
| `30s` | Últimos 30 segundos |
| `5m` | Últimos 5 minutos |
| `1h` | Última hora |
| `6h` | Últimas 6 horas |
| `24h` | Últimas 24 horas |
| `7d` | Últimos 7 días |
| `30d` | Últimos 30 días |

```json
{ "service": "payments_api", "since": "2h" }
```

### Ventana absoluta (`from` / `to`)

Usa fechas en formato ISO-8601 con zona horaria:

```json
{
  "service": "auth_service",
  "from": "2026-06-07T08:00:00Z",
  "to": "2026-06-07T09:00:00Z"
}
```

```json
{
  "service": "orders_api",
  "from": "2026-06-07T10:00:00+02:00",
  "to": "2026-06-07T11:00:00+02:00"
}
```

Si se proporciona `from` pero no `to`, el servidor usa el momento actual como `to`.

### Reglas de validación de ventanas

- `since` y `from`/`to` son **mutuamente excluyentes**. Usarlos juntos produce un error de validación.
- `to` sin `from` produce un error de validación.
- `from > to` produce un error de validación.
- Sin parámetros temporales → se usa `MCP_DEFAULT_SINCE` (por defecto: `1h`).

---

## Filtrado por nivel (severidad mínima)

El parámetro `level` en `query_logs` y `search_logs` **no filtra por nivel exacto**, sino por **severidad mínima**. Esto significa que todos los eventos con ese nivel o superior se incluyen en los resultados.

| `level` especificado | Niveles consultados al gateway |
|---|---|
| `trace` | trace, debug, info, warn, error, fatal |
| `debug` | debug, info, warn, error, fatal |
| `info` | info, warn, error, fatal |
| `warn` | warn, error, fatal |
| `error` | error, fatal |
| `fatal` | fatal |

```json
// Consultar todos los eventos de warning o peor
{ "service": "payments_api", "level": "warn" }
// → El gateway recibe: level=warn,error,fatal

// Consultar solo errores críticos
{ "service": "auth_service", "level": "error" }
// → El gateway recibe: level=error,fatal
```

> Las herramientas `get_recent_errors` y `summarize_errors` siempre usan `level=error,fatal` internamente, independientemente de lo que especifique el agente.

---

## Paginación

### Paginación manual (cursor)

Cuando el gateway tiene más resultados de los que caben en una página, devuelve un `next_cursor` en la respuesta:

```
Paginación: next_cursor=crs_abc123 | range_truncated=false | limit_truncated=true
```

Para obtener la siguiente página, pasa ese cursor como parámetro `cursor` en la siguiente llamada:

```json
{
  "service": "payments_api",
  "cursor": "crs_abc123",
  "sort": "desc"
}
```

### Autopaginación (`max_pages`)

Para recuperar múltiples páginas automáticamente en una sola llamada, usa `max_pages`:

```json
{
  "service": "payments_api",
  "since": "6h",
  "max_pages": 3,
  "limit": 100
}
```

El servidor recupera hasta 3 páginas de 100 resultados cada una (máximo 300 eventos) y los combina en una sola respuesta.

**Límites:**
- `max_pages` se recorta silenciosamente a `MCP_MAX_PAGES` (por defecto: 5).
- `limit` se recorta silenciosamente a `MCP_MAX_LIMIT` (por defecto: 1000).
- La paginación para automáticamente si el gateway no devuelve `next_cursor`, aunque no se haya alcanzado `max_pages`.

### Indicadores de truncado

| Campo | Descripción |
|---|---|
| `next_cursor` | Token para la siguiente página. `null` si no hay más datos. |
| `range_truncated` | `true` si el gateway recortó el rango temporal. |
| `limit_truncated` | `true` si se alcanzó el límite de resultados antes del fin del rango. |

---

## Política de decisión: logs locales vs. MCP

Este MCP no reemplaza los logs locales. La política de decisión correcta para el agente es:

### Usa los **logs locales** cuando:
- El fallo es reciente y reproducible localmente.
- Las rutas de log local del proyecto son conocidas (`.logs/app.log`, `/var/log/app/`, etc.).
- El desarrollador está depurando en su máquina o en un entorno de desarrollo local.

### Usa el **MCP** cuando:
- Se necesita información histórica (eventos de días o semanas atrás).
- Los logs son de un entorno remoto o de producción.
- Se busca por `request_id`, `trace_id` o `span_id` (identificadores del sistema centralizado).
- El usuario pide explícitamente: "mira en el gateway", "consulta OpenObserve", "usa el MCP".
- Se necesita correlacionar logs de múltiples servicios.
- Los logs locales no contienen la información suficiente.

### Ejemplo de decisión correcta

```
Usuario: "¿Por qué falla el test unitario?"
→ Agente usa logs locales, NO el MCP.

Usuario: "¿Qué pasó en producción anoche a las 3am?"
→ Agente usa el MCP (histórico, entorno remoto).

Usuario: "Busca el request_id req_abc123"
→ Agente usa el MCP (identificador del sistema centralizado).

Usuario: "¿Hay errores en payments_api?"
→ Agente revisa primero logs locales si hay rutas conocidas;
  escala al MCP si no hay suficiente información.
```

---

## Seguridad

### Protecciones implementadas

- **API key nunca expuesta**: La key de `LOG_GATEWAY_API_KEY` se usa como `Bearer` token en las cabeceras HTTP internas, pero **nunca** aparece en respuestas de herramientas, mensajes de error, logs del servidor ni salida stdout.
- **Solo lectura**: El servidor no implementa ninguna herramienta de escritura, modificación ni borrado. Solo usa `GET`.
- **Sin acceso directo a OpenObserve**: Las credenciales `OO_URL`, `OO_USER`, `OO_PASSWORD`, `OO_ORG` y `OO_STREAM` están explícitamente rechazadas.
- **Logs en stderr**: Todos los logs internos del servidor van a stderr. El stdout está reservado exclusivamente para los mensajes del protocolo MCP. Un log en stdout rompería el protocolo.
- **Redacción automática**: El sistema de logging redacta automáticamente secretos, tokens Bearer, contraseñas, API keys, cabeceras Authorization y session IDs antes de escribirlos.
- **Validación de entradas**: Todas las entradas de herramientas se validan con Zod antes de contactar al gateway. Entradas inválidas se rechazan sin llamada HTTP.
- **Paginación acotada**: El fan-out y la paginación están limitados para evitar bucles indefinidos o sobrecarga del gateway.

### Recomendaciones de configuración segura

```bash
# Nunca hardcodear la key en comandos de shell
# Mal:
LOG_GATEWAY_API_KEY=mi_secreto node dist/index.js

# Bien: usar un archivo .env no versionado
source .env && node dist/index.js

# O usar un gestor de secretos
LOG_GATEWAY_API_KEY=$(vault kv get -field=api_key secret/log-gateway) node dist/index.js
```

```bash
# Añadir al .gitignore
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore
```

---

## Solución de problemas

### El servidor no arranca

```
Error: Variable de entorno obligatoria no definida: LOG_GATEWAY_URL
```
→ Configura `LOG_GATEWAY_URL` con la URL base del gateway.

```
Error: Variable de entorno no permitida: OO_URL
```
→ Elimina todas las variables `OO_*` de tu entorno. Este MCP no acepta credenciales directas de OpenObserve.

### Errores de conexión al gateway

```
Error de conectividad: No se pudo conectar al gateway en http://localhost:8080
```
→ Verifica que el gateway está corriendo y que `LOG_GATEWAY_URL` es correcto. Usa `check_gateway_health` para diagnosticar.

### Errores de autenticación

```
API key ausente, inválida o mal configurada
```
→ Verifica que `LOG_GATEWAY_API_KEY` tiene el formato correcto (`key_id.secret`) y que la key tiene scope `read`.

### La búsqueda textual no funciona

```
Esta API key no permite búsqueda textual libre (allow_q=false)
```
→ La API key configurada no tiene permiso de búsqueda textual. Usa `query_logs` con filtros de nivel y tiempo, o solicita al administrador del gateway una key con `allow_q=true`.

### Respuestas truncadas

Si las respuestas se cortan con un indicador de truncado, aumenta `MCP_RESPONSE_MAX_CHARS`:

```env
MCP_RESPONSE_MAX_CHARS=100000
```

O usa `limit` y `max_pages` más pequeños para recibir menos datos por llamada.

### Rate limiting

```
Rate limit o cola llena — espera antes de reintentar
```
→ El gateway está rechazando peticiones por exceso de carga. Espera unos segundos antes de reintentar. Consulta `get_metrics` para ver el estado de la cola.

### Timeout en peticiones

El servidor realiza un único reintento automático tras un timeout. Si el reintento también falla:
```
La petición superó el timeout de 15000ms y el reintento también falló
```
→ Aumenta `MCP_REQUEST_TIMEOUT_MS` o verifica la conectividad con el gateway.

### Diagnóstico con logs de debug

```bash
LOG_LEVEL=debug node dist/index.js
```

Los logs se escriben en stderr. Para capturarlos:

```bash
LOG_GATEWAY_URL=http://... LOG_GATEWAY_API_KEY=... node dist/index.js 2>debug.log
```

---

## Desarrollo y contribución

### Requisitos de desarrollo

```bash
node --version  # 22.x o superior
npm --version   # 10.x o superior
```

### Comandos de desarrollo

```bash
# Instalar dependencias
npm install

# Compilar TypeScript
npm run build

# Ejecutar en modo desarrollo (sin compilar)
npm run dev

# Linting (debe pasar sin errores)
npm run lint

# Verificación de tipos (debe pasar sin errores)
npm run typecheck

# Ejecutar tests
npm test

# Ejecutar tests con coverage (≥80% en todos los umbrales)
npm run coverage
```

### Ejecutar tests

```bash
# Todos los tests
npm test

# Solo tests unitarios
npx vitest run tests/unit/

# Solo tests de contrato
npx vitest run tests/contract/

# Solo tests de integración
npx vitest run tests/integration/

# Con coverage detallado
npm run coverage
```

### Estructura del código fuente

```
src/
├── index.ts              # Punto de entrada: wiring de config, cliente y herramientas
├── config.ts             # Parseo de variables de entorno con Zod
├── gateway-client.ts     # Cliente HTTP: timeout, reintentos, mapeo de errores
├── errors.ts             # Tipos de error del dominio (AuthError, RateLimitError, etc.)
├── formatters.ts         # Formato de texto para respuestas MCP
├── logger.ts             # Wrapper de logging (única API de logging para la app)
├── logger/
│   ├── redaction.ts      # Rutas de redacción de secretos en Pino
│   ├── levels.ts         # Mapeo de LOG_LEVEL a nivel Pino efectivo
│   └── format.ts         # Formateo humanizado es-ES/Europe/Madrid
├── pagination.ts         # Autopaginación, cursor, límites
├── time.ts               # Parseo de ventanas temporales (since, from/to)
└── tools/
    ├── list-services.ts
    ├── query-logs.ts
    ├── search-logs.ts
    ├── get-recent-errors.ts
    ├── summarize-errors.ts
    ├── get-log-by-trace-or-request.ts
    ├── check-gateway-health.ts
    └── get-metrics.ts
```

### Estándares de código

- TypeScript 6.0.3 estricto con ESM (`"type": "module"`, especificadores `.js`)
- Todos los inputs de herramientas validados con Zod v4 antes de cualquier llamada HTTP
- El código de aplicación nunca usa `console.*` directamente; siempre `src/logger.ts`
- El código de aplicación nunca importa `pino` ni `pino-pretty` directamente
- Cobertura de tests ≥ 80% en líneas, ramas, funciones y sentencias

---

## Licencia

MIT
