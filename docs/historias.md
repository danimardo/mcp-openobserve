# Historias y especificacion del MCP Log Gateway

**Version**: 1.0  
**Fecha**: 2026-06-07  
**Proyecto**: `mcp-openobserve`  
**Objetivo**: definir un servidor MCP de solo lectura para que agentes de IA consulten logs a traves del Log Gateway API.  
**Fuentes usadas**:

- `docs/mcp-openobserve-spec.md`
- `docs/manual-de-integracion.md`
- `docs/openapi.yaml`

## 1. Resumen ejecutivo

El servidor MCP debe permitir que un agente de IA consulte logs de aplicaciones internas sin acceder directamente a OpenObserve y sin que el desarrollador tenga que copiar y pegar registros manualmente.

La arquitectura correcta es:

```text
Aplicacion / frontend / backend
        |
        | envia logs
        v
Log Gateway API
        |
        | almacena en OpenObserve
        v
OpenObserve

Agente IA
        |
        | llama herramientas MCP de solo lectura
        v
MCP Log Gateway
        |
        | HTTP Bearer contra Log Gateway API
        v
Log Gateway API
```

Decisiones cerradas:

- El MCP consume el **Log Gateway API**.
- El MCP **no** consume OpenObserve directamente.
- El MCP es de **solo lectura**.
- El MCP usa una unica API key por entorno/aplicacion.
- El MCP combina historias de usuario, criterios de aceptacion y especificacion tecnica.
- El fichero debe estar escrito en espanol limpio y UTF-8.

## 2. Problema que resuelve

En desarrollo local, muchas aplicaciones ya generan ficheros de log locales y los agentes suelen tener instrucciones para leer esos ficheros. Eso debe seguir siendo el camino preferente para depurar problemas recientes y reproducibles en local.

El MCP existe para los casos en los que los logs locales no bastan:

- Logs antiguos que ya no estan en el fichero local.
- Logs de despliegues remotos: `dev`, `test`, `staging` o `prod`.
- Logs de frontend o navegador enviados al gateway.
- Logs de otro servicio relacionado con el fallo.
- Correlacion por `request_id`, `trace_id` o `span_id`.
- Verificacion de lo que realmente llego al sistema centralizado.
- Situaciones en las que el desarrollador pide explicitamente usar el MCP o OpenObserve.

El agente no debe interpretar "mira los logs" como "usa siempre el MCP". Debe elegir la fuente de logs segun el contexto.

## 3. Politica de decision: logs locales vs MCP

### 3.1 Regla por defecto

Si el usuario pide "mira los logs", "revisa el error" o "comprueba que ha pasado" en el contexto de una aplicacion que se esta ejecutando en local, el agente debe revisar primero los logs locales definidos en las instrucciones del proyecto.

Solo debe usar el MCP cuando haya una razon clara.

### 3.2 Usar primero logs locales cuando

- El problema acaba de ocurrir en la maquina del desarrollador.
- El usuario esta ejecutando la aplicacion localmente.
- Existe una ruta conocida de log local en las instrucciones del agente o del repo.
- El objetivo es ver errores inmediatos de una prueba local.
- El usuario no menciona entorno remoto, historico, OpenObserve, gateway, centralizado, `prod`, `staging`, `dev` remoto o una fecha/hora antigua.

Ejemplos:

- "Mira los logs y dime por que falla el arranque."
- "Acabo de ejecutar el test, revisa el error."
- "Arranque la app y da 500, mira los logs."

Comportamiento esperado:

- Leer los ficheros locales relevantes.
- Si los logs locales no existen, estan vacios o no cubren la ventana temporal, explicar brevemente la limitacion.
- Usar MCP como fallback solo si aporta informacion.

### 3.3 Usar MCP cuando

- El usuario lo pide explicitamente: "usa el MCP", "consulta OpenObserve", "mira en el gateway", "mira los logs centralizados".
- El usuario pregunta por logs antiguos: "ayer a las 03:00", "hace cinco dias", "la semana pasada".
- El usuario pregunta por un entorno remoto: `prod`, `staging`, `test`, `dev` desplegado.
- El usuario busca logs de frontend enviados por API.
- El usuario quiere correlacion entre servicios.
- El usuario proporciona `request_id`, `trace_id`, `span_id` o un identificador que puede existir en logs centralizados.
- Los logs locales no tienen la informacion necesaria.
- El usuario quiere comprobar si el gateway recibio o almaceno un evento.

Ejemplos:

- "Mira en OpenObserve los errores de `payments_api` de ayer a las 03:00."
- "Usa el MCP para buscar el `request_id=req-123`."
- "Comprueba los logs centralizados de `staging`."
- "Busca en los logs del frontend el usuario que tuvo el error."

### 3.4 Si hay ambiguedad

Si no esta claro si el usuario quiere logs locales o centralizados, el agente debe usar este orden:

1. Revisar logs locales si estan disponibles y la peticion parece local/reciente.
2. Usar MCP si el usuario menciona una ventana historica, un entorno remoto o una correlacion que no se puede resolver localmente.
3. Si ambas fuentes pueden ser utiles, empezar por la menos costosa y explicar la decision en una frase.

