# Capacidades nativas — T46

Referencia funcional: [PRD v1](../../docs/versiones/v1/PRD.md), §3.7 y §7.

## Dependencias fijadas

| Paquete | Versión | Compatibilidad |
| --- | --- | --- |
| Capacitor core/CLI/Android/iOS | 8.5.2 | Base existente |
| `@capacitor/camera` | 8.2.5 | Capacitor >=8; iOS SPM |
| `@capacitor/push-notifications` | 8.1.3 | Capacitor >=8; iOS SPM |
| `@capacitor/calendar` | 1.0.1 | Capacitor >=8; iOS SPM |
| `@capacitor/filesystem` | 8.1.5 | Capacitor >=8; iOS SPM (T143) |
| `@capacitor/share` | 8.0.3 | Capacitor >=8; iOS SPM (T143) |

No agregar geolocalización, micrófono, recordatorios, notificaciones locales ni ejecución de fondo para este setup. Aunque un plugin incluya otras APIs, el adaptador expone únicamente capacidades de v1.

## Contratos y uso

Los puertos y errores están en `domain`, sin imports de Capacitor. Las fábricas testeables están en `src/native`; `createCapacitorCapabilities()` conecta los plugins reales. Ningún adaptador se activa al montar `App`.

- Fotos: `photos.select('camera' | 'gallery')` devuelve referencias locales y URLs de previsualización. No crea posts ni sube a S3. Solicita solo cámara al capturar en iOS. Los selectores del sistema entregan acceso a archivos seleccionados sin pedir acceso general a la biblioteca. La captura usa `saveToGallery: false`.
- Push: consultar/solicitar permiso explícitamente; luego instalar `push.listen(handlers)` y llamar `push.register()`. `register()` solo confirma que se solicitó el registro: el token llega por `onToken`, o el fallo por `onError`. Conservar y ejecutar el cierre de listeners al abandonar el flujo; no usar `removeAllListeners()`. `unregister()` no revoca por sí solo el registro en la API de T89/T90. El token iOS es **APNs** y el Android es **FCM**.
- Calendario: `checkAccess()` consulta sin diálogo. `requestAccess('write')` pide escritura; `requestAccess('manage')` pide lectura/escritura, necesarias para gestionar eventos vinculados. Un resultado exitoso puede contener permisos denegados: siempre inspeccionar `read`/`write`. No representa una exportación o sincronización.
- Errores: `unsupported`, `denied`, `cancelled`, `missing` (solo eventos del calendario: el evento buscado no existe) y `native`. La cancelación de fotos no equivale a denegación. En navegador se devuelve `unsupported`; no se incorpora una plataforma web pública.

T74 debe manejar `App.appRestoredResult` al recuperar una captura si Android termina el proceso. Este setup no introduce listeners permanentes ni publica archivos recuperados automáticamente.

### Límite del calendario oficial

La versión instalada exige `startDate` y `endDate` al crear un evento; `modifyEvent` elige la primera coincidencia por filtros y no admite ID. `deleteEvent` sí admite ID. iOS EventKit reduce la precisión a segundos.

T46 configuró plugins y permisos. T96 agrega la sincronización de eventos sobre ese plugin, sin tocar la configuración nativa. Un ICS sigue siendo una copia estática gestionada por T95.

**Qué hace realmente el plugin instalado** (leído en `node_modules/@capacitor/calendar`, no ejecutado en un dispositivo):

- Android `createEvent` concatena la URL a las notas: `"$notes $url"` (`android/.../Calendar.kt` líneas 43-51, el comentario del propio código lo dice), aunque `definitions.d.ts` (~líneas 228-235) afirma que Android la ignora. `modifyEvent` nunca lee `url` (`Calendar.kt` 72-120) y reemplaza `DESCRIPTION` con `notes` (línea 79). Antes se había documentado aquí que Android ignoraba la URL: era falso.
- iOS guarda la URL en un campo propio (`ios/.../Calendar.swift` 252-254), pero una cadena vacía no se interpreta (`URL(string: "")` es nulo) y `findEvents` no la devuelve (`eventToDictionary`, 311-335): no se puede limpiar ni leer.
- `findEvents`, `modifyEvent` y `deleteEvent` por filtro comparan subcadena sin distinguir mayúsculas en `title`, `location` y `notes` y devuelven todo evento cuyo intervalo se SUPERPONE con la ventana (`Calendar.kt` 262-316; `Calendar.swift` 185-217). Android ordena por inicio (línea 310); iOS no especifica el orden.
- `modifyEvent` cambia solo la PRIMERA coincidencia (`Calendar.kt` 73; `Calendar.swift` 74) y solo los campos presentes (`definitions.d.ts` ~42-46). En Android las cadenas vacías se ignoran (`optString(...).takeIf { it.isNotEmpty() }`, líneas 505-507): un lugar no se puede borrar enviando `location: ""`. En iOS sí (`Calendar.swift` 243-245).

