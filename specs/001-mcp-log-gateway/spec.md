# Feature Specification: MCP Log Gateway

**Feature Branch**: `001-mcp-log-gateway`

**Created**: 2026-06-07

**Status**: Draft

**Fuente normativa**: Esta especificación es la fuente normativa de producto para la feature `001-mcp-log-gateway`, subordinada solo a la constitución del proyecto en `.specify/memory/constitution.md` y al contrato de API en `docs/openapi.yaml`.

**Referencia cliente**: `docs/historias.md` conserva la formulación amplia recibida del cliente y se usa como referencia de trazabilidad. Si `docs/historias.md` y esta especificación discrepan, prevalece este `spec.md`.

---

## Resumen

Un agente de IA necesita poder consultar logs de aplicaciones internas almacenados de forma centralizada, sin acceder directamente al sistema de almacenamiento y sin que el desarrollador tenga que copiar y pegar registros manualmente.

La solución es un servidor MCP de solo lectura que actúa como intermediario entre el agente y el Log Gateway API existente. El agente llama herramientas MCP; el servidor las convierte en peticiones HTTP autenticadas contra el gateway; el gateway devuelve los logs almacenados en el sistema centralizado.

Este MCP NO reemplaza los logs locales. Los logs del proyecto local siguen siendo la fuente preferente para errores recientes y reproducibles. El MCP existe para los casos en que los logs locales no bastan.

Decisión sobre `include_total`: el MCP no expone ni envía `include_total` en v1. Calcular totales completos puede ser costoso y estar restringido por el gateway; el agente debe usar `next_cursor`, `range_truncated`, `limit_truncated` y mensajes de resumen parcial para saber si hay más datos. Si el gateway devuelve `total` aun sin solicitarlo, el MCP puede preservarlo como metadato informativo.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Configurar y arrancar el servidor MCP (Priority: P1)

Como desarrollador, quiero configurar el servidor MCP con la URL del gateway y una API key de lectura, para que los agentes puedan consultar logs del entorno correspondiente sin exponer credenciales internas.

**Why this priority**: Sin configuración válida, ninguna otra historia de usuario puede funcionar. Es el prerequisito de todo lo demás.

**Independent Test**: Dado un entorno con `LOG_GATEWAY_URL` y `LOG_GATEWAY_API_KEY` definidos, arrancar el servidor MCP devuelve un proceso activo listo para recibir llamadas de herramientas. Dado un entorno sin esas variables, el servidor termina con un mensaje de error claro que identifica qué variable falta.

**Acceptance Scenarios**:

1. **Given** `LOG_GATEWAY_URL` y `LOG_GATEWAY_API_KEY` están definidos, **When** se arranca el servidor MCP, **Then** el servidor inicia correctamente y está listo para recibir llamadas de herramientas MCP.
2. **Given** `LOG_GATEWAY_URL` no está definido, **When** se arranca el servidor MCP, **Then** el servidor falla de forma explícita con un mensaje claro que indica qué variable falta, sin imprimir ninguna credencial.
3. **Given** el servidor está configurado, **When** una herramienta se invoca, **Then** la API key nunca aparece en respuestas, errores ni logs del servidor.
4. **Given** variables opcionales como `MCP_DEFAULT_SINCE`, `MCP_DEFAULT_LIMIT` o `MCP_DEFAULT_ENV` están definidas, **When** el agente llama una herramienta sin especificar esos parámetros, **Then** el servidor usa los valores por defecto configurados.

---

### User Story 2 — Decidir correctamente entre logs locales y MCP (Priority: P1)

Como desarrollador, quiero que el agente sepa cuándo leer logs locales y cuándo usar el MCP, para evitar consultas innecesarias al sistema centralizado y obtener respuestas más rápidas.

**Why this priority**: Si el agente usa el MCP para todo, genera coste y ruido innecesarios. La política de decisión correcta es fundamental para la utilidad del sistema.

**Independent Test**: Dado un conjunto de peticiones de usuario de distintos tipos (local reciente, histórico remoto, explícito de gateway, con `request_id`), el agente selecciona la fuente correcta en cada caso según la política documentada.

**Acceptance Scenarios**:

1. **Given** el usuario pide "mira los logs" en contexto de ejecución local reciente, **When** existen rutas de log local conocidas, **Then** el agente revisa primero los logs locales, no el MCP.
2. **Given** el usuario pide logs "de ayer a las 03:00" o "de la semana pasada", **When** el agente procesa la petición, **Then** el agente usa el MCP porque es una consulta histórica.
3. **Given** el usuario dice explícitamente "usa el MCP", "consulta OpenObserve" o "mira el gateway", **When** el agente procesa la petición, **Then** el agente usa el MCP independientemente de si hay logs locales.
4. **Given** el usuario proporciona un `request_id`, `trace_id` o `span_id`, **When** el agente procesa la petición, **Then** el agente usa el MCP porque esos identificadores son propios del sistema centralizado.
5. **Given** los logs locales existen pero no contienen información suficiente, **When** el agente lo detecta, **Then** puede escalar al MCP y explica brevemente la decisión.