No se debe bloquear preguntando salvo que elegir la fuente incorrecta pueda llevar a una conclusion enganosa.

## 4. Alcance funcional

### 4.1 Incluido

- Consultar logs por servicio, entorno, nivel y ventana temporal.
- Buscar texto libre en logs cuando la API key lo permita.
- Consultar errores recientes.
- Resumir errores por frecuencia de mensaje.
- Listar servicios y capacidades autorizadas para la API key.
- Buscar por `request_id` o `trace_id`.
- Consultar salud del gateway.
- Consultar metricas Prometheus si el endpoint esta habilitado y se decide exponerlo.
- Gestionar paginacion con `cursor`.
- Devolver resultados legibles para agentes IA y, cuando sea util, datos estructurados.

### 4.2 Excluido

- Ingestar logs.
- Modificar logs.
- Borrar logs.
- Crear streams.
- Administrar API keys.
- Acceder a OpenObserve con Basic Auth.
- Ejecutar SQL directo.
- Exponer credenciales al agente.

## 5. Actores

### Desarrollador

Persona que trabaja en una aplicacion y quiere que un agente le ayude a depurar usando logs.

### Agente IA

Cliente MCP que decide si debe leer ficheros locales o llamar al MCP, ejecuta herramientas y sintetiza una respuesta.

### MCP Log Gateway

Servidor MCP local, lanzado por el agente, que transforma llamadas MCP en peticiones HTTP de solo lectura al Log Gateway API.

### Log Gateway API

Servicio HTTP existente documentado en `manual-de-integracion.md` y `openapi.yaml`. Gestiona autenticacion, autorizacion, limites y acceso a OpenObserve.

### OpenObserve

Sistema interno de almacenamiento y busqueda de logs. Queda oculto para el MCP.

## 6. Historias de usuario

### US-001 - Decidir correctamente la fuente de logs

Como desarrollador, quiero que el agente sepa cuando leer logs locales y cuando usar el MCP, para evitar consultas innecesarias al sistema centralizado y obtener respuestas mas rapidas.

Criterios de aceptacion:

- Dado un problema local reciente, el agente revisa primero logs locales si existen instrucciones o rutas conocidas.
- Dado un problema historico o remoto, el agente usa el MCP.
- Dado un pedido explicito de usar MCP/OpenObserve/gateway, el agente usa el MCP.
- Dado que los logs locales no contienen informacion suficiente, el agente puede escalar al MCP.
- El agente explica brevemente la fuente elegida cuando la decision no es obvia.

### US-002 - Configurar el MCP con una API key por entorno

Como desarrollador, quiero configurar el MCP con la URL del gateway y una API key de lectura, para consultar logs del entorno correspondiente sin exponer credenciales internas.

Criterios de aceptacion:

- El MCP arranca si `LOG_GATEWAY_URL` y `LOG_GATEWAY_API_KEY` estan definidos.
- El MCP falla de forma explicita si falta una variable obligatoria.
- El MCP no necesita credenciales de OpenObserve.
- El MCP no imprime la API key en errores, logs ni respuestas.
- El MCP permite definir valores por defecto para entorno, limite y ventana temporal.

### US-003 - Descubrir servicios y capacidades

Como agente IA, quiero saber que servicios, entornos, scopes y limites permite la API key actual, para no llamar consultas que el gateway rechazara.

Criterios de aceptacion:

- La tool `list_services` llama a `GET /api/v1/services`.
- La respuesta incluye servicios autorizados, entornos, scopes y limites.
- La respuesta no incluye secretos, hashes ni datos de otras keys.
- Si la key no tiene scope `read`, el MCP lo comunica claramente.
- Si `allow_q` es `false`, el agente evita usar busqueda textual libre.

### US-004 - Consultar logs recientes de un servicio

Como desarrollador, quiero pedir "mira los ultimos logs de `payments_api`", para entender que ha pasado recientemente.

Criterios de aceptacion:

- La tool `query_logs` acepta `service`.
- Si no se indica ventana temporal, usa `MCP_DEFAULT_SINCE` o `1h`.
- Si no se indica `limit`, usa `MCP_DEFAULT_LIMIT` o `100`.
- La tool llama a `GET /api/v1/logs`.
- La respuesta esta ordenada por defecto de mas reciente a mas antiguo.
- La salida muestra timestamp, nivel, servicio, entorno, mensaje y campos de correlacion relevantes.

### US-005 - Consultar logs en una fecha y hora concreta

Como desarrollador, quiero pedir logs de "ayer a las 03:00" o "hace cinco minutos", para investigar incidentes en ventanas temporales concretas.

Criterios de aceptacion:

- La tool `query_logs` acepta ventanas relativas mediante `since`.
- La tool `query_logs` acepta ventanas absolutas mediante `from` y `to`.
- `from` y `to` usan ISO-8601 con zona horaria o UTC.
- El agente convierte expresiones naturales del usuario a `from`/`to` antes de llamar la tool.
- Si el usuario no da duracion para una hora puntual, el agente usa una ventana razonable y pequena, por ejemplo de 10 a 15 minutos alrededor de la hora indicada.
- Si se reciben a la vez `since` y `from`/`to`, el MCP rechaza la entrada con error de validacion.