**Identidad por marcador y decisiones derivadas.** Como `modifyEvent` no admite ID, cada evento gestionado lleva como última línea de sus `notes` el marcador `travellier:<tipo>-<id>@<tripId>` (tipo: `activity`, `transport` o `day`). El adaptador (`apps/web/src/native/calendar-events.ts`, puerto `CalendarEventsPort`) decide así:

- **Nunca envía `url`.** El enlace del lugar viaja como una línea propia de las notas, justo antes del marcador, en ambas plataformas: el marcador sigue siendo una línea completa, no hay concatenaciones del plugin y quitar el enlace en la app lo quita del evento (las notas se reescriben enteras). Por robustez, además, `find` acepta el marcador al inicio de una línea seguido de fin de línea o espacio en blanco (nunca como prefijo de otra clave: un id con más caracteres no coincide) y descarta lo que solo contiene el texto (`cita <marcador>`).
- **Actualizar queda atado al evento referenciado.** Busca por marcador y ventana (±60 s de la anterior), exige encontrar el evento con el id guardado (si no, `missing`: se olvida la referencia y se adopta por marcador o se crea de nuevo), borra por id solo las copias idénticas que lleven el mismo marcador conservando el referenciado (ver política más abajo), y solo llama a `modifyEvent` si el referenciado queda como único candidato. Si hay otro evento ajeno que contenga el marcador en esa ventana, o si en Android hay que borrar un lugar, la vía más segura es crear de nuevo en el mismo calendario con los datos nuevos y recién entonces borrar el anterior por id (el id cambia y la referencia se actualiza; se pierden recordatorios que la persona haya agregado a mano a ese evento).
- **Lugar quitado:** iOS recibe `location: ""`; Android recrea el evento (ver arriba).
- `notes` reemplaza la descripción entera, por eso el marcador viaja siempre en el texto que se escribe. Borra con `deleteEvent({ id })`. `OS-PLUG-CLDR-0001` es un `INVALID_ARGUMENT` genérico del plugin (`CalendarError.kt`): lo devuelve «sin coincidencia», pero también `createEvent` con título vacío (`Calendar.kt`, `Calendar.swift`) o un `calendarId` inválido. El adaptador lo traduce a `NativeCapabilityError` de tipo `missing` y el servicio solo lo interpreta así en update/remove; en find/create es un fallo común. El efecto es benigno: se olvida la referencia y se recrea, o el resultado queda «parcial».
- **Copias con el marcador (política conservadora).** Se elige el evento gestionado por: id referenciado, coincidencia con el plan (título e inicio/fin a resolución de segundos), ventana de la referencia y, por último, el primero. Se borran solo las copias que llevan el marcador y son idénticas al plan o al gestionado en título, ventana (a resolución de segundos), notas (marcador incluido; sin diferencias de fin de línea ni espacios finales) y lugar (`location ?? ""`); el plugin devuelve `notes` y `location` en Android e iOS. Una copia con notas o lugar editados, o cualquier diferencia o normalización propia de la plataforma, cuenta como NO idéntica: se deja intacta y se informa como `ignoredCopies` (no es un error; el panel lo muestra como nota). `ignoredCopies` es efímero: no persiste entre reinicios y se recalcula en la próxima sincronización. Riesgos residuales: un duplicado intencional SIN editar (idéntico en título, ventana, notas y lugar) también se borra; y un cierre de la app entre crear y borrar al recrear (cuando el horario cambió) puede dejar dos eventos iguales con el marcador: el nuevo queda fuera de la ventana de la referencia anterior y la corrida siguiente modifica el viejo. «Volver a agregar» deduplica en ±400 días (borra solo copias idénticas al evento referenciado o al plan); la sincronización normal no. Sin referencia y con solo copias editadas se adopta la primera como último recurso y el siguiente update la sobrescribe. Recrear crea primero y borra después el anterior por id: si crear falla el original queda intacto; si borrar falla, se conserva el id nuevo, se reintenta el borrado una vez y, si vuelve a fallar, queda como copia ignorada.

