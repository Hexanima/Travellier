# Tareas de desarrollo — Travellier

## Fase 1 — Base técnica

### T01 — Reparar workspace Yarn y referencias base

**Descripción:** Corregir el lockfile para que incluya el workspace raíz y permita instalar, probar y compilar el monorepo. Actualizar las referencias documentales que aún apuntan al PRD en su ubicación anterior.

**Criterios de aceptación:**

- `corepack yarn install --immutable`, test, build y lint se ejecutan desde la raíz.
- El README apunta a `docs/versiones/v1/PRD.md` y no conserva enlaces rotos al PRD.

**Estimación:** M (4hs)
**Dependencias:** —

### T02 — Extender contratos y puertos de dominio

**Descripción:** Extender el `Result`, los errores y tipos ya presentes con value objects de `ObjectId`, validaciones de dominio y puertos para persistencia, almacenamiento y notificaciones. Conserva la regla de dependencias hacia el dominio.

**Criterios de aceptación:**

- Los nuevos casos de uso reutilizan el `Result` discriminado existente.
- Los puertos no dependen de MongoDB, AWS, HTTP ni Capacitor.

**Estimación:** M (4hs)
**Dependencias:** T01

### T03 — Consolidar calidad, pruebas y CI

**Descripción:** Extender la configuración existente de TypeScript, Vitest y ESLint con comandos consistentes para todos los workspaces y pipeline de CI. Reemplazar las pruebas de ejemplo a medida que se incorporen casos de uso de Travellier.

**Criterios de aceptación:**

- `lint`, typecheck, test y build se ejecutan mediante scripts raíz.
- El pipeline falla ante errores de calidad, compilación o tests fallidos.

**Estimación:** M (4hs)
**Dependencias:** T01

### T04 — Configurar MongoDB e índices

**Descripción:** Implementar el adaptador de MongoDB y crear colecciones e índices definidos en el PRD. Incluir índices únicos para membresías, votos, participaciones y likes.

**Criterios de aceptación:**

- Todas las colecciones del PRD están creadas o versionadas mediante migraciones.
- Los índices únicos y TTL de refresh tokens se aplican correctamente.

**Estimación:** M (4hs)
**Dependencias:** T01

### T05 — Provisionar infraestructura AWS

**Descripción:** Definir API Gateway, Lambdas, configuración de entorno, permisos mínimos y secretos para MongoDB, JWT y S3. La infraestructura debe poder desplegarse de forma repetible.

**Criterios de aceptación:**

- Existen entornos configurables para desarrollo y producción.
- Las Lambdas acceden solo a los recursos AWS necesarios.

**Estimación:** L (8hs)
**Dependencias:** T01

### T06 — Configurar bucket de fotos

**Descripción:** Crear la configuración de S3 para uploads directos desde la aplicación. Aplicar CORS, prefijos por Trip y políticas de acceso mínimas.

**Criterios de aceptación:**

- El cliente puede hacer `PUT` únicamente mediante URLs firmadas.
- No existen credenciales AWS embebidas en la aplicación.

**Estimación:** M (4hs)
**Dependencias:** T05

### T07 — Integrar Capacitor y navegación mobile

**Descripción:** Evolucionar el cliente React existente a una aplicación empaquetable con Capacitor para iOS y Android. Incorporar navegación base, soporte de deep links y el shell preparado para rutas protegidas.

**Criterios de aceptación:**

- La aplicación puede sincronizarse y compilarse para Android e iOS con Capacitor.
- El shell resuelve navegación inicial y deep links sin depender todavía de Auth implementado.

**Estimación:** L (8hs)
**Dependencias:** T01

### T08 — Crear componentes visuales base

**Descripción:** Implementar componentes reutilizables para formularios, botones, listas, modales, feedback y estados de carga. Deben servir para todos los módulos funcionales.

**Criterios de aceptación:**

- Los componentes soportan estados disabled, loading y error.
- Las pantallas no duplican estilos base de controles.

**Estimación:** M (4hs)
**Dependencias:** T07

