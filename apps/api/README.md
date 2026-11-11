# api

Node HTTP API for the Clean Architecture template.

The `/health` endpoint composes a response from the domain use case exported by `app-domain`.

## Commands

- `yarn workspace api dev`
- `yarn workspace api test --run`
- `yarn workspace api build`
- `yarn workspace api start`

Los tests preparan el binario de MongoDB una sola vez mediante el global setup de Vitest, antes de iniciar las suites paralelas. En un entorno sin caché, la descarga termina antes de ejecutar los hooks de cada suite; si falla, aborta el setup. Cada suite conserva su propia instancia y base de datos.

## Configuración local

Copiar [`.env.example`](.env.example) a `apps/api/.env`. Completar la URI de Atlas y un secreto JWT propio; usar una base de desarrollo separada de producción. El archivo `.env` está ignorado por Git. No copiar sus valores al frontend.

Para generar el secreto, ejecutar `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y pegar el resultado en `JWT_SECRET`.

La API local y las migraciones cargan `apps/api/.env` automáticamente con `dotenv`, independientemente de la carpeta desde la que se ejecute el comando. Las variables ya definidas en el entorno tienen prioridad. No se carga `.env.local`. Ejecutar desde la raíz del repositorio:

```bash
yarn install --immutable
yarn build
yarn workspace api migrate:mongodb
yarn workspace api dev
```

`yarn workspace api start` también carga el mismo `.env` al iniciar la API compilada. Lambda conserva su configuración mediante variables de entorno y Secrets Manager, sin cargar archivos locales. Las migraciones crean o actualizan el esquema en la base configurada. Atlas debe permitir la IP del desarrollador y el usuario debe tener permisos de lectura y escritura sobre esa base.

`S3_BUCKET_NAME` y `AWS_REGION` son opcionales para probar avatares y fotos (T72) y requieren credenciales AWS disponibles para el SDK. Dejarlas sin configurar permite probar autenticación, Trips, miembros, destinos, transportes e itinerario sin AWS.

La API local registra cada request y su respuesta en JSON: `requestId`, método, ruta, estado HTTP, duración y código de error cuando existe. Los errores inesperados registran el tipo y los frames del stack y responden HTTP 500 genérico. No se registran bodies, headers, query strings ni mensajes de excepciones; los tokens de verificación y códigos de invitación en la ruta se ocultan. Para desactivar estos logs, definir `API_VERBOSE=false` en `apps/api/.env`.

Para probar desde Vite sin proxy, usar `VITE_API_BASE_URL=http://localhost:3000` en el frontend. Las rutas del backend no llevan prefijo `/api`: el registro es `POST /auth/register`. Reiniciar Vite después de cambiar sus variables de entorno.

La API local usa `cors` antes de autenticar y responde a preflights `OPTIONS` con HTTP 204. Permite `Content-Type` y `Authorization`, sin cookies cross-origin. Por defecto permite `http://localhost:5173`, `http://127.0.0.1:5173`, `capacitor://localhost`, `http://localhost` y `https://localhost`. `CORS_ORIGINS` en `apps/api/.env` reemplaza esa lista por origenes exactos separados por comas (sin rutas ni barra final); no se habilitan todos los origenes mediante `*`.

Con dev tunnels, agregar el origen HTTPS del **frontend** (puerto 5173) a `CORS_ORIGINS`, y usar como `VITE_API_BASE_URL` la URL HTTPS del **backend** (puerto 3000), sin `/api`. Los headers CORS se conservan también en respuestas de error. Lambda mantiene la configuración CORS de API Gateway definida en `serverless.yml`.

## MongoDB

El adaptador de MongoDB usa estas variables de entorno:

- `MONGODB_URI`: URI de conexión de MongoDB Atlas.
- `MONGODB_DATABASE_NAME`: nombre de la base de datos de Travellier.
- `JWT_SECRET`: secreto para firmar access y refresh tokens durante el desarrollo local.

Para crear o actualizar el esquema versionado y sus índices:

```bash
yarn workspace api migrate:mongodb
```

El runner registra la migración aplicada en la colección técnica `_migrations`.

T32 agrega la migración `0003-unique-itinerary-identity`: conserva los índices existentes e impone unicidad de `(tripId, destinationId, date, type)` en `itineraryDays`. Ejecutar `yarn workspace api migrate:mongodb` con la configuración de la base antes de usar esta versión. La migración rechaza duplicados históricos sin borrar días ni referencias; requiere resolverlos explícitamente.

### Contratos pendientes (T44)

Antes de evolucionar contratos de datos, ejecutar la auditoría de solo lectura con la configuración de la base que se desea inspeccionar:

```bash
yarn workspace api audit:mongodb
```

La salida JSON contiene `findings`, ordenados por colección y `_id`, con `code`, `collection`, `documentId`, `tripId`, `fields` y `relatedIds`. Los ObjectId se imprimen como hexadecimal sin cambiar su tipo almacenado. Los códigos de salida son **0** sin hallazgos, **2** con contratos por revisar y **1** ante un error operativo. Ante errores no se imprimen URI ni credenciales. El comando no crea colecciones, índices ni versiones, ni adapta datos. Los hallazgos se recalculan en cada ejecución, aunque las migraciones ya estén aplicadas.

| Código | Diagnóstico |
| --- | --- |
| `post_multiple_links` | Más de una referencia directa entre actividad, padre y transporte. No elige cuál conservar. |
| `post_legacy_day` | Un post conserva `dayId` heredado. `referenceStatus` distingue `valid`, `missing`, `different_trip` e `invalid`. El `dayId` de actividades sigue siendo válido y no es un hallazgo. |
| `expense_legacy_paid_by` | Un `paidBy` ObjectId conocido todavía no tiene pagos registrados; `relatedIds` conserva esa identidad, aunque ya no sea integrante. |
| `expense_incomplete` | Campos faltantes/inválidos, pagos o reparto sin cubrir el total, exceso de cobertura o partes duplicadas. No calcula deudas, convierte monedas ni propone acuerdos. |

Una cadena válida con ramas y vínculo exclusivo al padre no produce un hallazgo de vínculos múltiples. Los posts sin `dayId` tampoco. Un gasto incompleto se conserva; no se considera apto para balance por pasar una migración de índices. La auditoría es un diagnóstico previo, no un validador exhaustivo de ciclos, referencias o balances ni una garantía frente a escrituras concurrentes.

Las nuevas migraciones son aditivas y se ejecutan después de `0001–0003`, cuyas definiciones permanecen intactas:

| Versión | Índices nuevos |
| --- | --- |
| `0004-publication-and-personal-agenda-indexes` | `posts.tripId_createdAt_desc`: `{ tripId: 1, createdAt: -1 }`; `activityParticipations.tripId_userId_status`: `{ tripId: 1, userId: 1, status: 1 }`. |
| `0005-notification-outbox-indexes` | `outboxEvents.eventKey_unique`: `{ eventKey: 1 }` único; `outboxEvents.status_availableAt`: `{ status: 1, availableAt: 1 }`. |
| `0007-push-device-indexes` | `pushDevices.provider_token_unique`: `{ provider: 1, token: 1 }` único; `pushDevices.userId`: `{ userId: 1 }`. Colección nueva de T89, sin TTL (no está en el PRD; ver «API de dispositivos push (T89)»). |
| `0008-notification-inbox-indexes` | `outboxEvents.userId_createdAt_id`: `{ userId: 1, createdAt: -1, _id: -1 }` (bandeja personal); `outboxEvents.tripId`: `{ tripId: 1 }` (cascada y autorización). Aditiva, idempotente, sin TTL y sin tocar documentos (T91; fuera del PRD, ver «API de avisos (T91)»). |
| `0009-rate-limit-ttl-index` | `rateLimits.expiresAt_ttl`: `{ expiresAt: 1 }` con `expireAfterSeconds: 0` (contadores del rate limiting de Auth, T102; aditivo, NO ejecutado sobre bases reales) |

