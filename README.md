# Travellier

Aplicación mobile para organizar viajes grupales. Centraliza el transporte, el itinerario, las actividades, los posts con fotos y gastos, y la participación de cada integrante.

El producto está en etapa de planificación. El modelo funcional completo está en [docs/versiones/v1/PRD.md](docs/versiones/v1/PRD.md).

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
- `apps/web`: cliente React mobile empaquetable con Capacitor para iOS y Android.
- `docs/versiones/v1/PRD.md`: especificación funcional y modelo de datos.
- `AGENTS.md`: contexto e instrucciones para agentes que trabajen en el repositorio.

## Comandos

- `corepack yarn lint`
- `corepack yarn typecheck`
- `corepack yarn test`
- `corepack yarn build`
- `corepack yarn workspace api dev`
- `corepack yarn workspace web dev`
- `corepack yarn workspace web cap:sync`
- `corepack yarn workspace web cap:build:android`
- `corepack yarn workspace web cap:build:ios` (macOS con Xcode)

Para compilar Android, `cap:build:android` usa automáticamente un JDK 17 a 21. En Windows también detecta el JBR de Android Studio. Si no está disponible, configurá `ANDROID_JAVA_HOME` o `JAVA_HOME`; el JDK 25 no es compatible con la versión de Gradle incluida en el proyecto.

El comando genera el APK debug en `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`; un release firmado requiere las credenciales de firma correspondientes.

## Infraestructura AWS

La API se despliega con Serverless Framework mediante [serverless.yml](serverless.yml). Los stages soportados son `dev` y `prod`; cada uno crea su propia API, Lambda y secretos de Secrets Manager.

Los comandos de Serverless requieren una sesión iniciada con `serverless login` o un `SERVERLESS_ACCESS_KEY`; el workflow de calidad no requiere esas credenciales.

Cada stack crea su propio bucket privado de fotos. Las escrituras y lecturas son exclusivamente mediante URLs presignadas emitidas por la API tras autorizar al miembro; el cliente no recibe credenciales AWS. Los objetos se cargan bajo `trips/{tripId}/posts/{postId}/...`; los endpoints de firma se incorporan en T48.

Los secretos pertenecen al ciclo de vida de cada stage: `serverless remove --stage <stage>` los elimina. CloudFormation asigna un nombre físico único en cada despliegue, por lo que un redeploy no depende de que la eliminación anterior haya terminado.

Los comandos `infrastructure:deploy:*` requieren `MONGODB_URI` y `MONGODB_DATABASE_NAME` en el entorno de despliegue, inyectados desde secretos del entorno de CI correspondientes a `dev` y `prod`. Después de desplegar el stack, el comando toma el output `MongoConfigurationSecretArn`, crea la primera versión si no existe `AWSCURRENT` y sólo escribe otra cuando la configuración cambió. La URI nunca se incluye en el template de CloudFormation, los parámetros de Serverless ni argumentos de CLI:

```json
{"uri":"mongodb+srv://...","databaseName":"travellier"}
```

La identidad de despliegue necesita `cloudformation:DescribeStacks`, `secretsmanager:GetSecretValue` y `secretsmanager:PutSecretValue` sobre los recursos del stage, además de los permisos habituales de Serverless. La Lambda mantiene solamente `secretsmanager:GetSecretValue` sobre los secretos del stack.

El secreto JWT se genera automáticamente. La conectividad de MongoDB Atlas debe habilitarse para la red desde la que corra la Lambda.

- `corepack yarn infrastructure:print:dev`
- `corepack yarn infrastructure:print:prod`
- `corepack yarn infrastructure:package:dev`
- `corepack yarn infrastructure:package:prod`
- `corepack yarn infrastructure:deploy:dev`
- `corepack yarn infrastructure:deploy:prod`
