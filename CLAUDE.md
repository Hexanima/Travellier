# Travellier — instrucciones para Claude

Las reglas del proyecto, la fuente de verdad y las reglas funcionales están en `AGENTS.md`, compartido con otros agentes. No duplicarlas aquí: si cambian, se actualiza `AGENTS.md`.

@AGENTS.md

## Antes de trabajar

- Revisar `git status` y conservar los cambios locales del usuario. No restaurar, descartar ni commitear cambios ajenos a la tarea.
- El estado de una tarjeta de Trello o el nombre de una rama no prueban que una tarea cumpla sus criterios. Revisar código y pruebas antes de declarar algo implementado o rehacerlo.
- Plan vigente: `docs/versiones/v1/TAREAS_PENDIENTES.md` (T44 en adelante). Sus totales iniciales (70 tareas / 400 h) y las frases sobre la sincronización con Trello son históricas.

## Proceso de tareas

- Para desarrollar y auditar tareas pendientes en fila usar el skill `avanzar-tareas` (`/avanzar-tareas`), con los subagentes `planificador-tarea`, `implementador-tarea` y `auditor-tarea`.
- Trabajar siempre en este directorio cambiando de rama con git; no crear worktrees, clones ni otras carpetas de trabajo.
- Bloqueos y dudas para el usuario: `docs/REVISION_PENDIENTE.md`.

## Colaboración

- Responder en español, conciso y directo, sin introducciones ni resúmenes innecesarios.
- No afirmar que algo funciona, está completo o pasa pruebas sin evidencia ejecutada.
- Revisiones y auditorías: solo reportar. Implementar únicamente el alcance autorizado.
- No modificar el PRD, el diseño, las tareas ni el trabajo terminado sin pedido explícito. Ante una regla de negocio faltante o contradictoria, preguntar.
- Auditorías de PR: contra los criterios de aceptación de la tarea, con base `origin/dev` por defecto.
- Separar siempre prototipo (`design/prototype`), código productivo, tests locales, estado del tablero y despliegue real.
- La votación de actividades fue retirada del producto: no reintroducirla.

## Entorno

- Windows, Yarn 4 vía `corepack`. Android requiere JDK 21. iOS requiere macOS/Xcode y no se puede verificar desde esta PC.
- Los archivos del repo usan fin de línea CRLF en el disco. Al editar, conservar el fin de línea existente.
- La PC ya sufrió un crash por falta de memoria: ejecutar primero pruebas acotadas y evitar suites completas con paralelismo innecesario.
- No incluir secretos (MongoDB, AWS, Serverless, FCM/APNs, firma) en código, logs ni argumentos. No desplegar ni ejecutar migraciones sobre bases reales sin pedido explícito.