### US-006 - Filtrar por nivel y entorno

Como desarrollador, quiero filtrar por `level` y `env`, para reducir ruido y centrarme en errores relevantes.

Criterios de aceptacion:

- La tool acepta `level` como uno o varios niveles.
- Niveles soportados: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.
- La tool acepta `env` cuando el gateway y la key lo permitan.
- Si se solicita un entorno no autorizado, el MCP devuelve el error del gateway de forma comprensible.

### US-007 - Buscar texto libre

Como desarrollador, quiero buscar logs que contengan un texto, id de usuario, pedido o fragmento de error, para encontrar eventos relacionados.

Criterios de aceptacion:

- La tool `search_logs` recibe `service` y `query`.
- La tool traduce `query` al parametro `q` de `GET /api/v1/logs`.
- Antes de usar `q`, el MCP debe conocer si `allow_q` esta permitido o manejar el `403` de forma clara.
- La busqueda permite combinar `query`, `env`, `level`, `from`/`to`, `since` y `limit`.
- Si `q` esta prohibido para una key frontend, el MCP informa que esa key no permite busqueda textual libre.

### US-008 - Consultar errores recientes

Como desarrollador, quiero pedir "mira los errores recientes de `auth_service`", para ir directamente a los problemas.

Criterios de aceptacion:

- La tool `get_recent_errors` consulta niveles `error` y `fatal`.
- Permite `service`, `env`, `since`, `from`, `to` y `limit`.
- Devuelve una lista legible de errores.
- Incluye `request_id`, `trace_id`, `span_id` y contexto util cuando existan.
- Si no hay errores, devuelve una respuesta explicita y no trata el caso como fallo tecnico.

### US-009 - Resumir errores frecuentes

Como desarrollador, quiero saber cuales son los errores mas repetidos de un servicio, para priorizar la investigacion.

Criterios de aceptacion:

- La tool `summarize_errors` consulta logs `error` y `fatal`.
- El agrupado se puede hacer en el MCP a partir de los eventos devueltos por el gateway.
- Agrupa por mensaje normalizado.
- Devuelve ocurrencias, ultimo timestamp y ejemplos de `request_id`/`trace_id` si existen.
- Limita el numero de resultados para evitar respuestas excesivas.
- Si hay mas paginas, indica que el resumen es parcial salvo que se haya solicitado autopaginacion.

### US-010 - Buscar por request_id o trace_id

Como desarrollador, quiero buscar todos los logs relacionados con un `request_id` o `trace_id`, para reconstruir una peticion o traza.

Criterios de aceptacion:

- La tool `get_log_by_trace_or_request` acepta `request_id` o `trace_id`.
- Debe recibir al menos uno de los dos.
- Si recibe `service`, consulta solo ese servicio.
- Si no recibe `service`, obtiene servicios autorizados con `list_services` y consulta cada uno de forma controlada.
- Devuelve resultados agrupados por servicio y ordenados temporalmente.
- No debe consultar servicios no autorizados.

### US-011 - Gestionar paginacion sin complicar al usuario

Como agente IA, quiero que el MCP soporte paginacion pero que el caso habitual siga siendo sencillo, para obtener resultados recientes sin coste innecesario.

Criterios de aceptacion:

- Todas las tools de consulta aceptan `cursor` cuando aplique.
- La primera llamada no necesita `cursor`.
- Si el gateway devuelve `next_cursor`, la respuesta del MCP lo muestra.
- Por defecto, el MCP obtiene una sola pagina.
- Las tools pueden aceptar `max_pages` para autopaginar de forma limitada.
- `max_pages` debe tener un maximo configurable y conservador.
- El MCP nunca entra en bucles de paginacion indefinidos.

Decision recomendada:

- Exponer `cursor` para control explicito.
- Exponer `max_pages` opcional, por defecto `1`.
- Valor maximo por defecto: `5`.
- Mantener `limit` por pagina, no como limite global implicito.

Razonamiento:

- Para "ultimos logs" una pagina suele ser suficiente.
- Para "ayer a las tres" lo importante no es paginar sino usar bien `from` y `to`.
- Para investigaciones largas, el agente puede pedir mas paginas de forma explicita o usar `max_pages`.

### US-012 - Consultar salud del gateway

Como desarrollador, quiero comprobar si el gateway esta vivo y listo, para distinguir errores de configuracion de ausencia real de logs.

Criterios de aceptacion:

- La tool `check_gateway_health` llama a `GET /api/v1/health`.
- Opcionalmente llama a `GET /api/v1/health/ready`.
- Distingue `ok`, `ready` y `not_ready`.
- No requiere API key para los endpoints publicos, aunque el MCP puede estar configurado con ella.

### US-013 - Consultar metricas

Como operador o desarrollador avanzado, quiero consultar metricas basicas del gateway, para diagnosticar rate limiting, cola llena o fallos de backend.

