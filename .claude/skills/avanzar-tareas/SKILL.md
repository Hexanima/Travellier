---
name: avanzar-tareas
description: Desarrolla y audita en fila las tareas pendientes de Travellier (TAREAS_PENDIENTES.md): rama desde dev, plan TDD, implementación, CI, PR, auditorías sucesivas hasta aprobar, merge y siguiente tarea. Usar cuando el usuario pida avanzar, continuar o retomar las tareas.
---

# Avanzar tareas de Travellier

Proceso secuencial: una tarea por vez, una auditoría por vez, nada en paralelo. Respondé y comentá en español.

## Fuentes

- Producto: `docs/versiones/v1/PRD.md` y `AGENTS.md` (ya cargado vía `CLAUDE.md`).
- Tareas: `docs/versiones/v1/TAREAS_PENDIENTES.md`. Cada tarea tiene título, capa, descripción, criterios, estimación y dependencias.
- Estado: tablero Trello «Travellier» (Backlog, To Do, In Progress, In Review, Done) si las herramientas de Trello están disponibles. Si no, una tarea está terminada cuando su PR está mergeado en `origin/dev` (`gh pr list --state merged --base dev --search "TNN"`).
- Bloqueos registrados: `docs/REVISION_PENDIENTE.md`.

## 1. Elegir la tarea

1. La siguiente tarea es la de número más bajo que no esté terminada, no esté bloqueada en `docs/REVISION_PENDIENTE.md` y tenga todas sus dependencias terminadas. T01–T43 están terminadas.
2. Si la de número más bajo está bloqueada o le faltan dependencias, seguí el orden numérico hasta encontrar una desbloqueada.
3. Si no queda ninguna desbloqueada, detenete y reportá (ver «Al detenerse»).

## 2. Preparar la rama

1. `git status`: puede haber cambios locales del usuario (por ejemplo `docs/versiones/v1/TAREAS_DESARROLLO.md`). No los restaures, descartes ni incluyas en commits. Nunca uses `git add -A` ni `git add .`: agregá solo los archivos de la tarea.
2. `git fetch origin`, `git checkout dev`, `git pull --ff-only origin dev`.
3. La rama se llama como la tarea en minúscula (`t49`). Si no existe, `git checkout -b tNN`. Si ya existe (local o remota), continuá sobre ella sin reescribir su historia.
4. Trello: mover la tarjeta a In Progress.

## 3. Planificar

Invocá el subagente `planificador-tarea` con este prompt, completado con el texto exacto de la tarea:

```md
Prepará un plan de implementación para la tarea <CODIGO>. NO hagas commits.

Revisá el código existente para entender el estado actual antes de planificar.
El plan debe cubrir todos los repos afectados (el proyecto) si la tarea lo requiere.
Seguí TDD: incluí en el plan qué tests escribir antes de implementar.

[Titulo]
<TITULO TAREA>

[Descripcion / Criterios de aceptación]
<DESCRIPCION TAREA>
```

Revisá el plan contra el PRD y los criterios. Si «Requiere definición» no está vacía y la definición es imprescindible para cumplir un criterio, registrala como bloqueo y pasá a la siguiente tarea. Si es menor, elegí la opción más conservadora que no invente reglas de negocio y anotala en `docs/REVISION_PENDIENTE.md`.

## 4. Implementar (TDD)

1. Escribí primero los tests del plan, verificá que fallen, implementá hasta que pasen.
2. Alcance estricto: solo lo que piden los criterios. No rehagas lo existente ni toques PRD, diseño aprobado, tareas o tarjetas ajenas.
3. Verificación local acotada para no saturar la memoria de la PC: ejecutá lint, typecheck y tests solo de los workspaces afectados y sin paralelismo innecesario (por ejemplo `corepack yarn workspace api test --run <archivo>`, `corepack yarn workspace domain typecheck`). No corras `corepack yarn test` completo: lo hace el CI.
4. Commits pequeños, mensaje en español con el código de tarea, como en el historial: `feat: <qué> (T49)`, `fix: …`, `test: …`, `docs: …`.
5. Nunca incluyas secretos ni valores de `.env`. No despliegues, no ejecutes migraciones ni auditorías sobre bases reales, no borres datos dev.

