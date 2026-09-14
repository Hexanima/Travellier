# Contexto del proyecto: Travellier

## Fuente de verdad

- El producto de la primera versión está definido en `docs/versiones/v1/PRD.md`. Consultarlo antes de implementar o modificar comportamiento funcional.
- Si una decisión de implementación contradice el PRD o requiere una nueva regla de negocio, señalarlo y pedir definición antes de asumirla.
- El proyecto comienza desde un template; que un módulo actual sea mínimo no implica que sea una funcionalidad ya implementada.

## Producto

Travellier es una aplicación mobile para iOS y Android que permite a grupos organizar y documentar viajes.

- El cliente es React empaquetado con Capacitor. No hay plataforma web pública en alcance.
- El backend objetivo es AWS Lambda + API Gateway con Node.js.
- MongoDB Atlas almacena datos relacionales mediante colecciones y referencias.
- Las fotos se cargan directo a S3 mediante presigned URLs.
- La autenticación usa JWT y refresh tokens manejados por el backend.

## Arquitectura

- Respetar Clean Architecture: `domain` no depende de `apps/*`; las dependencias apuntan hacia el dominio.
- Mantener entidades, value objects, casos de uso, errores, resultados y puertos en `domain`.
- Mantener los detalles HTTP, AWS, MongoDB, S3 y Capacitor en adaptadores de `apps/*`.
- Usar TypeScript y el contrato discriminado `Result` ya presente en el template para resultados de dominio.

## Reglas funcionales clave

- Un Trip agrupa integrantes, destinos, transportes, itinerario, actividades, posts y gastos.
- Las fechas de un Trip no se cargan manualmente: se derivan de `arrivalAt` y `departureAt` de los transportes. `itineraryDays` es una proyección visual del calendario.
- Un día puede incluir tránsito y actividad. Las actividades se habilitan desde la llegada y hasta la salida del destino.
- Un Trip puede tener destinos secuenciales ordenados.
- La participación en actividades es individual; el estado de una persona no determina si el resto realizó la actividad.
- La votación de actividades es configurable por Trip. Con votación desactivada, una actividad se crea confirmada.
- Un post puede ser espontáneo o vincularse, de forma independiente y también después de creado, a una actividad, otro post y/o transporte.
- Fotos, comentarios, likes de posts y likes de comentarios son entidades separadas.
- Los gastos pertenecen a posts. Cada Trip usa modo `register` o `balance`.
- Los roles del Trip son `admin` y `participant`; ambos pueden crear y editar actividades, posts y comentarios. Solo admin puede expulsar integrantes.

## Alcance

- En scope: notificaciones push e integración con calendario nativo.
- Fuera del alcance inicial: offline, chat grupal, templates de viaje y exportación de resumen en PDF.

## Convenciones de datos

- Usar `ObjectId` de MongoDB para identificadores y referencias entre colecciones.
- Preservar las colecciones y los índices definidos en el PRD, en particular los índices compuestos únicos para membresías, participaciones, votos y likes.
- Los campos de relación desnormalizados por `tripId` existen para consultas eficientes y deben mantenerse consistentes.