Criterios de aceptacion:

- La tool `get_metrics` llama a `GET /api/v1/metrics`.
- Devuelve texto Prometheus o un resumen parseado si se implementa parser.
- Puede estar deshabilitada por configuracion.
- No debe exponer secretos.

### US-014 - Gestionar errores del gateway

Como agente IA, quiero recibir errores claros del MCP, para saber si el problema es autenticacion, permisos, rate limit, validacion o fallo del gateway.

Criterios de aceptacion:

- `401` se comunica como API key ausente, invalida o mal configurada.
- `403` se comunica como falta de scope, servicio no autorizado, entorno no autorizado o restriccion de key.
- `400` se comunica como error de validacion de parametros.
- `429` se comunica como rate limit o cola llena.
- `502` se comunica como fallo de OpenObserve visto por el gateway.
- El `request_id` del error se conserva cuando el gateway lo devuelve.
- La API key nunca aparece en mensajes de error.

### US-015 - Mantener seguridad y privacidad

Como responsable tecnico, quiero que el MCP sea una capa segura de consulta, para que los agentes no puedan exfiltrar credenciales ni modificar logs.

Criterios de aceptacion:

- No hay tools de escritura.
- No hay endpoints de administracion.
- No se aceptan SQL ni rutas arbitrarias.
- No se configuran credenciales de OpenObserve.
- No se imprimen variables de entorno sensibles.
- Las respuestas se limitan por `limit`, `max_pages` y truncado de salida.
- El MCP respeta las restricciones del gateway.

## 7. Contrato del Log Gateway API usado por el MCP

El MCP debe basarse en los endpoints documentados en `openapi.yaml`.

### 7.1 Autenticacion

Endpoints protegidos:

```http
Authorization: Bearer <key_id>.<secret>
```

El MCP recibe el token completo en una variable de entorno y lo envia como Bearer. No debe separar, transformar, imprimir ni validar criptograficamente el secreto; esa responsabilidad pertenece al gateway.

### 7.2 Endpoints usados

| Metodo | Ruta | Uso en MCP | Auth |
|---|---|---|---|
| `GET` | `/api/v1/logs` | Consultar logs | Bearer |
| `GET` | `/api/v1/services` | Descubrir servicios y limites | Bearer |
| `GET` | `/api/v1/health` | Liveness | No |
| `GET` | `/api/v1/health/ready` | Readiness | No |
| `GET` | `/api/v1/metrics` | Metricas Prometheus | No |

Endpoints que el MCP no debe usar:

| Metodo | Ruta | Motivo |
|---|---|---|
| `POST` | `/api/v1/logs` | Escritura/ingesta fuera de alcance |
| `POST` | `/api/v1/logs/batch` | Escritura/ingesta fuera de alcance |

### 7.3 Parametros de `GET /api/v1/logs`

| Parametro | Tipo | Obligatorio | Uso |
|---|---|---|---|
| `service` | string | Si | Servicio/stream logico |
| `from` | string ISO-8601 | No | Inicio de ventana |
| `to` | string ISO-8601 | No | Fin de ventana |
| `level` | string | No | Uno o varios niveles separados por coma |
| `env` | string | No | Entorno |
| `q` | string | No | Busqueda textual, puede estar restringida |
| `trace_id` | string | No | Filtro de traza |
| `request_id` | string | No | Filtro de peticion |
| `limit` | integer | No | Maximo por pagina |
| `cursor` | string | No | Cursor opaco de pagina previa |
| `sort` | `asc`/`desc` | No | Orden temporal |
| `include_total` | boolean | No | Costoso; solo backend/interno |

### 7.4 Respuesta esperada de consulta

El gateway devuelve un `QueryResult` con:

- `items`: eventos de log.
- `next_cursor`: cursor opaco o `null`.
- `range_truncated`: indica si el gateway recorto la ventana temporal.
- `limit_truncated`: indica si el limite fue recortado.
- `total`: opcional, solo si se permite y se solicita `include_total=true`.
- `request_id`: id de la consulta.

El MCP debe conservar en su salida:

- Numero de resultados.
- Si hay mas paginas.
- `request_id` de la consulta.
- Indicadores `range_truncated` y `limit_truncated`.

### 7.5 Modelo de log relevante

Campos principales:

- `_timestamp`
- `service`
- `env`
- `level`
- `message`
- `version`
- `event_id`
- `trace_id`
- `span_id`
- `request_id`
- `hostname`
- `source`
- `context`
- `context_truncated`

El MCP no debe asumir que todos los campos existen.

## 8. Tools MCP

Todas las tools deben devolver una respuesta util para un agente IA. Siempre que sea viable, la respuesta debe incluir:

- Un bloque de texto resumido y legible.
- Datos estructurados minimos para que el agente pueda razonar sin reparsear texto.
- Metadatos de paginacion y `request_id`.

### 8.1 `list_services`

Descripcion:

Lista servicios, entornos, scopes y limites permitidos por la API key actual.

Endpoint:

```http
GET /api/v1/services
```

