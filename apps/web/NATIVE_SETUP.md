# Capacidades nativas — T46

Referencia funcional: [PRD v1](../../docs/versiones/v1/PRD.md), §3.7 y §7.

## Dependencias fijadas

| Paquete | Versión | Compatibilidad |
| --- | --- | --- |
| Capacitor core/CLI/Android/iOS | 8.5.2 | Base existente |
| `@capacitor/camera` | 8.2.5 | Capacitor >=8; iOS SPM |
| `@capacitor/push-notifications` | 8.1.3 | Capacitor >=8; iOS SPM |
| `@capacitor/calendar` | 1.0.1 | Capacitor >=8; iOS SPM |

No agregar geolocalización, micrófono, recordatorios, notificaciones locales ni ejecución de fondo para este setup. Aunque un plugin incluya otras APIs, el adaptador expone únicamente capacidades de v1.

## Contratos y uso

Los puertos y errores están en `domain`, sin imports de Capacitor. Las fábricas testeables están en `src/native`; `createCapacitorCapabilities()` conecta los plugins reales. Ningún adaptador se activa al montar `App`.

- Fotos: `photos.select('camera' | 'gallery')` devuelve referencias locales y URLs de previsualización. No crea posts ni sube a S3. Solicita solo cámara al capturar en iOS. Los selectores del sistema entregan acceso a archivos seleccionados sin pedir acceso general a la biblioteca. La captura usa `saveToGallery: false`.
- Push: consultar/solicitar permiso explícitamente; luego instalar `push.listen(handlers)` y llamar `push.register()`. `register()` solo confirma que se solicitó el registro: el token llega por `onToken`, o el fallo por `onError`. Conservar y ejecutar el cierre de listeners al abandonar el flujo; no usar `removeAllListeners()`. `unregister()` no revoca por sí solo el registro en la API de T89/T90. El token iOS es **APNs** y el Android es **FCM**.
- Calendario: `checkAccess()` consulta sin diálogo. `requestAccess('write')` pide escritura; `requestAccess('manage')` pide lectura/escritura, necesarias para gestionar eventos vinculados. Un resultado exitoso puede contener permisos denegados: siempre inspeccionar `read`/`write`. No representa una exportación o sincronización.
- Errores: `unsupported`, `denied`, `cancelled` y `native`. La cancelación de fotos no equivale a denegación. En navegador se devuelve `unsupported`; no se incorpora una plataforma web pública.

T74 debe manejar `App.appRestoredResult` al recuperar una captura si Android termina el proceso. Este setup no introduce listeners permanentes ni publica archivos recuperados automáticamente.

### Límite del calendario oficial

La versión instalada exige `startDate` y `endDate` al crear un evento; `modifyEvent` elige la primera coincidencia por filtros y no admite ID. `deleteEvent` sí admite ID. iOS EventKit reduce la precisión a segundos.

T46 configura plugins y permisos, sin exponer CRUD de eventos. Antes de T96 se debe resolver cómo preservar la identidad al editar y cómo representar planes sin duración. No asignar duración/fin por defecto, recrear eventos indiscriminadamente ni modificar por título. No se modificó el PRD ni se acredita T96. Un ICS sigue siendo una copia estática gestionada por T95.

## Android

Requisitos: Node 22+, Corepack/Yarn 4.9.1, Android Studio 2025.2.1+, SDK Platform 36, herramientas SDK y **JDK 21**. El mínimo de la app es API 24. El script detecta el JBR de Android Studio en Windows o usa `ANDROID_JAVA_HOME`/`JAVA_HOME`.

Desde la raíz:

```sh
corepack yarn install --immutable
corepack yarn workspace web cap:sync:android
corepack yarn workspace web cap:build:android
```

`cap:build:android` ya compila el cliente y sincroniza Android. APK: `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`. Configurar `ANDROID_HOME` y, si fuera necesario, `android/local.properties` con el SDK local; este archivo no se versiona.

El manifest fusionado incorpora `READ_CALENDAR`, `WRITE_CALENDAR` y `POST_NOTIFICATIONS` mediante los plugins y Firebase. Android 13+ solicita permiso de notificaciones en contexto. Fotos no requieren permisos generales de almacenamiento al usar el selector/cámara del sistema sin guardar en galería. FCM auto-init queda deshabilitado hasta el registro explícito.

