# Revisión pendiente

Registro del proceso automático de tareas (`/avanzar-tareas`). Cada entrada indica tarea, fecha, motivo, qué falta y si bloquea la tarea. El usuario revisa y resuelve estos puntos; no se dan por resueltos sin su confirmación.

| Tarea | Fecha | Motivo | Qué falta | Bloquea |
| --- | --- | --- | --- | --- |
| T48 | 2026-11-08 | Decisiones adoptadas sin regla explícita del PRD: (1) el nombre ausente se representa como `name: null` en la API y en Mongo, igual que `avatarS3Key`; (2) `POST /auth/register` acepta `name` opcional (el cliente actual lo sigue enviando hasta T60): si viene debe ser string (si no, `InvalidRequest`) y vacío o solo espacios se guarda como `null`; (3) sin fallback ni exposición del email: `GET /trips/:id/members` devuelve `name: null` para integrantes sin nombre; (4) `updateAuthenticatedProfile` sigue rechazando nombre vacío (no se agrega borrar el nombre). | Confirmación del usuario de las cuatro decisiones. T60 debe adaptar los guards del cliente (`isAuthenticatedProfile`, `isMember`) a `name: null` y definir qué se muestra para un perfil o integrante sin nombre. | No |