Input:

```json
{}
```

Output esperado:

```json
{
  "services": ["payments_api", "auth_service"],
  "envs": ["prod", "staging", "dev", "test"],
  "scopes": ["read"],
  "limits": {
    "max_query_window": null,
    "max_limit": 1000,
    "allow_q": true,
    "response_profile": "full"
  },
  "request_id": "..."
}
```

Notas:

- Esta tool lista servicios autorizados, no necesariamente servicios activos.
- Si en el futuro se necesita "servicios con actividad", se puede implementar una tool adicional que consulte cada servicio autorizado de forma acotada.

### 8.2 `query_logs`

Descripcion:

Consulta logs de un servicio con filtros seguros.

Endpoint:

```http
GET /api/v1/logs
```

Input:

```json
{
  "service": "payments_api",
  "env": "prod",
  "level": ["error", "fatal"],
  "since": "1h",
  "from": "2026-06-07T01:55:00+02:00",
  "to": "2026-06-07T02:10:00+02:00",
  "limit": 100,
  "cursor": null,
  "sort": "desc",
  "include_total": false,
  "max_pages": 1
}
```

Reglas:

- `service` es obligatorio.
- `since` no puede combinarse con `from`/`to`.
- Si no hay `since`, `from` ni `to`, usar `MCP_DEFAULT_SINCE` o `1h`.
- Si se usa una hora concreta, el agente debe construir `from` y `to`.
- `limit` se aplica por pagina.
- `max_pages` por defecto es `1`.
- `sort` por defecto es `desc`.

Mapeo a query params:

- `service` -> `service`
- `env` -> `env`
- `level[]` -> `level=error,fatal`
- `from` -> `from`
- `to` -> `to`
- `limit` -> `limit`
- `cursor` -> `cursor`
- `sort` -> `sort`
- `include_total` -> `include_total`

### 8.3 `search_logs`

Descripcion:

Busca texto libre en logs de un servicio.

Endpoint:

```http
GET /api/v1/logs?q=<query>
```

Input:

```json
{
  "service": "payments_api",
  "query": "timeout",
  "env": "prod",
  "level": ["warn", "error", "fatal"],
  "since": "24h",
  "limit": 100,
  "max_pages": 1
}
```

Reglas:

- `query` es obligatorio.
- Debe mapear a `q`.
- Si la key no permite `q`, devolver mensaje claro.
- No construir SQL.

### 8.4 `get_recent_errors`

Descripcion:

Devuelve errores recientes (`error` y `fatal`) de un servicio.

Endpoint:

```http
GET /api/v1/logs?level=error,fatal
```

Input:

```json
{
  "service": "auth_service",
  "env": "staging",
  "since": "1h",
  "limit": 100,
  "max_pages": 1
}
```

Reglas:

- Internamente llama a `query_logs` con `level=["error","fatal"]`.
- Si no hay resultados, responder "No se encontraron errores..." con la ventana usada.

### 8.5 `summarize_errors`

Descripcion:

Resume errores frecuentes de un servicio.

Endpoint:

```http
GET /api/v1/logs?level=error,fatal
```

Input:

```json
{
  "service": "payments_api",
  "env": "prod",
  "since": "6h",
  "limit": 500,
  "max_pages": 2,
  "top": 10
}
```

Reglas:

- Consulta errores y fatales.
- Agrupa client-side por `message` normalizado.
- Normalizacion minima:
  - trim.
  - colapsar espacios.
  - opcionalmente sustituir UUIDs, numeros largos o ids muy variables por marcadores si se implementa.
- Devuelve top N.
- Indica si el resumen es parcial por `next_cursor`, `range_truncated`, `limit_truncated` o `max_pages` alcanzado.

Output textual recomendado:

```text
Errores mas frecuentes en payments_api (prod, ultimas 6h):

1. [23] Connection timeout to database
   Ultimo: 2026-06-07T10:23:11.000Z
   Ejemplos: request_id=req-1, trace_id=trace-1

2. [8] Payment gateway returned 503
   Ultimo: 2026-06-07T10:19:44.000Z
```

### 8.6 `get_log_by_trace_or_request`

Descripcion:

Busca logs por `request_id` o `trace_id`.

Endpoint:

```http
GET /api/v1/logs?request_id=...
GET /api/v1/logs?trace_id=...
```

Input:

```json
{
  "service": "api_gateway",
  "request_id": "req-abc",
  "trace_id": null,
  "env": "prod",
  "since": "24h",
  "limit": 100,
  "max_pages": 1
}
```

Reglas:

- Requiere `request_id` o `trace_id`.
- Si se proporcionan ambos, aplicar ambos filtros si el gateway lo permite.
- Si `service` se omite:
  - llamar a `list_services`.
  - consultar servicios autorizados de forma secuencial o con concurrencia limitada.
  - limitar el numero total de servicios consultados mediante configuracion.
- Orden recomendado: `asc`, para reconstruir la secuencia temporal.

### 8.7 `check_gateway_health`

Descripcion:

Comprueba liveness y readiness del gateway.

Endpoints:

```http
GET /api/v1/health
GET /api/v1/health/ready
```

Input:

```json
{
  "include_ready": true
}
```

Output:

```json
{
  "live": "ok",
  "ready": "ready"
}
```

### 8.8 `get_metrics`

Descripcion:

Obtiene metricas Prometheus del gateway.

Endpoint:

```http
GET /api/v1/metrics
```

Input:

```json
{
  "format": "text"
}
```

Reglas:

- Debe poder deshabilitarse con `MCP_ENABLE_METRICS_TOOL=false`.
- Si se implementa resumen parseado, mantener tambien acceso al texto original o a una seleccion relevante.

## 9. Configuracion del MCP

Variables obligatorias:

| Variable | Descripcion | Ejemplo |
|---|---|---|
| `LOG_GATEWAY_URL` | URL base del gateway, sin necesidad de incluir `/api/v1` | `https://logs.tuempresa.com` |
| `LOG_GATEWAY_API_KEY` | Bearer token completo de la API key | `key-abc123.secreto` |

Variables opcionales:

| Variable | Default | Descripcion |
|---|---|---|
| `LOG_GATEWAY_API_PREFIX` | `/api/v1` | Prefijo de API |
| `MCP_DEFAULT_ENV` | vacio | Entorno por defecto si el usuario no indica uno |
| `MCP_DEFAULT_SINCE` | `1h` | Ventana por defecto |
| `MCP_DEFAULT_LIMIT` | `100` | Limite por pagina |
| `MCP_MAX_LIMIT` | `1000` | Limite maximo permitido por el MCP |
| `MCP_MAX_PAGES` | `5` | Maximo de paginas en autopaginacion |
| `MCP_REQUEST_TIMEOUT_MS` | `15000` | Timeout HTTP |
| `MCP_ENABLE_METRICS_TOOL` | `true` | Activa/desactiva `get_metrics` |
| `MCP_MAX_SERVICES_FANOUT` | `20` | Maximo de servicios a consultar si `service` se omite en busqueda por traza |
| `MCP_RESPONSE_MAX_CHARS` | `50000` | Maximo recomendado de texto devuelto al agente |

Variables prohibidas:

| Variable | Motivo |
|---|---|
| `OO_URL` | El MCP no debe llamar a OpenObserve |
| `OO_USER` | Credencial directa no permitida |
| `OO_PASSWORD` | Credencial directa no permitida |
| `OO_ORG` | Detalle interno de OpenObserve |
| `OO_STREAM` | El gateway resuelve streams por servicio |

## 10. Registro en clientes MCP

Ejemplo generico:

```json
{
  "mcpServers": {
    "log-gateway": {
      "command": "node",
      "args": ["F:/Apps/mcp-openobserve/dist/index.js"],
      "env": {
        "LOG_GATEWAY_URL": "https://logs.tuempresa.com",
        "LOG_GATEWAY_API_KEY": "key-abc123.secreto",
        "MCP_DEFAULT_ENV": "dev",
        "MCP_DEFAULT_SINCE": "1h",
        "MCP_DEFAULT_LIMIT": "100"
      }
    }
  }
}
```

En desarrollo TypeScript:

```json
{
  "mcpServers": {
    "log-gateway": {
      "command": "node",
      "args": ["--import", "tsx/esm", "F:/Apps/mcp-openobserve/src/index.ts"],
      "env": {
        "LOG_GATEWAY_URL": "http://localhost:3366",
        "LOG_GATEWAY_API_KEY": "key-local.secreto"
      }
    }
  }
}
```

## 11. Formato de salida para agentes

### 11.1 Logs

Formato textual recomendado:

```text
Consulta: payments_api prod ultimos 15m
Resultados: 3
Gateway request_id: 7a9...
next_cursor: null

[2026-06-07T10:23:11.000Z] ERROR payments_api prod Payment processing failed request_id=req-abc trace_id=trace-001
context: {"order_id":"ord-001","amount":99.99}

[2026-06-07T10:22:48.000Z] WARN  payments_api prod Retry payment provider request_id=req-def
```

Reglas:

- Mantener una linea principal por evento.
- Poner contexto adicional debajo solo cuando ayude.
- Truncar mensajes o contextos extremadamente largos.
- Indicar cuando hay mas paginas.
- Indicar cuando el gateway ha truncado rango o limite.

### 11.2 Sin resultados

```text
No se encontraron logs para service=payments_api env=prod en la ventana 2026-06-07T01:55:00+02:00 - 2026-06-07T02:10:00+02:00.
Gateway request_id: 7a9...
```

No debe tratarse como error tecnico.

### 11.3 Errores

```text
No se pudo consultar el Log Gateway.
HTTP 403 forbidden: la API key no tiene permiso de lectura para service=payments_api o env=prod.
Gateway request_id: 7a9...
```

No incluir token ni cabeceras completas.

## 12. Validaciones

### 12.1 Servicio

Formato esperado por la API:

```text
^[a-z0-9_]{3,64}$
```

El MCP debe validar antes de llamar al gateway para dar errores claros.

### 12.2 Niveles

