# T32 — Persistir y regenerar itinerario

## Estado actual verificado

- Monorepo con `domain`, `apps/api` y `apps/web` (cliente mobile React + Capacitor); no hay submódulos Git.
- T29 está conectada a HTTP mediante `createJourneyTransport` y `updateJourneyTransport` en `domain/src/usecases/trips/manage-journey.ts` y la composición de `apps/api/src/trips/trip-api.ts`. La integración debe hacerse en este flujo: `saveTransport` es un caso de uso independiente que la API actual no utiliza.
- T31 genera `ItineraryDayDraft[]` sin IDs ni persistencia. Conserva instantes UTC y milisegundos; permite tránsito y actividad en una misma fecha y genera solo tránsito si falta el transporte complementario.
- `itineraryDays` y su índice `{ tripId, order }` existen en las migraciones. No hay adaptador ni puerto para persistir o reconciliar la proyección.
- El repositorio Mongo usa transacciones para crear transportes y ordenar destinos, pero `replaceTransport` actualiza fuera de una transacción. Ningún guardado invoca T31.
- Actividades y posts todavía no tienen implementación funcional. Sus colecciones e índices existen y el PRD define referencias `dayId`; actividades también requieren `scheduledAt`.
- El cliente convierte HTTP 409 en un error genérico y pierde el código específico al convertirlo a `TripFailure`.
- Base verificada: 67 tests existentes pasan en siete archivos de dominio, repositorio Mongo, rutas, integración HTTP y formulario/cliente de transportes. Esto no verifica T32, que aún no está implementada.

## Decisión funcional confirmada

Rechazar el cambio y conservar todos los datos cuando elimine un día referenciado por actividades/posts o deje una actividad fuera de su ventana. No reubicar ni borrar automáticamente datos dependientes.

Conservar el `dayId` de cada franja que siga existiendo con la misma identidad `(tripId, destinationId, date UTC, type)`, aunque cambien sus límites u orden. `order` no identifica una franja. Un cambio de límites solo es admisible si las actividades vinculadas conservan un `scheduledAt` válido dentro de la ventana y franja correspondientes.

Los posts conservan su asociación al día y sus vínculos independientes a actividad, post o transporte. No usar `createdAt` para reubicarlos ni inventar una validación temporal de posts que el PRD no define.

## Alcance por workspace

| Workspace | Cambios previstos |
|---|---|
| `domain` | Orquestación del guardado y regeneración; puerto transaccional sin dependencias Mongo; reconciliación de días; validación de dependencias; error discriminado de incompatibilidad; exports y tests. |
| `apps/api` | Adaptadores Mongo de itinerario y unidad de trabajo; integración en el repositorio/composición existentes; migración de unicidad; HTTP 409 específico; tests reales con replica set. |
| `apps/web` | Propagar el conflicto de itinerario y mostrar un mensaje comprensible, conservando el formulario y el último estado confirmado; tests. |
| `docs/versiones/v1` | Registrar en el PRD la política confirmada y documentar persistencia, regeneración y migración. |

Las consultas agregadas y la pantalla de itinerario siguen siendo T33/T34. No se agregan endpoints para crear días manualmente ni una zona horaria fija del Trip. No se requieren cambios en proyectos nativos, S3 o infraestructura AWS.

## Plan con tests antes de implementación

En cada bloque: escribir el test, ejecutarlo y comprobar que falla por la funcionalidad faltante; implementar lo mínimo para pasarlo; refactorizar manteniendo los tests verdes. Usar el generador real y un adaptador en memoria en dominio; Mongo real mediante `MongoMemoryReplSet` para atomicidad y concurrencia.

### 1. Orquestación de dominio y reconciliación — 75 min

**Tests previos:** ampliar `manage-journey.test.ts` y agregar tests de reconciliación/regeneración.

- Crear únicamente ida o vuelta persiste las franjas de tránsito conocidas. Completar el par agrega las franjas de actividad con los límites exactos de T31.
- Modificar fechas agrega, actualiza y retira las franjas correspondientes; repetir el mismo PATCH mantiene cantidad, identidad y referencias.
- Cambiar costo, lugares o detalles conserva los días y sus IDs.
- Regenerar considera todos los destinos y transportes del Trip: cubre varios días, varios destinos y franjas de distintos tipos en una misma fecha, sin confundir coincidencia de fecha con duplicación.
- Rechazar una ventana incompatible entre ida/vuelta o destinos no escribe transporte ni días.
- Conservar regresiones de autenticación, pertenencia al Trip/destino y PATCH parcial.

**Implementación:** introducir un puerto de unidad de trabajo por Trip, con operaciones de lectura/escritura disponibles dentro de su contexto. Dentro de ese contexto leer el estado completo, combinar el PATCH con el transporte vigente, validar con las entidades existentes, invocar `generateItineraryDays` y calcular el conjunto final de días. Asignar ObjectIds mediante una dependencia inyectada solo a las identidades nuevas; conservar IDs existentes, actualizar límites/orden y retirar únicamente franjas obsoletas.

La generación y las decisiones funcionales quedan en `domain`; sesiones, documentos BSON y operaciones Mongo quedan en `apps/api`. El guardado de producción debe pasar por esta orquestación, sin persistir primero y regenerar después.

### 2. Protección de dependencias — 35 min

