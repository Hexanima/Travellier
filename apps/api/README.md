# api

Node HTTP API for the Clean Architecture template.

The `/health` endpoint composes a response from the domain use case exported by `app-domain`.

## Commands

- `yarn workspace api dev`
- `yarn workspace api test --run`
- `yarn workspace api build`
- `yarn workspace api start`

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

`S3_BUCKET_NAME` y `AWS_REGION` son opcionales para probar avatares y requieren credenciales AWS disponibles para el SDK. Dejarlas sin configurar permite probar autenticación, Trips, miembros, destinos, transportes e itinerario sin AWS.

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

PATCH permite únicamente `title`, `dayId`, `scheduledAt`, `description` y `mapsUrl`. Conserva campos omitidos; `null` limpia los opcionales y se rechaza en fecha/hora o día. Cambiar el día requiere que el horario resultante sea válido en la nueva franja. La API controla ID, Trip, autoría, `createdAt` y estado: estos campos del body no alteran el registro. POST deriva `confirmed` con votación desactivada y `proposed` con votación habilitada. PATCH conserva el estado; las transiciones de votación pertenecen a T40.

Sin JWT válido responde 401; usuarios externos y Trips inaccesibles responden 404. Una actividad ausente o de otro Trip devuelve 404 `ActivityNotFoundError`. JSON/IDs de ruta malformados y PATCH sin campos editables devuelven 400. Los errores de campos y horarios devuelven 422 `ValidationError`, con detalles en `error.fields`.

Las mutaciones leen membresía, configuración y días dentro de la misma transacción, coordinada por Trip con transportes y bajas. La expulsión de participantes revoca la membresía dentro de una transacción con la misma coordinación: una mutación de actividad confirma antes de la expulsión o, si la expulsión se confirma primero, se rechaza por falta de membresía. Un fallo revierte todas las escrituras. DELETE elimina actividad, votos y participaciones y desvincula sus posts con `activityId: null`; conserva sus demás datos y relaciones, fotos, gastos, likes y comentarios. GET usa un snapshot sin modificar datos. La consulta agregada del itinerario refleja los cambios en su siguiente lectura.

## API de participación (T38)