---

### User Story 3 — Descubrir servicios y capacidades autorizadas (Priority: P1)

Como agente IA, quiero saber qué servicios, entornos, scopes y límites permite la API key actual, para no llamar consultas que el gateway rechazará.

**Why this priority**: Conocer las capacidades de la key permite al agente evitar llamadas que van a fallar y dar mejores mensajes al usuario.

**Independent Test**: Llamar a `list_services` con una key de lectura válida devuelve la lista de servicios, entornos y límites autorizados, sin incluir ningún secreto o hash de la key.

**Acceptance Scenarios**:

1. **Given** el servidor MCP está configurado con una key de lectura, **When** el agente llama `list_services`, **Then** la respuesta incluye servicios autorizados, entornos, scopes y límites.
2. **Given** la key no tiene scope `read`, **When** el agente llama cualquier herramienta de consulta, **Then** el MCP comunica claramente que la key no tiene permisos de lectura.
3. **Given** `allow_q` es `false` para la key actual, **When** el agente conoce esta restricción, **Then** evita usar la herramienta de búsqueda textual libre.
4. **Given** la respuesta de `list_services` se recibe correctamente, **Then** no incluye secretos, hashes ni datos de otras keys.

---

### User Story 4 — Consultar logs recientes de un servicio (Priority: P1)

Como desarrollador, quiero pedir "mira los últimos logs de `payments_api`", para entender qué ha pasado recientemente en ese servicio.

**Why this priority**: Es la consulta más habitual y el caso de uso central del MCP.

**Independent Test**: Llamar a `query_logs` con un servicio autorizado, sin especificar ventana temporal, devuelve los logs más recientes ordenados de más nuevo a más antiguo, con los metadatos necesarios para el agente.

**Acceptance Scenarios**:

1. **Given** el agente llama `query_logs` con solo el nombre del servicio, **When** el servidor procesa la llamada, **Then** usa la ventana temporal por defecto (`MCP_DEFAULT_SINCE` o `1h`) y el límite por defecto.
2. **Given** el agente llama `query_logs` con servicio y ventana, **When** el gateway devuelve resultados, **Then** la respuesta muestra timestamp, nivel, servicio, entorno, mensaje y campos de correlación relevantes.
3. **Given** el agente llama `query_logs` sin especificar orden, **When** el servidor construye la petición al gateway, **Then** usa orden descendente por defecto (más reciente primero).
4. **Given** el gateway no devuelve resultados para la consulta, **When** el servidor recibe respuesta vacía, **Then** la respuesta es explícita ("no se encontraron logs") y no se trata como error técnico.

---

### User Story 5 — Consultar logs en una ventana temporal concreta (Priority: P2)

Como desarrollador, quiero pedir logs de "ayer a las 03:00" o "hace cinco minutos", para investigar incidentes en ventanas temporales específicas.

**Why this priority**: Las investigaciones históricas son el segundo caso de uso más frecuente del MCP.

**Independent Test**: Llamar a `query_logs` con `from` y `to` en formato ISO-8601 devuelve únicamente los logs dentro de esa ventana. Llamar con `since` y `from`/`to` a la vez devuelve un error de validación claro.

**Acceptance Scenarios**:

1. **Given** el agente proporciona `since` como "1h" o "24h", **When** el servidor procesa la llamada, **Then** la ventana temporal se calcula correctamente a partir de ese valor relativo.
2. **Given** el agente proporciona `from` y `to` en formato ISO-8601 con zona horaria, **When** el servidor procesa la llamada, **Then** la ventana se usa tal cual en la petición al gateway.
3. **Given** el agente proporciona tanto `since` como `from`/`to`, **When** el servidor valida la entrada, **Then** rechaza la llamada con un error de validación claro antes de contactar al gateway.
4. **Given** el agente proporciona solo `to` sin `from`, **When** el servidor valida la entrada, **Then** rechaza la llamada con un error de validación.
5. **Given** el usuario menciona "ayer a las 03:00" en lenguaje natural, **When** el agente traduce la expresión, **Then** construye una ventana `from`/`to` razonable de unos 10-15 minutos alrededor de esa hora antes de llamar la herramienta.

---

### User Story 6 — Filtrar por nivel de log y entorno (Priority: P2)

Como desarrollador, quiero filtrar logs por nivel (`error`, `warn`, etc.) y por entorno (`prod`, `staging`), para reducir ruido y centrarme en lo relevante.

**Why this priority**: El filtrado es necesario para hacer las consultas útiles en entornos con alto volumen de logs.

**Independent Test**: Llamar a `query_logs` con `level=["error","fatal"]` y `env="prod"` devuelve únicamente logs de esos niveles en ese entorno.

**Acceptance Scenarios**:

1. **Given** el agente especifica uno o varios niveles válidos, **When** el servidor construye la petición al gateway, **Then** los niveles se pasan correctamente como parámetro.
2. **Given** el agente especifica un nivel no válido (fuera de trace/debug/info/warn/error/fatal), **When** el servidor valida la entrada, **Then** rechaza la llamada con un error claro antes de contactar al gateway.
3. **Given** el agente especifica un entorno no autorizado para la key, **When** el gateway devuelve un error 403, **Then** el MCP comunica el error de forma comprensible, indicando que el entorno no está autorizado.