### T09 — Implementar cliente HTTP autenticado

**Descripción:** Crear adaptador HTTP con serialización de errores y agregado automático del access token. Debe manejar respuestas no autorizadas de forma centralizada.

**Criterios de aceptación:**

- Las requests autenticadas incluyen `Authorization: Bearer`.
- Los errores de API se traducen a errores consumibles por la UI.

**Estimación:** M (4hs)
**Dependencias:** T07

### T10 — Implementar middleware JWT

**Descripción:** Crear middleware para validar JWT y exponer el usuario autenticado a las Lambdas protegidas. Debe rechazar tokens inválidos, vencidos o ausentes.

**Criterios de aceptación:**

- Los endpoints privados devuelven 401 sin JWT válido.
- El identificador de usuario autenticado no proviene del body de la request.

**Estimación:** M (4hs)
**Dependencias:** T02, T05

## Fase 2 — Autenticación y perfil

### T11 — Crear casos de uso de autenticación

**Descripción:** Implementar registro, login, renovación, revocación de sesión y validaciones de credenciales. Las contraseñas solo se manejan hasheadas.

**Criterios de aceptación:**

- El dominio no persiste contraseñas en texto plano.
- Login y refresh diferencian credenciales inválidas de sesiones vencidas.

**Estimación:** M (4hs)
**Dependencias:** T02

### T12 — Crear endpoints de autenticación

**Descripción:** Exponer `/auth/register`, `/auth/login`, `/auth/refresh` y logout usando bcrypt y refresh tokens hasheados. Aplicar expiración y rotación de refresh token.

**Criterios de aceptación:**

- Registro crea usuario sin exponer `passwordHash`.
- Refresh inválido, vencido o revocado no genera un access token.

**Estimación:** L (8hs)
**Dependencias:** T04, T05, T10, T11

### T13 — Crear pantallas de registro e inicio de sesión

**Descripción:** Implementar formularios de registro y login conectados a los endpoints de Auth. Mostrar validaciones de campos y errores de credenciales.

**Criterios de aceptación:**

- El usuario puede registrarse e iniciar sesión desde mobile.
- Los errores no revelan información sensible sobre cuentas existentes.

**Estimación:** L (8hs)
**Dependencias:** T08, T09, T12

### T14 — Persistir y restaurar sesión nativa

**Descripción:** Guardar tokens en `@capacitor/preferences`, restaurar la sesión al abrir la app y cerrar sesión localmente. No usar `localStorage`.

**Criterios de aceptación:**

- Los tokens sobreviven al reinicio de la app.
- Cerrar sesión elimina los tokens persistidos.

**Estimación:** M (4hs)
**Dependencias:** T09, T12

### T15 — Crear API de perfil

**Descripción:** Implementar consulta y actualización de datos básicos del perfil autenticado. Limitar cada usuario a modificar exclusivamente su propio perfil.

**Criterios de aceptación:**

- El endpoint devuelve nombre, email y avatar sin datos sensibles.
- Un usuario no puede actualizar el perfil de otra persona.

**Estimación:** M (4hs)
**Dependencias:** T04, T10

### T16 — Crear pantalla de perfil

**Descripción:** Implementar visualización y edición de nombre y foto de perfil. Refrescar los datos visibles después de guardar cambios.

**Criterios de aceptación:**

- El usuario puede editar su nombre.
- La UI muestra un estado de éxito o error al guardar.

**Estimación:** M (4hs)
**Dependencias:** T08, T09, T15

### T17 — Crear endpoint de verificación de email

**Descripción:** Implementar validación de token de verificación y HTML puente para abrir el deep link de la app. El envío del email queda condicionado a definir proveedor.

**Criterios de aceptación:**

- Un token válido abre `com.travellier.app://verify/:token`.
- Un token inválido muestra una página de error segura.

**Estimación:** M (4hs)
**Dependencias:** T05, T10

### T18 — Configurar deep links en Capacitor

