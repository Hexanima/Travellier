# Travellier

Aplicación mobile para organizar viajes grupales. Centraliza el transporte, el itinerario, las actividades, los posts con fotos y gastos, y la participación de cada integrante.

El [PRD v1](docs/versiones/v1/PRD.md) y el [diseño azul navegable](design/prototype/README.md) quedaron aprobados y fijados como referencia de implementación el 2026-10-11. Los cambios requieren solicitud o aprobación explícita del usuario; el [PRD original](docs/versiones/v1/PRD-original.md) se conserva sin cambios para comparar. La aprobación no actualiza automáticamente las tareas ni acredita implementación.

## Alcance inicial

- iOS y Android desde un único codebase con React y Capacitor.
- Trips privados por invitación o públicos a los que se puede unir cualquier usuario.
- Transporte de ida/vuelta y viajes con múltiples destinos.
- Itinerario generado a partir de los horarios exactos de transporte.
- Actividades con participación individual, planes simultáneos y agenda personal sin superposiciones.
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
- `design/prototype`: [prototipo visual navegable](design/prototype/README.md), independiente de la aplicación; sus archivos para Live Server están en `design/prototype/public`.
- `docs/versiones/v1/PRD.md`: especificación funcional y modelo de datos aprobados; `PRD-original.md` conserva el documento inicial.
- `AGENTS.md`: contexto e instrucciones para agentes que trabajen en el repositorio.

## Comandos

- `corepack yarn lint`
- `corepack yarn typecheck`
- `corepack yarn test`
- `corepack yarn test:integration`
- `corepack yarn build`
- `corepack yarn workspace api dev`
- `corepack yarn workspace web dev`
- `corepack yarn workspace web cap:sync`
- `corepack yarn workspace web cap:build:android`
- `corepack yarn workspace web cap:build:ios` (macOS con Xcode)
- `corepack yarn workspace web typecheck:integration`

Las pruebas de integración del cliente corren el cliente real contra el handler real de la API, con MongoDB en memoria, un solo worker y zona horaria fija; por eso viven fuera de `corepack yarn test`. En CI son el job `web-integration`.

La suite es independiente de la zona horaria del proceso: los fixtures siembran instantes UTC (el contrato del servidor) y los valores que la App muestra o interpreta en la zona del proceso —días de las fichas del itinerario, horarios de los formularios, inputs `datetime-local`— se derivan de cada instante con `test-integration/support/local-time.ts`. Para verificarlo, el job corre con una matriz de dos zonas (`UTC` y `America/Argentina/Buenos_Aires`) y `fail-fast: false`. `TZ` fija la zona de cada corrida por determinismo, no porque la suite requiera una zona en particular. Para un solo archivo:

```sh
TZ=UTC corepack yarn workspace web exec vitest run --config vitest.integration.config.ts test-integration/smoke.integration.test.tsx --maxWorkers=1
```

El smoke nativo de Android se corre en CI dentro del job `android-native` (`bash ../test/run-android-native-smoke.sh` desde `apps/web/android`, sobre un emulador desechable); el job espera `sys.boot_completed`, descarta los diálogos del sistema y reintenta una sola vez si el emulador falla.

Para compilar Android, `cap:build:android` usa un JDK 21, requerido por las fuentes Java de Capacitor 8. En Windows también detecta el JBR de Android Studio. Si no está disponible, configurá `ANDROID_JAVA_HOME` o `JAVA_HOME`; JDK 17 y 25 no son compatibles con este setup.

El comando genera el APK debug en `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`; un release firmado requiere las credenciales de firma correspondientes.

## Infraestructura AWS

Push y ejecución diferida de eventos/limpieza se configuran en [Servicios pendientes — T45](docs/infraestructura/servicios-pendientes.md), con secretos por entorno. Las funciones `events` y `storage-deletion` (con SNS y permisos mínimos) ya están definidas en `serverless.yml` (T142), pero sus reglas EventBridge siguen desactivadas hasta pasar `--param=eventsConsumerArn` / `--param=storageDeletionConsumerArn` en un segundo despliegue autorizado; frecuencias en los parámetros `eventsScheduleExpression` y `storageDeletionScheduleExpression`. El wrapper de despliegue requiere también la configuración FCM/APNs allí documentada. La configuración local no acredita despliegue ni entrega real.

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