Valores soportados:

- `trace`
- `debug`
- `info`
- `warn`
- `error`
- `fatal`

### 12.3 Tiempo

Formatos relativos permitidos por el MCP:

- `5m`
- `15m`
- `1h`
- `6h`
- `24h`
- `7d`

El MCP puede aceptar cualquier numero positivo con unidad `m`, `h` o `d`, aplicando limites configurados.

Formatos absolutos:

- ISO-8601 con `Z`.
- ISO-8601 con offset: `2026-06-07T03:00:00+02:00`.

Reglas:

- No aceptar `since` junto a `from`/`to`.
- Si solo se proporciona `from`, usar `to=now` salvo que la tool indique otra cosa.
- Si solo se proporciona `to`, devolver error de validacion.
- Si `from > to`, devolver error de validacion.

### 12.4 Limites

- `limit` minimo: `1`.
- `limit` maximo efectivo: minimo entre `MCP_MAX_LIMIT` y el limite reportado por `/services`.
- `max_pages` minimo: `1`.
- `max_pages` maximo: `MCP_MAX_PAGES`.

## 13. Seguridad

Requisitos obligatorios:

- No implementar tools de escritura.
- No aceptar SQL del usuario.
- No construir URLs arbitrarias fuera de `LOG_GATEWAY_URL`.
- No exponer `LOG_GATEWAY_API_KEY`.
- No loguear cabeceras `Authorization`.
- No incluir secretos en errores.
- Respetar `services`, `envs`, `scopes` y `limits` devueltos por el gateway.
- Usar timeouts HTTP.
- Gestionar `429` sin reintentos agresivos.

Recomendaciones:

- Cachear `/services` durante un periodo corto, por ejemplo 5 minutos, para validar capacidades sin llamar en cada tool.
- Permitir invalidar cache si una consulta recibe `403`.
- Limitar fan-out cuando se busque por traza sin servicio.
- Truncar respuestas largas.

## 14. Manejo de errores

| HTTP | Codigo API | Interpretacion MCP |
|---|---|---|
| `400` | `validation_error` / `invalid_level` | Parametros invalidos |
| `401` | `unauthorized` | Token ausente, invalido o mal configurado |
| `403` | `forbidden` | Sin scope, service/env no autorizado o restriccion de key |
| `429` | `rate_limited` | Rate limit o cola llena |
| `502` | `openobserve_error` | El gateway no pudo consultar almacenamiento |
| `503` | readiness | Gateway no listo |

El MCP debe distinguir:

- Error de entrada del agente.
- Error de permisos/configuracion.
- Error temporal de infraestructura.
- Ausencia normal de resultados.

## 15. Implementacion recomendada

Stack:

- Node.js >= 22.
- TypeScript.
- `@modelcontextprotocol/sdk`.
- `zod` para schemas de entrada.
- `fetch` nativo.

Estructura:

```text
mcp-openobserve/
  src/
    index.ts
    config.ts
    gateway-client.ts
    formatters.ts
    time.ts
    pagination.ts
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
    gateway-client.test.ts
    tools/
```

### 15.1 Cliente HTTP

Responsabilidades:

- Construir URLs contra `LOG_GATEWAY_URL + LOG_GATEWAY_API_PREFIX`.
- Incluir Bearer token solo en endpoints protegidos.
- Aplicar timeout.
- Parsear JSON.
- Convertir errores HTTP en errores de dominio.
- No exponer secretos.

### 15.2 Tools

Responsabilidades:

- Validar input con `zod`.
- Convertir input MCP a query params.
- Llamar al cliente.
- Formatear resultados.
- Incluir metadatos utiles.

### 15.3 Formateadores

Responsabilidades:

- Formatear eventos.
- Truncar campos largos.
- Resumir errores.
- Ordenar por tiempo.
- Agrupar por servicio cuando aplique.

## 16. Pruebas

### 16.1 Unitarias

Cubrir:

- Validacion de variables de entorno.
- Construccion de URLs.
- Inclusion de Bearer sin imprimirlo.
- Conversion de `since` a `from`/`to`.
- Rechazo de `since` combinado con `from`/`to`.
- Validacion de `service`.
- Validacion de niveles.
- Truncado de respuestas.
- Agrupacion de errores por mensaje.
- Manejo de `next_cursor`.

### 16.2 Tests de tools con gateway mock

Casos minimos:

- `list_services` exitoso.
- `query_logs` sin resultados.
- `query_logs` con resultados.
- `query_logs` con `next_cursor`.
- `search_logs` con `allow_q=false` o `403`.
- `get_recent_errors` filtra `error,fatal`.
- `summarize_errors` agrupa correctamente.
- `get_log_by_trace_or_request` con servicio.
- `get_log_by_trace_or_request` sin servicio y fan-out limitado.
- `check_gateway_health` ready y not_ready.
- `get_metrics` deshabilitada.

### 16.3 Integracion

Opcional, contra un gateway local:

- `GET /api/v1/health`.
- `GET /api/v1/services` con key de test.
- `GET /api/v1/logs` con service de test.