**Descripción:** Registrar el esquema custom de la app y enrutar links de invitación y verificación. Preservar el destino cuando la aplicación se inicia desde un deep link.

**Criterios de aceptación:**

- `com.travellier.app://invite/:code` abre el flujo de unión.
- `com.travellier.app://verify/:token` abre la pantalla de verificación.

**Estimación:** M (4hs)
**Dependencias:** T07, T17

## Fase 3 — Trips, miembros e invitaciones

### T19 — Crear dominio de Trips y membresías

**Descripción:** Modelar Trip, visibilidad, roles, modos de gasto, votación y membresía. Validar que solo un admin pueda expulsar miembros.

**Criterios de aceptación:**

- El creador se asigna como admin.
- Un participante no puede ejecutar operaciones exclusivas de admin.

**Estimación:** M (4hs)
**Dependencias:** T02

### T20 — Crear API de Trips

**Descripción:** Implementar creación, consulta, edición de configuración y listado de Trips del usuario. Generar un código de invitación único al crear cada Trip.

**Criterios de aceptación:**

- Crear un Trip genera su membresía admin.
- La respuesta no permite leer Trips privados ajenos.

**Estimación:** L (8hs)
**Dependencias:** T04, T10, T19

### T21 — Crear pantallas de listado y creación de Trips

**Descripción:** Implementar listado de Trips propios y formulario de creación con nombre, destino principal y descripción opcional. Mostrar estados vacíos y errores.

**Criterios de aceptación:**

- El Trip creado aparece en el listado.
- La creación no solicita fechas manuales.

**Estimación:** L (8hs)
**Dependencias:** T08, T09, T20

### T22 — Crear pantalla de configuración del Trip

**Descripción:** Permitir editar visibilidad, modo de votación y modo de gastos. Reflejar las restricciones que puedan afectar actividades y gastos existentes.

**Criterios de aceptación:**

- Los cambios se persisten y se visualizan al recargar.
- Los controles solo aparecen para usuarios autorizados.

**Estimación:** M (4hs)
**Dependencias:** T20, T21

### T23 — Crear API de miembros e invitaciones

**Descripción:** Implementar consulta de miembros, unión por código, prevención de duplicados y expulsión. Validar pertenencia al Trip en cada operación.

**Criterios de aceptación:**

- Un usuario no puede unirse dos veces al mismo Trip.
- Solo admins pueden expulsar y no se exponen miembros de Trips ajenos.

**Estimación:** M (4hs)
**Dependencias:** T10, T19, T20

### T24 — Crear interfaz de miembros e invitación

**Descripción:** Implementar pantalla para copiar código, compartir link, ver miembros, confirmar unión y expulsar participantes. Separar claramente las acciones administrativas.

**Criterios de aceptación:**

- Un usuario puede unirse ingresando un código válido.
- La acción de expulsión no está disponible para participantes.

**Estimación:** M (4hs)
**Dependencias:** T08, T09, T23

### T25 — Crear handler web de links de invitación

**Descripción:** Implementar `GET /invite/:code` para validar el código y devolver HTML con intento de apertura de la app y fallback. Mantener el formato de link compartible definido en el PRD.

**Criterios de aceptación:**

- El link intenta abrir el esquema custom de la app.
- El fallback aparece si la app no responde dentro del tiempo configurado.

**Estimación:** M (4hs)
**Dependencias:** T05, T20, T23

### T26 — Crear API de Trips públicos

**Descripción:** Implementar consulta de Trips públicos y unión sin invitación. Excluir información privada que no sea necesaria para decidir unirse.

**Criterios de aceptación:**

- Solo se devuelven Trips con visibilidad pública.
- Unirse conserva las mismas validaciones de membresía.

**Estimación:** M (4hs)
**Dependencias:** T20, T23

### T27 — Crear explorador de Trips públicos

**Descripción:** Crear pantalla de descubrimiento y confirmación de unión a Trips públicos. Mostrar información mínima del Trip antes de confirmar.

**Criterios de aceptación:**