**Qué hace el servicio** (`apps/web/src/calendar/calendar-sync-service.ts`): solo corre si la persona lo activó; antes de operar consulta el permiso sin diálogo y exige lectura y escritura (los dos hacen falta para buscar, actualizar y borrar). Crea guardando la referencia (id, huella, ventana) en Preferences por cuenta, viaje y dispositivo; antes de crear busca por marcador y adopta el evento existente (si se perdió la referencia o la app murió antes de guardarla), borrando solo las copias idénticas (las editadas por la persona se ignoran). Un plan sin duración se escribe con fin igual al inicio. No se escriben gastos, participantes, tokens, costos ni números de vuelo. Tras las pasadas (tope de 50 por corrida), si queda trabajo informa «pendiente» (había progreso) o «parcial» (no converge), nunca «sincronizado». Si «Quitar del calendario» falla en parte, conserva solo las referencias de lo que no se pudo borrar, no sincroniza nada y ofrece «Reintentar quitar» (solo esos eventos) y «Dejar de sincronizar». Con el permiso denegado y la sincronización activada se ofrece «Dejar de sincronizar» (no requiere permiso).

**Requiere permiso de lectura:** buscar por marcador, actualizar, borrar y adoptar. **Solo escritura** (iOS 17+ «Add Events Only»): se pueden crear eventos pero no buscarlos ni mantenerlos, así que la app no sincroniza y ofrece el `.ics`. El permiso se pide solo al pulsar «Mantener sincronizado con el calendario», nunca al abrir la pantalla.

**No verificado (T96), NO cumplido y bloqueado desde esta PC:** todo se probó con un plugin simulado en memoria que reproduce lo que dice el código nativo leído (no lo ejecutado). Falta comprobar en Android e iOS reales: alta, edición y baja; que Android concatene de verdad la URL y que `modifyEvent` por filtro se comporte como se lee (subcadena de `notes`, superposición de rango, primera coincidencia); el orden en iOS; recrear un evento en el mismo calendario; la estabilidad de los ids; el truncado a segundos; los permisos reales, incluido «Add Events Only»; cuentas de calendario reales (Google/iCloud); duplicados tras reinstalar; y varios dispositivos. Los ids y las referencias son por dispositivo.

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

## Registro push T90

El cliente registra el token del dispositivo en la API (`PUT /push-devices`, T89) y lo revoca al cerrar sesión (`POST /push-devices/revoke`). El token viaja solo en el cuerpo de las solicitudes: nunca en la URL, en logs ni en el estado de la UI (solo se muestra un `tokenHint`), y vive únicamente en memoria. Código: `src/push/` (servicio, cliente API, panel); el adaptador del plugin es `src/native/push-registration.ts`.

### Flujo y momento del permiso

- Nunca se pide permiso al abrir la app ni al iniciar sesión. Con sesión (al iniciar o restaurar), el servicio solo actúa si el permiso ya está concedido: instala el listener, llama a `register()` y envía cada token con `PUT`. Con permiso sin decidir o denegado no hace nada.
- El permiso se pide en contexto, solo desde el botón «Activar avisos»: sección «Avisos» de Mi perfil (siempre disponible) y tarjeta descartable tras unirse a un Trip («Ahora no» la oculta solo en esa sesión). En Android 13+ el diálogo es `POST_NOTIFICATIONS`.
- Si el permiso está denegado la app explica cómo activarlo en Ajustes del sistema, pero no ofrece botón: ningún plugin instalado puede abrir los Ajustes. Viajes, actividades, «Voy / No voy» y «Modificado» no dependen del estado push.
- Al cerrar sesión se revoca el token con el access token saliente, antes de borrar la sesión local, con un tope de 3 s; si falla o tarda, el cierre continúa igual. Si la app muere antes, la revocación explícita no ocurre y queda la reasignación del backend cuando otra cuenta registre el mismo token. Un 401 limpia el estado local sin revocar.
- La renovación del token envía un nuevo `PUT` (idempotente) y revoca el anterior de forma best-effort. Solo en plataforma nativa; en web/jsdom el servicio no existe.

### Credenciales sin versionarlas

- **Android:** el `google-services.json` real del proyecto Firebase se inyecta en build/CI desde un secreto (por ejemplo, base64 en un secret de GitHub decodificado en `apps/web/android/app/google-services.json` justo antes de `cap sync` y del `assemble`). El archivo está ignorado por Git y no debe versionarse. El job `android-native` actual no se modifica y compila sin él (push no funciona en ese APK).
- **iOS:** no hay credenciales de Firebase en el cliente. Se necesitan el entitlement `aps-environment`, el perfil y la firma del equipo Apple Developer, en macOS.
- La clave `.p8` de APNs y las credenciales FCM de envío viven solo en el servidor (T45/T92), nunca en el cliente ni en el repositorio.
- `src/push/credentials-contract.test.ts` verifica que esos archivos no estén rastreados, que Android ignore `google-services.json` y que `src/`, `android/` e `ios/` (incluidos `.xcconfig`, `.entitlements`, `.storyboard`, `.pbxproj` y `.plist`) no contengan `BEGIN PRIVATE KEY`, claves `AIza…`, referencias `AuthKey_*.p8` ni valores de configuración FCM; omite binarios y archivos de más de 1 MiB.