Se mantienen todos los índices anteriores, incluidos los únicos de membresías, participaciones, likes, gastos, posiciones de destinos, direcciones de transporte e identidad de itinerario, además del TTL de refresh tokens. No se quitan índices heredados de `dayId` ni se borra `activityVotes`.

`outboxEvents` prepara el almacenamiento técnico para avisos/push de T91–T92; no almacena vínculos al calendario nativo de T96. Su contrato base reserva `_id: ObjectId`, `tripId: ObjectId`, `eventKey: string` (clave estable de deduplicación; desde T91, `{type}:{operación}:{userId}`, un documento por evento y destinatario), `type: string`, `status: string`, `availableAt: Date` y `createdAt: Date` en UTC. T91 escribe en esta colección (ver «API de avisos (T91)») con los campos adicionales `userId`, `actorId`, `operationKey` y `payload`; los IDs son ObjectId. La entrega (la máquina de estados de `status`) es de T92; T44 solo versiona sus índices y no impone un validador de documentos. No hay TTL ni eliminación de eventos en estas migraciones.

Cada versión se registra en `_migrations` solo después de crear todos sus índices. Si un índice existente tiene una definición incompatible o hay claves de evento duplicadas, la operación falla y conserva los datos y el índice conflictivo. Los índices ya creados pueden permanecer: después de una resolución explícita se puede repetir `migrate:mongodb` sin duplicar versiones ni modificar sus fechas. Los hallazgos del auditor no bloquean por sí solos estos índices aditivos; la evolución funcional posterior debe revisar el reporte y resolver incompatibilidades explícitamente.

Los fixtures de T44 están en `test/legacy-contract-fixture.ts` y solo se cargan desde pruebas con MongoDB efímero, sin usar `.env` ni reiniciar una base dev. Incluyen un gasto con importe y `paidBy` conocidos, sin `currency`, `payments` ni `shares`. **T80** realizará la adaptación idempotente a un único pago `percent: 100`; T44 no la ejecuta, no infiere moneda/reparto ni cambia fechas o importes. Los tests verifican conservación BSON, índices anteriores, idempotencia, reintentos tras fallos y ausencia de escrituras durante la auditoría.

Los POST/PATCH de transportes y los cambios de orden de destinos regeneran el itinerario en una transacción MongoDB con coordinación por Trip. Un fallo aborta el cambio completo. Los cambios que invaliden actividades o eliminen días con actividades/posts responden HTTP 409 con código `ItineraryConflictError`.

## API de actividades (T36)

Todas las rutas requieren `Authorization: Bearer <accessToken>` y membresía actual del Trip. Admins y participantes tienen los mismos permisos, incluso para editar o eliminar actividades creadas por otro integrante. La visibilidad pública no habilita acceso a actividades sin membresía.

| Método | Ruta | Respuesta |
|---|---|---|
| POST | `/trips/:tripId/activities` | 201 `{ activity }` |
| GET | `/trips/:tripId/activities` | 200 `{ activities }`, ordenadas por `scheduledAt` e ID |
| GET | `/trips/:tripId/activities/:activityId` | 200 `{ activity }` |
| PATCH | `/trips/:tripId/activities/:activityId` | 200 `{ activity }` |
| DELETE | `/trips/:tripId/activities/:activityId` | 204, sin body |

POST requiere `title`, `dayId` y `scheduledAt`; acepta `description` y `mapsUrl` opcionales, como texto o `null`. `scheduledAt` debe ser un ISO con fecha, hora y zona explícita (`Z` u offset `±HH:mm`), con hasta tres decimales para los segundos. Por ejemplo: `2026-09-25T09:00:00.456-03:00`. Las fechas se almacenan como BSON `Date` y se devuelven normalizadas a UTC (`2026-09-25T12:00:00.456Z`). El día debe ser una franja de actividad del mismo Trip y el instante debe pertenecer a ella, respetando los límites exactos de llegada y salida.

PATCH permite únicamente `title`, `dayId`, `scheduledAt`, `description` y `mapsUrl`. Conserva campos omitidos; `null` limpia los opcionales y se rechaza en fecha/hora o día. Cambiar el día requiere que el horario resultante sea válido en la nueva franja. La API controla ID, Trip, autoría y `createdAt`: estos campos del body no alteran el registro. Desde T47 las actividades no tienen estado de aprobación ni configuración de votación; `status` y `votingEnabled` heredados del body se ignoran. Los planes están disponibles al crearse, pueden ser simultáneos y permanecen visibles sin participantes, sin aprobación ni mínimos.

Desde T53, un PATCH que cambia `scheduledAt` o `durationMinutes` (valor distinto al almacenado) revisa, en la misma transacción que la edición, la agenda de cada integrante actual con `going` en esa actividad, incluido quien edita. Quien queda con superposición pasa a `pending` solo en la actividad editada y se guarda `decisionRequired { reason: "schedule_conflict", changedFields, changedAt }` (`changedFields` con los campos que cambiaron, en orden `scheduledAt`, `durationMinutes`; `changedAt` es un único instante UTC por edición). No se asigna `not_going` ni se tocan sus otros planes; los compatibles conservan `going`. Quienes ya estaban `pending` con marca, `not_going`, sin registro o ex integrantes no se modifican. Cambiar solo título, descripción, Maps o día, o enviar valores idénticos, no lee ni escribe participaciones. La respuesta sigue siendo 200 `{ activity }`: la lista de afectados es interna (para las notificaciones de T91/T92) y no se expone, porque la agenda ajena es personal. Un fallo aborta edición y marcas; la marca solo se elimina con un `going`/`not_going` explícito (PUT de participación). `GET .../participation` devuelve el registro propio con `decisionRequired` (`changedAt` ISO UTC) o `null`. No requiere migración.

Sin JWT válido responde 401; usuarios externos y Trips inaccesibles responden 404. Una actividad ausente o de otro Trip devuelve 404 `ActivityNotFoundError`. JSON/IDs de ruta malformados y PATCH sin campos editables devuelven 400. Los errores de campos y horarios devuelven 422 `ValidationError`, con detalles en `error.fields`.

Las mutaciones leen membresía, existencia del Trip y días dentro de la misma transacción, coordinada por Trip con transportes y bajas. La expulsión de participantes revoca la membresía dentro de una transacción con la misma coordinación: una mutación de actividad confirma antes de la expulsión o, si la expulsión se confirma primero, se rechaza por falta de membresía. Un fallo revierte todas las escrituras. DELETE elimina actividad y participaciones y desvincula sus posts con `activityId: null`; conserva sus demás datos y relaciones, fotos, gastos, likes y comentarios. GET usa un snapshot sin modificar datos. La consulta agregada del itinerario refleja los cambios en su siguiente lectura.

## API de Posts (T43)

Todas las rutas requieren `Authorization: Bearer <accessToken>` y membresía actual del Trip, incluso si es público. Admins y participantes pueden crear, consultar y editar posts de cualquier integrante. La edición y las vinculaciones conservan la autoría y la fecha original de publicación.

| Método | Ruta | Respuesta |
|---|---|---|
| POST | `/trips/:tripId/posts` | 201 `{ post }`, o `{ post, activity, participation }` en creación conjunta; 409 si hay conflictos de agenda sin confirmar (T58); `id` opcional del post para reintentar sin duplicar, 409 `PostRequestConflictError` si ese `id` ya se usó con otro contenido (T87) |
| GET | `/trips/:tripId/posts` | 200 `{ posts }`, por publicación descendente (`createdAt`) y, ante empate, ID descendente |
| GET | `/trips/:tripId/posts/:postId` | 200 `{ post, parent, children, rootActivityId }` (T55) |
| PATCH | `/trips/:tripId/posts/:postId` | 200 `{ post }`, o `{ post, activity, participation }` si trae `newActivity`; 409 igual que POST (T58) |