---

### User Story 7 — Buscar texto libre en logs (Priority: P2)

Como desarrollador, quiero buscar logs que contengan un texto, ID de usuario, fragmento de error o cualquier cadena, para encontrar eventos relacionados con un problema específico.

**Why this priority**: La búsqueda textual es necesaria cuando no se conoce el nivel ni la ventana temporal exacta del evento buscado.

**Independent Test**: Llamar a `search_logs` con un servicio y una cadena de búsqueda devuelve los logs que contienen esa cadena. Si la key no permite búsqueda textual, el MCP lo comunica claramente sin fallar silenciosamente.

**Acceptance Scenarios**:

1. **Given** la key tiene `allow_q=true`, **When** el agente llama `search_logs` con un texto, **Then** el servidor traduce el texto al parámetro `q` del gateway y devuelve los resultados.
2. **Given** la key tiene `allow_q=false` (conocido por el caché de `list_services`), **When** el agente llama `search_logs`, **Then** el MCP devuelve un error informativo inmediato sin enviar ninguna petición al gateway.
3. **Given** el caché de `list_services` no está disponible aún y el gateway devuelve un 403 por restricción de búsqueda, **When** el MCP recibe el error, **Then** lo comunica de forma comprensible como restricción de permisos, no como error técnico genérico.
4. **Given** la búsqueda se combina con filtros de entorno, nivel y ventana temporal, **When** el servidor construye la petición, **Then** todos los filtros se aplican correctamente.

---

### User Story 8 — Consultar errores recientes de un servicio (Priority: P2)

Como desarrollador, quiero pedir "mira los errores recientes de `auth_service`", para ir directamente a los problemas sin tener que filtrar manualmente.

**Why this priority**: Es la consulta más frecuente en un escenario de depuración activa.

**Independent Test**: Llamar a `get_recent_errors` con un servicio devuelve únicamente logs de nivel `error` y `fatal`, ordenados por tiempo, con los campos de correlación cuando existan.

**Acceptance Scenarios**:

1. **Given** el agente llama `get_recent_errors` con un servicio y una ventana, **When** el servidor procesa la llamada, **Then** filtra internamente a niveles `error` y `fatal`.
2. **Given** no hay errores en la ventana consultada, **When** el servidor recibe respuesta vacía del gateway, **Then** devuelve una respuesta explícita ("no se encontraron errores en la ventana X") y no trata el caso como fallo técnico.
3. **Given** hay errores con `request_id`, `trace_id` o `span_id`, **When** el servidor formatea la respuesta, **Then** incluye esos campos de correlación cuando están presentes.

---

### User Story 9 — Resumir los errores más frecuentes (Priority: P3)

Como desarrollador, quiero saber cuáles son los errores más repetidos de un servicio en las últimas horas, para priorizar qué investigar primero.

**Why this priority**: Proporciona una vista de resumen rápida sin necesidad de leer todos los logs individuales.

**Independent Test**: Llamar a `summarize_errors` con un servicio devuelve una lista de los N errores más frecuentes, agrupados por mensaje normalizado, con conteo y último timestamp de cada uno.

**Acceptance Scenarios**:

1. **Given** el agente llama `summarize_errors`, **When** el servidor procesa los eventos recibidos del gateway, **Then** agrupa los errores por mensaje normalizado con normalización básica (`trim` y colapso de espacios) y devuelve los N más frecuentes.
2. **Given** el resumen es parcial por límite de paginación o truncado del gateway, **When** el servidor formatea la respuesta, **Then** indica explícitamente que el resumen es parcial y no exhaustivo.
3. **Given** hay múltiples páginas disponibles, **When** el agente solicita autopaginación con `max_pages`, **Then** el servidor recupera hasta ese número de páginas sin entrar en bucles indefinidos.

---

### User Story 10 — Buscar logs por request_id o trace_id (Priority: P3)

Como desarrollador, quiero buscar todos los logs relacionados con un `request_id` o `trace_id` concreto, para reconstruir el flujo completo de una petición o traza.

**Why this priority**: La correlación entre servicios por identificador de traza es una capacidad diferencial del sistema centralizado frente a los logs locales.

**Independent Test**: Llamar a `get_log_by_trace_or_request` con un `request_id` devuelve todos los logs de todos los servicios que contienen ese identificador, agrupados por servicio y ordenados temporalmente.

**Acceptance Scenarios**:

1. **Given** el agente proporciona un `request_id` o `trace_id`, **When** el servidor procesa la llamada, **Then** usa ese identificador como filtro en la consulta al gateway.
2. **Given** el agente proporciona un servicio específico, **When** el servidor construye la petición, **Then** consulta solo ese servicio.
3. **Given** el agente no proporciona servicio, **When** el servidor necesita buscar en todos los servicios autorizados, **Then** llama a `list_services` primero, luego consulta cada servicio de forma controlada y limitada por `MCP_MAX_SERVICES_FANOUT`.
4. **Given** el agente no proporciona ni `request_id` ni `trace_id`, **When** el servidor valida la entrada, **Then** rechaza la llamada con un error de validación.