## 5. CI

1. `git push -u origin tNN`.
2. Esperá el CI de la rama (`gh run list --branch tNN --limit 1`, `gh run watch <id> --exit-status`).
3. Si falla, leé el log (`gh run view <id> --log-failed`), corregí y repetí. Si falla por motivos externos (credenciales, servicios, emuladores) o tras 5 intentos sin avance, registralo como bloqueo y pasá a la siguiente tarea.

## 6. PR

Con CI en verde: `gh pr create --base dev --head tNN --title "TNN — <título>"` con un cuerpo que liste los criterios de aceptación como checklist y un resumen breve de lo hecho. Si ya existe el PR, reutilizalo. Trello: mover a In Review.

## 7. Auditar hasta aprobar

Repetí, de a una ronda por vez:

1. Invocá una instancia nueva del subagente `auditor-tarea` (nunca reutilices una anterior) con:

```md
Auditá en el proyecto las ramas origin/tNN contra origin/dev usando triple punto (git diff origin/dev...origin/tNN) para leer solo los commits propios de la rama.
NO hagas cambios. NO ejecutes tests, el CI se encarga de eso.

Si hay observaciones, generá al final un bloque markdown listo para comentario de GitHub (wrapper de cuatro backticks, código de ejemplo con tres backticks) con solo los puntos ⚠️ y ❌ encontrados.

[Titulo tarea]
<TITULO TAREA>

[Descripcion tarea / Criterios de aceptación]
<DESCRIPCION TAREA>
```

2. Si el veredicto es `APROBADO`, pasá al merge.
3. Si hay observaciones: publicá el bloque como comentario del PR (`gh pr comment`). Evaluá cada punto contra PRD y criterios:
   - Válido: corregilo con TDD, commit, push y esperá el CI en verde.
   - Inválido (fuera de alcance, contradice el PRD o pide una regla inexistente): no lo implementes; respondé en el PR con la justificación. Si plantea una duda de producto real, anotala en `docs/REVISION_PENDIENTE.md`.
4. Volvé al paso 1 con un auditor nuevo.
5. Si tras 6 rondas no se llega a `APROBADO`, o se repiten observaciones que consideraste inválidas, registralo como bloqueo con el detalle y pasá a la siguiente tarea sin mergear.

## 8. Merge y siguiente

1. Confirmá CI en verde y auditoría aprobada.
2. `gh pr merge <n> --merge` (merge commit, como en los PRs anteriores). No borres la rama.
3. `git checkout dev`, `git pull --ff-only origin dev`.
4. Trello: mover a Done.
5. Volvé al paso 1.

## Bloqueos y revisión

`docs/REVISION_PENDIENTE.md` registra, por tarea: fecha, motivo, qué falta y si bloquea. Se commitea en la rama de la tarea que lo genera, o en la siguiente rama que se cree.

Son bloqueo, entre otros:
- Credenciales o servicios externos que no tenés (AWS, FCM/APNs, firma, mapas).
- Verificación en iOS o dispositivos reales: no la simules ni la des por hecha.
- Una regla de negocio imprescindible que el PRD no define o contradice.

No son bloqueo:
- Diferencias visuales o de diseño frente al PRD: anotalas para revisión futura y seguí.
- T117 y las tareas visuales: usá el skill de Impeccable y `design/prototype/DESIGN.md` para validar la presentación; registrá en el archivo que la aprobación del usuario queda pendiente, sin detener el proceso.

## Reglas permanentes

- No afirmar que algo funciona o pasa sin evidencia (CI, test ejecutado).
- No force push, no reescribir historia, no borrar ramas, no desplegar.
- No modificar tareas terminadas, el PRD ni el diseño aprobado salvo que la tarea lo pida.
- No reintroducir votación.
- Nada en paralelo: una tarea, un PR y una auditoría por vez.

## Al detenerse

Reportá: tareas mergeadas en esta sesión (con PR), tarea en curso y su estado, bloqueos nuevos y la próxima tarea que se podría tomar.
