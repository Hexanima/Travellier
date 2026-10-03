# api

Node HTTP API for the Clean Architecture template.

The `/health` endpoint composes a response from the domain use case exported by `app-domain`.

## Commands

- `yarn workspace api dev`
- `yarn workspace api test --run`
- `yarn workspace api build`
- `yarn workspace api start`

## MongoDB

El adaptador de MongoDB usa estas variables de entorno:

- `MONGODB_URI`: URI de conexión de MongoDB Atlas.
- `MONGODB_DATABASE_NAME`: nombre de la base de datos de Travellier.
- `JWT_SECRET`: secreto para firmar access y refresh tokens durante el desarrollo local.

Para crear o actualizar el esquema versionado y sus índices:

```bash
MONGODB_URI=<uri> MONGODB_DATABASE_NAME=travellier yarn workspace api migrate:mongodb
```

El runner registra la migración aplicada en la colección técnica `_migrations`.

T32 agrega la migración `0003-unique-itinerary-identity`: conserva los índices existentes e impone unicidad de `(tripId, destinationId, date, type)` en `itineraryDays`. Ejecutar `yarn workspace api migrate:mongodb` con la configuración de la base antes de usar esta versión. La migración rechaza duplicados históricos sin borrar días ni referencias; requiere resolverlos explícitamente.

Los POST/PATCH de transportes y los cambios de orden de destinos regeneran el itinerario en una transacción MongoDB con coordinación por Trip. Un fallo aborta el cambio completo. Los cambios que invaliden actividades o eliminen días con actividades/posts responden HTTP 409 con código `ItineraryConflictError`. La consulta agregada del itinerario corresponde a T33.

## Verificación de email

`GET /auth/verify/:token` valida un JWT firmado para el propósito `email-verification`, su vencimiento y la existencia del usuario. Si es válido, devuelve un HTML que intenta abrir `com.travellier.app://verify/:token` y muestra instrucciones si la app no responde. Los enlaces inválidos devuelven una página de error sin reflejar el token.

El adaptador de autenticación puede crear estos tokens con una fecha de vencimiento provista por el llamador. El envío de emails y la confirmación persistida del email quedan pendientes de definir el proveedor y el flujo de producto.