**Tests previos:** agregar fixtures de actividades/posts vinculados a días, aunque sus módulos funcionales aún no existan.

- Una franja vigente conserva `dayId`, actividades y posts después de un cambio compatible.
- Eliminar una franja referenciada rechaza el cambio y mantiene transporte, proyección y dependencias originales.
- Recortar una franja que conserva su ID, pero excluye `scheduledAt`, también rechaza el cambio.
- Recortar sin excluir actividades y eliminar franjas sin dependencias se permiten.
- Validar límites con precisión de milisegundos, sin habilitar actividad desde medianoche por el campo `date`.
- No alterar fotos, gastos, participaciones, votos, likes, comentarios ni los vínculos independientes de posts.

**Implementación:** leer referencias mínimas de `activities` y `posts` en la misma unidad de trabajo. Validar antes de persistir la reconciliación y devolver un error de dominio específico, por ejemplo `ItineraryConflictError`. No crear los casos de uso de actividades/posts de futuras tareas.

### 3. MongoDB: atomicidad, concurrencia e índices — 65 min

**Tests previos:** ampliar `trip-journey-repository.test.ts`, agregar tests del adaptador de itinerario y ampliar `migrations.test.ts`.

- Persistir IDs/referencias como BSON ObjectId y timestamps como Date; conservar UTC y milisegundos al leer.
- Inyectar un fallo durante la escritura de días: comprobar rollback completo del transporte y la proyección, tanto en alta como en modificación.
- Dos guardados concurrentes del mismo Trip dejan una proyección que corresponde a todos los transportes finalmente confirmados, sin duplicados ni pérdida de campos en PATCH parciales.
- Un rechazo de dominio dentro de la transacción aborta los cambios: devolver `Result.err` no puede terminar confirmando escrituras.
- Reordenar destinos regenera y conserva IDs, o rechaza el orden si vuelve incompatible la secuencia temporal; una carrera entre reordenamiento y guardado de transporte no confirma una proyección desactualizada.
- Otros Trips permanecen intactos. Lecturas bajo distintas zonas de presentación no modifican días ni referencias.
- La migración es repetible, mantiene los índices previos y rechaza datos históricos duplicados sin borrar referencias.

**Implementación:** ejecutar lectura, validación, guardado de transporte y reconciliación dentro de `session.withTransaction`. Serializar mutaciones del mismo Trip mediante escritura en el documento `trips`, compatible con el bloqueo existente de orden de destinos. En cada reintento releer datos y recalcular desde el estado vigente; no reutilizar un snapshot previo a la transacción. Traducir rechazos de dominio a aborto y recuperar el `Result` correspondiente fuera de la transacción.

Agregar una migración versionada para un índice único de identidad `{ tripId, destinationId, date, type }`, conservando `{ tripId, order }`. No imponer unicidad solo por fecha: T31 admite varias franjas por fecha. Detectar duplicados previos y exigir resolución explícita, sin limpieza automática.

Integrar la misma regeneración al cambiar el orden de destinos, porque T31 lo usa para validar secuencia y desempatar franjas; orden y proyección deben confirmarse juntos. Renombrar un destino no cambia la identidad de sus días.

### 4. Integración HTTP y cliente mobile — 35 min

**Tests previos:** ampliar `destination-transport-routes.test.ts`, `destination-transport-integration.test.ts`, `trip-journey-api.test.ts` y `TransportForm.test.tsx`.

- POST de transporte produce los documentos esperados de `itineraryDays`; PATCH recalcula y un PATCH repetido no duplica documentos.
- Un cambio incompatible responde HTTP 409 con código específico; la base conserva todos los datos anteriores. Errores temporales siguen respondiendo 422 y recursos ajenos 404.
- El cliente diferencia incompatibilidad del itinerario de duplicación de transporte; no muestra éxito ni publica un transporte rechazado.
- El formulario conserva los valores ingresados y permite corregirlos, con un mensaje como: «Este cambio deja actividades fuera de su horario o elimina días con actividades o posts. Revisá los datos vinculados antes de cambiar el transporte».

**Implementación:** actualizar la composición en `trip-api.ts` y el mapeo de errores en `app.ts`, manteniendo las respuestas exitosas existentes. Propagar el conflicto específico a través del cliente HTTP y `TripFailure`, evitando cambios de comportamiento en otros consumidores. Registrar la regla confirmada en el PRD.

### 5. Verificación final — 30 min

- Ejecutar suites focalizadas de cada bloque y luego `yarn test`, `yarn typecheck`, `yarn lint` y `yarn build` desde la raíz.
- Verificar ambos criterios mediante integración HTTP + Mongo: configuración produce la proyección esperada; modificación/repetición/concurrencia deja exactamente el conjunto generado, con IDs estables y sin franjas obsoletas.
- Verificar también la descripción de T32: un cambio incompatible o un fallo intermedio conserva todos los datos anteriores.
- Revisar el diff para confirmar alcance y ausencia de cambios ajenos. No hacer commits.

## Estimación

Total: 240 min (4 hs). La estimación presupone datos históricos sin duplicados ni referencias inválidas. Reparar datos existentes o incorporar la política de protección a futuras escrituras de actividades/posts requiere trabajo adicional. Esos módulos deberán compartir la coordinación por Trip para evitar carreras con la regeneración.