---

### User Story 11 — Consultar la salud del gateway (Priority: P3)

Como desarrollador, quiero comprobar si el gateway está vivo y listo, para distinguir errores de configuración del MCP de ausencia real de logs o fallos del gateway.

**Why this priority**: Es una herramienta de diagnóstico que facilita la resolución de problemas de conectividad.

**Independent Test**: Llamar a `check_gateway_health` devuelve el estado de liveness y opcionalmente readiness, sin requerir API key para los endpoints públicos.

**Acceptance Scenarios**:

1. **Given** el gateway está vivo, **When** el agente llama `check_gateway_health`, **Then** la respuesta indica `live: ok`.
2. **Given** el agente solicita también el estado de readiness, **When** el servidor llama al endpoint de readiness, **Then** la respuesta distingue entre `ready` y `not_ready`.
3. **Given** el gateway no está disponible, **When** el agente llama `check_gateway_health`, **Then** el MCP comunica el error de conectividad de forma comprensible.

---

### User Story 12 — Gestionar paginación de resultados (Priority: P3)

Como agente IA, quiero que el MCP soporte paginación pero que el caso habitual sea sencillo, para obtener resultados recientes sin coste innecesario.

**Why this priority**: La paginación es necesaria para investigaciones largas pero no debe complicar el caso habitual.

**Independent Test**: La primera llamada sin `cursor` devuelve la primera página. Si hay más resultados, la respuesta incluye el cursor para la siguiente página. Con `max_pages=2`, el servidor recupera hasta 2 páginas automáticamente sin solicitud adicional.

**Acceptance Scenarios**:

1. **Given** el agente llama una herramienta de consulta sin `cursor`, **When** el gateway devuelve resultados con `next_cursor`, **Then** la respuesta del MCP incluye el cursor para que el agente pueda solicitar más.
2. **Given** el agente especifica `max_pages=2`, **When** hay más de una página de resultados, **Then** el servidor recupera automáticamente hasta 2 páginas y combina los resultados.
3. **Given** se alcanza el límite de `max_pages`, **When** el servidor formatea la respuesta, **Then** indica que puede haber más resultados disponibles.
4. **Given** cualquier herramienta de autopaginación, **When** el gateway no devuelve `next_cursor`, **Then** el servidor para de paginar aunque `max_pages` no se haya alcanzado.

---

### User Story 13 — Recibir errores claros del gateway (Priority: P2)

Como agente IA, quiero recibir mensajes de error claros del MCP, para saber si el problema es de autenticación, permisos, rate limiting, validación o fallo del gateway.

**Why this priority**: Los errores claros son esenciales para que el agente pueda ayudar al desarrollador a resolver problemas de configuración o acceso.

**Independent Test**: Provocar cada tipo de error del gateway (401, 403, 429, 502) devuelve un mensaje diferente y comprensible en el MCP, sin incluir la API key ni cabeceras completas.

**Acceptance Scenarios**:

1. **Given** el gateway devuelve 401, **When** el MCP recibe el error, **Then** comunica "API key ausente, inválida o mal configurada", sin incluir la key.
2. **Given** el gateway devuelve 403, **When** el MCP recibe el error, **Then** comunica "sin scope de lectura, servicio no autorizado o entorno no autorizado", según el contexto.
3. **Given** el gateway devuelve 429, **When** el MCP recibe el error, **Then** comunica "rate limit o cola llena" y no reintenta agresivamente.
4. **Given** el gateway devuelve 502, **When** el MCP recibe el error, **Then** comunica que el gateway no pudo consultar el almacenamiento.
5. **Given** el gateway incluye `request_id` en el error, **When** el MCP formatea el mensaje, **Then** conserva ese `request_id` en la respuesta para facilitar la depuración.

---

### User Story 14 — Consultar métricas del gateway (Priority: P3)

Como operador o desarrollador avanzado, quiero consultar métricas básicas del gateway, para diagnosticar rate limiting, cola llena o fallos de backend.

**Why this priority**: Es una herramienta de diagnóstico avanzado, útil pero no crítica para el uso habitual.

**Independent Test**: Llamar a `get_metrics` devuelve el texto de métricas del gateway cuando está habilitada, y comunica que está deshabilitada cuando `MCP_ENABLE_METRICS_TOOL=false`.

**Acceptance Scenarios**:

1. **Given** `MCP_ENABLE_METRICS_TOOL=true`, **When** el agente llama `get_metrics`, **Then** el servidor devuelve las métricas del gateway.
2. **Given** `MCP_ENABLE_METRICS_TOOL=false`, **When** el agente llama `get_metrics`, **Then** el servidor informa que la herramienta está deshabilitada, sin fallar con un error técnico.
3. **Given** las métricas se devuelven, **Then** no incluyen secretos, credenciales ni información sensible de configuración.