### Configuración FCM

Registrar `com.travellier.app` en el proyecto Firebase del entorno y suministrar su `google-services.json` real en `apps/web/android/app/` (ignorado por Git). El Gradle existente aplica Google Services cuando encuentra este archivo; el APK puede compilar sin él, pero **push no funciona**. No crear configuraciones ficticias para anunciar éxito.

Este archivo contiene configuración del cliente. Las credenciales de envío del servidor y las claves privadas de APNs pertenecen a T45 y deben permanecer fuera del cliente/repositorio. T46 no implementa endpoints de tokens, proveedores de envío ni entrega productiva.

## iOS en macOS

Requisitos: macOS compatible con **Xcode 26+**, Command Line Tools, Node 22+ y Yarn 4.9.1. Deployment target actual: iOS 15+. Este proyecto usa SPM: no ejecutar `pod install` ni migrar a CocoaPods.

```sh
xcode-select -p
corepack yarn install --immutable
corepack yarn workspace web cap:sync:ios
corepack yarn workspace web exec cap open ios
```

En Xcode, abrir el target App y seleccionar un equipo válido en Signing & Capabilities, con el bundle ID `com.travellier.app`. Está preparada la capability **Push Notifications**, el entitlement `aps-environment` y los callbacks de registro/fallo APNs. Las descripciones de cámara/fotos y calendario ya están en `Info.plist`.

Para push real se necesita membresía/equipo Apple Developer con el identificador habilitado para APNs, certificado/perfil válidos y configuración de envío del entorno (T45). El entitlement fuente es `development`; verificar que la firma/exportación de distribución genere el entorno `production` compatible con el perfil y proveedor. No versionar Team IDs privados, perfiles, certificados, `.p8` ni contraseñas de firma. El plugin oficial devuelve token APNs: no requiere integrar Firebase iOS para este setup.

Usar Run en un dispositivo iOS registrado y con Developer Mode habilitado. El simulador permite verificar compilación/navegación y algunos permisos; la aceptación de cámara y recepción APNs se verifica en **iPhone físico**. Para distribución, crear Archive/Export con la firma del equipo; `corepack yarn workspace web cap:build:ios` también requiere macOS y opciones de firma correspondientes. No considerar `cap sync ios` una compilación iOS.

## Verificación

```sh
corepack yarn lint
corepack yarn typecheck
corepack yarn test
corepack yarn build
corepack yarn workspace web test --run src/native
node --test scripts/android-build-environment.test.mjs
corepack yarn workspace web cap:test:android
```

`cap:test:android` requiere `ANDROID_SERIAL=emulator-<puerto>` y un único emulador descartable conectado. Rechaza dispositivos físicos o conexiones adicionales antes de instalar APKs de instrumentación. Gradle instala/desinstala la app de pruebas; no usar un AVD con datos de desarrollo que deban conservarse. Los tests operan sobre la app real y el puente nativo, inyectando un bundle de los adaptadores desde el APK de instrumentación; no se agrega una pantalla/ruta de prueba al cliente.

La suite verifica arranque y consulta sin diálogos, captura y selección con archivos de imagen decodificables, ausencia de permisos generales de almacenamiento y calendario concedido/denegado. Los fixtures se indexan con el escáner de medios del emulador y se eliminan por su referencia propia. La concesión de calendario se prueba al final: revocar un permiso concedido desde el proceso de instrumentación mata ese mismo proceso, por lo que el runner prepara el estado fuera de él.

### Matriz Android en CI

El job `android-native` de `.github/workflows/ci.yml` ejecuta la suite en AVDs x86_64 de API **24 y 33**, independientemente del job de calidad. Publica resultados JUnit/HTML, capturas y respuestas JSON como artifacts `t46-android-api-24` y `t46-android-api-33`, también al fallar. Los archivos de evidencia se copian a `/sdcard/Download/t46-smoke` antes de desinstalar el APK y se descargan a `apps/web/android-smoke-results/` (ignorado por Git).