- La pantalla no muestra Trips privados.
- El usuario ve el Trip unido en su listado al confirmar.

**Estimación:** M (4hs)
**Dependencias:** T21, T26

## Fase 4 — Destinos, transportes e itinerario

### T28 — Crear dominio de destinos y transportes

**Descripción:** Modelar destinos secuenciales, tipos de transporte, tramos urbanos y validaciones temporales. Evitar llegadas anteriores a las salidas.

**Criterios de aceptación:**

- Los detalles requeridos cambian según el tipo de transporte.
- Un transporte inválido no llega a persistencia.

**Estimación:** M (4hs)
**Dependencias:** T02, T19

### T29 — Crear API de destinos y transportes

**Descripción:** Implementar altas, modificaciones y consultas de destinos ordenados y sus transportes. Validar que pertenecen al Trip y destino indicados.

**Criterios de aceptación:**

- El orden de destinos se persiste sin duplicados.
- No se puede crear un transporte para otro Trip.

**Estimación:** M (4hs)
**Dependencias:** T04, T10, T28

### T30 — Crear formularios de destinos y transportes

**Descripción:** Implementar formularios para avión, ómnibus, colectivo urbano, auto y otro. Permitir agregar destinos y tramos de colectivo secuenciales.

**Criterios de aceptación:**

- Cada tipo muestra solo sus campos pertinentes.
- Los errores temporales se muestran antes de guardar.

**Estimación:** L (8hs)
**Dependencias:** T08, T09, T29

### T31 — Implementar generador de días de itinerario

**Descripción:** Crear el caso de uso que deriva días de tránsito y actividad desde timestamps de transportes. Cubrir viajes de un día, múltiples días y múltiples destinos.

**Criterios de aceptación:**

- No existe creación manual de `itineraryDays`.
- Los límites de actividad respetan `arrivalAt` y `departureAt`.

**Estimación:** L (8hs)
**Dependencias:** T28

### T32 — Persistir y regenerar itinerario

**Descripción:** Integrar el generador al guardar o modificar transportes y reemplazar la proyección de días de forma consistente. Proteger datos dependientes ante cambios incompatibles.

**Criterios de aceptación:**

- Configurar transporte genera los días correspondientes.
- Modificar un transporte recalcula el itinerario sin crear días duplicados.

**Estimación:** M (4hs)
**Dependencias:** T29, T31

### T33 — Crear consulta agregada de itinerario

**Descripción:** Implementar endpoint que obtiene días, transportes, actividades, posts espontáneos y resumen de gastos en orden cronológico. Preparar la respuesta para evitar múltiples requests desde la app.

**Criterios de aceptación:**

- Los días se devuelven ordenados por `order`.
- Los posts asociados a actividad y transporte se ubican en su contexto correcto.

**Estimación:** M (4hs)
**Dependencias:** T32

### T34 — Crear pantalla de itinerario

**Descripción:** Implementar la visualización diaria de tránsito, actividades, posts espontáneos y gastos. Diferenciar visualmente franjas de actividad y transporte.

**Criterios de aceptación:**

- Un día puede mostrar tránsito y actividad en la misma fecha.
- Las actividades y posts aparecen cronológicamente.

**Estimación:** L (8hs)
**Dependencias:** T08, T09, T33

## Fase 5 — Actividades, participación y votación

### T35 — Crear dominio de actividades

**Descripción:** Modelar actividades, estados, horario, ubicación y relación con días válidos del itinerario. Validar que una actividad solo pueda pertenecer a una ventana habilitada.

**Criterios de aceptación:**

- Una actividad no puede asignarse a un día ajeno al Trip.
- Con votación desactivada, se crea confirmada.

**Estimación:** M (4hs)
**Dependencias:** T02, T31

### T36 — Crear API de actividades

**Descripción:** Implementar creación, edición, consulta y eliminación de actividades. Respetar permisos iguales para admins y participantes.

**Criterios de aceptación:**

- Miembros pueden crear y editar actividades.
- Usuarios externos no pueden leer ni modificar actividades del Trip.