---

### User Story 15 — Emitir logs de servidor seguros y útiles (Priority: P1)

Como desarrollador, quiero que el MCP emita logs controlados, seguros y legibles durante desarrollo y operación, para diagnosticar problemas sin romper el protocolo MCP ni exponer secretos.

**Why this priority**: El MCP corre por stdio; un log escrito en stdout puede romper el protocolo. Además, la depuración de configuración, permisos y gateway depende de logs fiables y redactados.

**Independent Test**: Arrancar el servidor con distintos valores de `LOG_LEVEL` y provocar eventos de configuración, consulta y error demuestra que los logs pasan por el wrapper compartido, respetan niveles, redactan secretos, usan formato humano localizado en desarrollo y nunca escriben en stdout durante operación MCP.

**Acceptance Scenarios**:

1. **Given** `LOG_LEVEL` no está definido y el entorno es producción, **When** el servidor arranca, **Then** el nivel efectivo de logging es `warn`.
2. **Given** `LOG_LEVEL=debug`, **When** el servidor ejecuta una consulta, **Then** los logs de debug se emiten solo a través del wrapper compartido.
3. **Given** una API key o cabecera `Authorization` existe en configuración o errores, **When** el servidor registra un evento, **Then** el valor sensible aparece redactado y nunca en claro.
4. **Given** el servidor corre como MCP stdio, **When** se emite cualquier log, **Then** el log no se escribe en stdout.
5. **Given** el servidor se ejecuta en desarrollo local, **When** se renderizan logs para inspección humana, **Then** las fechas se muestran con locale `es-ES` y zona horaria `Europe/Madrid`.
6. **Given** código de aplicación necesita registrar un evento, **When** se implementa la llamada, **Then** usa el wrapper compartido y no `console.*` ni importaciones directas de `pino`.

---

### Edge Cases

- ¿Qué ocurre si `from` es posterior a `to`? El MCP debe rechazarlo con error de validación antes de llamar al gateway.
- ¿Qué ocurre si el nombre de servicio no cumple el formato `^[a-z0-9_]{3,64}$`? El MCP lo rechaza con error de validación claro.
- ¿Qué ocurre si `max_pages` excede `MCP_MAX_PAGES`? El MCP aplica el máximo configurado sin fallar.
- ¿Qué ocurre si `limit` excede `MCP_MAX_LIMIT` o el límite del gateway? El MCP aplica el mínimo entre ambos.
- ¿Qué ocurre si la respuesta del gateway es extremadamente larga? El MCP trunca la salida respetando `MCP_RESPONSE_MAX_CHARS`.
- ¿Qué ocurre si el gateway está caído durante una búsqueda de fan-out por traza? El MCP reporta los servicios que falló, no falla silenciosamente.
- ¿Qué ocurre si solo se proporciona `to` sin `from`? El MCP rechaza la entrada con error de validación.
- ¿Qué ocurre si el agente solicita `include_total`? El MCP rechaza o ignora ese parámetro porque no está soportado en v1 y no debe enviarlo al gateway.
- ¿Qué ocurre si el agente filtra por `level="error"`? El MCP interpreta el nivel como severidad mínima y consulta `error` y `fatal`.
- ¿Qué ocurre si el agente filtra por `level="warn"`? El MCP interpreta el nivel como severidad mínima y consulta `warn`, `error` y `fatal`.
- ¿Qué ocurre si se generan logs internos del MCP durante stdio? El MCP los envía a stderr o destino configurado, nunca a stdout.
- ¿Qué ocurre si un mensaje de error contiene token, password, session ID o cabecera Authorization? El MCP lo redacta antes de devolverlo o registrarlo.

---

## Requirements *(mandatory)*

### Functional Requirements

**Configuración y arranque:**

- **FR-001**: El sistema DEBE arrancar correctamente cuando `LOG_GATEWAY_URL` y `LOG_GATEWAY_API_KEY` están definidos.
- **FR-002**: El sistema DEBE fallar de forma explícita e informativa cuando falta cualquier variable de configuración obligatoria.
- **FR-003**: El sistema DEBE soportar variables de configuración opcionales con valores por defecto definidos para entorno, ventana temporal, límite de resultados, número máximo de páginas, timeout HTTP, fan-out, métricas y tamaño máximo de respuesta.
- **FR-004**: El sistema DEBE rechazar cualquier configuración de credenciales directas de OpenObserve (`OO_URL`, `OO_USER`, `OO_PASSWORD`, `OO_ORG`, `OO_STREAM`).

**Herramientas de consulta:**