POST no requiere `dayId` ni itinerario: acepta `description`, `mapsUrl`, `activityId`, `parentPostId` y `transportId` opcionales. Un post puede ser independiente, vincularse a una actividad, a un transporte o a ambos, o ser hijo de otro post (T55). Un padre excluye la relación directa con actividad y transporte: `parentPostId` junto con `activityId` o `transportId` no nulos responde 422 `ValidationError` con `field: "parentPostId"` y `code: "conflict"`, tanto en POST como en PATCH. Un PATCH que agrega `parentPostId` a un post que ya tiene actividad o transporte se rechaza: el cliente debe enviar `activityId: null` y/o `transportId: null` en el mismo cambio (no se limpian vínculos implícitamente). Las referencias deben existir en el mismo Trip; los vínculos pueden apuntar a contenido de otros días del viaje. Se rechaza la autorreferencia (`code: "self_reference"`), los ciclos indirectos (`code: "cycle"`, p. ej. mover un post bajo uno de sus descendientes) y los padres de otro Trip; el chequeo corre dentro de la misma transacción coordinada por Trip, por lo que dos ediciones simultáneas opuestas no pueden cerrar un ciclo (una gana y la otra recibe `cycle`) y un rechazo no escribe nada. Un hijo se vincula solo a su padre inmediato y admite ramificaciones; no hay profundidad máxima funcional (solo un tope técnico anti-corrupción de 1000 niveles). Desde T54 el post no tiene día: el servidor asigna `createdAt` al publicar (con milisegundos), también antes o después del viaje o en un Trip sin transportes, y el cliente no lo elige. Un `dayId` o `createdAt` del body se ignora, aunque sea inválido o ajeno; solo con `newActivity` el `dayId` define el día de la actividad nueva (transitorio hasta T58). Los registros anteriores conservan su `dayId` en MongoDB, se leen y editan sin depender de él, y la API de posts no lo expone.

El detalle (`GET /trips/:tripId/posts/:postId`) conserva `post` y agrega `parent` (resumen `{ id, authorId, createdAt, description }` o `null`), `children` (resúmenes de los hijos directos, por publicación descendente y ID descendente) y `rootActivityId` (`activityId` del ancestro más alto de la cadena, o `null` explícito si la raíz no tiene actividad). Datos previos corruptos (ciclos o padres inexistentes) no hacen fallar la lectura: `rootActivityId` es `null`. Al eliminar una actividad sus posts quedan con `activityId: null`; la cadena, `createdAt`, el contenido y las fotos/gastos asociados se conservan y los descendientes dejan de proyectar esa actividad raíz. Los registros preexistentes con padre más actividad no se migran ni se borran; la API los lee, pero rechaza guardar ese estado al editarlos.

PATCH permite únicamente esos cinco campos: omitidos conservan su valor; `null` limpia texto/Maps o desvincula cada relación independientemente. `dayId` ya no es editable: se ignora y un PATCH que solo lo traiga responde 400. El servidor controla ID, Trip, autor y `createdAt`; los campos protegidos o desconocidos del body se ignoran y un PATCH sin campos editables responde 400. La entidad resultante se valida completa, incluidas las referencias conservadas. Un vínculo inválido rechaza toda la edición, incluidos los cambios de texto.

Para crear una actividad espontánea y su primer post, enviar `newActivity` en el mismo POST:

```json
{
  "description": "Fuimos a cenar",
  "newActivity": {
    "title": "Cena",
    "scheduledAt": "2026-09-25T09:00:00.456-03:00",
    "durationMinutes": 90,
    "description": "Restaurante del centro",
    "mapsUrl": null
  }
}
```

`newActivity` requiere título y `scheduledAt`; acepta descripción y Maps opcionales. `dayId` (raíz del body) es opcional: si viene debe ser una franja de actividad del Trip; si no viene, la franja se deriva del inicio (en un borde contiguo gana la siguiente; sin franja, 422 `scheduledAt`/`outside_window`; más de una franja posible, 422 `dayId`/`ambiguous`). `durationMinutes` es opcional y su fin debe caber en la ventana del destino (422 si la excede). El horario se valida dentro de la ventana exacta del destino. La fecha requiere zona explícita y admite hasta tres decimales, como en T36; la respuesta normaliza UTC y conserva milisegundos. La actividad resultante no contiene `status` ni genera votos, independientemente de la configuración histórica del Trip. No se admite combinar `newActivity` con un `activityId` no nulo. La creación conjunta guarda en una sola transacción la actividad, el post, la participación `going` del autor (`participation`) y, si hace falta, `not_going` en las actividades incompatibles de su agenda. El post conserva su `createdAt` automático aunque la actividad registre un momento anterior. Si la actividad se superpone con planes en los que el autor ya está «Voy», se responde 409 `ParticipationConflictError` con `conflicts` y `activity { scheduledAt, durationMinutes }` sin escribir nada; el cliente reenvía el mismo body con `confirmedConflicts` y `confirmedActivity` (raíz del body, como en `POST /activities`) y la confirmación se revalida contra la agenda actual (una confirmación obsoleta vuelve a dar 409; malformada, 422). Un error o la cancelación no dejan registros parciales ni retiran participaciones.

`PATCH /trips/:tripId/posts/:postId` acepta el mismo `newActivity` para crear una espontánea sobre un post existente (el usuario autenticado es autor de la actividad y queda «Voy»; mismo contrato 200/409/confirmación y `dayId` opcional). El `createdAt` del post no cambia; `activityId` no nulo junto con `newActivity` y un post con `parentPostId` que el body no pone en `null` se rechazan con 422 (vínculo exclusivo, T55). Un PATCH que solo trae `dayId` sigue respondiendo 400.

Reintento idempotente del guardado conjunto (T87): `POST /trips/:tripId/posts` acepta un `id` opcional del post (ObjectId hex de 24 caracteres en minúsculas, generado por el cliente una vez por intento de publicación) que se usa como `_id`; otro formato da 422 (`fields` `id`/`invalid`). Repetir el mismo `id` con el mismo cuerpo (descripción, `mapsUrl`, vínculos, `newActivity`, claves de fotos en orden y gasto) responde 201 con lo guardado, reconstruido leyendo, sin escribir de nuevo. Un `id` de otro autor o de otro Trip da 409 `PostRequestConflictError` genérico (cuerpo `{ error: { code, message } }`): no revela dueño ni Trip, pero sí que el `id` está ocupado (inherente a que el cliente elija el `_id`; no permite apropiarse de nada). Si el post existe, es del mismo Trip y del mismo autor pero el cuerpo ya no coincide con lo guardado (p. ej. otro integrante lo editó o agregó fotos tras el primer 201), el 409 trae además `reason: "already_saved"` y `postId` (es el propio post del autor en su Trip): el recuerdo ya se guardó, no republicar con otro `id`, refrescar y abrirlo; lo mismo en `PATCH` con `newActivity.id` ya vinculado al post pero con contenido distinto, o cuando la actividad con ese `id` es propia (mismo Trip y `createdBy` quien pide) aunque otro integrante haya reapuntado después el post a otra actividad (el `postId` es el de la ruta). Resumen para el cliente: 409 con `reason: "already_saved"` = el `id` ya corresponde a un recuerdo o actividad propios en este viaje (refrescar y abrirlo; no republicar con otro `id`, aunque el contenido haya cambiado o sea distinto); 409 sin `reason` = `id` ocupado por otro autor u otro viaje (el cliente reintenta automáticamente una vez con un `id` nuevo y el mismo contenido; cualquier `reason` distinto de `already_saved` se trata como genérico). El cliente reutiliza el mismo `id` aunque el contenido se edite tras un fallo mientras el recuerdo no se haya guardado (el backend lo acepta con otro cuerpo mientras no se consumió); si ya se guardó responde `already_saved` y las ediciones posteriores al fallo se pierden, costo elegido frente a duplicar publicaciones. Un `id` de actividad ocupado por la actividad de otro creador de este viaje sigue siendo el 409 genérico; si lo ocupa una actividad de otro viaje, el 409 genérico sin `reason` llega SOLO si el pedido alcanza a insertarse: antes puede responder 422 de ventana/validación o el 409 de confirmación de agenda (`ParticipationConflictError`), sin escribir nada ni revelar el dueño; un 409 `ParticipationConflictError` no guarda nada, así que se puede repetir con el mismo `id` tras confirmar. Sin `id` el servidor lo genera y un reintento crea otro post. `newActivity.id` opcional (mismo formato) en `PATCH` hace seguro su reintento: mismo id y mismo contenido responde 200 con lo guardado sin crear otra actividad ni participación; mismo id con otro contenido da 409 `already_saved` y un id ya usado por la actividad de otro creador o Trip da 409 genérico. En el `PATCH`, el `expense` del reintento se compara aplicado como edición parcial sobre el gasto guardado: el mismo cuerpo exacto (p. ej. solo `{ breakdown }`, o sin `payments`/`shares`) responde 200 porque no cambia ningún campo, y un valor distinto al guardado da 409 `already_saved`; en el `POST` la comparación sigue siendo estricta (como creación). En `PATCH`, la comparación de fotos acepta un subconjunto de las claves ya guardadas (el PATCH solo agrega fotos), a diferencia del `POST`, donde la lista debe ser exacta y ordenada. En `POST`, `photos: []` y un reintento sin `photos` se consideran iguales; la respuesta del reintento sin `photos` no trae la clave `photos` (un POST original con `photos: []` sí la trae vacía). El reintento incrementa `destinationOrderRevision` por el lock del Trip, aunque no escribe datos de negocio. Un `PATCH` con `newActivity` sin `id` sobre un post ya vinculado sigue creando otra actividad y reapuntando el post (decisión pendiente en `docs/REVISION_PENDIENTE.md`, T87). No hay cancelación del lado servidor: una transacción en curso termina completa o se revierte.