No se deben ejecutar tests de ingesta desde el MCP salvo que vivan en otro proyecto o sean parte de pruebas del gateway, no del MCP.

## 17. Ejemplos de uso para agentes

### Ejemplo 1 - Caso local reciente

Usuario:

```text
Mira los logs y dime por que falla el arranque.
```

Decision esperada:

```text
Primero revisar logs locales del proyecto, porque la peticion parece local y reciente.
No usar MCP salvo que los logs locales no existan o no expliquen el fallo.
```

### Ejemplo 2 - MCP explicito

Usuario:

```text
Usa el MCP y mira los errores de payments_api en staging de la ultima hora.
```

Tool:

```json
{
  "tool": "get_recent_errors",
  "arguments": {
    "service": "payments_api",
    "env": "staging",
    "since": "1h"
  }
}
```

### Ejemplo 3 - Hora concreta

Usuario:

```text
Mira los logs de auth_service de ayer a las 03:00 en prod.
```

Decision esperada:

- Usar MCP porque es una consulta historica/remota.
- Convertir "ayer a las 03:00" a una ventana absoluta con zona horaria.
- Si no hay mas precision, consultar una ventana pequena alrededor de esa hora.

Tool:

```json
{
  "tool": "query_logs",
  "arguments": {
    "service": "auth_service",
    "env": "prod",
    "from": "2026-06-06T02:55:00+02:00",
    "to": "2026-06-06T03:10:00+02:00",
    "limit": 100,
    "sort": "desc"
  }
}
```

### Ejemplo 4 - Correlacion por request_id

Usuario:

```text
Busca el request_id req-abc123 en los logs centralizados.
```

Tool:

```json
{
  "tool": "get_log_by_trace_or_request",
  "arguments": {
    "request_id": "req-abc123",
    "since": "24h",
    "sort": "asc"
  }
}
```

### Ejemplo 5 - Resumen de errores

Usuario:

```text
Cuales son los errores mas repetidos de api_gateway en las ultimas 6 horas?
```

Tool:

```json
{
  "tool": "summarize_errors",
  "arguments": {
    "service": "api_gateway",
    "since": "6h",
    "top": 10,
    "limit": 500,
    "max_pages": 2
  }
}
```

## 18. Criterios globales de aceptacion

El MCP se considera correcto cuando:

- Puede arrancar con configuracion de Log Gateway.
- No requiere ninguna variable de OpenObserve.
- Expone solo tools de lectura.
- Puede listar servicios autorizados.
- Puede consultar logs recientes.
- Puede consultar logs por ventana absoluta.
- Puede buscar texto libre cuando la key lo permite.
- Puede resumir errores.
- Puede buscar por `request_id` o `trace_id`.
- Maneja paginacion con `cursor` y `max_pages`.
- Maneja errores HTTP del gateway de forma clara.
- No imprime ni devuelve secretos.
- Documenta cuando usar MCP frente a logs locales.
- Tiene tests unitarios y de tools con gateway mock.

## 19. Riesgos y mitigaciones

| Riesgo | Mitigacion |
|---|---|
| El agente usa MCP para todo y genera coste/ruido | Politica explicita de logs locales primero |
| La key no permite busqueda `q` | Descubrir limites con `/services` y manejar `403` |
| Consultas historicas muy amplias | Defaults conservadores, limites y paginacion |
| Respuestas enormes al agente | `limit`, `max_pages` y `MCP_RESPONSE_MAX_CHARS` |
| Exposicion de secretos | No loguear env ni Authorization |
| Confusion con zonas horarias | Exigir ISO-8601 con offset para `from`/`to` |
| Fan-out excesivo sin `service` | `MCP_MAX_SERVICES_FANOUT` |
| Diferencia entre servicios autorizados y activos | Documentar que `list_services` lista capacidades, no actividad |

## 20. Pendientes de decision futura

No bloquean la primera implementacion:

- Si conviene crear una tool separada `list_active_services` basada en consultas acotadas por servicio.
- Si `summarize_errors` debe normalizar mensajes variables de forma avanzada.
- Si `get_metrics` debe devolver siempre texto Prometheus o tambien un resumen estructurado.
- Si se debe cachear `/services` y durante cuanto tiempo exacto.
- Si se debe soportar configuracion multiperfil en el futuro.

## 21. Definicion de no regresion frente a la spec inicial

La spec inicial proponia un MCP con herramientas utiles, pero asumia acceso directo a OpenObserve mediante SQL y Basic Auth. Esta especificacion conserva la intencion funcional, pero cambia la integracion para respetar el gateway existente.

Se mantienen:

- Consulta de logs recientes.
- Busqueda de logs.
- Listado de servicios.
- Resumen de errores.
- Integracion MCP por stdio.
- Uso por agentes IA.

Se corrige:

- No hay credenciales directas de OpenObserve.
- No hay SQL construido en el MCP.
- No hay dependencia de streams internos.
- La autenticacion es Bearer contra Log Gateway API.
- Los limites, scopes y permisos los decide el gateway.
- Se documenta la politica de logs locales frente a MCP.