**Estimación:** L (8hs)
**Dependencias:** T10, T32, T35

### T37 — Crear interfaz de actividades

**Descripción:** Implementar creación, edición y detalle de actividades desde el día del itinerario. Incluir título, descripción, hora y vínculo de Maps opcionales.

**Criterios de aceptación:**

- Se puede crear una actividad desde un día válido.
- La actividad aparece en el itinerario al guardar.

**Estimación:** L (8hs)
**Dependencias:** T08, T34, T36

### T38 — Crear API de participación

**Descripción:** Implementar el registro individual de `going`, `not_going` y `pending`. Mantener el índice único por actividad y usuario.

**Criterios de aceptación:**

- Un usuario tiene un único estado por actividad.
- Cambiar una participación no modifica la de otros miembros.

**Estimación:** M (4hs)
**Dependencias:** T04, T10, T36

### T39 — Crear interfaz de participación

**Descripción:** Agregar controles para indicar asistencia y mostrar el estado propio en cada actividad. No debe inferir un estado global de realización desde una respuesta individual.

**Criterios de aceptación:**

- El usuario puede actualizar su estado.
- La interfaz muestra el cambio sin recargar el itinerario completo.

**Estimación:** M (4hs)
**Dependencias:** T37, T38

### T40 — Crear API de votos de actividades

**Descripción:** Implementar registro y reemplazo de votos cuando la votación está habilitada. Dejar encapsulada la transición de estado según la futura regla de consenso.

**Criterios de aceptación:**

- No se puede votar en un Trip con votación desactivada.
- Un usuario conserva un único voto por actividad.

**Estimación:** M (4hs)
**Dependencias:** T04, T10, T36

### T41 — Crear interfaz de votación

**Descripción:** Mostrar estado de propuesta o votación y controles de voto para actividades configurables. Ocultar la funcionalidad cuando el Trip no la habilita.

**Criterios de aceptación:**

- La UI permite emitir o cambiar el voto propio.
- Las actividades confirmadas no muestran acciones incompatibles.

**Estimación:** M (4hs)
**Dependencias:** T37, T40

## Fase 6 — Posts, interacciones y fotos

### T42 — Crear dominio de Posts

**Descripción:** Modelar posts espontáneos y vinculaciones opcionales a actividad, post padre y transporte. Validar que todas las relaciones sean del mismo Trip.

**Criterios de aceptación:**

- Un post puede combinar las tres vinculaciones o no tener ninguna.
- No se puede vincular contenido entre Trips distintos.

**Estimación:** M (4hs)
**Dependencias:** T02, T28, T35

### T43 — Crear API de Posts y vinculaciones

**Descripción:** Implementar creación, edición, consulta y relink posterior de posts. Preservar autoría y validar acceso al Trip.

**Criterios de aceptación:**

- Un post se puede vincular o desvincular después de creado.
- Los links inválidos no modifican el post existente.

**Estimación:** L (8hs)
**Dependencias:** T10, T32, T42

### T44 — Crear compositor y edición de Posts

**Descripción:** Implementar pantalla para crear y editar posts desde un día, actividad o acción global. Permitir seleccionar ubicación, gasto y vinculaciones opcionales.

**Criterios de aceptación:**

- Se puede crear un post espontáneo sin relaciones.
- Se puede elegir una actividad, post o transporte del mismo Trip.

**Estimación:** L (8hs)
**Dependencias:** T08, T09, T43

### T45 — Crear detalle y feed de Posts

**Descripción:** Implementar render de posts anidados bajo actividades, relacionados con otros posts y asociados a transporte. Ordenar posts espontáneos por fecha de creación.

**Criterios de aceptación:**

- El itinerario muestra posts en el bloque correcto.
- Los posts vinculados a transporte aparecen en días de tránsito.

**Estimación:** L (8hs)
**Dependencias:** T34, T43

### T46 — Crear API de likes y comentarios

**Descripción:** Implementar likes de posts, comentarios y likes de comentarios con sus índices únicos. Validar membresía antes de cualquier interacción.