Membresía, configuración, día y relaciones se leen dentro de la misma transacción que las escrituras, coordinada por Trip con regeneración del itinerario, expulsiones y bajas de actividades/Trip. Cualquier error aborta todos los cambios; la creación conjunta nunca deja uno de los dos registros persistido parcialmente. GET usa snapshots sin escrituras. El itinerario refleja los cambios en su siguiente consulta, y eliminar una actividad sigue desvinculando sus posts sin alterar sus demás datos.

Sin JWT válido devuelve 401; externos, expulsados o Trips inaccesibles reciben 404 `TripNotFoundError`. Un post ausente o de otro Trip recibe 404 `PostNotFoundError`. JSON/body o IDs de ruta malformados reciben 400; campos, horario de la actividad nueva o vínculos inválidos reciben 422 `ValidationError`, con detalles en `error.fields`. Dependencias sin configurar reciben 503 y fallos inesperados, 500 genérico.

IDs y referencias se almacenan como BSON `ObjectId`, y fechas como BSON `Date`. Se reutilizan la colección `posts` y los índices de T04; T43 no agrega migraciones. Fotos, gastos e interacciones permanecen en sus colecciones separadas; esta API no los crea ni modifica. Compositor y feed corresponden a T44/T45.

## API de fotos (T72)

Protocolo de fotos de un post con el bucket privado de S3 (el cliente es T74 en adelante). Todas las rutas requieren JWT y membresía actual del Trip; un externo o ex integrante recibe 404 `TripNotFoundError`. `S3_BUCKET_NAME` (y credenciales AWS del SDK) habilita estas rutas; sin ella la API local arranca igual: las rutas de fotos responden 500 y los posts sin `photos` no cambian. Sin la dependencia cableada responden 503.

1. `POST /trips/:tripId/photo-uploads` con `{ files: [{ contentType, sizeBytes }] }` (1 a 10 archivos): 201 `{ uploads: [{ key, uploadUrl, headers, expiresAt }] }`. Solo lee un snapshot de la membresía (sin lock, la firma es local) y no es idempotente: cada llamada reserva claves nuevas `trips/<tripId>/photos/<userId>/<uuid>.<jpg|png|webp>` y las no usadas quedan huérfanas (las barre T73). El cliente sube con PUT a `uploadUrl` con los `headers` devueltos (vence a los 900 s). Tipos `image/jpeg`, `image/png`, `image/webp` (sin HEIC), máximo 10 MiB. 422 `ValidationError` con `fields`: `files/required|too_many`, `files[i].contentType/unsupported`, `files[i].sizeBytes/invalid|too_large`.
2. `POST /trips/:tripId/posts` y `PATCH /trips/:tripId/posts/:postId` (también con `newActivity`) aceptan `photos: [{ key }]` con las claves ya subidas. En POST son las fotos del post en orden; en PATCH se agregan al final (nunca se quitan ni reordenan) y un PATCH solo con `photos` es válido. Con `photos` la respuesta suma `photos: [{ id, order }]` (todas las fotos del post, `order` contiguo desde 1, máximo 10 por post); sin `photos` la respuesta no cambia. Antes de abrir la transacción el servidor hace `HeadObject` de cada clave (no retiene el lock de Trip durante I/O de S3) y dentro de ella revalida la membresía. 422 con todas las fallas: `photos/invalid|too_many`, `photos[i].key/invalid|duplicate|not_uploaded|too_large|content_type_mismatch`. 404 si el post no existe o el actor ya no es integrante; 409 `PhotoConflictError` si la clave ya está en otro post (también el reintento de un POST que sí guardó); 409 `ParticipationConflictError` sin escribir fotos; 500 si S3 falla por otra causa. Todo o nada: si falla cualquier archivo no se guarda el post ni las fotos. Repetir una clave ya registrada en el mismo post es un no-op.
3. `GET /trips/:tripId/posts/:postId/photos` → 200 `{ photos: [{ id, postId, order, uploadedAt, uploaderId, url, expiresAt }] }` por `order` ascendente y `GET /trips/:tripId/photos/:photoId` → 200 `{ photo }`. `url` es un GET firmado de 300 s que no se persiste; la clave de S3 no se expone. Se autoriza con la membresía actual y la foto debe pertenecer al Trip de la ruta (`postPhotos.tripId`), si no 404 `PhotoNotFoundError`. Las fotos de ex integrantes se siguen sirviendo a los integrantes actuales.

`postPhotos` guarda `{ _id, postId, tripId, uploaderId, s3Key, order, uploadedAt }` con índices únicos `s3Key_unique` y `postId_order_unique` (migración `0004-unique-post-photo-keys`). La baja del Trip conserva las claves en `storageDeletionJobs`. No se probó contra S3 real: el IAM de `trips/*` (GetObject/ListBucket) y CORS para GET son decisiones pendientes (ver `docs/REVISION_PENDIENTE.md`, T72).

## Limpieza de fotos (T73)

Código del worker de limpieza de S3, **sin cablear ni desplegar** (ver `docs/infraestructura/servicios-pendientes.md`, «Estado de T73»). La baja del Trip sigue insertando `storageDeletionJobs` dentro de su transacción y no invoca al storage; el worker procesa esos trabajos aparte.

- `src/storage-deletion-lambda.ts`: `handler` SQS (lote de 1, `ReportBatchItemFailures`). Acepta solo el tick exacto `{ kind: "storageDeletionJobs", stage }` con `stage` = `APP_ENV`; un tick inválido o un fallo de infraestructura (config, Mongo) falla el ítem. Usa un deadline interno de 45 s y hasta 5 trabajos por tick, no pide `JWT_SECRET_ARN` y solo registra contadores (sin claves ni errores crudos).
- `processStorageDeletionJobs` (dominio): reclama un trabajo de forma atómica con lease de 120 s (`findOneAndUpdate`), borra solo las claves del trabajo con formato `trips/<tripId>/photos/<userId>/<uuid>.<ext>` de su propio Trip y que no figuren en `postPhotos` (las demás se registran en `rejectedKeys` y nunca se borran), tolera objetos ausentes, persiste el avance por lotes de 25 claves y completa al resolver todas. Ante fallos incrementa `attempts`, reprograma `nextAttemptAt` con backoff exponencial (1 min a 6 h) y tras 10 intentos deja el trabajo `failed` sin borrarlo. Toda escritura posterior al reclamo filtra por `leaseOwner`: un worker con lease vencido no pisa al que retomó el trabajo.
- `sweepAbandonedPhotoUploads` / `runAbandonedPhotoSweep`: entrada manual `{ "kind": "photoSweep", "stage": "<stage>" }`. Lista `trips/` por páginas y borra solo claves con el formato exacto de foto, con antigüedad ≥24 h (se rechaza un mínimo inferior a 1 h 15 min) y sin vínculo en `postPhotos`, consultado por página y de nuevo antes de cada borrado. También limpia Trips ya dados de baja. Sin cursor: cada corrida reinicia. No tiene schedule y requiere `s3:ListBucket` (pendiente de decisión).
- Migración `0005-storage-deletion-job-indexes`: agrega índices `{ status, nextAttemptAt }` y `{ tripId }` y completa los trabajos legados sin borrar nada. La confirmación de fotos de T72 no cambió: una carrera entre el barrido y la confirmación de un objeto de ~24 h queda documentada en `docs/REVISION_PENDIENTE.md` (T73).
- No se verificó contra S3 ni MongoDB reales.