- **FR-005**: El sistema DEBE exponer la herramienta `list_services` que devuelve servicios, entornos, scopes y límites autorizados para la API key actual.
- **FR-006**: El sistema DEBE exponer la herramienta `query_logs` que permite consultar logs de un servicio con filtros de entorno, nivel, ventana temporal y paginación.
- **FR-007**: El sistema DEBE exponer la herramienta `search_logs` que permite búsqueda textual libre cuando la API key lo autoriza. Antes de enviar la petición, el sistema DEBE consultar el caché de `list_services` para verificar `allow_q`; si `allow_q` es `false`, DEBE devolver un error informativo inmediato sin realizar ninguna llamada al gateway.
- **FR-008**: El sistema DEBE exponer la herramienta `get_recent_errors` que filtra automáticamente por niveles `error` y `fatal`.
- **FR-009**: El sistema DEBE exponer la herramienta `summarize_errors` que agrupa y cuenta errores por mensaje normalizado.
- **FR-010**: El sistema DEBE exponer la herramienta `get_log_by_trace_or_request` que busca logs por `request_id` o `trace_id` en uno o varios servicios. Cuando no se indica `service`, las consultas a múltiples servicios se ejecutan con un pool concurrente acotado de entre 3 y 5 peticiones simultáneas, nunca superando `MCP_MAX_SERVICES_FANOUT` servicios en total.
- **FR-011**: El sistema DEBE exponer la herramienta `check_gateway_health` que verifica liveness y readiness del gateway.
- **FR-012**: El sistema DEBE exponer la herramienta `get_metrics` que puede ser deshabilitada mediante configuración y devuelve únicamente texto Prometheus sin resumen parseado en v1.

**Validaciones:**

- **FR-013**: El sistema DEBE validar que los nombres de servicio cumplen el formato `^[a-z0-9_]{3,64}$` antes de llamar al gateway.
- **FR-014**: El sistema DEBE validar que los niveles de log son valores del conjunto `{trace, debug, info, warn, error, fatal}` y tratarlos como severidad mínima, no como coincidencia exacta.
- **FR-015**: El sistema DEBE rechazar combinaciones mutuamente exclusivas de parámetros temporales (`since` junto a `from`/`to`).
- **FR-016**: El sistema DEBE rechazar entrada donde solo se proporciona `to` sin `from`, o donde `from` es posterior a `to`.

**Paginación:**

- **FR-017**: Todas las herramientas de consulta DEBEN soportar el parámetro `cursor` para paginación explícita.
- **FR-018**: Todas las herramientas de consulta DEBEN soportar el parámetro `max_pages` para autopaginación limitada, con un valor máximo configurable; si el agente solicita un valor superior, el MCP DEBE recortarlo silenciosamente al máximo efectivo.
- **FR-019**: El sistema NUNCA DEBE entrar en bucles de paginación indefinidos.

**Seguridad:**

- **FR-020**: El sistema NO DEBE implementar ninguna herramienta de escritura, modificación o borrado de logs.
- **FR-021**: El sistema NO DEBE aceptar SQL del usuario ni construir URLs arbitrarias fuera de `LOG_GATEWAY_URL`.
- **FR-022**: El sistema NO DEBE imprimir, devolver ni incluir en errores la API key ni ninguna credencial.
- **FR-023**: El sistema DEBE respetar los servicios, entornos, scopes y límites devueltos por el gateway en `/api/v1/services`.

**Errores:**

- **FR-024**: El sistema DEBE comunicar cada tipo de error HTTP del gateway (401, 403, 400, 429, 502, 503) con un mensaje diferenciado y comprensible.
- **FR-025**: El sistema DEBE preservar el `request_id` del gateway en las respuestas de error cuando esté disponible.

**Formato de salida:**

- **FR-026**: Las respuestas de herramientas DEBEN incluir texto legible, metadatos de paginación y el `request_id` de la consulta.
- **FR-027**: Las respuestas vacías DEBEN ser explícitas y no tratarse como errores técnicos.
- **FR-028**: El sistema DEBE truncar respuestas que superen `MCP_RESPONSE_MAX_CHARS`.

**Configuración detallada:**

- **FR-029**: El sistema DEBE soportar `LOG_GATEWAY_API_PREFIX` con valor por defecto `/api/v1`.
- **FR-030**: El sistema DEBE soportar `MCP_DEFAULT_SINCE` con valor por defecto `1h`.
- **FR-031**: El sistema DEBE soportar `MCP_DEFAULT_LIMIT` con valor por defecto `100`.
- **FR-032**: El sistema DEBE soportar `MCP_MAX_LIMIT` con valor por defecto `1000`; si `limit` excede el máximo efectivo, el MCP DEBE recortarlo silenciosamente.
- **FR-033**: El sistema DEBE soportar `MCP_MAX_PAGES` con valor por defecto `5`.
- **FR-034**: El sistema DEBE soportar `MCP_REQUEST_TIMEOUT_MS` con valor por defecto `15000`. Cuando una petición al gateway supera este umbral, el sistema DEBE realizar un único reintento tras una pausa de 1–2 s; si el reintento también supera el timeout, el sistema falla definitivamente con un error de timeout claro.
- **FR-035**: El sistema DEBE soportar `MCP_ENABLE_METRICS_TOOL` con valor por defecto `true`.
- **FR-036**: El sistema DEBE soportar `MCP_MAX_SERVICES_FANOUT` con valor por defecto `20`.
- **FR-037**: El sistema DEBE soportar `MCP_RESPONSE_MAX_CHARS` con valor por defecto `50000`.