La imagen oficial API 24 trae WebView **53**, incompatible con el JavaScript actual: la primera ejecución detectó `SyntaxError: Unexpected token ?` y no pudo iniciar React. Los emuladores no actualizan WebView automáticamente ([requisito de Capacitor](https://capacitorjs.com/docs/android#running-your-app)). La matriz instala **Chromium/Bromite 108.0.5359.156** solo en el AVD API 24 descartable mediante `test/prepare-api24-webview.sh`; el proveedor y su overlay no se distribuyen con la app. El APK de pruebas se obtiene de la [publicación del mantenedor](https://github.com/bromite/bromite/releases/tag/108.0.5359.156) y se verifica contra SHA-256 `990e1c052eeca7380496f1ec81843d002402346dffddf60368fa77c888ac10e5`. El AVD necesita `-writable-system` y acceso root de userdebug para ese setup exclusivo del emulador. API 33 usa su proveedor Google WebView 109.0.5414.123 original.

En ejecución local, preparar un proveedor compatible antes de invocar el comando. El mínimo Android permanece API 24: la versión de Android por sí sola no garantiza una WebView compatible. Estas comprobaciones no acreditan que una WebView 53 funcione ni sustituyen pruebas de proveedores/dispositivos adicionales.

Los tests de adaptadores se escribieron primero y se observaron fallando antes de implementar. El setup se comprueba contra manifests, plist, callbacks, entitlements y registros Gradle/SPM.

Comprobaciones manuales en un dispositivo de prueba, sin datos ajenos:

| Comprobación | Evidencia requerida |
| --- | --- |
| Primer inicio | Sin diálogos de fotos, push o calendario |
| Fotos | Captura/selección/cancelación; solo imágenes, sin upload ni post automático |
| Permisos | Conceder/denegar, acceso limitado en iOS y reintento contextual |
| Push configurado | Token del proveedor correcto, error explícito, recepción y acción; sin logs de tokens |
| Calendario | Consulta silenciosa y solicitudes explícitas de escritura/gestión |
| Android mínimo/moderno | API 24 y API 33+; inspeccionar permisos del manifest fusionado |
| iOS | Build y firma en macOS; pruebas en iPhone físico |

### Evidencia local — 2026-10-12 (Windows)

- Cliente: lint, typecheck y **600 tests** correctos; build y bundle de instrumentación correctos. Selector JDK/comando/guardas de dispositivo: **7 tests** correctos.
- Android `assembleDebug`: correcto con JBR 21.0.10, SDK 36 y los cinco plugins registrados. APK debug generado; advertencias de `flatDir`/bibliotecas nativas sin stripping no impidieron la compilación.
- Manifest fusionado: incluye calendario y notificaciones; no incluye micrófono, ubicación ni acceso general al almacenamiento. FCM auto-init permanece deshabilitado.
- `cap sync` Android/iOS: correcto. Una segunda sincronización conservó sin cambios los 8 archivos de setup verificados (Gradle, SPM, manifest, plist, delegate, entitlements y proyecto Xcode).
- XML de `Info.plist` y `App.entitlements`: válido. El montaje de App bajo StrictMode no pide permisos ni registra push en el test del cliente.
- Instrumentación local: **5 tests correctos en API 24 y 5 en API 33**, en AVDs separados con los proveedores indicados. Captura y selección devuelven archivos nativos que se decodifican como imágenes; las pruebas de calendario comprueban además el permiso efectivo del sistema. Resultados/capturas/JSON se conservan localmente en `android-smoke-results/`; los informes JUnit originales se guardan en `test/evidence/`.

| Caso nativo | API 24 / Chromium 108 | API 33 / Google WebView 109 |
| --- | --- | --- |
| Arranque y consulta de calendario sin diálogos | Correcto | Correcto |
| Captura desde cámara del sistema | Correcto | Correcto |
| Selección desde picker sin almacenamiento general | Correcto | Correcto |
| Calendario rechazado sin anunciar acceso | Correcto | Correcto |
| Calendario concedido mediante diálogo contextual | Correcto | Correcto |

- **Pendiente:** recepción push con configuración real FCM/APNs; compilación/firma iOS en macOS y pruebas en iPhone físico; resultado del job nuevo en GitHub después del push. Estas evidencias no acreditan entrega push ni sincronización de eventos de T96.

Referencias: [entorno Capacitor](https://capacitorjs.com/docs/getting-started/environment-setup), [Camera](https://capacitorjs.com/docs/apis/camera), [Push Notifications](https://capacitorjs.com/docs/apis/push-notifications), [Calendar](https://capacitorjs.com/docs/apis/calendar).