**Criterios de aceptación:**

- Un usuario puede dar un único like por entidad.
- Comentarios y likes no pueden crearse fuera del Trip.

**Estimación:** M (4hs)
**Dependencias:** T04, T10, T43

### T47 — Crear interfaz de interacciones

**Descripción:** Implementar comentario, like de post y like de comentario desde el detalle del post. Actualizar contadores y estado propio de forma consistente.

**Criterios de aceptación:**

- Un usuario puede crear comentarios de texto.
- Dar o quitar like actualiza la UI correctamente.

**Estimación:** M (4hs)
**Dependencias:** T45, T46

### T48 — Crear API de URLs presignadas

**Descripción:** Implementar solicitud de URL de subida y registro de `s3Key` y orden de fotos en un post. Verificar que el usuario tenga acceso al post antes de firmar.

**Criterios de aceptación:**

- La URL firmada usa un prefijo asociado al Trip y post.
- Solo se registran fotos luego de una subida válida.

**Estimación:** M (4hs)
**Dependencias:** T06, T10, T43

### T49 — Implementar carga de fotos desde mobile

**Descripción:** Integrar selección o captura de fotos, subida directa a S3 y asociación con el post. Manejar progreso, error y reintento por archivo.

**Criterios de aceptación:**

- El archivo no atraviesa la Lambda.
- Un fallo de upload no crea una referencia de foto inválida.

**Estimación:** M (4hs)
**Dependencias:** T44, T48

### T50 — Crear galería grupal

**Descripción:** Implementar consulta y vista agregada de fotos de posts de un Trip. Mantener acceso restringido a miembros.

**Criterios de aceptación:**

- La galería muestra fotos de todos los posts del Trip.
- Una foto permite abrir el post de origen.

**Estimación:** M (4hs)
**Dependencias:** T43, T49

## Fase 7 — Gastos y mapa

### T51 — Crear API de gastos en modo registro

**Descripción:** Implementar creación, edición y consulta de gastos asociados uno a uno con posts. Calcular el resumen diario sin generar deudas en modo `register`.

**Criterios de aceptación:**

- Un post tiene como máximo un gasto.
- El resumen diario suma únicamente gastos del día y Trip consultados.

**Estimación:** M (4hs)
**Dependencias:** T04, T10, T43

### T52 — Crear interfaz de gastos en Posts

**Descripción:** Agregar monto y desglose libre al compositor de post y mostrar gastos en detalle e itinerario. Adaptar la UI al modo de gasto del Trip.

**Criterios de aceptación:**

- El gasto se puede crear o editar junto con el post.
- En modo registro no se solicita quién pagó.

**Estimación:** M (4hs)
**Dependencias:** T44, T51

### T53 — Implementar cálculo de balances

**Descripción:** Crear caso de uso y endpoint para calcular saldos y deudas en modo `balance`. Debe usar los gastos previos al activar el modo sin alterar sus registros.

**Criterios de aceptación:**

- El cálculo no se ejecuta en modo `register`.
- El resultado identifica acreedores, deudores y montos.

**Estimación:** L (8hs)
**Dependencias:** T19, T51

### T54 — Crear pantalla de balance

**Descripción:** Mostrar el resumen de balance del Trip y el detalle de saldos por integrante. Ocultar la sección si el modo de gasto no está habilitado.

**Criterios de aceptación:**

- El resumen se actualiza al registrar un gasto.
- No se muestra balance en Trips de modo registro.

**Estimación:** M (4hs)
**Dependencias:** T22, T52, T53

### T55 — Integrar mapas en Posts y actividades

**Descripción:** Crear componente para vista previa embebida de enlaces de Google Maps y apertura en la app nativa de mapas. Manejar enlaces inválidos sin romper la pantalla.

**Criterios de aceptación:**

- Un enlace válido muestra vista previa y acción “Abrir en Maps”.
- Un enlace ausente o inválido no muestra un mapa vacío.