Las rutas requieren `Authorization: Bearer <accessToken>` y membresía actual del Trip, incluso si es público. Admins y participantes pueden consultar y actualizar únicamente su propia participación; `userId` se obtiene del JWT.

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/trips/:tripId/activities/:activityId/participation` | 200 `{ participation }`, o `{ participation: null }` si no existe respuesta |
| PUT | `/trips/:tripId/activities/:activityId/participation` | 200 `{ participation }`, tanto al registrar como al reemplazar el estado |

PUT requiere un body como `{ "status": "going" }`. Los únicos estados válidos son `going`, `not_going` y `pending`. La respuesta contiene `id`, `tripId`, `activityId`, `userId`, `status` y `updatedAt` en ISO UTC con milisegundos. La API controla identidad, referencias y fecha; los campos protegidos enviados en el body se ignoran. Repetir PUT conserva el ID y un único registro, y actualiza la fecha del cambio.

No se crean participaciones automáticamente: GET sin registro devuelve `null` y no escribe. `pending` se puede registrar explícitamente con PUT. Cambiar la respuesta propia conserva íntegramente las respuestas de otros miembros y no modifica el estado de la actividad ni sus votos.

Sin JWT válido responde 401. Usuarios externos o expulsados y Trips inaccesibles responden 404 `TripNotFoundError`; una actividad ausente o de otro Trip responde 404 `ActivityNotFoundError`. Identificadores malformados, JSON inválido o un body que no sea objeto responden 400. Un estado ausente, `null` o distinto de los tres admitidos responde 422 `ValidationError`, con detalles en `error.fields`. Una dependencia sin configurar responde 503; los fallos inesperados responden 500 genérico.

La colección `activityParticipations` conserva el índice único `{ activityId: 1, userId: 1 }` de T04. Los identificadores y referencias se almacenan como BSON `ObjectId`, y `updatedAt` como BSON `Date`; `tripId` coincide con el de la actividad. PUT autoriza y realiza el upsert en una misma transacción coordinada por Trip con eliminación de actividades, baja del Trip y expulsión de miembros. Los conflictos de escritura se reintentan mediante el driver y cualquier fallo aborta los cambios. Una eliminación no deja participaciones huérfanas; si la expulsión se confirma primero, la escritura se rechaza por falta de membresía. GET usa un snapshot sin modificar datos. T38 no requiere una nueva migración.

## Consulta de itinerario (T33)

Los POST/PATCH de transporte urbano requieren `details.steps[].estimatedAt` como ISO UTC completo con milisegundos (por ejemplo, `2026-10-04T00:30:00.345Z`). Se almacena como BSON `Date` y se serializa igual en GET de transportes e itinerario. Cada instante debe estar entre salida y llegada, en orden no decreciente. Un PATCH de los límites también revalida los tramos; un rechazo responde 422 con `error.fields` y aborta la transacción.

Los GET siguen leyendo tramos históricos con `estimatedTime: "HH:mm"`, sin convertirlos ni escribir durante la lectura. Editar ese transporte requiere reenviar todos sus tramos con `estimatedAt`, después de reconfirmar sus horas locales en la app. No hay migración automática: los documentos anteriores conservan sus datos y referencias hasta esa confirmación. Actualizar el cliente junto con la API, ya que los clientes anteriores enviaban horas sin fecha.

`GET /trips/:tripId/itinerary` requiere `Authorization: Bearer <accessToken>` y membresía del Trip, tanto para admin como para participante. Un Trip público también requiere membresía para acceder a este contenido.

HTTP 200 devuelve `{ itinerary }`, con configuración, destinos, días, transportes, actividades y posts en una sola respuesta. La lectura usa un snapshot MongoDB consistente y no regenera días ni modifica datos. Un Trip sin configurar devuelve listas vacías de días, transportes, actividades y posts.

| Campo | Contrato |
|---|---|
| `tripId`, `expenseMode`, `votingEnabled` | Identidad y configuración del Trip. |
| `destinations` | Destinos ordenados por `order`, con sus nombres. |
| `days` | Franjas persistidas ordenadas por `order`, sin fusionar fechas coincidentes. Incluyen `items` y `expenseSummary`. |
| `days[].items` | Referencias `{ kind: "transport" \| "activity" \| "post", id, at }` ordenadas por instante; empate por tipo (transporte, actividad, post) y después por ID. |
| `activities` | Campos del PRD, ordenados por `scheduledAt` e ID. `postIds` referencia sus publicaciones, por `createdAt` e ID. |
| `transports` | Campos existentes, ordenados por `departureAt` e ID. `postIds` referencia publicaciones vinculadas, por `createdAt` e ID. |
| `posts` | Cada publicación aparece una sola vez, por `createdAt` e ID. Conserva `dayId`, los vínculos independientes y `expense` (`null` cuando no tiene gasto). |

Las referencias de `items` y `postIds` se resuelven contra las listas de la misma respuesta, sin requests por día o contexto. Un transporte se referencia en cada franja de tránsito correspondiente a su destino y dirección; `at` es el inicio del transporte dentro de esa franja. Las actividades usan `scheduledAt` y los posts independientes usan `createdAt`.

Un post puede tener `activityId`, `transportId` y `parentPostId` simultáneamente. Se referencia desde ambos contextos, incluso si su `dayId` difiere del día del contexto; no se reasigna ni duplica. Los posts sin actividad ni transporte aparecen como items de su propio día. `parentPostId` se resuelve localmente contra `posts`, sin expansión recursiva. En un transporte de varios días, la app puede filtrar sus `postIds` por el `dayId` original de cada publicación.

Los gastos se suman una sola vez en el día indicado por `post.dayId`: `expenseSummary` contiene `totalAmount` y `expenseCount`, ambos cero cuando no hay gastos. Esto aplica a `register` y `balance`; no incluye deudas ni el costo estimado del transporte. Los datos y vínculos ajenos al Trip no se incorporan: referencias que no resuelven dentro del agregado se devuelven como `null`, y registros sin día/destino del Trip se omiten. No se reparan documentos durante el GET.

IDs: texto hexadecimal ObjectId. Fechas: ISO UTC con milisegundos; `endsAt` puede ser `null`. `date` identifica la franja canónica UTC, no reemplaza sus límites. La app proyecta los instantes a la zona local sin modificar IDs ni asociaciones. `arrival` se conserva sin inferir un transporte asociado.

Ejemplo completo con un post vinculado a actividad, transporte y otro post; su gasto se cuenta una vez:

```json
{
  "itinerary": {
    "tripId": "000000000000000000000001",
    "expenseMode": "register",
    "votingEnabled": false,
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
      "status": "confirmed", "createdBy": "000000000000000000000002", "createdAt": "2026-09-25T11:00:00.000Z",
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