**Contrato de herramientas:**

- **FR-038**: `query_logs`, `search_logs`, `get_recent_errors`, `summarize_errors` y `get_log_by_trace_or_request` DEBEN aceptar `sort` con valores `asc` o `desc`; `query_logs` y consultas recientes usan `desc` por defecto, y búsquedas de correlación usan `asc` por defecto.
- **FR-039**: El MCP NO DEBE exponer ni enviar `include_total` en v1.
- **FR-040**: El MCP DEBE preservar `next_cursor`, `range_truncated`, `limit_truncated` y `total` si el gateway los devuelve, pero no debe pedir `total` activamente.
- **FR-041**: `list_services` DEBE documentar y comunicar que lista servicios autorizados por la key, no servicios necesariamente activos.

**Logging y depuración:**

- **FR-042**: Todo logging interno del servidor DEBE pasar por el wrapper compartido de logging.
- **FR-043**: El código de aplicación NO DEBE usar `console.log`, `console.debug`, `console.info`, `console.warn` ni `console.error`.
- **FR-044**: El código de aplicación NO DEBE importar directamente `pino`, `pino-pretty` ni `loglevel`; solo el wrapper puede hacerlo.
- **FR-045**: `LOG_LEVEL` DEBE controlar el nivel de logs del servidor; producción usa `warn` por defecto y entornos no productivos usan `info` por defecto.
- **FR-046**: `PUBLIC_LOG_LEVEL` DEBE existir como configuración de cliente si en el futuro hay código cliente; en v1 de MCP servidor no tiene efecto funcional.
- **FR-047**: Los logs internos del MCP durante operación stdio NO DEBEN escribirse en stdout.
- **FR-048**: Los logs DEBEN redactar secretos, tokens Bearer, passwords, API keys, session IDs, cookies, cabeceras Authorization, credenciales crudas y datos personales innecesarios.
- **FR-049**: Los logs orientados a inspección humana en desarrollo DEBEN renderizar fechas con locale `es-ES` y zona horaria `Europe/Madrid`.

### Tool Input Contract

Todas las herramientas deben validar su entrada antes de llamar al gateway y devolver error de validación si la entrada no cumple contrato.

| Tool | Parámetros obligatorios | Parámetros opcionales | Endpoint gateway |
|---|---|---|---|
| `list_services` | ninguno | ninguno | `GET /api/v1/services` |
| `query_logs` | `service` | `env`, `level`, `since`, `from`, `to`, `limit`, `cursor`, `sort`, `max_pages` | `GET /api/v1/logs` |
| `search_logs` | `service`, `query` | `env`, `level`, `since`, `from`, `to`, `limit`, `cursor`, `sort`, `max_pages` | `GET /api/v1/logs?q=...` |
| `get_recent_errors` | `service` | `env`, `since`, `from`, `to`, `limit`, `cursor`, `sort`, `max_pages` | `GET /api/v1/logs?level=error,fatal` |
| `summarize_errors` | `service` | `env`, `since`, `from`, `to`, `limit`, `max_pages`, `top`, `sort` | `GET /api/v1/logs?level=error,fatal` |
| `get_log_by_trace_or_request` | `request_id` o `trace_id` | `service`, `env`, `since`, `from`, `to`, `limit`, `cursor`, `sort`, `max_pages` | `GET /api/v1/logs` |
| `check_gateway_health` | ninguno | `include_ready` | `GET /api/v1/health`, `GET /api/v1/health/ready` |
| `get_metrics` | ninguno | ninguno | `GET /api/v1/metrics` |

Reglas comunes:

- `since` y `from`/`to` son mutuamente excluyentes.
- `from` y `to` deben ser ISO-8601 con zona horaria o UTC.
- Si se proporciona `from` sin `to`, el MCP usa `to=now`.
- Si se proporciona `to` sin `from`, el MCP rechaza la entrada.
- `limit` se recorta al máximo efectivo sin fallar.
- `max_pages` se recorta al máximo efectivo sin fallar.
- `include_total` no es un parámetro válido de ninguna herramienta en v1.
- `query` en `search_logs` se mapea al parámetro `q` del gateway.
- `level` se expande como severidad mínima antes de llamar al gateway.
- `sort` en `summarize_errors` ordena los eventos recogidos antes de agrupar; por defecto `desc` (más recientes primero).

### Key Entities

