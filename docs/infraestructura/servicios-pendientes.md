# Servicios pendientes — T45

Extensión de [AWS/S3 existentes](../../README.md#infraestructura-aws). No reemplaza el bucket, MongoDB, JWT ni la API. El producto sigue definido por el [PRD vigente](../versiones/v1/PRD.md).

## Proveedor y aislamiento

SNS entrega a Android mediante FCM **HTTP v1**, con `Platform: GCM` en la API de SNS, y a iOS directamente mediante APNs con autenticación por token. No se utiliza la server key de FCM legacy.

| Configuración | dev | prod |
| --- | --- | --- |
| Stack | `travellier-api-dev` | `travellier-api-prod` |
| Aplicación SNS Android | `travellier-dev-android` | `travellier-prod-android` |
| Aplicación SNS iOS | `travellier-dev-ios` | `travellier-prod-ios` |
| Firebase | Proyecto propio de dev | Proyecto propio de prod |
| APNs | `APNS_SANDBOX` para firma development; `APNS` para distribución | `APNS` |
| Credenciales | Secretos del entorno dev | Secretos del entorno prod |

No asociar dispositivos prod con aplicaciones dev. El entorno APNs depende de la firma/provisioning del build, no solamente del nombre del stage. Si se cambia de sandbox a distribución, se crea/reconcilia la aplicación de esa plataforma; la anterior no se elimina automáticamente.

CloudFormation crea secretos vacíos; el wrapper de despliegue valida las credenciales antes de ejecutar Serverless y después las configura mediante SDK. Las aplicaciones móviles SNS se gestionan mediante SDK porque no tienen un recurso nativo de CloudFormation.

## Secretos y configuración del despliegue

Inyectar los siguientes valores desde el almacén de secretos del entorno de CI o una sesión de despliegue protegida. No ingresarlos en comandos, archivos versionados, `--param`, logs ni el bundle mobile. No activar trazas del SDK, `--debug` ni impresión de variables.

| Variable | Contenido |
| --- | --- |
| `PUSH_FCM_SERVICE_ACCOUNT_JSON` | JSON completo de cuenta de servicio del proyecto Firebase del entorno, con clave privada RSA |
| `PUSH_APNS_PRIVATE_KEY` | Clave privada `.p8` en PEM, EC P-256 |
| `PUSH_APNS_KEY_ID` | Signing Key ID de Apple, 10 caracteres |
| `PUSH_APNS_TEAM_ID` | Team ID de Apple, 10 caracteres |
| `PUSH_APNS_BUNDLE_ID` | Bundle ID exacto del build iOS del entorno |
| `PUSH_APNS_PLATFORM` | `APNS` o `APNS_SANDBOX`; prod rechaza sandbox |

Las variables MongoDB ya documentadas siguen siendo necesarias. AWS y Serverless usan sus mecanismos de autenticación existentes; preferir perfiles/roles de corta duración, sin credenciales en argumentos. El wrapper pasa al subproceso solamente las variables operativas y de autenticación AWS/Serverless permitidas; no transmite Mongo/JWT/push ni secretos ajenos.

| Output del stack | Valor en Secrets Manager | Lectura en ejecución |
| --- | --- | --- |
| `FcmCredentialsSecretArn` | JSON privado FCM | Ningún worker; solo aprovisionamiento |
| `ApnsCredentialsSecretArn` | Plataforma y atributos APNs, incluida `.p8` | Ningún worker; solo aprovisionamiento |
| `PushApplicationsSecretArn` | `{ stage, android, ios, firebaseProjectId }`, sin claves ni tokens | Worker de eventos |

SNS conserva las credenciales del proveedor necesarias para entregar mensajes. Los workers publican usando su rol AWS; no necesitan leer las claves privadas FCM/APNs. Los ARNs del registro no son secretos de autenticación.

Repetir el despliegue reconcilia las aplicaciones por ARN/nombre del stage y no escribe una versión nueva si el valor no cambió. Se recupera una aplicación creada antes de fallar el guardado del registro. Los cambios de credenciales se aplican con `SetPlatformApplicationAttributes`; el registro se escribe al final de una ejecución exitosa.

Si falla el SDK, el comando termina con error genérico sin imprimir el error original ni su causa. CloudFormation puede haber terminado correctamente: **no hay rollback conjunto AWS/Secrets Manager/SNS**. Mantener consumidores desactivados, revisar estado y repetir el wrapper. Un registro existente describe el último aprovisionamiento confirmado; por sí solo no prueba entrega ni salud actual del proveedor. Serializar despliegues/rotaciones por stage en el sistema que los ejecute.

## Ejecución y reintentos

`infrastructure/pending-services.cjs` agrega dos circuitos separados: EventBridge → SQS → consumidor Lambda, para `events` y `storageDeletionJobs`.

- EventBridge genera un tick por minuto: `{ kind: "events" | "storageDeletionJobs", stage: "dev" | "prod" }`. No contiene tokens, fotos, claves privadas ni payloads de negocio.
- MongoDB conserva el trabajo durable. **T45 no lee ni consume esas colecciones**. El tick no equivale a un evento de negocio; el consumidor debe buscar trabajos elegibles en MongoDB. La expiración de un tick no elimina el trabajo durable.
- Cada cola usa SSE administrado por SQS, retención de 1 día, visibilidad de 360 segundos y redrive tras 5 recepciones. La DLQ de procesamiento conserva mensajes 14 días y admite redrive solamente desde su cola de origen.
- EventBridge tiene hasta 5 reintentos dentro de 1 hora y una DLQ de entrega de 14 días. Esa política cubre entrega a SQS, no ejecución del consumidor.
- El mapping SQS usa lote de 1, `ReportBatchItemFailures` y concurrencia máxima 2. El consumidor debe usar timeout ≤60 segundos. T73/T92 deben reclamar trabajos atómicamente, usar leases recuperables y procesar de forma idempotente; SQS entrega al menos una vez.
- Hay alarmas de antigüedad >600 segundos, DLQ de procesamiento no vacía y DLQ de entrega no vacía, para cada circuito. No tienen canal de notificación externo configurado: se inspeccionan en CloudWatch; agregar suscripción operativa cuando se defina su destino.

Las reglas nacen **DISABLED**, sin mappings ni consumidores ficticios. Hasta conectar T73/T92 no se acumulan ticks y no se confirma ningún trabajo como realizado. Los trabajos existentes `{ tripId, objectKeys, createdAt }` se conservan intactos. Persistencia de avance, backoff por trabajo, índices incrementales y tratamiento de fallos parciales pertenecen a T44/T73/T91/T92.

## Permisos

| Identidad | Acceso |
| --- | --- |
| API existente | Conserva sus permisos; sin borrado S3 ni administración push |
| `EventsWorkerRoleArn` | Cola propia; logs de su función; secreto Mongo y registro de aplicaciones del stage; `sns:Publish` solo a endpoints de sus aplicaciones GCM/APNs |
| `StorageDeletionWorkerRoleArn` | Cola propia; logs de su función; secreto Mongo; `s3:DeleteObject` solo en `trips/*` del bucket existente |
| EventBridge | `sqs:SendMessage` a su cola y DLQ de entrega, restringido por ARN de regla y cuenta |
| Aprovisionamiento | Permisos habituales del deploy más lectura/escritura de secretos del stage y operaciones SNS indicadas abajo |

SNS: `GetPlatformApplicationAttributes` y `SetPlatformApplicationAttributes` sobre `app/GCM/travellier-<stage>-android` y `app/APNS[_SANDBOX]/travellier-<stage>-ios`. `CreatePlatformApplication` no admite restricción por recurso en IAM y requiere `Resource: "*"` **solamente en la identidad de aprovisionamiento**, limitado a esa acción y región mediante `aws:RequestedRegion`. No se requieren `ListPlatformApplications` ni eliminación automática de aplicaciones.

Al activar consumidores, el wrapper también necesita `lambda:GetFunctionConfiguration` sobre las dos funciones del stage y `cloudformation:DescribeStacks`. Los workers no reciben esos permisos ni los de registro/revocación de dispositivos; T89 deberá asignarlos a su adaptador con alcance propio.

Las colas rechazan conexiones sin TLS. Los roles solo pueden escribir en los log groups creados para sus nombres de función; no tienen `logs:CreateLogGroup` ni comodines de acciones de autorización. El comodín `sqs:*` pertenece exclusivamente al **Deny** de transporte inseguro.

## Conectar T73/T92

1. Desplegar T45 con consumidores desactivados y confirmar el aprovisionamiento SNS. Esto requiere autorización explícita del despliegue.
2. Crear las funciones reales `travellier-api-<stage>-events` y `travellier-api-<stage>-storage-deletion` usando los outputs de rol respectivos, Node.js 22 y timeout ≤60 segundos. Configurar solo los ARNs Mongo/registro y el bucket necesarios; no usar el lector HTTP que exige JWT.
3. Verificar pruebas de consumidor, idempotencia, leases y reintentos persistidos. La limpieza limita cada clave al trabajo y al prefijo autorizado; ningún tick permite borrar objetos arbitrarios.
4. Agregar los ARNs públicos como parámetros del wrapper, después de autorización del cambio. Ejemplo sin secretos:

```sh
corepack yarn infrastructure:deploy:dev --param=eventsConsumerArn=arn:aws:lambda:sa-east-1:123456789012:function:travellier-api-dev-events --param=storageDeletionConsumerArn=arn:aws:lambda:sa-east-1:123456789012:function:travellier-api-dev-storage-deletion
```

El wrapper comprueba antes de desplegar que las funciones sean del stage/región/cuenta, estén activas, usen sus roles y timeout correctos, y que las credenciales/registro coincidan con el aprovisionamiento anterior. La configuración de proveedor/rotación se hace primero con consumidores desactivados. Para desactivar, desplegar sin los parámetros; no vaciar colas ni colecciones.

## Dispositivos

**Android/FCM:** habilitar FCM HTTP v1 en el proyecto Firebase del entorno y autorizar la cuenta de servicio para enviar mensajes. Registrar el package ID Android correcto. La configuración pública `google-services.json` del cliente es distinta del JSON privado de cuenta de servicio y no permite enviar mensajes como servidor. T46/T90 agregan la integración y permisos Android; T89 vincula tokens FCM con usuarios autenticados.

**iOS/APNs:** cuenta Apple Developer, App ID/Bundle ID correctos, capacidad Push Notifications, entitlement `aps-environment` y provisioning/firma compatibles. Configurar `.p8`, Key ID, Team ID y Bundle ID en SNS. El token iOS de esta ruta es **APNs**, no FCM; debe coincidir con sandbox/producción. Verificar con dispositivo y build firmados; la recepción depende del permiso del usuario. T46/T90 implementan la parte nativa.

La falta de permiso o de entrega no bloquea el producto ni elimina `decisionRequired`. T91/T92 notifican solamente operaciones guardadas; un éxito de SNS acredita aceptación del proveedor, no recepción física.

## Validación y evidencia pendiente

Con Node.js 22:

```sh
node --test scripts/infrastructure-contract.test.mjs scripts/infrastructure-deploy.test.mjs scripts/pending-services.test.mjs scripts/push-provisioning.test.mjs
corepack yarn lint
corepack yarn typecheck
corepack yarn test
corepack yarn build
corepack yarn infrastructure:print:dev
corepack yarn infrastructure:print:prod
corepack yarn infrastructure:package:dev
corepack yarn infrastructure:package:prod
```

Revisar ambos templates compilados con `cfn-lint` y `cloudformation:ValidateTemplate`; inspeccionar que los ZIP no incluyan `.env`, claves privadas o el cliente. La revisión del change set dev debe preservar los recursos existentes y no reemplazar bucket ni secretos Mongo/JWT. No ejecutar cambios hasta recibir autorización explícita.

Después del deploy autorizado, registrar evidencia sin valores secretos: outputs/estado del stack, aplicaciones SNS y método Token, aislamiento dev/prod, reglas desactivadas y políticas. En un circuito temporal aislado, probar entrega, fallo del consumidor, reintento y llegada a DLQ con un payload sintético; eliminar solamente recursos del fixture autorizado. No conectar un consumidor de prueba a trabajos dev reales ni purgar sus colas. La entrega push a dispositivos necesita credenciales/builds de prueba y tokens ingresados por canal protegido, nunca argumentos o logs.

Para recuperar fallos, inspeccionar primero la DLQ y el trabajo Mongo correspondiente; corregir la causa y autorizar replay controlado. Repetir ticks puede ejecutar otra búsqueda, no debe duplicar avisos de app ni afectar otros Trips. No borrar `storageDeletionJobs` al fallar. La evidencia funcional de limpieza/push se completa con T73/T92.

**T45 no se considera cerrada únicamente por tests locales o `print`.** El empaquetado exige credenciales AWS válidas; el despliegue dev autorizado y las pruebas del proveedor siguen pendientes hasta tener esas credenciales, cuentas y dispositivos. No se modifica el PRD ni el listado de tareas para dar esos criterios por cumplidos.

Verificación local del 2026-10-11: lint, typecheck y build exitosos; tests de infraestructura/aprovisionamiento exitosos; suites domain (485), web (566) y API (393) exitosas con `--maxWorkers=2`. La ejecución sin limitar workers tuvo un timeout de cierre de un fixture MongoDB. Serverless resolvió dev/prod con `print`. `cfn-lint` 1.57.2 validó las declaraciones originales y nuevas para ambos stages, con/sin mappings; esto excluye los recursos de API generados por Serverless y no sustituye validar el template compilado. `package:dev` se detuvo al resolver la cuenta AWS por credenciales inválidas del perfil default. No se desplegaron recursos ni se probaron dispositivos.

Las aplicaciones SNS creadas por SDK no se eliminan con `serverless remove`. Su baja, endpoints y credenciales requieren una operación separada y explícitamente autorizada; no eliminar aplicaciones, secretos o datos dev como parte de una reparación automática.

Referencias: [SNS/FCM HTTP v1](https://docs.aws.amazon.com/sns/latest/dg/sns-fcm-authentication-methods.html), [APNs](https://docs.aws.amazon.com/sns/latest/dg/sns-apple-authentication-methods.html), [recursos SNS en CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/AWS_SNS.html), [IAM SNS](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonsns.html), [Lambda/SQS](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html), [reintentos EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html).