## API de dispositivos push (T89)

Registro de los tokens de push del dispositivo, ligados al usuario autenticado (el cliente Capacitor es T90; el despacho a FCM/APNs y la política de tokens inválidos por respuesta del proveedor son T92). T89 solo toca MongoDB: no llama a AWS/SNS ni cambia `serverless.yml`, IAM ni infraestructura (la API Lambda no necesita permisos nuevos). Todas las rutas son autenticadas (JWT) y el usuario sale **solo** del JWT; `userId`/`id` del body se ignoran. Ninguna otra ruta depende del registro: usar la app no exige permiso push.

| Método | Ruta | Respuesta |
|---|---|---|
| PUT | `/push-devices` con `{ provider, platform, token }` | 200 `{ device: { id, provider, platform, tokenHint, registeredAt } }`, siempre 200 (alta o repetición) |
| DELETE | `/push-devices/:id` | 204 idempotente |
| POST | `/push-devices/revoke` con `{ provider, token }` | 204 idempotente |

- Combinaciones válidas: `fcm` + `android` y `apns` + `ios` (iOS usa APNs directo, T45); cualquier otra, proveedor/plataforma desconocidos o token inválido → 422 `ValidationError` con `fields`. Token: texto de 1 a 4096 caracteres ASCII visibles (`[\x21-\x7E]`), sin espacios ni control, con trim. Body no JSON → 400. `:id` que no es ObjectId → 422.
- `PUT` es un upsert por `(provider, token)`: si no existe lo crea; si es del mismo usuario actualiza `platform`, `updatedAt` y `lastRegisteredAt` conservando `id` y `createdAt`; si es de **otro** usuario lo reasigna al autenticado (el anterior lo pierde, sin aviso), de modo que un token nunca pertenece a dos cuentas tras un cambio de cuenta. La reasignación no cuenta contra el límite de quien la recibe y siempre se realiza (no crea un documento nuevo).
- Revocar solo borra si el `userId` coincide; un dispositivo inexistente, ajeno o ya revocado también responde 204 (no revela existencia). Se revoca también por body (no por path/query) para que el token no aparezca en la URL que registra el logger. No hay GET de listado.
- Límite provisorio de 10 dispositivos por usuario, aplicable solo a documentos **nuevos**: al registrar un token nuevo con 10 ya registrados se desaloja el dispositivo propio más antiguo (menor `lastRegisteredAt`, desempate por `_id`) en la misma transacción y se inserta el nuevo; no hay 409 por límite. Re-registrar un token propio y reasignar uno ajeno no desalojan nada. El límite es **blando**: una ráfaga de N registros simultáneos de tokens nuevos puede excederlo hasta N; el exceso se corrige en el siguiente registro por desalojo del más antiguo; afecta solo a la propia cuenta.
- `pushDevices` guarda `{ _id, userId: ObjectId, provider, platform, token, createdAt, updatedAt, lastRegisteredAt }`. El token se guarda crudo (hace falta para enviar) y **nunca** se devuelve (solo `tokenHint`: los últimos 4 caracteres; si es corto, oculto), ni se registra en logs ni aparece en errores; el cifrado en reposo del dato es de la infraestructura (Atlas). `/auth/logout` no revoca dispositivos: el cliente de T90 debe revocar antes de cerrar sesión.
- El caso de uso `removeInvalidPushDevices` (dominio) borra tokens por proveedor sin filtrar por usuario; lo consumirá T92 y **no** se expone por HTTP.
- Verificado con MongoDB efímero (`mongodb-memory-server`); no se probó con FCM/APNs/SNS, dispositivos ni Atlas reales.

## API de avisos (T91)

Los eventos de la app se guardan **con la operación que los origina**, como última escritura de su misma transacción MongoDB (con el bloqueo del Trip): si la operación no se guarda, o falla después, no queda evento; un evento nunca anuncia un cambio revertido ni depende del dispositivo. T91 no envía push (T92) y no cambia `serverless.yml` ni infraestructura.

**Persistencia.** `outboxEvents` es a la vez outbox (para T92) y bandeja personal (T91): **un documento por evento y destinatario**, `{ _id, tripId, eventKey, type, status: "pending", availableAt, createdAt, userId (destinatario), actorId (ObjectId o null), operationKey, payload }`. `eventKey = "{type}:{id de la operación}:{userId}"` y se escribe con `updateOne({ eventKey }, { $setOnInsert }, { upsert: true })` (nunca `insertOne`): repetir una clave no duplica ni aborta la transacción. Un aviso no se consume ni cambia por entregarse ni por leerse; la bandeja ignora `status`. Los reintentos de T87 de un post ya guardado y las ediciones sin cambios reales no emiten.

| `type` | Se emite cuando | Destinatarios | `payload` (solo IDs y fechas UTC, sin textos) |
|---|---|---|---|
| `post.created` | se guarda un post | integrantes actuales menos el autor | `postId`, `actorId`, `activityId` (o null) |
| `activity.created` | se crea una actividad (también la espontánea creada con o a partir de un post) | integrantes menos el autor | `activityId`, `actorId`, `scheduledAt`, `durationMinutes` |
| `activity.updated` | una edición cambia título, descripción, ubicación, inicio o duración | integrantes menos el editor y menos los desvinculados por esa edición | `activityId`, `actorId`, `changedFields` |
| `activity.participant_unlinked` | una edición de inicio/duración pasa a «Sin responder» a un participante «Voy» con conflicto | solo cada afectado (el editor si está afectado); los compatibles no lo reciben | `activityId`, `reason: "schedule_conflict"`, `changedFields`, `changedAt`, `newInterval { startsAt, durationMinutes, endsAt \| null }`, `incompatibleActivities [{ activityId, reason, scheduledAt, durationMinutes }]` (todas) |
| `member.joined` | ingresa un integrante nuevo (no si ya lo era) | integrantes menos quien ingresó | `memberId` (membresía), `userId` |
| `member.expelled` | se expulsa a un participante | solo el expulsado; sin actor ni datos del Trip | `tripId` |
| `comment.created` | se crea un comentario | integrantes menos el autor | `commentId`, `postId`, `actorId` |