**Estimación:** M (4hs)
**Dependencias:** T37, T45

## Fase 8 — Notificaciones y calendario

### T56 — Registrar dispositivos para push

**Descripción:** Configurar permisos nativos, obtención de token y persistencia del dispositivo por usuario. Preparar un puerto intercambiable para SNS o FCM.

**Criterios de aceptación:**

- La app solicita permiso de notificaciones en el momento definido.
- Los tokens se asocian al usuario autenticado y pueden revocarse.

**Estimación:** M (4hs)
**Dependencias:** T05, T14

### T57 — Despachar eventos push del Trip

**Descripción:** Emitir notificaciones por post, propuesta, voto, confirmación, unión, expulsión y comentario. Excluir al actor cuando no corresponda.

**Criterios de aceptación:**

- Cada evento llega solo a miembros relevantes.
- La expulsión notifica únicamente al integrante afectado.

**Estimación:** L (8hs)
**Dependencias:** T23, T36, T40, T43, T46, T56

### T58 — Manejar notificaciones en la app

**Descripción:** Implementar recepción de push, navegación al recurso asociado y manejo de notificaciones abiertas desde segundo plano. Mostrar feedback ante permisos denegados.

**Criterios de aceptación:**

- Tocar una notificación abre el Trip o contenido correcto.
- La app no falla si el usuario rechaza permisos.

**Estimación:** M (4hs)
**Dependencias:** T18, T56, T57

### T59 — Integrar exportación al calendario nativo

**Descripción:** Implementar adaptación de actividades confirmadas y días de actividad a eventos de calendario nativo. Incluir nombre del Trip, horario y ubicación cuando existan.

**Criterios de aceptación:**

- Solo se exportan actividades confirmadas.
- La integración funciona en iOS y Android o informa una alternativa `.ics`.

**Estimación:** L (8hs)
**Dependencias:** T34, T36

## Fase 9 — Seguridad, observabilidad y validación

### T60 — Agregar observabilidad y protección de API

**Descripción:** Incorporar logs estructurados, trazabilidad de errores, rate limiting para Auth y sanitización de entradas. Evitar registrar tokens, contraseñas o datos sensibles.

**Criterios de aceptación:**

- Los errores incluyen contexto técnico sin secretos.
- Los endpoints de autenticación limitan intentos abusivos.

**Estimación:** M (4hs)
**Dependencias:** T05, T12

### T61 — Crear pruebas end-to-end de flujos críticos

**Descripción:** Cubrir registro, creación y unión a Trip, transporte, itinerario, actividad, post con foto y permisos. Ejecutar los flujos contra el stack integrado.

**Criterios de aceptación:**

- Los flujos críticos se ejecutan automáticamente.
- Se prueban rechazos de acceso a Trips ajenos y acciones de admin.

**Estimación:** L (8hs)
**Dependencias:** T13, T24, T30, T34, T47, T50, T54, T59

## Preguntas abiertas

- ¿Cuál es la regla exacta de consenso para confirmar una actividad: unanimidad, mayoría simple, porcentaje configurable o decisión manual de un admin?
- ¿Cómo se distribuye un gasto en modo balance: partes iguales entre todos los miembros, participantes seleccionados o proporciones personalizadas?
- ¿Qué moneda, precisión decimal y reglas de redondeo deben aplicarse a los gastos?
- El modelo `direction: outbound | return` no representa claramente traslados entre destinos intermedios. ¿Cada destino requiere transporte de llegada y salida, o solo el primero y último?
- ¿Qué proveedor enviará emails de verificación y cuál será la URL de descarga/fallback para cada plataforma?
- ¿Los códigos de invitación expiran, pueden regenerarse o pueden revocarse?
- ¿Qué proveedor y credenciales se usarán para mapas, push y preview embebida?
- ¿Qué comportamiento debe tener la regeneración del itinerario si ya existen actividades o posts en días afectados?

## Resumen

- Total de tareas: 61
- Estimación inicial: 316 horas
- No hay un límite de horas provisto.
