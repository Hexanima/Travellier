# Travellier

Aplicación mobile para organizar viajes grupales. Centraliza el transporte, el itinerario, las actividades, los posts con fotos y gastos, y la participación de cada integrante.

El producto está en etapa de planificación. El modelo funcional completo está en [docs/PRD.md](docs/PRD.md).

## Alcance inicial

- iOS y Android desde un único codebase con React y Capacitor.
- Trips privados por invitación o públicos a los que se puede unir cualquier usuario.
- Transporte de ida/vuelta y viajes con múltiples destinos.
- Itinerario generado a partir de los horarios exactos de transporte.
- Actividades con participación individual y votación opcional por Trip.
- Posts espontáneos o vinculados a actividades, otros posts o transportes.
- Fotos en S3, comentarios y likes.
- Gastos dentro de posts, con modos de registro y balance.
- Notificaciones push y exportación al calendario nativo.

## Decisiones técnicas

| Área | Decisión |
| --- | --- |
| Cliente | React + Capacitor, solo mobile |
| Backend | AWS Lambda + API Gateway, Node.js |
| Datos | MongoDB Atlas |
| Autenticación | JWT y refresh tokens gestionados por Lambda |
| Fotos | AWS S3 con presigned URLs de carga directa |
| Deep links | Custom URL scheme manejado por Capacitor |

## Estructura actual

El repositorio parte de un template de arquitectura limpia y conserva sus límites mientras se desarrolla el producto:

- `domain`: entidades, casos de uso, contratos de resultado y puertos sin dependencias de frameworks.
- `apps/api`: adaptador HTTP; evolucionará hacia las funciones Lambda de la API.
- `apps/web`: cliente React; evolucionará hacia el cliente mobile empaquetado con Capacitor.
- `docs/PRD.md`: especificación funcional y modelo de datos.
- `AGENTS.md`: contexto e instrucciones para agentes que trabajen en el repositorio.

## Comandos

- `yarn test`
- `yarn build`
- `yarn workspace api dev`
- `yarn workspace web dev`
