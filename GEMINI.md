# Instrucciones para Gemini — mcp-openobserve

Este fichero define las instrucciones de trabajo para Gemini CLI, Gemini Code Assist y otros agentes de Google AI que colaboren en este proyecto.

---

## Idioma y comunicación

Comunícate siempre en español. Escribe todas las instrucciones, comentarios, mensajes y outputs en español. Los identificadores de código, nombres de variables, nombres de fichero y términos técnicos de la industria se mantienen en su forma original (inglés técnico).

---

## Documentos normativos del proyecto

Antes de implementar cualquier cambio, lee y respeta estos ficheros en orden de autoridad:

1. **`.specify/memory/constitution.md`** — Constitución del proyecto. Define restricciones de arquitectura, límites de seguridad, tecnologías obligatorias, estándares de logging y criterios de calidad. Prevalece sobre cualquier otro documento en caso de conflicto.
2. **`specs/001-mcp-log-gateway/spec.md`** — Especificación funcional de la feature activa. Define qué debe hacer el sistema, las historias de usuario, los requisitos funcionales y los criterios de éxito. Prevalece sobre `docs/historias.md` en caso de discrepancia.
3. **`docs/openapi.yaml`** — Contrato del Log Gateway API. Fuente autoritativa del comportamiento HTTP esperado.
4. **`docs/historias.md`** — Formulación original del cliente. Referencia de trazabilidad; no es normativo.

---

## Instrucciones de implementación

- Sigue estrictamente las definiciones de `constitution.md`, `spec.md` y `docs/openapi.yaml`.
- No modifiques comportamiento fuera de los criterios descritos en esos ficheros.
- Si detectas discrepancias entre el código existente y los documentos normativos, comunícalo antes de aplicar cualquier cambio que altere el comportamiento observable.
- Cuando una tarea no esté cubierta por los documentos normativos, propón el cambio como diff o nota de diseño y espera validación explícita antes de aplicarlo.

---

## Confirmación obligatoria

- Antes de realizar refactorizaciones, "arreglos" no solicitados o cambios de comportamiento no especificados, pregunta y espera confirmación explícita.
- Evita optimizaciones que cambien efectos observables si no están contempladas en `constitution.md` o `spec.md`.
- Si la intención de un cambio no está 100% clara o hay ambigüedades, pregunta antes de implementar nada.

---

## Trazabilidad y cumplimiento

- Referencia siempre el criterio de aceptación o requisito funcional correspondiente al realizar cambios (por ejemplo: `FR-006`, `SC-003`, `US-004`).
- Si un criterio es ambiguo, pide aclaración en lugar de asumir comportamiento.

---

## Documentación obligatoria al finalizar cada tarea

- Cualquier cambio en el código que altere un comportamiento observable **debe reflejarse en `specs/001-mcp-log-gateway/spec.md`** antes de dar la tarea por terminada.
- Esto incluye: correcciones de bugs que cambian comportamiento, ajustes de lógica, nuevas métricas, cambios en reglas de negocio y correcciones de campo.
- Solo se puede omitir la actualización del spec cuando el cambio es puramente interno y no altera ningún comportamiento observable (por ejemplo: renombrar una variable local o reformatear código).
- La regla es: **documenta siempre, salvo que el cambio sea invisible para el usuario**. La excepción es la que requiere justificación, no la documentación.

---

## Consulta de documentación técnica

- Para implementar código que use librerías, frameworks o APIs del stack del proyecto, consulta siempre la documentación oficial más reciente de la versión instalada.
- Las versiones exactas del stack están fijadas en `.specify/memory/constitution.md` en la sección "Technology Baseline and Versions".
- No asumas que el conocimiento de entrenamiento refleja la versión exacta instalada.

---

## Commits y operaciones Git

- Para commits y operaciones con GitHub, usa la CLI `gh` instalada en el sistema cuando sea posible.
- Nunca hagas push a `main` directamente. Trabaja siempre en la rama de feature activa (`001-mcp-log-gateway`).
- Antes de hacer un commit, verifica que `npm run lint`, `npm run typecheck` y `npm test` pasan.

---

## Logging y diagnóstico

Este proyecto usa una arquitectura de logging estructurado.

Durante el desarrollo local, el servidor escribe logs en:

- `.logs/app.log` — logs legibles por humanos.
- `.logs/app.jsonl` — logs estructurados en JSON Lines.

Estos ficheros se sobreescriben en cada arranque de desarrollo y están ignorados por Git.

Cuando diagnostiques problemas de arranque, errores en tiempo de ejecución, flujos rotos, peticiones fallidas o comportamiento inesperado, **inspecciona estos ficheros antes de hacer suposiciones**.

Usa:
- `.logs/app.log` para inspección rápida legible.
- `.logs/app.jsonl` para análisis estructurado.

El código de la aplicación **nunca debe usar `console.*` directamente**. Usa siempre el módulo wrapper de logging compartido (`src/logger.ts`).

Los logs ya redactan secretos, tokens, credenciales, cookies, cabeceras de autorización e identificadores de sesión. Aun así, nunca copies datos sensibles de los logs a respuestas, commits, documentación o código generado.

Al añadir nuevas funcionalidades, asegúrate de que los eventos operativos relevantes se registran a través del contrato del logger compartido y de que activar el nivel `debug` proporciona valor diagnóstico real.