No emiten: editar un post o un comentario, «Voy / No voy», likes, votos (retirados), eliminar una actividad, ni quien ya estaba «Sin responder» (con o sin marca) vuelve a recibir un aviso de desvinculación. Los destinatarios «integrantes menos el actor» se leen dentro de la transacción del Trip: una expulsión concurrente se serializa con la operación. `activity.updated` y los `activity.participant_unlinked` de una misma edición comparten un `operationId` y un único `changedAt`. `activityParticipations.decisionRequired` **no** se consume ni se modifica al emitir ni al leer: solo lo borra una respuesta explícita.

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/notifications?limit&cursor` | 200 `{ notifications: [{ id, type, tripId, actorId, payload, createdAt }], nextCursor }` |

- Autenticada (JWT) y **solo lectura**: el usuario sale únicamente del JWT (un `userId` en query o body se rechaza/ignora; parámetro desconocido o repetido → 422 `ValidationError` con `fields`). Sin token → 401. No marca avisos como leídos (no existe «leído»).
- Orden: `createdAt` descendente y `_id` descendente. `limit` entero de 1 a 60 (30 por defecto); `cursor` opaco como el de fotos (posición `createdAt`+`_id`); `limit` o `cursor` inválidos → 422 con el campo. `nextCursor` es `null` en la última página; un aviso nuevo no desplaza las páginas siguientes.
- Autorización en cada lectura: solo avisos propios de los Trips de los que el usuario es integrante **hoy**, más el aviso `member.expelled` de su propia expulsión (mientras exista el Trip). Quien sale o es expulsado deja de ver los demás avisos de ese Trip. La respuesta lleva IDs exactos y fechas; sin títulos, descripciones, textos de comentarios ni tokens.
- Al eliminar un Trip se borran sus documentos de `outboxEvents` (cascada). No hay TTL ni retención definida.
- `lambda.ts` ahora entrega a la ruta el `rawQueryString` de API Gateway (antes se descartaba: `limit` y `cursor` no llegaban a ninguna ruta con parámetros, incluida la lista de fotos). Solo `/notifications` y `/trips/:id/photos` leen la query; las demás rutas la ignoran porque `handleApiRequest` las matchea sobre el pathname.
- Verificado con MongoDB efímero (`mongodb-memory-server`); no se probó con Atlas, push real (T92), volumen del fan-out ni textos finales del cliente.

## Despacho de avisos push (T92)

Código del worker que entrega por push los eventos de `outboxEvents` (T91), **sin cablear ni desplegar** y sin SDK de SNS (ver `docs/infraestructura/servicios-pendientes.md`, «Estado de T92»).

- `src/events-lambda.ts`: `createEventsHandler` (SQS, lote de 1, `ReportBatchItemFailures`, tick exacto `{ kind: "events", stage }`, deadline interno 45 s, hasta 20 eventos por tick, logs solo de contadores), `createEventsRun` y `createEventsRuntimeLoader`. No exporta un `handler` productivo: la fábrica del cliente SNS real queda pendiente. `src/sqs-tick.ts` comparte `isTick`/`parseBody`/tipos SQS con `storage-deletion-lambda.ts`.
- `dispatchPushNotifications` (dominio): reclama cada evento con lease de 120 s, omite eventos de más de 24 h, de un Trip eliminado o de quien dejó de ser miembro (la expulsión solo se entrega a quien no es miembro), lista los dispositivos del usuario y envía a los que no figuran en `deliveredDeviceIds` (idempotencia por evento y dispositivo). Token inválido (`EndpointDisabled`) → se elimina una vez por proveedor y no se reintenta; el intento se cuenta al reclamar (`$inc` atómico en `claimNext`); fallo transitorio → release con backoff de 1 min a 6 h que NO suma otro intento, y `failed` al quinto, sin borrar; el corte por deadline devuelve el intento (`refundAttempt`); un evento cuyo worker muere repetidamente pasa a `failed` con `lastErrorCode: exhausted` sin enviar (`claim.attempts > 5`); rechazo permanente (`InvalidParameter`, `AuthorizationError`) → no se borra el token. Nunca crea ni borra avisos de la app.
- `adapters/mongodb/push-dispatch-repository.ts`: reclamo atómico con `findOneAndUpdate` sobre `{ status: "pending", availableAt <= now, sin lease vigente }`; toda escritura posterior filtra por `_id` y `leaseOwner` y devuelve `false` si se perdió el lease. `PushDeviceRepository.listForUser` devuelve los dispositivos con su token (no se expone por HTTP).
- `adapters/aws/sns-push-provider.ts`: `createSnsPushProvider({ client, applications })` con cliente estructural; `adapters/aws/events-config.ts`: lee `APP_ENV`, `MONGODB_SECRET_ARN` y `PUSH_APPLICATIONS_SECRET_ARN`.
- Mensaje (`buildPushMessage`): `data` solo con strings: `notificationId`, `type`, `tripId` e IDs del recurso (más `scheduledAt` y `durationMinutes` en el desvinculado); sin textos del usuario, tokens ni la lista de actividades incompatibles (el cliente la consulta en `GET /notifications`). Sin ningún tipo de voto o aprobación.
- Verificado con MongoDB efímero y un cliente SNS falso; no se probó FCM/APNs/SNS reales, el formato exacto de los mensajes SNS, los nombres de error del SDK, IAM, EventBridge/SQS/DLQ ni Atlas.

## Protección de la API (T102)

Rate limiting de Auth y límites de entrada, en `src/security/`. El estado del limitador es compartido (MongoDB, colección `rateLimits`), no de memoria de cada Lambda.

- Auth: `POST /auth/login` por IP (30 / 15 min) y por IP + email normalizado (`trim().toLowerCase()`, 5 / 15 min); `POST /auth/register` por IP (10 / h); `POST /auth/refresh` y `POST /auth/logout` comparten un contador por IP (60 / 15 min). Nunca se bloquea por email solo. Un login exitoso borra solo el contador IP + email, nunca el de IP. Umbrales provisorios: el PRD no los define.
- Exceso: `429` `{ "error": { "code": "TooManyRequests", "message": "Too many attempts. Try again later." } }` con `Retry-After` (segundos). No indica qué clave ni cuántos intentos, y se responde antes de bcrypt o de leer usuarios.
- Claves sin datos personales: HMAC-SHA256 con el secreto JWT ya cargado (`rate-limit:v1:...`), truncado a 32 hex. En Mongo solo hay `{ _id, bucket, keyHash, count, expiresAt }`. IP: `requestContext.http.sourceIp` en Lambda y `socket.remoteAddress` en local; `X-Forwarded-For` se ignora; sin IP se usa «unknown».
- Ventana fija atómica (`findOneAndUpdate` con upsert y `$inc`, un reintento ante clave duplicada); el `_id` incluye el inicio de la ventana, así que la corrección no depende del TTL. El índice TTL `expiresAt_ttl` lo crea la migración aditiva `0009-rate-limit-ttl-index` (`pending-contract-migrations.ts`), que NO se ejecutó sobre ninguna base real.
- Falla del almacén: `AUTH_RATE_LIMIT_FAIL_MODE=open` (default, deja pasar y registra solo el nombre del error) o `closed` (rechaza con 429).
- Cuerpos: `MAX_BODY_BYTES` (256 KiB por defecto, tope duro 1 MiB) y `MAX_BODY_BYTES_AUTH` (16 KiB; rige para `/auth/*`, `/push-devices*` y `/trips/join`). Excederlos responde `413` `PayloadTooLarge` sin parsear ni invocar el handler. En Lambda se mide el largo codificado antes de decodificar base64 y los bytes decodificados; base64 inválido es `400`. En local el lector corta al pasar el tope o con un `Content-Length` mayor.
- `Content-Type`: `415` solo si el header existe y no es `application/json` (con o sin charset); si falta, el comportamiento no cambia.
- `x-request-id`: cabecera de toda respuesta (en Lambda es `requestContext.requestId`; en local un UUID). Lambda emite los mismos eventos `request`/`response`/`error` que el servidor local (desactivables con `API_VERBOSE=false`). `redact.ts` centraliza la redacción (`redactForLog`, `redactPath`, `sanitizeErrorForLog`: nombre y frames, nunca el `message`).
- Configuración (valores inválidos o fuera de rango abortan el arranque sin repetir el valor): `AUTH_RATE_LIMIT_ENABLED`, `AUTH_RATE_LIMIT_FAIL_MODE`, `AUTH_RATE_LIMIT_{LOGIN_IP,LOGIN_ACCOUNT,REGISTER_IP,REFRESH_IP}_{MAX,WINDOW_SECONDS}`. El servidor local lo activa por defecto; la Lambda real solo con `AUTH_RATE_LIMIT_ENABLED=true` (por defecto apagado hasta aplicar la migración 0009). `serverless.yml` no se modificó: las variables no están declaradas por stage.
- Verificado con MongoDB efímero (`mongodb-memory-server`), servidor HTTP local y eventos Lambda simulados. No se probó API Gateway ni Lambda reales (techos de payload y headers, `sourceIp` real), Atlas (monitor TTL, upserts concurrentes), la migración 0009 contra Atlas ni el throttling por stage.

## API de participación (T38)

Las rutas requieren `Authorization: Bearer <accessToken>` y membresía actual del Trip, incluso si es público. Admins y participantes pueden consultar y actualizar únicamente su propia participación; `userId` se obtiene del JWT.

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/trips/:tripId/activities/:activityId/participation` | 200 `{ participation }`, o `{ participation: null }` si no existe respuesta |
| PUT | `/trips/:tripId/activities/:activityId/participation` | 200 `{ participation }`, tanto al registrar como al reemplazar el estado |

PUT requiere un body como `{ "status": "going" }`. Los únicos estados que se pueden enviar son `going` y `not_going`; `pending` es solo un estado inicial o generado por el sistema, se conserva en las lecturas y enviarlo responde 422 sin cambios. La respuesta contiene `id`, `tripId`, `activityId`, `userId`, `status` y `updatedAt` en ISO UTC con milisegundos. La API controla identidad, referencias y fecha; los campos protegidos enviados en el body se ignoran. Repetir PUT conserva el ID y un único registro, y actualiza la fecha del cambio.

No se crean participaciones automáticamente: GET sin registro devuelve `null` y no escribe. Guardar `going` o `not_going` limpia atómicamente `decisionRequired` (la marca la escribirá T53; `pending` rechazado no la modifica). Cambiar la respuesta propia conserva íntegramente las respuestas de otros miembros y no modifica la actividad ni los votos históricos.

Sin JWT válido responde 401. Usuarios externos o expulsados y Trips inaccesibles responden 404 `TripNotFoundError`; una actividad ausente o de otro Trip responde 404 `ActivityNotFoundError`. Identificadores malformados, JSON inválido o un body que no sea objeto responden 400. Un estado ausente, `null`, `pending` o distinto de `going`/`not_going` responde 422 `ValidationError`, con detalles en `error.fields`. Una dependencia sin configurar responde 503; los fallos inesperados responden 500 genérico.

### Confirmación de conflictos de agenda (T51)

`going` revisa la agenda del usuario en el Trip (política de T50). Sin conflictos guarda 200 `{ participation }`. Con conflictos y sin confirmación válida responde 409 sin escribir:

```json
{ "error": { "code": "ParticipationConflictError", "message": "...",
  "conflicts": [{ "activityId": "...", "reason": "overlap | same_start", "scheduledAt": "ISO UTC", "durationMinutes": 60 }],
  "activity": { "scheduledAt": "ISO UTC", "durationMinutes": 60 } } }
```

Para confirmar se repite el PUT con `{ "status": "going", "confirmedConflicts": [{ "activityId", "scheduledAt", "durationMinutes" }], "confirmedActivity": { "scheduledAt", "durationMinutes" } }` (los valores devueltos en el 409). El servidor revalida dentro de la transacción del Trip: si los conflictos o el horario de la actividad elegida cambiaron, responde 409 de nuevo con el snapshot nuevo y no escribe. Si coinciden, guarda `not_going` en cada actividad incompatible propia y `going` en la elegida en la misma transacción. `confirmedConflicts` o `confirmedActivity` malformados responden 422 `ValidationError`. Nunca se modifican participaciones de otros usuarios.

La colección `activityParticipations` conserva el índice único `{ activityId: 1, userId: 1 }` de T04. Los identificadores y referencias se almacenan como BSON `ObjectId`, y `updatedAt` como BSON `Date`; `tripId` coincide con el de la actividad. PUT autoriza y realiza el upsert en una misma transacción coordinada por Trip con eliminación de actividades, baja del Trip y expulsión de miembros. Los conflictos de escritura se reintentan mediante el driver y cualquier fallo aborta los cambios. Una eliminación no deja participaciones huérfanas; si la expulsión se confirma primero, la escritura se rechaza por falta de membresía. GET usa un snapshot sin modificar datos. T38 no requiere una nueva migración.

## Retiro de votación (T47)

El contrato activo de Trips e itinerarios omite `votingEnabled`; el de actividades omite `status`. PATCH `/trips/:tripId/config` permite únicamente `visibility` y `expenseMode`: una solicitud con solo `votingEnabled` responde 400; combinado con campos válidos, el campo retirado se ignora.

GET/PUT `/trips/:tripId/activities/:activityId/vote` ya no tienen rutas ni servicios activos. Con JWT válido responden 404 `NotFound` tanto en Lambda como en el servidor local, sin crear, reemplazar o consultar votos. Los adaptadores de entrada conservan su validación de JWT.

`activityVotes`, su índice único y sus documentos se conservan como histórico, también al eliminar una actividad o un Trip; pueden conservar referencias a recursos eliminados y quedan fuera del contrato activo. Los campos almacenados `trips.votingEnabled` y `activities.status` se ignoran en lecturas, se conservan en ediciones y no se incorporan a documentos nuevos. No se reescriben migraciones aplicadas ni se ejecuta una limpieza de datos.

El cliente acepta los DTO nuevos sin inventar estados de aprobación ni realizar requests de voto. Los tipos y controles legados del cliente se retiraron por completo en T59.

## Consulta de itinerario (T33)

Los POST/PATCH de transporte urbano requieren `details.steps[].estimatedAt` como ISO UTC completo con milisegundos (por ejemplo, `2026-10-04T00:30:00.345Z`). Se almacena como BSON `Date` y se serializa igual en GET de transportes e itinerario. Cada instante debe estar entre salida y llegada, en orden no decreciente. Un PATCH de los límites también revalida los tramos; un rechazo responde 422 con `error.fields` y aborta la transacción.

Los GET siguen leyendo tramos históricos con `estimatedTime: "HH:mm"`, sin convertirlos ni escribir durante la lectura. Editar ese transporte requiere reenviar todos sus tramos con `estimatedAt`, después de reconfirmar sus horas locales en la app. No hay migración automática: los documentos anteriores conservan sus datos y referencias hasta esa confirmación. Actualizar el cliente junto con la API, ya que los clientes anteriores enviaban horas sin fecha.

`GET /trips/:tripId/itinerary` requiere `Authorization: Bearer <accessToken>` y membresía del Trip, tanto para admin como para participante. Un Trip público también requiere membresía para acceder a este contenido.

HTTP 200 devuelve `{ itinerary }`, con configuración, destinos, días, transportes, actividades y posts en una sola respuesta. La lectura usa un snapshot MongoDB consistente y no regenera días ni modifica datos. Un Trip sin configurar devuelve listas vacías de días, transportes, actividades y posts.

| Campo | Contrato |
|---|---|
| `tripId`, `expenseMode` | Identidad y configuración del Trip. |
| `destinations` | Destinos ordenados por `order`, con sus nombres. |
| `days` | Franjas persistidas ordenadas por `order`, sin fusionar fechas coincidentes. Incluyen `items` y `expenseSummary`. |
| `days[].items` | Referencias `{ kind: "transport" \| "activity" \| "post", id, at }` ordenadas por instante; empate por tipo (transporte, actividad, post) y después por ID. |
| `activities` | Campos del PRD, ordenados por `scheduledAt` e ID. `postIds` referencia sus publicaciones directas y descendientes (toda la cadena, publicada el día que sea), por `createdAt` e ID. |
| `transports` | Campos existentes, ordenados por `departureAt` e ID. `postIds` referencia todas las publicaciones vinculadas, directas y descendientes, por `createdAt` e ID; no hay endpoint de detalle de transporte: sus recuerdos se leen aquí. |
| `posts` | Publicaciones con un día proyectable, una sola vez, por `createdAt` e ID. T56: `dayId` se calcula por contexto (nunca el guardado): actividad efectiva, o la franja de publicación (`startsAt <= createdAt < endsAt`; sin franja contenedora, la de menor `order` con la misma fecha UTC), o la franja de tránsito del transporte. `context` (aditivo) trae `parentPostId` real, `rootPostId`, `rootActivityId`, `rootTransportId` y `placement` (`activity`, `transport`, `independent`). `parentPostId` queda `null` si el padre no está en `posts` (el real va en `context`). Conserva los vínculos independientes y `expense`. |
| `unplacedPosts` | Publicaciones sin día proyectable (publicadas fuera de las fechas existentes o en un Trip sin itinerario), con el mismo shape, `dayId: null` y su `expense`. Ninguna publicación se pierde; no entran en `postIds`, `items` ni `expenseSummary`. Compatibilidad transitoria: el cliente actual las ignora hasta T63.

Las referencias de `items` y `postIds` se resuelven contra las listas de la misma respuesta, sin requests por día o contexto. Un transporte se referencia en cada franja de tránsito correspondiente a su destino y dirección; `at` es el inicio del transporte dentro de esa franja. Las actividades usan `scheduledAt` y los posts independientes usan `createdAt`.

Desde T55 un post con `parentPostId` no tiene `activityId` ni `transportId` propios (los registros previos con ambos se leen igual). Se referencia desde ambos contextos, incluso si su `dayId` difiere del día del contexto; no se reasigna ni duplica. Los posts sin actividad ni transporte efectivos (propios o de la raíz de su cadena) aparecen como items de su franja de publicación, con `at = createdAt`. `parentPostId` se resuelve localmente contra `posts`, sin expansión recursiva. En un transporte de varios días, la app puede filtrar sus `postIds` por el `dayId` original de cada publicación.

Los gastos se suman una sola vez: en el día de la actividad efectiva o, sin actividad, en la franja de publicación; sin franja, el post va a `unplacedPosts` y su gasto solo viaja en `unplacedPosts[].expense`. Un post de transporte sin actividad publicado fuera de toda franja se queda en `posts[]` con el `dayId` de la franja de tránsito y su `expense`, pero no entra en `unplacedPosts` ni en ningún `expenseSummary` (el gasto no se atribuye a un día sin franja de publicación ni actividad, PRD 3.6). El servidor entrega instantes UTC y contexto sin convertir a zona local (la agrupación local es del cliente): `expenseSummary` contiene `totalAmount` y `expenseCount`, ambos cero cuando no hay gastos. Esto aplica a `register` y `balance`; no incluye deudas ni el costo estimado del transporte. Los datos y vínculos ajenos al Trip no se incorporan: referencias que no resuelven dentro del agregado se devuelven como `null`, y registros sin día/destino del Trip se omiten. No se reparan documentos durante el GET.

IDs: texto hexadecimal ObjectId. Fechas: ISO UTC con milisegundos; `endsAt` puede ser `null`. `date` identifica la franja canónica UTC, no reemplaza sus límites. La app proyecta los instantes a la zona local sin modificar IDs ni asociaciones. Las franjas son `transit_out`, `activity` y `transit_return`; el tipo `arrival` fue retirado y los registros históricos con ese tipo no se exponen ni se borran.

Ejemplo completo con un post vinculado a actividad, transporte y otro post; su gasto se cuenta una vez:

```json
{
  "itinerary": {
    "tripId": "000000000000000000000001",
    "expenseMode": "register",
    "destinations": [{
      "id": "000000000000000000000003", "tripId": "000000000000000000000001",
      "name": "Córdoba", "order": 1, "createdAt": "2026-09-20T12:00:00.000Z"
    }],
    "days": [{
      "id": "000000000000000000000008", "tripId": "000000000000000000000001",
      "destinationId": "000000000000000000000003", "date": "2026-09-25T00:00:00.000Z",
      "type": "transit_out", "startsAt": "2026-09-25T08:00:00.123Z", "endsAt": "2026-09-25T10:00:00.456Z", "order": 1,
      "items": [{ "kind": "transport", "id": "000000000000000000000005", "at": "2026-09-25T08:00:00.123Z" }],
      "expenseSummary": { "totalAmount": 0, "expenseCount": 0 }
    }, {
      "id": "000000000000000000000004", "tripId": "000000000000000000000001",
      "destinationId": "000000000000000000000003", "date": "2026-09-25T00:00:00.000Z",
      "type": "activity", "startsAt": "2026-09-25T10:00:00.456Z", "endsAt": "2026-09-25T18:00:00.789Z", "order": 2,
      "items": [
        { "kind": "activity", "id": "000000000000000000000006", "at": "2026-09-25T12:00:00.000Z" },
        { "kind": "post", "id": "00000000000000000000000a", "at": "2026-09-25T13:00:00.000Z" }
      ],
      "expenseSummary": { "totalAmount": 42.5, "expenseCount": 1 }
    }, {
      "id": "00000000000000000000000c", "tripId": "000000000000000000000001",
      "destinationId": "000000000000000000000003", "date": "2026-09-25T00:00:00.000Z",
      "type": "transit_return", "startsAt": "2026-09-25T18:00:00.789Z", "endsAt": "2026-09-25T20:00:00.123Z", "order": 3,
      "items": [{ "kind": "transport", "id": "00000000000000000000000b", "at": "2026-09-25T18:00:00.789Z" }],
      "expenseSummary": { "totalAmount": 0, "expenseCount": 0 }
    }],
    "transports": [{
      "id": "000000000000000000000005", "tripId": "000000000000000000000001", "destinationId": "000000000000000000000003",
      "direction": "outbound", "type": "car", "departurePlace": "Origen", "arrivalPlace": "Córdoba",
      "departureAt": "2026-09-25T08:00:00.123Z", "arrivalAt": "2026-09-25T10:00:00.456Z",
      "costPerPerson": null, "details": {}, "postIds": ["000000000000000000000007"]
    }, {
      "id": "00000000000000000000000b", "tripId": "000000000000000000000001", "destinationId": "000000000000000000000003",
      "direction": "return", "type": "car", "departurePlace": "Córdoba", "arrivalPlace": "Origen",
      "departureAt": "2026-09-25T18:00:00.789Z", "arrivalAt": "2026-09-25T20:00:00.123Z",
      "costPerPerson": null, "details": {}, "postIds": []
    }],
    "activities": [{
      "id": "000000000000000000000006", "tripId": "000000000000000000000001", "dayId": "000000000000000000000004",
      "title": "Paseo", "description": null, "scheduledAt": "2026-09-25T12:00:00.000Z", "mapsUrl": null,
      "createdBy": "000000000000000000000002", "createdAt": "2026-09-25T11:00:00.000Z",
      "postIds": ["000000000000000000000007"]
    }],
    "posts": [{
      "id": "00000000000000000000000a", "tripId": "000000000000000000000001", "dayId": "000000000000000000000004",
      "authorId": "000000000000000000000002", "description": "Llegamos", "mapsUrl": null,
      "activityId": null, "transportId": null, "parentPostId": null, "createdAt": "2026-09-25T13:00:00.000Z", "expense": null
    }, {
      "id": "000000000000000000000007", "tripId": "000000000000000000000001", "dayId": "000000000000000000000004",
      "authorId": "000000000000000000000002", "description": "Registro del paseo", "mapsUrl": null,
      "activityId": "000000000000000000000006", "transportId": "000000000000000000000005",
      "parentPostId": "00000000000000000000000a", "createdAt": "2026-10-03T12:00:00.789Z",
      "expense": {
        "id": "000000000000000000000009", "tripId": "000000000000000000000001", "postId": "000000000000000000000007",
        "totalAmount": 42.5, "breakdown": null, "paidBy": null, "createdAt": "2026-10-03T12:00:00.789Z"
      }
    }]
  }
}
```

Errores: HTTP 401 sin JWT válido; 400 con `tripId` inválido; 404 con código `TripNotFoundError` para Trip inexistente o usuario ajeno; 500 ante fallo interno; 503 si el servicio no está configurado. La forma de los errores sigue el contrato existente de la API.

## Verificación de email

`GET /auth/verify/:token` valida un JWT firmado para el propósito `email-verification`, su vencimiento y la existencia del usuario. Si es válido, devuelve un HTML que intenta abrir `com.travellier.app://verify/:token` y muestra instrucciones si la app no responde. Los enlaces inválidos devuelven una página de error sin reflejar el token.

El adaptador de autenticación puede crear estos tokens con una fecha de vencimiento provista por el llamador. El envío de emails y la confirmación persistida del email quedan pendientes de definir el proveedor y el flujo de producto.