### No verificado

Registro real en Android (requiere `google-services.json` real y un dispositivo o emulador con Google Play) e iOS (macOS, Xcode, Apple Developer, firma, APNs, iPhone físico); recepción y renovación real del token; diálogo `POST_NOTIFICATIONS`. La entrega (T92) y la apertura desde el aviso (T93) no están implementadas.

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

En Android el adaptador de galería usa `Camera.pickImages`, todavía incluido en Camera 8.2.5 aunque deprecado. `chooseFromGallery` tiene una [carrera reportada por el proveedor](https://github.com/ionic-team/capacitor-camera/issues/55) que puede dejar `IONCAMRLoadingActivity` abierta tras devolver imágenes pequeñas. Se observó también en la [ejecución 38320242935](https://github.com/Hexanima/Travellier/actions/runs/38320242935): la imagen era válida pero `MainActivity` permanecía pausada y fallaba el cierre del test. `pickImages` utiliza el picker del sistema sin esa actividad de carga y sin permisos generales de almacenamiento. iOS conserva `chooseFromGallery`. Mantener este workaround hasta verificar una corrección del proveedor; no aumentar timeouts ni ignorar errores de cierre para ocultarlo.

La regresión nativa conserva el fixture de 64×64 y realiza **tres selecciones consecutivas** por ejecución, comprobando que `MainActivity` queda `RESUMED` después de cada resultado. La limpieza y sus errores siguen siendo obligatorios.

La cámara AOSP del AVD API 24 necesita completar su primer inicio antes de probar el intent de captura: su [PermissionsActivity](https://android.googlesource.com/platform/packages/apps/Camera2/+/android-7.0.0_r1/src/com/android/camera/PermissionsActivity.java) vuelve a abrir `CameraActivity` sin conservar el intent original. El test prepara únicamente esa app externa, rechaza ubicación y desactiva el etiquetado de ubicaciones; después ejecuta el adaptador real. No concede permisos a Travellier. Esta evidencia cubre la cámara del sistema preparada y no acredita ese primer inicio defectuoso del proveedor AOSP.

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

- Cliente: lint, typecheck y **605 tests** correctos; build y bundle de instrumentación correctos. Selector JDK/comando/guardas de dispositivo: **7 tests** correctos.
- Android `assembleDebug`: correcto con JBR 21.0.10, SDK 36 y los cinco plugins registrados. APK debug generado; advertencias de `flatDir`/bibliotecas nativas sin stripping no impidieron la compilación.
- Manifest fusionado: incluye calendario y notificaciones; no incluye micrófono, ubicación ni acceso general al almacenamiento. FCM auto-init permanece deshabilitado.
- `cap sync` Android/iOS: correcto. Una segunda sincronización conservó sin cambios los 8 archivos de setup verificados (Gradle, SPM, manifest, plist, delegate, entitlements y proyecto Xcode).
- XML de `Info.plist` y `App.entitlements`: válido. El montaje de App bajo StrictMode no pide permisos ni registra push en el test del cliente.
- Instrumentación local: **5 tests correctos en API 24 y 5 en API 33**, en AVDs separados con los proveedores indicados. Captura y selección devuelven archivos nativos que se decodifican como imágenes; las pruebas de calendario comprueban además el permiso efectivo del sistema. Resultados/capturas/JSON se conservan localmente en `android-smoke-results/`; los informes JUnit originales se guardan en `test/evidence/`.
- Regresión del picker corregida: los informes `test/evidence/2026-10-12-picker-api24.xml` y `2026-10-12-picker-api33.xml` registran **5 tests sin fallos por API**, incluyendo las tres selecciones consecutivas con regreso a `MainActivity` y cierre obligatorio del escenario.

| Caso nativo | API 24 / Chromium 108 | API 33 / Google WebView 109 |
| --- | --- | --- |
| Arranque y consulta de calendario sin diálogos | Correcto | Correcto |
| Captura desde cámara del sistema | Correcto | Correcto |
| Selección desde picker sin almacenamiento general | Correcto | Correcto |
| Calendario rechazado sin anunciar acceso | Correcto | Correcto |
| Calendario concedido mediante diálogo contextual | Correcto | Correcto |

- Evidencia inicial de GitHub Actions: [ejecución 38319600852](https://github.com/Hexanima/Travellier/actions/runs/38319600852), commit `b53b6967ca891835368fa018d7529f3b32e97f1a`, correcta para calidad y ambas APIs. Los informes `test/evidence/2026-10-12-ci-api24.xml` y `2026-10-12-ci-api33.xml` registran **5 tests sin fallos por API**. Esa ejecución anterior al workaround no acredita ausencia de la carrera descrita arriba. Capturas, resultados JSON y logs nativos están en los artifacts de cada nueva ejecución de la matriz.
- **Pendiente:** recepción push con configuración real FCM/APNs; compilación/firma iOS en macOS y pruebas en iPhone físico. Estas evidencias no acreditan entrega push ni sincronización de eventos de T96.

Referencias: [entorno Capacitor](https://capacitorjs.com/docs/getting-started/environment-setup), [Camera](https://capacitorjs.com/docs/apis/camera), [Push Notifications](https://capacitorjs.com/docs/apis/push-notifications), [Calendar](https://capacitorjs.com/docs/apis/calendar).

## Apertura de enlaces de ubicación T94

- `ExternalLinkPort.open(url)` (adaptador `src/native/external-link.ts`) revalida el enlace con `parseMapsLink` (solo `https:` y lista exacta de hosts de Maps) y abre `window.open(url, "_blank", "noopener,noreferrer")`. Construcción sin efectos y sin registrar la URL.
- `@capacitor/app` 8.1.1 no incluye `openUrl` y `@capacitor/browser` no está instalado; no se agregaron dependencias ni cambios en `android/` o `ios/`.
- No verificado: cómo el WebView de Capacitor maneja `window.open` hacia Google Maps o Apple Maps (intents de Android, universal links de iOS) ni la apertura real en dispositivos. Detalle y decisiones pendientes (mapa estático/WebView, credenciales, privacidad) en `docs/REVISION_PENDIENTE.md` (T94).

## Guardar y compartir el `.ics` T143

- Adaptador `src/native/ics-share.ts` (`createNativeIcsSharer`, fábrica productiva `createCapacitorIcsSharer()`; `App.tsx` la inyecta como `icsExport.download` solo con `Capacitor.isNativePlatform()`). Construcción sin efectos. En web/dev delega en la descarga por Blob (`downloadIcs`).
- Flujo Android/iOS: `Filesystem.writeFile({ path, data, directory: Cache, encoding: UTF8 })` con nombre sanitizado (`safeFileName`: solo letras, dígitos, `_` y `-`, más `.ics`), luego `Share.canShare()` (falso: fallo) y `Share.share({ title, files: [uri] })`. `files` es la opción correcta en `@capacitor/share` 8 (`definitions.d.ts`; en Android solo acepta URLs `file:`). La cancelación de la hoja rechaza con `Share canceled` (Android y iOS) y se informa como mensaje neutro, no como éxito ni error.
- Alcance del archivo: tope de 1 MB (se rechaza sin escribir). Los errores solo exponen `reason` (`cancelled`/`failed`), nunca rutas ni URIs.
- Limpieza diferida: el temporal en Cache no se borra tras compartir (la app destino puede leerlo después de que `share` resuelva; el SO purga la caché). La siguiente exportación con el mismo nombre lo sobrescribe y, si el nombre cambió, se borra el anterior en modo best-effort sin alterar el resultado.
- Android: `Share.share` resuelve al LANZAR la hoja; no prueba que el usuario eligiera destino ni que una app importara el archivo. iOS resuelve al cerrarse la hoja. Por eso el éxito dice «Se abrió la hoja para compartir o guardar el archivo.».
- Android: el FileProvider (`${applicationId}.fileprovider`) ya está declarado en el manifest de la app y `res/xml/file_paths.xml` cubre `cache-path`. Los plugins no declaran permisos propios: no se agregó ninguno (el contrato verifica que no haya permisos de almacenamiento).
- Límite: el archivo queda en Cache y no es visible en Descargas; el usuario lo guarda desde la hoja («Guardar en archivos» en iOS, un destino en Android). Un archivo persistente visible requeriría otro mecanismo o permisos (duda en `docs/REVISION_PENDIENTE.md`, T143).
- No verificado en dispositivo real (T113): la hoja, el FileProvider y la importación en calendarios.