- **Evento de log**: Registro individual con campos opcionales `_timestamp`, `service`, `env`, `level`, `message`, `event_id`, `trace_id`, `span_id`, `request_id`, `hostname`, `source`, `context`, `context_truncated`.
- **API key**: Token Bearer (`key_id.secret`) que configura autorizaciones de servicio, entorno, scopes y límites.
- **Servicio**: Identificador lógico de una aplicación (`^[a-z0-9_]{3,64}$`) cuyos logs están almacenados en el sistema centralizado.
- **Ventana temporal**: Rango de tiempo de una consulta, expresado como valor relativo (`since`) o absoluto (`from`/`to` en ISO-8601 con zona horaria).
- **Cursor de paginación**: Token opaco devuelto por el gateway para recuperar la siguiente página de resultados.
- **Respuesta de herramienta**: Salida MCP compuesta por texto legible, metadatos de paginación, `request_id`, indicadores de truncado y datos estructurados mínimos para el agente.
- **Evento de logging interno**: Registro emitido por el propio MCP para diagnóstico operativo; nunca forma parte del protocolo MCP en stdout y siempre debe pasar por el wrapper de logging.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un agente puede consultar los logs más recientes de un servicio autorizado en menos de 15 segundos desde que llama la herramienta, en condiciones nominales (sin reintento por timeout). En el escenario de reintento único definido en FR-034, el tiempo total puede alcanzar hasta ≈ 32 s; este escenario no invalida SC-001.
- **SC-002**: El sistema rechaza el 100% de las entradas inválidas con mensajes de error comprensibles, sin llegar a llamar al gateway en esos casos.
- **SC-003**: Las credenciales (API key) no aparecen en ningún output de herramienta, mensaje de error ni log del servidor, verificable mediante inspección de respuestas y logs.
- **SC-004**: El 100% de las herramientas tienen cobertura por tests unitarios y de contrato con gateway simulado, cumpliendo la cobertura mínima del 80% definida en la constitución.
- **SC-005**: El agente selecciona correctamente entre logs locales y MCP en los escenarios documentados en la política de decisión (US-001), verificable mediante los criterios de aceptación de cada escenario.
- **SC-006**: El servidor arranca y está operativo en menos de 5 segundos en condiciones normales de configuración.
- **SC-007**: La búsqueda por `request_id` o `trace_id` sin especificar servicio no consulta más servicios que el límite configurado en `MCP_MAX_SERVICES_FANOUT`.
- **SC-008**: La paginación con `max_pages` nunca excede el valor máximo configurado en `MCP_MAX_PAGES`, independientemente del valor que solicite el agente.
- **SC-009**: El 100% de los tests de logging demuestran que no se escribe en stdout durante operación MCP stdio.
- **SC-010**: El 100% de los tests de redacción demuestran que tokens, API keys, passwords, session IDs y cabeceras Authorization no aparecen en outputs ni logs.
- **SC-011**: `get_metrics` devuelve texto Prometheus crudo cuando está habilitado y no devuelve resúmenes parseados.
- **SC-012**: Las consultas con `level="error"` incluyen `error` y `fatal`; las consultas con `level="warn"` incluyen `warn`, `error` y `fatal`.

---

## Clarifications

### Session 2026-06-07

- Q: ¿Cuál es la estrategia de concurrencia en el fan-out por traza cuando `get_log_by_trace_or_request` no recibe `service`? → A: Pool concurrente acotado (máx. 3–5 peticiones simultáneas), controlando la carga en el gateway.
- Q: ¿Qué comportamiento debe tener el MCP cuando una petición al gateway supera `MCP_REQUEST_TIMEOUT_MS`? → A: Reintento único tras pausa breve (~1-2 s), luego falla definitivamente con error de timeout.
- Q: ¿Cómo determina el MCP si la key permite `allow_q` antes de enviar la petición de búsqueda textual? → A: Pre-verificación mediante `list_services` cacheado; si `allow_q` es `false`, devuelve error informativo sin llamar al gateway.

---

## Assumptions

- El Log Gateway API está disponible en la URL configurada y tiene al menos un servicio autorizado para la API key usada en las pruebas.
- El agente (cliente MCP) es responsable de traducir expresiones de tiempo en lenguaje natural ("ayer a las 03:00") a los parámetros `from`/`to` en formato ISO-8601 antes de llamar las herramientas.
- Los logs locales del proyecto ya tienen rutas conocidas definidas en las instrucciones del agente o del repositorio, y no son responsabilidad de este MCP.
- La API key configurada tiene al menos scope `read`. Una key sin scope `read` no puede usar ninguna herramienta de consulta.
- El MCP corre como proceso stdio y no expone ningún puerto HTTP propio.
- No se implementa autenticación de múltiples entornos en la primera versión; cada instancia del MCP usa una única API key.
- La normalización de mensajes en `summarize_errors` usa al menos trim y colapso de espacios; la normalización avanzada de UUIDs y IDs variables es una mejora futura no bloqueante.
- La caché de `/api/v1/services` tiene una vida útil corta (aprox. 5 minutos) y se invalida si una consulta devuelve 403 por permisos inesperados.
- `include_total` queda fuera de v1 porque puede aumentar coste y latencia; la paginación mediante `next_cursor` es suficiente para detectar que hay más datos.
- Los filtros de `level` representan severidad mínima. El orden de severidad es `trace < debug < info < warn < error < fatal`.
- Los límites solicitados por encima de la configuración efectiva se recortan silenciosamente para mantener ergonomía de agente y evitar fallos innecesarios.
- La salida de `get_metrics` es texto Prometheus crudo; cualquier resumen interpretado queda fuera de v1.
