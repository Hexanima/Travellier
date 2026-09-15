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
- `MONGODB_DATABASE`: nombre de la base de datos de Travellier.

Para crear o actualizar el esquema versionado y sus índices:

```bash
MONGODB_URI=<uri> MONGODB_DATABASE=travellier yarn workspace api migrate:mongodb
```

El runner registra la migración aplicada en la colección técnica `_migrations`.
