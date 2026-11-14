# Plan pendiente — Travellier v1

Fecha: 2026-10-11. Fuente de producto: [PRD aprobado](PRD.md). Fuente de diseño: [diseño azul fijado](../../../design/prototype/DESIGN.md).

## Alcance del reemplazo

- **Este listado reemplaza íntegramente las tareas pendientes del plan anterior, desde T44. No se ejecuta después de las antiguas T44–T61 ni se suma a ellas.**
- T01–T43 y las tarjetas históricas de correcciones quedan intactas. Se parte del código integrado hasta T43 y se implementa únicamente lo que falta o debe adaptarse al PRD aprobado.
- Los IDs T44–T113 identifican ahora un único plan de trabajo pendiente, numerado según sus fases. Los títulos y alcances anteriores de T44–T61 quedan sustituidos para la planificación; no son tareas adicionales que deban completarse primero.
- [TAREAS_DESARROLLO.md](TAREAS_DESARROLLO.md) se conserva como registro histórico. Su sección pendiente deja de ser el plan vigente; no se cambian sus tareas terminadas.
- [Trello Travellier](https://trello.com/b/WUtxsOqR/travellier) permanece sin cambios: al consultar, T01–T43 estaban en Done, T44–T50 en To Do y T51–T61 en Backlog; In Progress e In Review estaban vacíos. Esta propuesta todavía no se sincroniza con las tarjetas.
- La base existente incluye infraestructura, Auth, perfil, Trips, miembros, transportes, itinerario, actividades, participación, votación anterior y API de posts. No se rehace esa base: las tareas de corrección cambian solo los contratos y comportamientos que difieren del PRD vigente.
- Cada tarea representa un PR atómico, con pruebas según su capa, máximo de 8 horas y separación de backend y frontend. Las dependencias T01–T43 ya están satisfechas; las restantes apuntan exclusivamente a este nuevo listado.
- Cada PR verifica sus contratos con los consumidores actuales; si un retiro rompe DTO/tipos compartidos, se contempla compatibilidad técnica transitoria y su retiro posterior, sin cambiar reglas de producto.
- La fase funcional reutiliza componentes actuales. La aplicación integral del diseño azul aprobado queda al final, después de las pruebas funcionales.
- Las horas son trabajo efectivo, no incluyen esperas por cuentas, credenciales, firma, revisión de PR o dispositivos. Este documento no autoriza despliegues ni cambios de datos por sí mismo.

## 1. Setup e infraestructura incremental

### T44 — Versionar los contratos pendientes

**Capa:** Infraestructura/backend.

**Descripción:** Agregar migraciones incrementales y fixtures para el PRD aprobado sin reescribir las migraciones anteriores. Esto permite detectar registros dev incompatibles antes de evolucionar relaciones y contratos.

**Criterios de aceptación:**

- Conservar ObjectId, referencias y datos existentes; ninguna prueba o migración borra colecciones dev.
- Versionar los índices nuevos requeridos por publicaciones, agenda personal y eventos, conservando los únicos vigentes.
- Probar idempotencia y diagnosticar vínculos múltiples, días heredados y gastos incompletos sin corregirlos silenciosamente.

- Preparar fixture legado con paidBy conocido y sin moneda/reparto; la adaptación explícita definida por el PRD se ejecuta en T80, sin inferir campos desconocidos.

**Estimación:** M (4hs).
**Dependencias:** T03, T04, T43.

### T45 — Provisionar los servicios pendientes

**Capa:** Infraestructura/backend.

**Descripción:** Extender la infraestructura existente para push y ejecución de limpieza de fotos. Documentar el proveedor y sus secretos por entorno sin repetir el setup de AWS/S3 ya terminado.

**Criterios de aceptación:**

- Configurar SNS/FCM y ejecución/reintento de eventos y storageDeletionJobs con permisos mínimos.
- Separar dev/prod y mantener credenciales fuera de repositorio, cliente, argumentos y logs.
- Validar plantillas y despliegue dev autorizado; documentar configuración APNs/FCM necesaria para dispositivos.

**Estimación:** L (6hs).
**Dependencias:** T05, T06.

### T46 — Configurar las capacidades nativas

**Capa:** Frontend/nativo.

**Descripción:** Preparar adaptadores y permisos de Capacitor para fotos, push y calendario. Separarlos de las pantallas permite implementar cada integración sin aplicar todavía el diseño visual.

**Criterios de aceptación:**

- Configurar dependencias compatibles y sincronización Android/iOS sin añadir capacidades fuera de v1.
- Definir adaptadores testeables; no solicitar todos los permisos al iniciar la aplicación.
- Verificar setup Android y documentar ejecución iOS en macOS, firma y dispositivos requeridos.

**Estimación:** M (4hs).
**Dependencias:** T07.

## 2. Correcciones del backend existente

### T47 — Retirar la votación del backend

**Capa:** Backend.

**Descripción:** Eliminar votación del contrato activo de Trips, actividades y API. Esta corrección se implementa como trabajo nuevo sin modificar las tareas históricas que incorporaron esa funcionalidad.

**Criterios de aceptación:**

- Retirar votingEnabled, estados proposed/voting/confirmed y endpoints de voto; no generar votos nuevos.
- Mantener planes simultáneos y actividades visibles sin participantes, sin aprobación ni mínimos.
- Actualizar contratos/tests sin borrar votos o datos dev históricos ni reescribir migraciones aplicadas.

**Estimación:** M (4hs).
**Dependencias:** T44, T40, T43.

### T48 — Simplificar el registro de cuentas

**Capa:** Backend.

**Descripción:** Permitir registro solo con email y contraseña, sin nombre ni verificación obligatorios. Conservar perfiles y usuarios existentes para alinear Auth con el PRD aprobado.

**Criterios de aceptación:**

- Registrar sin name y permitir login inmediato sin emailVerified obligatorio.
- Conservar nombres/avatares previos y devolver correctamente perfiles o integrantes sin nombre.
- Mantener hashing, rotación/revocación y errores seguros; probar registro, login y perfil sin nombre.

**Estimación:** M (3hs).
**Dependencias:** T11, T12, T15.

### T49 — Agregar duración a las actividades

**Capa:** Backend.

**Descripción:** Extender dominio, persistencia y API con durationMinutes opcional y fin derivado. Validar el intervalo contra la ventana completa del destino permite cruzar medianoche sin habilitar horarios fuera del viaje.

**Criterios de aceptación:**

- Aceptar duración positiva o ausente, sin fin por defecto; conservar precisión UTC al editar contenido.
- Permitir cruce de día dentro de la ventana y fin exacto en salida; rechazar cualquier exceso sin guardar.
- Cubrir creación/edición y el contrato de actividad espontánea con pruebas de inicio, fin y milisegundos.

**Estimación:** L (6hs).
**Dependencias:** T47, T36.

### T50 — Detectar conflictos de agenda

**Capa:** Backend/dominio.

**Descripción:** Crear una política reutilizable de conflictos personales independiente de persistencia. Usar la misma regla al participar, crear y editar evita agendas incompatibles y diferencias entre casos de uso.

**Criterios de aceptación:**

- Detectar todas las intersecciones entre intervalos conocidos; fin/inicio contiguos son compatibles.
- Sin duración no inventar fin y detectar al menos igualdad de inicio con motivo «Mismo horario».
- Comparar solo going de la misma persona y Trip; probar múltiples conflictos, precisión y planes ajenos.

**Estimación:** M (4hs).
**Dependencias:** T49.

### T51 — Confirmar los cambios de plan

**Capa:** Backend.

**Descripción:** Extender participación con detección y confirmación explícita de conflictos. Reutilizar la serialización del Trip impide guardar dos agendas incompatibles bajo requests concurrentes.

**Criterios de aceptación:**

- Sin confirmar, devolver todas las incompatibles/horarios sin cambios; confirmar guarda anteriores not_going y elegida going juntos.
- Revalidar conflictos y horarios al confirmar; un snapshot cambiado solicita nueva decisión sin escrituras parciales.
- Permitir solo respuestas propias going/not_going antes/durante/después; únicamente su guardado correcto limpia decisionRequired sin modificar planes ajenos.
- Rechazar pending manual en el caso de uso y la API sin cambiar participación ni decisionRequired; conservar pending en lecturas y como estado inicial o generado por el sistema.
- Actualizar las pruebas de dominio/HTTP que hoy aceptan los tres estados manuales; cubrir rechazo sin escrituras y limpieza atómica de la marca solo mediante going/not_going.

**Estimación:** L (8hs).
**Dependencias:** T50, T38.

### T52 — Registrar al creador como participante

**Capa:** Backend.

**Descripción:** Guardar conjuntamente actividad nueva y going del autor. La creación solicita el mismo cambio de plan cuando haya conflictos, sin publicar primero una actividad incompleta.

**Criterios de aceptación:**

- Crear actividad y going del autor en una transacción; los demás quedan sin responder.
- Ante conflicto, pedir confirmación antes de insertar y revalidar al guardar las bajas personales anteriores.
- Cancelación/error no publica ni cambia participaciones; dejar de asistir no elimina actividades sin participantes.

**Estimación:** L (6hs).
**Dependencias:** T51, T36.

### T53 — Persistir las decisiones requeridas

**Capa:** Backend.

**Descripción:** Revisar agendas al editar actividades y persistir decisionRequired en quienes deban decidir nuevamente. La desvinculación automática no debe registrarse como una negativa voluntaria ni perderse tras recarga.

**Criterios de aceptación:**

- Cambiar inicio/duración pasa afectados going a pending solo en la editada, con schedule_conflict, changedFields y changedAt UTC.
- Incluir creador/editor; conservar otros planes, compatibles y marcas previas; contenido/ubicación solos no desvinculan.
- Serializar con participación, membresía y bajas; fallos no guardan parcialmente y consultas devuelven la marca personal persistida.

**Estimación:** L (8hs).
**Dependencias:** T51, T52.

### T54 — Desvincular la publicación del itinerario

**Capa:** Backend.

**Descripción:** Retirar dayId como requisito y fuente de fecha de posts en dominio, MongoDB y API. La publicación automática del servidor permite recuerdos sin transportes o fuera del viaje sin ampliar el itinerario.

**Criterios de aceptación:**

- Crear sin dayId antes/después del viaje o sin itinerario; el cliente no elige ni edita createdAt.
- Editar conserva autor/createdAt y milisegundos; registros anteriores se leen sin borrar ni depender funcionalmente de dayId.
- Listar por publicación descendente con desempate estable e índice adecuado; probar autorización de miembros.

**Estimación:** L (6hs).
**Dependencias:** T44, T43.

### T55 — Validar las cadenas de recuerdos

**Capa:** Backend.

**Descripción:** Cambiar vínculos para que un hijo apunte exclusivamente al padre inmediato. Resolver la actividad raíz recorriendo la cadena evita relaciones duplicadas y admite ramificaciones.

**Criterios de aceptación:**

- Permitir independiente, actividad, transporte o padre; padre excluye relación directa con actividad/transporte.
- Rechazar autorreferencia, ciclos indirectos y relaciones entre Trips, también bajo concurrencia, sin escrituras parciales.
- Consultar padre, hijos directos y raíz; relink/baja de actividad conservan cadena, publicación y contenido asociado.

**Estimación:** L (6hs).
**Dependencias:** T54, T43.

### T56 — Proyectar los recuerdos por contexto

**Capa:** Backend.

**Descripción:** Actualizar la consulta del itinerario para publicaciones sin dayId y cadenas completas. Devolver instantes y contexto permite agrupar localmente sin modificar datos compartidos ni confundir plan con publicación.

**Criterios de aceptación:**

- Actividad incluye directos y descendientes publicados otro día sin duplicarlos como independientes.
- Independientes se proyectan por publicación solo en fechas existentes; detalle de transporte consulta todos sus recuerdos.
- Mantener orden de planes/tránsito y UTC preciso; probar días intermedios, zona local y Trip sin itinerario sin perder publicaciones.

**Estimación:** L (6hs).
**Dependencias:** T55, T33.

### T57 — Proteger los límites al regenerar días

**Capa:** Backend.

**Descripción:** Adaptar regeneración al nuevo modelo de posts y duración. Mantener identidades compatibles sin dejar que la fecha de publicación bloquee modificaciones válidas del transporte.

**Criterios de aceptación:**

- Posts no se validan por dayId ni se borran/reubican al cambiar transportes; conservan vínculos y timestamps.
- Rechazar eliminación de franja referenciada o inicio fuera de ella, y fin fuera de la ventana del destino.
- Guardar transporte/proyección atómicamente, conservar ObjectId compatibles y probar rechazos concurrentes sin pérdida.
- Retirar `arrival` del tipo de franja en dominio y contrato API; los registros dev existentes se leen sin borrarse ni romper la consulta.

**Estimación:** M (4hs).
**Dependencias:** T49, T54, T32.

### T58 — Publicar actividades espontáneas de forma atómica

**Capa:** Backend.

**Descripción:** Extender la operación conjunta de T43 con duración, autor going y confirmación personal. El post conserva publicación automática aunque la actividad registre un momento anterior.

**Criterios de aceptación:**

- Guardar actividad, post, going y cambios de plan necesarios en una transacción.
- Conflictos requieren confirmación y revalidación; cancelar/error no publica registros parciales ni retira participaciones.
- Respetar vínculo exclusivo y límites; permitir crear espontánea al relink de post existente sin cambiar createdAt.

**Estimación:** L (6hs).
**Dependencias:** T52, T55, T57.

## 3. Correcciones funcionales del cliente

### T59 — Retirar los controles de votación

**Capa:** Frontend.

**Descripción:** Quitar configuración, estados y controles de voto del cliente React. Conservar componentes y participación existentes sin rehacer todavía su apariencia.

**Criterios de aceptación:**

- Eliminar votingEnabled, hooks/requests de votos y etiquetas de aprobación de itinerario/detalle.
- Mostrar planes sin mínimos ni eliminación por ausencia de participantes.
- Actualizar pruebas y conservar configuración de visibilidad/gastos y permisos administrativos.

**Estimación:** M (3hs).
**Dependencias:** T47, T41.

### T60 — Simplificar el formulario de registro

**Capa:** Frontend.

**Descripción:** Solicitar solo email y contraseña al registrarse y mantener nombre/avatar en Perfil. Retirar verificación del recorrido de v1 sin afectar los links de invitación.

**Criterios de aceptación:**

- Registro no muestra/exige nombre ni verificar correo; permite iniciar sesión con la cuenta creada.
- Conservar borrador, errores seguros y bloqueo de doble envío; perfiles sin nombre no rompen la UI.
- Retirar pantalla/enlaces de verificación del flujo activo y probar invitaciones con/sin sesión.

**Estimación:** M (2hs).
**Dependencias:** T48, T13, T18.

### T61 — Agregar duración a los formularios

**Capa:** Frontend.

**Descripción:** Extender formularios y detalle de actividades con duración opcional en horas/minutos. Reutilizar un formateador temporal compartido permite mostrar intervalos consistentes antes del rediseño.

**Criterios de aceptación:**

- Cargar/quitar duración; no inventar fin y distinguir fecha/año si la actividad termina otro día.
- Conservar segundos/milisegundos en ediciones sin cambio horario y mostrar rechazos de ventana del backend.
- Mantener borrador ante error y actualizar itinerario/detalle sin duplicar reglas.

**Estimación:** M (4hs).
**Dependencias:** T49, T59, T37.

### T62 — Resolver los conflictos de participación

**Capa:** Frontend.

**Descripción:** Conectar Voy/No voy al cambio confirmado y al indicador personal Modificado. Sin responder debe ser neutro y no una tercera respuesta manual que consuma la marca.

**Criterios de aceptación:**

- Mostrar todas las incompatibles y conservar/cambiar; cancelación no altera datos y snapshot cambiado pide revisar nuevamente.
- Mostrar Modificado solo al afectado con explicación accesible; leer/cerrar, cancelar/error o recargar no lo elimina, aun sin push.
- Limpiar solo tras respuesta guardada y aplicar confirmación al crear una actividad, conservando borrador ante cancelación.

**Estimación:** L (6hs).
**Dependencias:** T51, T52, T53, T61.

### T63 — Adaptar la proyección del itinerario

**Capa:** Frontend.

**Descripción:** Actualizar el cliente HTTP y la proyección local a publicaciones sin dayId y cadenas por actividad raíz. Reutilizar el itinerario existente permite mostrar los contratos nuevos sin esperar al rediseño.

**Criterios de aceptación:**

- Validar el DTO sin dayId de post, votingEnabled o estados de aprobación; admitir duración y datos personales de participación sin rechazar respuestas válidas.
- Agrupar independientes por publicación solo en días existentes y descendientes por actividad raíz; los del transporte se consultan por contexto sin anclarlos al antiguo dayId.
- Conservar UTC/milisegundos, días compartidos y publicaciones fuera del viaje; probar relink/baja, zona local y respuestas reales del backend.
- Dejar de esperar o etiquetar franjas `arrival`, sin rechazar respuestas válidas.

**Estimación:** L (6hs).
**Dependencias:** T56, T59, T61.

### T64 — Conectar la eliminación de actividades

**Capa:** Frontend.

**Descripción:** Agregar la operación DELETE al adaptador frontend y una confirmación en el detalle. Reutilizar la baja transaccional existente completa DEL-01 y DEL-02 sin crear otro endpoint backend.

**Criterios de aceptación:**

- Permitir eliminar a admin y participante actual; cancelar no envía DELETE y guardar bloquea doble acción.
- Tras éxito, retirar actividad y sus controles personales, refrescar contexto y volver al origen conservando día/scroll; error o acceso revocado no anuncia eliminación.
- Probar que recuerdos, cadenas y publicaciones permanecen consultables, no se reasignan participantes y otras actividades no cambian.

**Estimación:** M (4hs).
**Dependencias:** T55, T62, T63, T36.

## 4. Recuerdos e interacciones

### T65 — Crear el compositor de recuerdos

**Capa:** Frontend.

**Descripción:** Implementar creación/edición conectadas a la API nueva con texto y ubicación opcionales. Mantener una base funcional para incorporar vínculos, fotos y gasto en PRs separados.

**Criterios de aceptación:**

- Publicar/guardar al final del formulario sin revisión intermedia ni fecha de publicación seleccionable.
- Permitir recuerdos sin itinerario o fuera del viaje y conservar createdAt al editar.
- Conservar borrador al volver de subformularios/error, bloquear doble envío y actualizar el listado tras guardar.

**Estimación:** L (6hs).
**Dependencias:** T54, T08, T09.

### T66 — Agregar el selector de vínculo

**Capa:** Frontend.

**Descripción:** Centralizar relaciones en Vincular a con Post y Actividad. Usar padre inmediato y transporte precargado evita tres selectores simultáneos en el compositor.

**Criterios de aceptación:**

- Seleccionar/cambiar/quitar vínculo y volver sin perder borrador; un hijo no mantiene otra relación directa.
- Excluir propio post/descendientes y presentar rechazos de ciclo/permisos sin guardar parcialmente.
- Aceptar transporte desde su detalle sin tercera opción; ofrecer Crear actividad espontánea dentro de Actividad.

**Estimación:** L (6hs).
**Dependencias:** T65, T55.

### T67 — Crear actividades desde el compositor

**Capa:** Frontend.

**Descripción:** Conectar el subformulario espontáneo al guardado conjunto del recuerdo. Precargar momento actual ajustable y reutilizar duración, límites y confirmación personal evita reglas distintas a las actividades planificadas.

**Criterios de aceptación:**

- Pedir título, fecha/hora y duración opcional sin selector de modo; conservar publicación automática del post.
- Guardar/vincular juntos; conflictos requieren confirmación y cancelación mantiene borradores sin publicar ni cambiar agenda.
- Soportar recuerdo nuevo y relink existente; errores no anuncian éxito ni dejan actividad huérfana visible.

**Estimación:** M (4hs).
**Dependencias:** T58, T66, T62.

### T68 — Crear el diario y las cadenas

**Capa:** Frontend.

**Descripción:** Implementar listado descendente y detalle con padre e hijos directos. Separar continuaciones de comentarios permite explorar ramas sin una lista recursiva confusa.

**Criterios de aceptación:**

- Diario reúne todas las publicaciones más recientes primero, incluso fuera del viaje; abrir detalle desde diario/actividad/transporte.
- Mostrar padre inmediato, hijos directos y Continuar recuerdo prelinked sin listar nietos como hijos.
- Volver restaura origen/panel/posición; admitir entradas textuales y estados vacíos sin inventar contenido.

**Estimación:** L (8hs).
**Dependencias:** T56, T66.

### T69 — Crear la API de comentarios

**Capa:** Backend.

**Descripción:** Implementar comentarios textuales con creación, edición y consulta autorizadas por Trip. Separar likes mantiene este PR centrado en comentarios y sus permisos.

**Criterios de aceptación:**

- Validar miembro actual, post y Trip; conservar autor/createdAt y rechazar texto inválido.
- Permitir edición por integrantes según PRD sin confundir comentarios con posts hijos.
- Serializar con expulsión/baja y probar ausencia de huérfanos y acceso a Trips ajenos.

**Estimación:** L (6hs).
**Dependencias:** T55, T10.

### T70 — Crear la API de likes

**Capa:** Backend.

**Descripción:** Implementar dar/quitar like de posts y comentarios como entidades separadas. Reutilizar índices únicos asegura operaciones repetibles bajo concurrencia.

**Criterios de aceptación:**

- Un like por usuario/entidad; repetir dar/quitar conserva contadores correctos.
- Validar membresía y entidad del mismo Trip en ambas colecciones.
- Evitar huérfanos al concurrir con baja/expulsión y conservar identidad de autores.

**Estimación:** M (4hs).
**Dependencias:** T69, T04.

### T71 — Conectar comentarios y likes

**Capa:** Frontend.

**Descripción:** Agregar comentarios y likes independientes al detalle del recuerdo. Mantener paneles y borradores separados evita perder texto al recorrer continuaciones.

**Criterios de aceptación:**

- Crear/editar comentarios y dar/quitar likes de post/comentario con contadores coherentes.
- Cambiar panel o volver conserva texto sin publicar; errores/reintentos no duplican interacciones.
- Mostrar carga/permisos y bloquear doble acción sin reconstruir la cadena ni perder posición.

**Estimación:** L (6hs).
**Dependencias:** T68, T69, T70.

## 5. Fotos y limpieza S3

### T72 — Crear el protocolo de fotos

**Capa:** Backend.

**Descripción:** Extender el adaptador S3 con uploads/confirmación para recuerdos nuevos o existentes. Reservar claves en el servidor evita publicar un post vacío para subir archivos o confiar en claves arbitrarias del cliente.

**Criterios de aceptación:**

- Autorizar lote por usuario/Trip, firmar PUT en su prefijo y confirmar existencia antes de registrar s3Key/order.
- Finalizar metadatos con el guardado del post y revalidar membresía/bajas; no publicar referencias de archivos fallidos.
- Mantener el bucket privado: servir lecturas con URL firmada GET de vencimiento corto solo a integrantes actuales del Trip de `postPhotos.tripId`, sin entidad adicional; reintentar sin duplicar fotos y probar acceso cruzado y confirmaciones inválidas.

**Estimación:** L (8hs).
**Dependencias:** T06, T54, T55, T58.

### T73 — Procesar la limpieza de fotos

**Capa:** Backend.

**Descripción:** Implementar el consumidor de storageDeletionJobs reutilizando la baja transaccional existente. Separarlo de carga mobile mantiene el PR centrado en limpieza S3 idempotente.

**Criterios de aceptación:**

- Eliminar solo claves del trabajo y tolerar objetos ausentes sin afectar otros Trips.
- Persistir reintentos/avance y completar al resolver todas las claves; fallos no bloquean/revierten baja del Trip.
- Probar fallo parcial/reejecución y limpiar lotes temporales abandonados sin borrar objetos vinculados.

**Estimación:** L (6hs).
**Dependencias:** T45, T72, T23.

### T74 — Cargar fotos desde el dispositivo

**Capa:** Frontend/nativo.

**Descripción:** Conectar selección/captura, uploads directos y confirmación de fotos al compositor. Mostrar progreso y reintentos por archivo permite preservar el resto del recuerdo ante fallos.

**Criterios de aceptación:**

- Binarios van directamente a S3 y solo confirmados se asocian al post; imágenes no atraviesan Lambda.
- Mantener selección/orden y quitar/reintentar; fallos no duplican post/fotos ni alteran publicación de un post existente.
- Resolver permisos/cancelación y revocación de membresía sin perder texto, vínculo o gasto del borrador.

**Estimación:** L (8hs).
**Dependencias:** T46, T72, T65.

### T75 — Consultar las fotos del viaje

**Capa:** Backend.

**Descripción:** Crear consulta agregada por Trip y actividad raíz. Resolver descendientes dinámicamente evita álbumes independientes o fotos mal asociadas después de un relink.

**Criterios de aceptación:**

- Orden descendente por publicación con desempate/orden de foto estable, origen postId y lectura autorizada.
- Actividad incluye descendientes de su raíz y se recalcula tras relink/baja sin borrar fotos.
- Restringir a miembros y consultar por páginas sin duplicados, incluyendo publicaciones fuera del itinerario.

**Estimación:** L (6hs).
**Dependencias:** T72, T55.

### T76 — Crear la galería navegable

**Capa:** Frontend.

**Descripción:** Conectar Fotos del diario y visor a las consultas del backend. Conservar acceso al recuerdo y posición evita duplicar referencias o perder el contexto al explorar imágenes.

**Criterios de aceptación:**

- Mostrar más recientes primero, cargar páginas y manejar vacío/error/reintento.
- Abrir visor/post de origen y volver a foto, panel y posición anteriores.
- Preparar grid reutilizable para alineación superior y filas comunes; ajuste estético integral queda en fase visual.

**Estimación:** L (6hs).
**Dependencias:** T75, T68, T74.

### T77 — Mostrar recuerdos y fotos de actividad

**Capa:** Frontend.

**Descripción:** Agregar Recuerdos/Fotos al detalle de actividad con sus cadenas completas. Reutilizar galería/detalle de recuerdo mantiene navegación y contenido consistentes.

**Criterios de aceptación:**

- Recuerdos incluye descendientes, miniaturas y texto solo; Fotos reúne únicamente imágenes de esa raíz.
- Abrir imagen/post y volver restaura actividad/pestaña; relink/baja actualiza contexto sin borrar contenido.
- Compartir precarga actividad correcta y mantiene disponible el formulario conjunto de espontánea.

**Estimación:** M (4hs).
**Dependencias:** T75, T76, T67.

## 6. Gastos y guardado completo

### T78 — Modelar pagos y reparto

**Capa:** Backend/dominio.

**Descripción:** Crear reglas con total, moneda, pagos y partes acordadas independientes. Calcular en centavos permite redondear correctamente y distinguir incompletos sin inventar deudas.

**Criterios de aceptación:**

- ARS/EUR/USD; pagos monto/% y shares monto/%/resto/exclusión, usuario único en shares y varios pagos.
- Rechazar excesos, distribuir sobrantes por orden y ajustar residuo porcentual según PRD; probar reglas mixtas.
- Distinguir completo/incompleto sin inventar moneda, pagador o reparto históricos.

**Estimación:** L (6hs).
**Dependencias:** T02, T44.

### T79 — Guardar gastos con los recuerdos

**Capa:** Backend.

**Descripción:** Crear persistencia/API del gasto opcional con moneda y desglose. Guardarlo conjuntamente con el recuerdo evita éxito parcial del formulario.

**Criterios de aceptación:**

- Relación única post/gasto y miembro actual; crear/editar post y gasto se valida y guarda atómicamente.
- register conserva importe/moneda/desglose sin deudas; cambiar modo no borra datos adicionales.
- Permitir completar registros anteriores sin duplicar ni asignar datos faltantes automáticamente.

**Estimación:** L (6hs).
**Dependencias:** T78, T54, T58.

### T80 — Guardar pagos y partes acordadas

**Capa:** Backend.

**Descripción:** Extender gastos con payments/shares configurables en balance. Preservar identidades anteriores permite incorporar integrantes nuevos sin alterar acuerdos al consultar.

**Criterios de aceptación:**

- Guardar pagos múltiples y partes monto/%/resto/exclusión validados junto al post/gasto.
- Conservar datos al cambiar modo, total o membresía; montos fijos no se recalculan como porcentajes.
- Señalar faltantes y distinguir borrador propuesto de persistencia; probar miembros nuevos, expulsados y que salieron del viaje, identificados como ex integrantes.

- Adaptar paidBy legado conocido a un único payment de percent: 100, de forma idempotente; conservar importe, identidad y moneda conocida, sin inventar moneda ni shares faltantes ni duplicar el pago en lecturas/migraciones repetidas.
- Probar paidBy nulo, usuario anterior, expulsado o que salió y gasto ya adaptado; sin datos completos queda por completar y fuera del balance.

**Estimación:** L (8hs).
**Dependencias:** T79, T78.

### T81 — Proyectar los gastos por fecha y moneda

**Capa:** Backend.

**Descripción:** Atribuir gasto a la actividad raíz o a publicación y actualizar resúmenes. Separar monedas evita sumar importes sin una conversión definida.

**Criterios de aceptación:**

- Usar scheduledAt de raíz o createdAt sin actividad, sin modificar esos instantes.
- Relink, reprogramación/baja recalculan proyección sin cambiar importes; incluir gastos fuera del itinerario en resumen del Trip.
- Totales separados en centavos y datos UTC para agrupar localmente, sin duplicar gastos de descendientes.

**Estimación:** M (4hs).
**Dependencias:** T79, T56.

### T82 — Calcular los balances por moneda

**Capa:** Backend.

**Descripción:** Calcular saldos y compensaciones sugeridas comparando aportes y partes acordadas. Incluir solo completos evita convertir datos faltantes en deudas o simular transferencias.

**Criterios de aceptación:**

- Solo balance genera deudas; separar ARS/EUR/USD sin conversión o suma entre monedas.
- Excluir incompletos con faltantes identificables, conservar suma cero y cada centavo resuelto.
- Recalcular tras edición/modo sin alterar registros ni excluir identidades históricas silenciosamente; pagos y partes de ex integrantes siguen en el balance identificados como tales.

**Estimación:** L (8hs).
**Dependencias:** T80, T81.

### T83 — Agregar gastos al compositor

**Capa:** Frontend.

**Descripción:** Conectar monto, moneda y desglose al guardado del recuerdo y sus resúmenes. Mantener pagos/reparto existentes aunque register no los muestre evita pérdida al cambiar de modo.

**Criterios de aceptación:**

- Editar gasto en el mismo guardado y conservar borrador al entrar/salir del subformulario.
- Mostrar fecha atribuida/publicación si difieren y acceder a gastos fuera del itinerario desde resumen.
- Separar monedas y mostrar errores de precisión sin duplicar ni borrar pagos al cambiar modo.

**Estimación:** L (6hs).
**Dependencias:** T79, T81, T65.

### T84 — Configurar los pagos y el reparto

**Capa:** Frontend.

**Descripción:** Agregar editor de aportes realizados y partes acordadas como secciones independientes. La propuesta inicial del resto es un borrador que el usuario confirma, no un acuerdo persistido al abrir.

**Criterios de aceptación:**

- Editar pagos monto/% y partes monto/%/resto/exclusión; porcentajes usan total y montos fijos permanecen fijos.
- Proponer miembros actuales ante reparto nuevo/vacío e incluir nuevos explícitamente sin duplicar/retirar históricos.
- Cancelación/error no persiste, mostrar incompletos/sobrantes y conservar datos entre modos.

**Estimación:** L (6hs).
**Dependencias:** T80, T83.

### T85 — Crear la vista de balances

**Capa:** Frontend.

**Descripción:** Mostrar saldos por persona/moneda y compensaciones del backend. Facilitar completar pendientes evita mostrar deudas que todavía no pueden calcularse.

**Criterios de aceptación:**

- Ocultar deudas en register y conservar acceso a gastos; separar monedas en balance.
- Listar incompletos editables y refrescar saldos tras guardar sin perder origen.
- No anunciar transferencias/cobros ejecutados; mostrar vacío/error y ex integrantes identificados como tales.

**Estimación:** L (6hs).
**Dependencias:** T82, T84.

### T86 — Adaptar los gastos del itinerario

**Capa:** Frontend.

**Descripción:** Actualizar el DTO y el render de gastos del itinerario al resumen por moneda del backend. Reemplazar la atribución local por dayId impide mezclar monedas o ubicar gastos bajo la publicación cuando corresponde la actividad raíz.

**Criterios de aceptación:**

- Validar moneda, pagos/partes e incompletos sin exigir paidBy; conservar lectura compatible de registros anteriores.
- Mostrar ARS/EUR/USD separados, sin total combinado ni conversiones, en centavos y sin recalcular un acuerdo en el cliente.
- Usar actividad raíz o publicación para agrupar en zona local; probar relink, cambio/baja de actividad y acceso desde resumen a gastos fuera del itinerario.

**Estimación:** M (4hs).
**Dependencias:** T81, T80, T63.

### T87 — Integrar el guardado completo del recuerdo

**Capa:** Backend.

**Descripción:** Componer los casos de uso existentes en una única operación de creación o edición con todos los campos del compositor. La transacción MongoDB debe incluir actividad espontánea, agenda, post, referencias de fotos y gasto cuando correspondan.

**Criterios de aceptación:**

- Una única confirmación guarda conjuntamente actividad nueva, post, going/cambio de plan, fotos confirmadas, gasto y payments/shares opcionales; revalidar permisos y agenda en esa operación.
- Fallar en cualquier validación o escritura revierte todos los cambios MongoDB; los uploads previos S3 no son una transacción y sus claves temporales quedan sujetas a limpieza, sin referencias públicas huérfanas.
- Reintentar la misma petición después de timeout no duplica post, actividad, fotos, gasto ni cambios de plan; probar rollback en cada etapa, cancelación y concurrencia.
- Cubrir independiente, cadena, transporte y relink de existente; editar conserva autor/createdAt y omitir campos no elimina datos existentes.

**Estimación:** L (6hs).
**Dependencias:** T58, T72, T80, T73.

### T88 — Conectar la publicación completa

**Capa:** Frontend.

**Descripción:** Conectar fotos, gasto y actividad del compositor a la operación conjunta del backend. Confirmar una sola vez evita publicar el post y terminar de guardar sus partes mediante requests independientes.

**Criterios de aceptación:**

- Enviar texto, vínculo, actividad nueva, fotos confirmadas y gasto/pagos/reparto en un único guardado final; no crear un post visible antes de completarlo.
- Mantener borrador y clave de reintento al fallar o cancelar el modal de agenda; timeout y doble toque no duplican publicaciones.
- Actualizar diario, actividad, participación y gastos solo tras éxito; probar espontánea con fotos y gasto, relink existente y rechazo de agenda sin efectos parciales.

**Estimación:** M (4hs).
**Dependencias:** T87, T67, T74, T83, T84.

## 7. Notificaciones, mapas y calendario

### T89 — Registrar los dispositivos push

**Capa:** Backend.

**Descripción:** Crear endpoints/persistencia de tokens vinculados al usuario autenticado. Separarlos de permisos y recepción de Capacitor mantiene el backend independiente de la interfaz nativa.

**Criterios de aceptación:**

- Registrar/actualizar/revocar idempotentemente, con modificación exclusiva del usuario autenticado.
- Evitar asignaciones duplicadas tras cambio de cuenta, retirar tokens inválidos y no registrarlos en logs.
- Validar proveedor/plataforma y autorización sin exigir permiso push para usar la app.

**Estimación:** L (6hs).
**Dependencias:** T45, T10.

### T90 — Registrar push desde Capacitor

**Capa:** Frontend/nativo.

**Descripción:** Conectar permisos, token nativo y revocación a la API. Solicitar permiso en contexto y conservar funcionamiento normal ante rechazo evita que push sea obligatorio para participar.

**Criterios de aceptación:**

- Registrar con usuario/permiso válidos; renovar y cerrar/cambiar sesión sin avisos a otra cuenta.
- Presentar denegación/ajustes sin bloquear viajes, participación ni Modificado.
- Probar adaptador y registrar en Android/iOS con credenciales externas al bundle.

**Estimación:** M (4hs).
**Dependencias:** T46, T89.

### T91 — Persistir los eventos y los avisos

**Capa:** Backend.

**Descripción:** Guardar eventos y avisos personales con la operación que los origina. Entrega diferida permite reintentar push sin anunciar cambios revertidos ni depender del dispositivo.

**Criterios de aceptación:**

- Emitir post, actividad, edición, ingreso, expulsión y comentario solo de operaciones guardadas, sin eventos de voto.
- Guardar motivo/nuevo intervalo y todas las incompatibles; expulsión solo al expulsado y compatibles sin aviso de desvinculación.
- Consultar avisos autorizados con IDs exactos y deduplicar reintentos sin consumir decisionRequired.

**Estimación:** L (8hs).
**Dependencias:** T44, T53, T87, T69.

### T92 — Despachar los avisos push

**Capa:** Backend.

**Descripción:** Conectar eventos persistidos al proveedor con reintentos y destinatarios correctos. Push complementa el indicador personal y nunca acredita un cambio no guardado.

**Criterios de aceptación:**

- Enviar a miembros relevantes y solo afectados de expulsión/conflicto, sin avisar transacciones fallidas.
- Conservar contenido/IDs y tolerar tokens inválidos o entrega repetida sin duplicar avisos de app.
- Probar cambios de contenido/ubicación/inicio/duración, espontáneas y comentarios sin votos/aprobación.

**Estimación:** L (8hs).
**Dependencias:** T45, T89, T91.

### T93 — Abrir los avisos en su contexto

**Capa:** Frontend/nativo.

**Descripción:** Implementar centro de avisos y apertura desde push con ID exacto de recurso. Manejar eliminación/expulsión sin abrir un viaje distinto evita navegación incorrecta o contenido privado.

**Criterios de aceptación:**

- Mostrar avisos propios y abrir Trip/actividad/post exacto en primer plano, segundo plano o inicio.
- Leer no consume Modificado y su explicación funciona sin permiso push.
- Volver conserva origen; tratar sesión vencida, recurso eliminado o acceso revocado sin exponer datos.

**Estimación:** L (6hs).
**Dependencias:** T92, T90, T91, T62, T68.

### T94 — Mostrar mapas y abrir la ubicación

**Capa:** Frontend/nativo.

**Descripción:** Agregar vista previa geográfica real y apertura en Maps para recuerdos/actividades. Reutilizar el componente evita confundir el dibujo del prototipo con una integración terminada.

**Criterios de aceptación:**

- Validar enlace y mostrar mapa estático/WebView real con Abrir en Maps; sin mapa vacío ante ausencia/enlace inválido.
- Manejar apertura/cancelación y error de proveedor sin bloquear edición ni perder borrador.
- Configurar restricciones/credenciales apropiadas sin secretos en código y probar enlaces soportados en Android/iOS.

**Estimación:** L (6hs).
**Dependencias:** T68, T61.

### T95 — Exportar el itinerario como ICS

**Capa:** Frontend.

**Descripción:** Generar exportación descargable con horarios precisos e identificadores estables. Separarla de calendario nativo evita prometer actualización automática de archivos ya importados.

**Criterios de aceptación:**

- Incluir nombre, franjas, planes y lugares sin filtro de confirmación ni fin inventado.
- UID estable por ID de dominio, UTC y DTEND solo si corresponde; cambiar zona no cambia identidad.
- Descargar/compartir nueva exportación tras cambios e informar reimportación de copia estática, con tests de formato.

**Estimación:** L (6hs).
**Dependencias:** T49, T56.

### T96 — Sincronizar el calendario vinculado

**Capa:** Frontend/nativo.

**Descripción:** Crear/actualizar/eliminar eventos nativos mediante el adaptador de Capacitor. Persistir referencias permite reconciliar cambios en el evento existente en vez de duplicarlo al reabrir.

**Criterios de aceptación:**

- Exportar planes/franjas sin aprobación y guardar referencia estable por cuenta/dispositivo/Trip/recurso.
- Reconciliar horario/duración/contenido y bajas al consultar/reanudar; conservar vínculo tras reinicio sin duplicar.
- Denegación/error no se informa sincronizado; ofrecer reintento/ICS y verificar alta/edición/baja en Android/iOS.

**Estimación:** L (8hs).
**Dependencias:** T46, T95, T53.

## 8. Navegación y listado funcional

### T97 — Agregar el detalle del transporte

**Capa:** Frontend.

**Descripción:** Crear el detalle funcional del segmento desde el itinerario usando sus datos existentes. Reunir sus recuerdos y abrir el compositor precargado completa el acceso contextual que todavía no tiene el cliente.

**Criterios de aceptación:**

- Abrir el segmento exacto con tipo, salida/llegada y tramos locales, preservando instantes y sin inventar horarios.
- Consultar todos sus recuerdos aunque se publiquen después; abrir post o crear con transportId precargado sin un tercer selector de vínculo.
- Volver restaura origen/día/scroll y maneja segmento eliminado, acceso revocado o errores sin abrir otro recurso.

**Estimación:** M (4hs).
**Dependencias:** T56, T68, T66, T30.

### T98 — Implementar las pestañas y el retorno

**Capa:** Frontend.

**Descripción:** Unificar funcionalmente Itinerario, Diario y Grupo y los paneles Posts/Fotos con componentes actuales. Centralizar contexto y posición permite probar navegación antes de aplicar tokens y composición finales.

**Criterios de aceptación:**

- Compartir estado del Trip y pestañas reales accesibles; detalles/formularios se abren fuera de ellas y vuelven a su origen, mientras Atrás desde raíz sale a Mis viajes.
- Restaurar destino, día, pestaña y scroll; cambiar día conserva lectura y tira de fechas, pulsar el seleccionado no reinicia y cambiar Trip no reutiliza estado ajeno.
- Probar ida/vuelta por recuerdo, fotos, actividad, grupo y transporte, incluido botón Atrás del dispositivo; no aplicar todavía la estética final.

**Estimación:** L (6hs).
**Dependencias:** T68, T76, T77, T64, T24, T97.

### T99 — Agregar el selector de destinos

**Capa:** Frontend.

**Descripción:** Abrir los destinos secuenciales desde el banner del itinerario utilizando transportes existentes. Resolver selección y salto como comportamiento funcional completa NAV-03 y NAV-04 antes del rediseño.

**Criterios de aceptación:**

- Mostrar orden y límites locales derivados; seleccionar un destino completo lleva al primer día y deja visible la fecha en la tira.
- Conservar el destino elegido cuando comparte fecha con otro; cerrar el selector no cambia día ni scroll.
- Indicar transportes faltantes sin inventar fechas ni habilitar un salto; probar zonas horarias, llegada/salida en el mismo día y destinos compartidos.

**Estimación:** M (4hs).
**Dependencias:** T98, T63, T57, T30.

### T100 — Proyectar las fechas del listado de viajes

**Capa:** Backend.

**Descripción:** Extender la consulta existente de Mis viajes y su DTO con fechas derivadas de los transportes. Obtener estos datos en el listado permite implementar Activos/Finalizados sin fechas manuales ni una consulta de itinerario por cada tarjeta.

**Criterios de aceptación:**

- Devolver por viaje startAt/endAt UTC como mínimo/máximo de departureAt y arrivalAt conocidos, de acuerdo con el prototipo aprobado; no persistir fechas manuales ni modificar transportes.
- Sin transportes devolver ambas fechas null; con configuración incompleta conservar solo los límites derivados de datos conocidos, sin inventar horarios o ampliar el itinerario.
- Consultar solo viajes del integrante autenticado, mediante lectura agrupada de transportes; mantener compatibilidad de consumidores y no ampliar el detalle público.
- Probar múltiples destinos, transportes incompletos/ausentes, precisión temporal y fechas actualizadas tras editar transportes; mantener autorización y estados de error.

**Estimación:** L (6hs).
**Dependencias:** T20, T29, T57.

### T101 — Filtrar los viajes activos y finalizados

**Capa:** Frontend.

**Descripción:** Adaptar TripSummary y el listado existente a las fechas derivadas para implementar las pestañas Activos/Finalizados con componentes actuales. Separar clasificación y carga de su presentación deja el comportamiento conectado y probado antes de aplicar el diseño azul.

**Criterios de aceptación:**

- Usar startAt/endAt del listado sin solicitar cada itinerario; Finalizados contiene endAt anterior al instante actual, Activos incluye endAt igual/posterior o ausente, según el prototipo aprobado.
- Comparar instantes UTC con reloj testeable y mostrar fechas locales sin alterar la clasificación por zona horaria; recalcular al reanudar/actualizar y al alcanzar el límite temporal.
- Mantener selección de pestaña al volver desde un viaje, estados vacíos/carga/error por filtro y refresco tras cambios de transportes, sin duplicar viajes ni exponer los ajenos.
- Probar viajes futuros, terminados, sin transportes y configuración incompleta, límite exacto y cambio de zona; no aplicar todavía la presentación final.

**Estimación:** M (4hs).
**Dependencias:** T100, T21, T98.

## 9. Protección y pruebas funcionales

### T102 — Completar la protección de la API

**Capa:** Backend.

**Descripción:** Agregar rate limiting de Auth y completar observabilidad/sanitización existentes. Reutilizar logs y validaciones evita rehacer trabajo ya cubierto y protege información sensible.

**Criterios de aceptación:**

- Limitar abuso con estado compartido adecuado para Lambda; probar rechazo y recuperación.
- Mantener requestId y errores útiles sin tokens, contraseñas, claves privadas o payloads sensibles.
- Cubrir cuerpos sobredimensionados/entradas inesperadas en endpoints nuevos, con configuración por entorno y tests de redacción.

**Estimación:** L (6hs).
**Dependencias:** T05, T12, T54.

### T103 — Probar los flujos de API integrados

**Capa:** Backend/pruebas.

**Descripción:** Crear recorridos integrados del backend final en un entorno aislado. Complementar pruebas por PR con operaciones entre repositorios, permisos y concurrencia permite validar el stack real.

**Criterios de aceptación:**

- Probar registro sin nombre, invitación, transportes, autor going, conflictos, pending del sistema, cadenas, gastos y fotos confirmadas.
- Rechazar pending manual por HTTP sin escrituras ni consumo de decisionRequired; probar going/not_going explícitos y listado con fechas derivadas actualizadas, sin transportes y acceso autorizado.
- Probar rollback/concurrencia, acceso revocado y bajas preservando cadenas o trabajos S3 según operación.
- Ejecutar CI/dev aislado con fixtures propios y limpieza controlada; nunca usar/borrar datos dev ajenos.

- Ejecutar la publicación compuesta con actividad, agenda, fotos y gasto/pagos/reparto; fallos inyectados y reintentos conservan atomicidad y no duplican datos, incluyendo el fixture legado paidBy.
- Probar titularidad, gestión de admins, salida/expulsión con participaciones futuras eliminadas y anteriores conservadas, baja solo del titular y moneda de transportes.

**Estimación:** L (8hs).
**Dependencias:** T48, T57, T87, T70, T73, T82, T92, T102, T100, T116, T119.

### T104 — Probar los recorridos funcionales

**Capa:** Frontend/pruebas.

**Descripción:** Automatizar cliente conectado a API antes de aplicar la capa visual. Mantener estos recorridos durante el rediseño separa regresiones funcionales de ajustes de apariencia.

**Criterios de aceptación:**

- Cubrir compositor, cadenas, fotos, gasto, participación/conflicto y Modificado con cancelación/reintento/recarga.
- Cubrir permisos, sesión vencida, avisos y zonas horarias sin modificar publicación o vínculos.
- Ejecutar con fixtures reproducibles y workers acotados; tests del prototipo no sustituyen evidencia del cliente real.

- Probar DEL-01/DEL-02 y NAV-01–NAV-04 sobre aplicación conectada antes del diseño; probar publicación completa y gasto atribuido por raíz/publicación con monedas separadas.
- Probar Activos/Finalizados con API real, viajes sin transportes/configuración incompleta, límite temporal y refresco tras cambios; volver conserva el filtro sin implementar comportamiento nuevo en la fase visual.
- Probar Grupo por rol (titular, admin, participante), salida y transferencia, moneda de transportes y refresco periódico o al reanudar sin perder borradores.

**Estimación:** L (8hs).
**Dependencias:** T103, T60, T71, T77, T85, T93, T94, T96, T63, T64, T86, T88, T98, T97, T99, T101, T118, T120, T121.

## 10. Aplicación visual final

### T105 — Aplicar los tokens y controles aprobados

**Capa:** Frontend/visual.

**Descripción:** Portar azul y Manrope del diseño fijado a componentes React reutilizables. Cambiar apariencia de funciones conectadas sin alterar reglas ni contratos permite aplicar el diseño al final.

**Criterios de aceptación:**

- Usar tokens de DESIGN.md en controles, tarjetas, estados, foco/superficies sin verde/marrón heredados.
- Conservar accesibilidad, loading/error/disabled y tamaños táctiles sin estilos base duplicados.
- Verificar componentes a 320/390 px y pantalla amplia con las pruebas funcionales existentes.

**Estimación:** L (6hs).
**Dependencias:** T104, T08.

### T106 — Adaptar la cabecera y las pestañas

**Capa:** Frontend/visual.

**Descripción:** Aplicar la presentación aprobada al shell y las pestañas funcionales ya implementadas. Reutilizar su estado y retorno evita reconstruir navegación en el PR visual.

**Criterios de aceptación:**

- Aplicar composición, espaciado y estados de selección aprobados a cabecera/pestañas sin cambiar rutas ni la gestión de contexto.
- Mantener accesibilidad y recorridos de retorno/scroll cubiertos por las pruebas funcionales, sin implementar otro shell paralelo.
- Ocupar pantalla disponible con safe areas/teclado, sin marcos, estudio o huecos bajo navbar.

**Estimación:** M (4hs).
**Dependencias:** T105, T98.

### T107 — Adaptar acceso y perfil al diseño

**Capa:** Frontend/visual.

**Descripción:** Aplicar bienvenida, login, registro y perfil aprobados. Conservar los flujos corregidos y los estados reales de sesión evita reintroducir requisitos descartados.

**Criterios de aceptación:**

- Replicar jerarquía/navegación azul sin nombre obligatorio ni verificación en registro.
- Integrar avatar/nombre, guardado/error y sesión vencida sin copy de estudio o funciones futuras.
- Verificar teclado, foco, safe areas y textos largos a 320/390 px.

**Estimación:** L (6hs).
**Dependencias:** T105, T60, T16.

### T108 — Adaptar el itinerario y los planes

**Capa:** Frontend/visual.

**Descripción:** Aplicar la presentación aprobada al itinerario, selector de destinos y detalles/formularios funcionales existentes. Reutilizar intervalos, participación, eliminación y navegación conectados mantiene las reglas intactas.

**Criterios de aceptación:**

- Aplicar presentación aprobada al selector funcional de destinos, incluidos límites y faltantes, conservando salto y selección ya probados.
- Mantener separación destino/calendario, scroll y ventanas; mostrar fin/duración/fecha y Modificado personal accesible.
- Replicar tarjetas/modales/formularios sin perder precisión, validaciones, tramos o contexto al volver.

**Estimación:** L (8hs).
**Dependencias:** T106, T61, T62, T57, T64, T97, T99.

### T109 — Adaptar recuerdos y fotos al diseño

**Capa:** Frontend/visual.

**Descripción:** Aplicar compositor, diario, cadenas y galería aprobados con los componentes conectados. Conservar publicación directa y acceso flotante permite explorar sin reconstruir reglas de vínculo.

**Criterios de aceptación:**

- Vincular a único, padre compacto, hijos/comentarios separados y miniaturas de actividad.
- FAB en Posts/Fotos sin tapar último elemento; orden descendente y origen del visor conservados.
- Grid alineada arriba y filas iguales con títulos multilínea; probar textos solos, imágenes y vacío/error.

**Estimación:** L (8hs).
**Dependencias:** T106, T88, T71, T76, T77.

### T110 — Adaptar viajes y grupo al diseño

**Capa:** Frontend/visual.

**Descripción:** Aplicar Mis viajes, creación/configuración, descubrimiento y grupo/invitación aprobados. Conservar separación de acciones administrativas y confirmaciones reales evita cambios de permisos.

**Criterios de aceptación:**

- Aplicar la presentación aprobada a Activos/Finalizados ya conectados y probados en T101/T104; no introducir aquí consultas, clasificación ni reglas de fechas.
- Replicar presentación de descubrimiento/perfil y creación sin fechas manuales, conservando los flujos existentes.
- Conservar Grupo, código/link, unión y permisos sin votación; configuración permanece conectada.
- Adaptar bajas/expulsión y estados vacíos/carga/error; volver no mezcla viajes ni pierde contexto.
- Aplicar el diseño de T117 a titular, admins, transferencia y salida, conservando permisos y confirmaciones de T118.

**Estimación:** M (4hs).
**Dependencias:** T106, T59, T27, T24, T101, T117, T118.

### T111 — Adaptar gastos y balances al diseño

**Capa:** Frontend/visual.

**Descripción:** Aplicar gasto, pagos/reparto y balances aprobados. Reutilizar controles comunes conserva el acuerdo configurado mientras mejora su presentación.

**Criterios de aceptación:**

- Separar pagos/partes y mostrar monedas/faltantes sin deudas inventadas ni conversión.
- Presentar nuevos integrantes, exclusión y resto con filas legibles sin perder datos al cancelar/volver.
- Mostrar fechas de gasto/publicación distintas y acceso a gastos fuera del itinerario en ambos modos.

**Estimación:** L (6hs).
**Dependencias:** T105, T85, T84, T86.

### T112 — Adaptar avisos y exportaciones al diseño

**Capa:** Frontend/visual.

**Descripción:** Aplicar avisos, mapas y calendario aprobados sobre integraciones reales. Diferenciar permiso, error, archivo descargado y sincronización evita mensajes de éxito falsos.

**Criterios de aceptación:**

- Avisos personales y componentes comunes con acceso exacto; lectura no consume Modificado.
- Mostrar mapa real sin dibujo placeholder y estados de apertura/permisos coherentes.
- No anunciar entrega/sincronización fallida y distinguir ICS estático de actualización nativa.

**Estimación:** M (4hs).
**Dependencias:** T105, T93, T94, T96.

### T113 — Verificar la aplicación visual en dispositivos

**Capa:** Frontend/nativo/pruebas.

**Descripción:** Validar aplicación real contra diseño fijado y PRD en iOS/Android. Limitar el PR a pruebas finales y regresiones de presentación sin reabrir producto.

**Criterios de aceptación:**

- Probar navbar, safe areas, teclado, Atrás, texto escalado, orientación y 320/390 px sin overflow.
- Verificar fotos/push/calendario/mapas y recorridos tras rediseño en Android/iOS con evidencia de dispositivo.
- Guardar capturas/resultados reproducibles; corregir diferencias visuales acotadas y reportar aparte cambios funcionales imprevistos.

**Estimación:** L (8hs).
**Dependencias:** T107, T108, T109, T110, T111, T112, T123, T125, T128, T129, T132, T134, T136, T138, T139, T143, T144, T145, T146.

## 11. Ajustes aprobados el 2026-11-08

Tareas derivadas de los cambios al PRD del 2026-11-08: titularidad y gestión de admins, salida del viaje, moneda del costo de transportes y actualización periódica. Algunas ajustan funcionalidades ya terminadas (T19–T30). Los IDs continúan la numeración y no indican orden de ejecución: las dependencias lo definen.

### T114 — Incorporar la titularidad del viaje

**Capa:** Backend.

**Descripción:** Agregar `ownerId` a Trips para distinguir al titular actual de `createdBy`, que queda como dato histórico. Restringir la baja del viaje al titular alinea los permisos ya implementados con el PRD.

**Criterios de aceptación:**

- Crear viajes con ownerId igual al creador y migrar de forma idempotente los existentes desde createdBy, sin borrar ni reescribir otros datos dev; diagnosticar viajes cuyo creador ya no es miembro sin corregirlos silenciosamente.
- Exponer el titular en el detalle y en los integrantes; el titular siempre conserva el rol admin.
- Permitir eliminar el Trip solo al titular; otros admins y participantes reciben rechazo sin efectos, manteniendo la cascada y los storageDeletionJobs existentes.

**Estimación:** M (5hs).
**Dependencias:** T44, T19, T23.

### T115 — Gestionar admins y transferir la titularidad

**Capa:** Backend.

**Descripción:** Agregar operaciones del titular para nombrar o quitar admins y transferir la titularidad, y ampliar la expulsión a admins. Serializar estos cambios con las demás mutaciones del Trip evita quedar sin titular o con permisos inconsistentes bajo concurrencia.

**Criterios de aceptación:**

- Solo el titular cambia el rol de integrantes actuales; nadie quita el rol admin al titular y repetir la operación es idempotente.
- Transferir a otro integrante actual lo deja admin y titular y conserva admin al anterior, en una transacción.
- Los admins expulsan participantes; solo el titular expulsa admins y nadie expulsa al titular. Probar rechazos sin escrituras y concurrencia con bajas y transferencias.

**Estimación:** L (6hs).
**Dependencias:** T114.

### T116 — Permitir salir del viaje

**Capa:** Backend.

**Descripción:** Agregar la salida voluntaria y aplicar a salida y expulsión la misma limpieza de participaciones. Conservar el contenido y las participaciones ya iniciadas mantiene el registro del viaje sin dejar planes futuros con personas ausentes.

**Criterios de aceptación:**

- Cualquier integrante sale con confirmación; el titular recibe rechazo hasta transferir la titularidad o eliminar el Trip.
- Al salir o ser expulsado se retira la membresía, se conservan las participaciones de actividades con inicio anterior a ese momento y se eliminan las futuras con sus marcas decisionRequired, sin reasignar a nadie.
- Conservar posts, fotos, comentarios, likes, pagos y partes; serializar con participación, edición de actividades y bajas sin escrituras parciales, y probar el límite exacto de inicio.

**Estimación:** L (6hs).
**Dependencias:** T115, T53.

### T117 — Diseñar salida, titularidad y moneda de transportes

**Capa:** Diseño/prototipo.

**Descripción:** Extender el prototipo azul aprobado con las pantallas y estados que agregó el PRD el 2026-11-08. Definir su diseño antes de implementarlos evita inventar interfaz en los PRs funcionales y visuales.

**Criterios de aceptación:**

- En Grupo: titular identificado, hacer/quitar admin, transferir titularidad, expulsar admin y salir, con confirmaciones; el titular que intenta salir elige transferir o eliminar.
- Moneda en el costo de ómnibus/avión, «moneda sin indicar» para registros previos, costos de transporte por moneda en el resumen y ex integrantes identificados en gastos y balance.
- Reutilizar tokens y componentes de DESIGN.md sin modificar flujos aprobados; actualizar PRD-AUDIT y README del prototipo y obtener aprobación del usuario.

**Estimación:** M (4hs).
**Dependencias:** Ninguna.

### T118 — Conectar titularidad, admins y salida

**Capa:** Frontend.

**Descripción:** Agregar a Grupo las acciones del titular y la salida del viaje con los componentes actuales. Mostrar solo las acciones permitidas y refrescar ante cambios de rol evita operaciones rechazadas o menús desactualizados.

**Criterios de aceptación:**

- Mostrar titular y admins; el titular nombra/quita admins, transfiere y expulsa admins; los admins expulsan participantes; eliminar el viaje solo aparece al titular.
- Salir con confirmación; el titular ve transferir o eliminar; tras salir se vuelve a Mis viajes sin conservar datos del Trip.
- Manejar rechazos por permisos cambiados, errores y doble acción; probar cada rol sin aplicar todavía la estética final.

**Estimación:** L (6hs).
**Dependencias:** T115, T116, T117, T24.

### T119 — Agregar moneda al costo de transportes

**Capa:** Backend.

**Descripción:** Extender transportes con costCurrency obligatoria cuando hay costo y exponer los totales por moneda del resumen del Trip. Separar monedas y no inventar la de registros previos mantiene la regla de gastos sin conversiones.

**Criterios de aceptación:**

- Aceptar ARS/EUR/USD y rechazar costo sin moneda en escrituras nuevas, sin modificar el resto del transporte.
- Leer costos anteriores sin moneda como «sin indicar», sin migrarlos ni sumarlos; editarlos exige elegir moneda.
- Totalizar el costo por persona por moneda, fuera del balance y de los gastos de posts; probar varios destinos y monedas mezcladas.

**Estimación:** M (4hs).
**Dependencias:** T44, T29.

### T120 — Mostrar moneda y costo de transportes

**Capa:** Frontend.

**Descripción:** Agregar la moneda al formulario de transporte y mostrar los costos en el resumen del Trip. Reutilizar el formateo por moneda de los gastos evita sumar monedas distintas en el cliente.

**Criterios de aceptación:**

- Elegir moneda al cargar costo en ómnibus/avión; los registros previos muestran «moneda sin indicar» y piden elegirla al editar.
- Mostrar costos por transporte y totales por moneda en el resumen, separados de gastos y balance.
- Conservar borrador ante error y probar transporte sin costo, con costo y registro previo.

**Estimación:** M (4hs).
**Dependencias:** T119, T117, T30, T83.

### T121 — Actualizar los datos periódicamente

**Capa:** Frontend.

**Descripción:** Refrescar los datos del Trip al volver a primer plano o a una pantalla, al deslizar hacia abajo y cada 30–60 s mientras la pantalla está visible. Centralizarlo en la carga de datos evita consultas en segundo plano y pérdida de borradores.

**Criterios de aceptación:**

- Refrescar al reanudar la app y al volver a una pantalla; deslizar para refrescar en los listados del Trip; intervalo solo con la app en primer plano y la pantalla visible.
- No duplicar requests en curso ni interrumpir formularios o borradores; conservar scroll y selección; detenerse en segundo plano y al salir del Trip.
- Ante acceso revocado o Trip eliminado volver a Mis viajes sin exponer datos; probar con reloj y ciclo de vida simulados.

**Estimación:** M (4hs).
**Dependencias:** T98, T09.

## 12. Correcciones aprobadas el 2026-11-12

Tareas derivadas de la resolución de `docs/REVISION_PENDIENTE.md` y del PRD del 2026-11-12. Los IDs continúan la numeración y no indican orden de ejecución: las dependencias lo definen.

### T122 — Exigir el contenido mínimo de los recuerdos

**Capa:** Backend.

**Descripción:** Rechazar crear o dejar vacío un recuerdo sin texto, ubicación ni foto, y aplicar los límites de texto del PRD. Validarlo en el servidor evita depender de la regla provisoria del cliente.

**Criterios de aceptación:**

- POST y PATCH de recuerdos responden 422 si no queda texto (tras trim), ubicación ni foto confirmada; gasto y vínculo no cuentan, y un PATCH que quita el último contenido se rechaza sin escrituras.
- Texto del recuerdo hasta 5000 code points y desglose del gasto hasta 2000; un exceso responde 422 con el campo, sin recortar.
- Probar creación solo con foto, edición que borra el texto conservando fotos publicadas, reintento idempotente de T87 y publicación compuesta sin escrituras parciales.

**Estimación:** M (4hs).
**Dependencias:** T87, T79.

### T123 — Adaptar el contenido mínimo en el compositor

**Capa:** Frontend.

**Descripción:** Alinear la validación del compositor con la regla del backend, contando también las fotos ya publicadas al editar. Así la app no bloquea ediciones válidas ni deja pasar recuerdos vacíos.

**Criterios de aceptación:**

- Al editar, las fotos ya publicadas cuentan como contenido; crear exige texto, ubicación o foto.
- Avisar los límites de 5000 y 2000 caracteres sin recortar y mapear los 422 del backend al campo, conservando el borrador.
- Probar crear solo con foto, editar quitando el texto con fotos publicadas y los límites.

**Estimación:** S (3hs).
**Dependencias:** T122, T88.

### T124 — Restringir la edición al autor

**Capa:** Backend.

**Descripción:** Permitir editar el contenido de un recuerdo o comentario solo a su autor, manteniendo abiertos a todo integrante el gasto, su reparto y las actividades. Esto protege lo que publicó cada persona sin trabar el registro de gastos del grupo.

**Criterios de aceptación:**

- Solo el autor edita descripción, ubicación, fotos y vínculos de su recuerdo y el texto de su comentario; otro integrante recibe 403 sin escrituras, también en un PATCH que mezcla gasto y contenido.
- Cualquier integrante actual sigue editando gasto, pagos y reparto (PATCH solo con `expense`) y las actividades; el contenido de un ex integrante no lo edita nadie.
- Probar autor, otro integrante, admin y ex integrante, y que los reintentos de T87 sigan funcionando para el autor.

**Estimación:** M (4hs).
**Dependencias:** T87, T69.

### T125 — Mostrar la edición según la autoría

**Capa:** Frontend.

**Descripción:** Ofrecer «Editar» en recuerdos y comentarios solo a su autor y mantener accesible el gasto para todos. Evita acciones que el backend va a rechazar.

**Criterios de aceptación:**

- «Editar» de recuerdo y de comentario aparece solo al autor; gasto, pagos y reparto siguen accesibles a cualquier integrante.
- Un 403 por autoría muestra un mensaje y conserva el borrador.
- Probar autor, otro integrante y ex integrante.

**Estimación:** S (3hs).
**Dependencias:** T124.

### T126 — Eliminar recuerdos y comentarios

**Capa:** Backend.

**Descripción:** Agregar la baja de recuerdos y comentarios por su autor o un admin, con la limpieza que define el PRD. Hacerlo en una transacción con el bloqueo del Trip evita cadenas rotas o datos huérfanos.

**Criterios de aceptación:**

- DELETE de recuerdo (autor o admin) borra sus postPhotos encolando el borrado en storageDeletionJobs, su gasto, sus comentarios y sus likes; sus continuaciones pasan a colgar del padre del eliminado o quedan independientes, conservando su contenido.
- DELETE de comentario (autor o admin) borra sus likes; repetir la baja responde 404; un no integrante recibe 404.
- Probar cadenas ramificadas, balance tras borrar un gasto, fotos encoladas y concurrencia con edición, comentarios y publicación de continuaciones.

**Estimación:** L (8hs).
**Dependencias:** T124, T73.

### T127 — Quitar fotos y gasto al editar

**Capa:** Backend.

**Descripción:** Permitir al autor quitar fotos ya publicadas y a cualquier integrante quitar el gasto de un recuerdo. Completa la edición sin obligar a borrar el recuerdo entero.

**Criterios de aceptación:**

- PATCH permite al autor quitar fotos por clave, encolando su borrado en S3 y reordenando las restantes, respetando el contenido mínimo.
- `expense: null` quita el gasto (cualquier integrante actual) y lo retira del registro y del balance.
- Probar reintentos idempotentes de T87 con fotos quitadas, contenido mínimo y balance tras quitar el gasto.

**Estimación:** M (5hs).
**Dependencias:** T126.

### T128 — Conectar la eliminación y las quitas

**Capa:** Frontend.

**Descripción:** Agregar en la app eliminar recuerdos y comentarios, y quitar fotos y gasto al editar. Reutilizar los diálogos de confirmación existentes mantiene el diseño aprobado.

**Criterios de aceptación:**

- Eliminar recuerdo (detalle) y comentario con confirmación, visibles para el autor o un admin; tras eliminar se vuelve al origen y se refresca.
- El compositor permite quitar fotos publicadas y quitar el gasto.
- Manejar errores y permisos cambiados; probar cadenas y estados, usando componentes de DESIGN.md.

**Estimación:** L (6hs).
**Dependencias:** T126, T127, T125.

### T129 — Convertir fotos HEIC y reducir las pesadas

**Capa:** Frontend/nativo.

**Descripción:** Convertir a JPEG las fotos HEIC/HEIF y reducir las que superan 10 MiB antes de reservarlas. Sin esto, muchas fotos de iPhone no se pueden subir.

**Criterios de aceptación:**

- HEIC/HEIF se convierten a JPEG y las fotos de más de 10 MiB se reducen (lado mayor y calidad) hasta entrar en el límite.
- Si una conversión falla, se informa esa foto y no se publica el recuerdo sin ella en silencio.
- Probar con puertos simulados; la verificación en dispositivo queda para T113.

**Estimación:** M (5hs).
**Dependencias:** T74.

### T130 — Derivar el fin del viaje con la vuelta faltante

**Capa:** Backend.

**Descripción:** Dejar vacío el fin del viaje cuando falta la vuelta en algún destino o no hay transportes, y listar sin error los viajes con datos incompletos. Evita que un viaje pase a Finalizados antes de tiempo.

**Criterios de aceptación:**

- `endAt` queda null si no hay transportes o si algún destino no tiene transporte de vuelta.
- Un viaje sin destino primario se lista sin fechas, sin error 500.
- Probar el listado y el filtro de T101 con configuraciones completas e incompletas.

**Estimación:** S (3hs).
**Dependencias:** T100.

### T131 — Restringir el modo de gastos a admins

**Capa:** Backend.

**Descripción:** Permitir cambiar el modo de gastos solo a admins, incluido el titular. Cambiarlo afecta a todo el grupo y no debería hacerlo cualquier integrante.

**Criterios de aceptación:**

- Cambiar `expenseMode` exige rol admin; un participante recibe 403 sin escrituras.
- Cambiar de modo conserva pagos y reparto.
- Probar titular, admin y participante.

**Estimación:** S (2hs).
**Dependencias:** T82.

### T132 — Ofrecer el modo de gastos en la configuración

**Capa:** Frontend.

**Descripción:** Mostrar el selector de modo de gastos en la configuración del viaje para admins y en lectura para el resto. Hoy no hay ningún lugar desde donde cambiarlo.

**Criterios de aceptación:**

- La configuración del viaje muestra el modo; solo admins pueden cambiarlo.
- El balance ofrece a los admins un acceso a esa configuración.
- Probar roles y el refresco del balance tras cambiar de modo.

**Estimación:** S (3hs).
**Dependencias:** T131, T85.

### T133 — Validar importes y costos

**Capa:** Backend.

**Descripción:** Aplicar a gastos, pagos fijos y costos de transporte los límites de importe del PRD. Evita costos negativos y montos no representables.

**Criterios de aceptación:**

- `costPerPerson` debe ser mayor que 0 y hasta 999.999.999.999,99 con dos decimales; sin costo queda null.
- `totalAmount` y los montos fijos nuevos respetan el mismo tope; un exceso responde 422 con el campo, sin escrituras.
- Probar los bordes y que los registros ya guardados se lean igual.

**Estimación:** M (3hs).
**Dependencias:** T119, T80.

### T134 — Validar importes en los formularios

**Capa:** Frontend.

**Descripción:** Reflejar en los formularios de transporte, gasto y reparto los mismos límites del backend. Así el error aparece antes de enviar.

**Criterios de aceptación:**

- El formulario de transporte rechaza costos menores o iguales a 0 y los que superan el tope.
- Gasto y pagos fijos avisan el tope sin redondear y conservan el borrador.
- Probar los bordes.

**Estimación:** S (2hs).
**Dependencias:** T133, T120, T84.

### T135 — Emitir avisos de salida, rol y transferencia

**Capa:** Backend.

**Descripción:** Agregar los avisos nuevos del PRD, unificar los textos del push con los del centro de avisos y retener los avisos 90 días. Completa los eventos que hoy no informan nada.

**Criterios de aceptación:**

- `member.left` a los demás integrantes, cambio de rol al afectado y transferencia al nuevo titular, emitidos en la misma transacción de cada operación y despachados por push.
- Los textos del push de todos los tipos coinciden con los del centro de avisos (T93).
- Los avisos se eliminan a los 90 días mediante un índice TTL, sin afectar trabajos de despacho vigentes; probar destinatarios y deduplicación.

**Estimación:** L (7hs).
**Dependencias:** T116, T115, T92.

### T136 — Mostrar los avisos nuevos

**Capa:** Frontend.

**Descripción:** Agregar al centro de avisos los tres tipos nuevos y omitir los avisos que la app no reconoce. Un aviso inválido no debe impedir ver los demás.

**Criterios de aceptación:**

- Textos y destinos de salida, cambio de rol y transferencia dentro del Trip correspondiente.
- Un aviso inválido o de tipo desconocido se omite y se registra sin romper la página.
- Probar el parser, la navegación y la apertura desde push simulado.

**Estimación:** M (4hs).
**Dependencias:** T135, T93.

### T137 — Ocultar la existencia del viaje a no integrantes

**Capa:** Backend.

**Descripción:** Responder 404 a quien no es integrante en todas las operaciones del Trip y exponer solo el titular real. Evita revelar si un viaje existe y mostrar titulares incoherentes.

**Criterios de aceptación:**

- Un no integrante recibe 404 en todas las rutas del Trip, incluida la expulsión.
- Detalle y listado exponen el `ownerId` real, sin usar `createdBy` de respaldo.
- Probar las rutas de administración con integrante, ex integrante y ajeno.

**Estimación:** S (3hs).
**Dependencias:** T115, T114.

### T138 — Actualizar el plan anterior al cambiar de plan

**Capa:** Frontend.

**Descripción:** Corregir que, tras confirmar un cambio de plan, la pantalla siga mostrando «Voy» en el plan anterior hasta el próximo refresco (bug A de T104).

**Criterios de aceptación:**

- Confirmar el cambio actualiza en pantalla todas las actividades incompatibles a «No voy» sin esperar el refresco.
- Quitar el `it.fails` correspondiente de T104 y dejar la prueba en verde.
- Probar cancelación y error sin cambios locales.

**Estimación:** S (3hs).
**Dependencias:** T62.

### T139 — Conservar los borradores al pasar por el diario

**Capa:** Frontend.

**Descripción:** Evitar que se pierdan los borradores de recuerdo y comentario al ir del compositor o del detalle al diario y volver (bug B de T104).

**Criterios de aceptación:**

- Los borradores sobreviven a la navegación entre compositor, detalle y diario dentro del Trip.
- Quitar el `it.fails` correspondiente de T104 y dejar la prueba en verde.
- Los borradores se descartan al salir del Trip o al publicar.

**Estimación:** M (4hs).
**Dependencias:** T98.

### T140 — Permitir el origen de Android en CORS

**Capa:** Infraestructura.

**Descripción:** Agregar el origen `https://localhost` que usa Capacitor ≥6 en Android, o fijar `androidScheme`, de forma consistente entre API y bucket. Sin esto, la app en Android no puede llamar a la API ni subir fotos.

**Criterios de aceptación:**

- API Gateway y el CORS del bucket aceptan el origen real de la app en Android e iOS.
- Actualizar `scripts/infrastructure-contract.test.mjs` y la configuración de Capacitor si corresponde.
- Sin desplegar.

**Estimación:** S (2hs).
**Dependencias:** T45.

### T141 — Completar los permisos de fotos

**Capa:** Infraestructura/backend.

**Descripción:** Dar a la API y al worker de limpieza los permisos de S3 que exige el protocolo de fotos, y rechazar confirmaciones de subidas viejas. Sin estos permisos las fotos fallan al desplegar.

**Criterios de aceptación:**

- La API tiene `s3:GetObject` y `s3:ListBucket` con prefijo `trips/*`; el worker de limpieza tiene `ListBucket`; los contratos de infraestructura lo reflejan.
- `ObjectHead` incluye `lastModified` y la confirmación rechaza subidas de más de 23 horas.
- Sin desplegar; probar con el bucket simulado.

**Estimación:** M (4hs).
**Dependencias:** T72, T73.

### T142 — Integrar SNS y los workers

**Capa:** Infraestructura/backend.

**Descripción:** Completar la composición productiva del push con el SDK de SNS y definir las funciones de eventos y limpieza en `serverless.yml`. Deja todo listo para desplegar sin cargar credenciales reales.

**Criterios de aceptación:**

- Agregar `@aws-sdk/client-sns` con fábrica productiva, `requestTimeout` por llamada y reactivación de endpoints deshabilitados (`SetEndpointAttributes`).
- Definir las funciones `events` y `storage-deletion` con roles, permisos, variables y timeout menor al lease; reglas EventBridge parametrizadas.
- Actualizar los contratos de infraestructura; sin desplegar ni credenciales reales.

**Estimación:** L (8hs).
**Dependencias:** T92, T73, T140.

### T143 — Guardar y compartir el calendario

**Capa:** Frontend/nativo.

**Descripción:** Guardar el `.ics` en el dispositivo y abrir la hoja de compartir. La descarga por Blob no guarda archivos dentro del WebView.

**Criterios de aceptación:**

- Agregar `@capacitor/filesystem` y `@capacitor/share` para guardar y compartir el `.ics`.
- Informar éxito solo cuando el archivo se guardó o se compartió; error reintentable si falla.
- Probar con puertos simulados; dispositivo en T113.

**Estimación:** M (4hs).
**Dependencias:** T95.

### T144 — Abrir Maps con la app nativa

**Capa:** Frontend/nativo.

**Descripción:** Abrir el link de Maps validado con la apertura nativa de Capacitor en lugar de `window.open`. Asegura que se abra la app de mapas del dispositivo.

**Criterios de aceptación:**

- Agregar `@capacitor/app-launcher` (o equivalente) y abrir solo links validados por `parseMapsLink`.
- Si no se puede abrir, mostrar el error existente sin perder el borrador.
- Probar con puertos simulados; dispositivo en T113.

**Estimación:** S (3hs).
**Dependencias:** T94.

### T145 — Manejar el Atrás nativo y la navegación inicial

**Capa:** Frontend/nativo.

**Descripción:** Definir el botón Atrás del dispositivo, el destino de links sin pantalla y el día inicial del itinerario. Resuelve los casos pendientes de T98.

**Criterios de aceptación:**

- Atrás cierra el diálogo u hoja abierta (también los de estado local), pide confirmación ante un formulario con cambios, desde una raíz del Trip vuelve a Mis viajes y sin historial va a Mis viajes.
- `/verify` y otros links sin pantalla llevan a Mis viajes o al inicio de sesión; el itinerario abre en hoy si pertenece al viaje y si no en su primer día.
- Probar con el puerto de ciclo de vida simulado; dispositivo en T113.

**Estimación:** L (6hs).
**Dependencias:** T98, T99.

### T146 — Ajustar el documento y la red del cliente

**Capa:** Frontend.

**Descripción:** Completar el documento HTML, el modo de teclado de Capacitor y un timeout del cliente HTTP. Evita pantallas en inglés para lectores, teclados que tapan campos y botones colgados.

**Criterios de aceptación:**

- `index.html` con `lang="es"` y título «Travellier»; modo de resize del teclado configurado.
- Timeout HTTP de 30 s con error reintentable, reutilizando el id de reintento de T88.
- Probar el timeout con reloj simulado.

**Estimación:** S (3hs).
**Dependencias:** T105.

### T147 — Integrar las pruebas de integración en CI

**Capa:** CI.

**Descripción:** Correr en CI las pruebas de integración y estabilizar los jobs intermitentes. Deja la evidencia automática que hoy solo corre localmente.

**Criterios de aceptación:**

- Job de `test:integration` con zona horaria fija y un worker, sin saturar memoria.
- Estabilizar el job del emulador Android (arranque en frío, espera de `sys.boot_completed`, descarte de diálogos, reintento acotado) y el test inestable de participación.
- Documentar los comandos en el README.

**Estimación:** M (5hs).
**Dependencias:** T103, T104, T138, T139.

### T148 — Independizar los fixtures de integración de la zona horaria

**Capa:** Pruebas.

**Descripción:** Hacer que las pruebas de integración del cliente pasen con cualquier zona horaria del proceso, no solo con `TZ=UTC`. Hoy el job fija `TZ: UTC` para que la corrida sea determinista y eso oculta la dependencia.

**Criterios de aceptación:**

- Los fixtures que siembran instantes UTC y los formularios que escriben horarios en la zona del proceso quedan alineados: ningún caso depende de que ambas coincidan.
- La suite pasa con `TZ=UTC` y con `TZ=America/Argentina/Buenos_Aires`; el caso de `participation-conflict-modified.integration.test.tsx` que hoy falla fuera de UTC queda cubierto.
- El `TZ: UTC` del job y la nota del README se actualizan al motivo que quede (determinismo, no requisito).

**Estimación:** M (5hs).
**Dependencias:** T147.

### T149 — Instalar el plugin de teclado para iOS

**Capa:** Frontend/nativo.

**Descripción:** Instalar `@capacitor/keyboard` para que el modo de resize configurado en T146 tenga efecto en iOS. En Android el comportamiento ya lo da `android:windowSoftInputMode="adjustResize"`.

**Criterios de aceptación:**

- `@capacitor/keyboard` instalado y sincronizado en Android e iOS; el bloque `plugins.Keyboard` de `capacitor.config.ts` pasa a usar el tipo del plugin.
- El contrato de plugins nativos incluye el nuevo plugin.
- La verificación en iOS queda registrada como pendiente de dispositivo: no se puede ejecutar desde esta PC (requiere macOS/Xcode).

**Estimación:** S (3hs).
**Dependencias:** T146.

### T150 — Mostrar un texto propio para el timeout

**Capa:** Frontend.

**Descripción:** Diferenciar en pantalla un timeout de una conexión caída. Hoy el cliente produce `code: "TimeoutError"` con su mensaje, pero los mapeadores de la API descartan `code` y `message` para los errores de red, así que el usuario ve el texto de conexión caída.

**Criterios de aceptación:**

- Los mapeadores propagan el `code` del error de red sin cambiar el `kind`, que sigue siendo reintentable.
- Las pantallas que muestran el fallo de red distinguen el timeout con un texto propio, que el usuario define antes de implementar; el resto de los errores de red conserva su texto actual.
- Tests que cubran el timeout y la conexión caída por separado.

**Estimación:** S (2hs).
**Dependencias:** T146.

### T151 — Definir el Atrás en la raíz del Trip

**Capa:** Frontend.

**Descripción:** Resolver la pulsación sin efecto visible al volver desde una raíz del Trip a Mis viajes. El Atrás reemplaza la entrada de la raíz del Trip, así que la siguiente pulsación consume la entrada anterior antes de cerrar la app. El PRD no define cuántas pulsaciones cuesta salir.

**Criterios de aceptación:**

- El usuario define el comportamiento esperado: salir de Mis viajes con una sola pulsación o conservar el historial previo.
- La implementación respeta esa definición sin reintroducir el defecto corregido en T145 (marcar `noBack` a ciegas mata un Atrás legítimo).
- Casos de prueba del recorrido completo desde una raíz del Trip hasta la salida.

**Estimación:** S (2hs).
**Dependencias:** T145.

### T152 — Permitir un almacenamiento S3 local en el servidor de desarrollo

**Capa:** Backend.

**Descripción:** El servidor local arma el cliente S3 sin direccionamiento configurable, así que un S3 local tipo MinIO solo funciona cuando se lo alcanza por IP. Alcanzado por un nombre de host (un túnel, por ejemplo) el SDK firma virtual-host-style y MinIO no lo resuelve.

**Criterios de aceptación:**

- Una variable de entorno `S3_FORCE_PATH_STYLE` activa el direccionamiento path-style del cliente S3; sin ella, el comportamiento actual no cambia.
- La lectura de esa variable es una función pura con tests.
- El servidor local usa un único cliente S3 con esa configuración para el almacenamiento de auth y el de trips.

**Estimación:** XS (1h).
**Dependencias:** ninguna.

## Resumen

| Fase | Tareas | Horas |
| --- | ---: | ---: |
| Setup e infraestructura incremental | 3 | 14 |
| Correcciones del backend existente | 12 | 67 |
| Correcciones funcionales del cliente | 6 | 25 |
| Recuerdos e interacciones | 7 | 40 |
| Fotos y limpieza S3 | 6 | 38 |
| Gastos y guardado completo | 11 | 64 |
| Notificaciones, mapas y calendario | 8 | 52 |
| Navegación y listado funcional | 5 | 24 |
| Protección y pruebas funcionales | 3 | 22 |
| Aplicación visual final | 9 | 54 |
| Ajustes aprobados el 2026-11-08 | 8 | 39 |
| Correcciones aprobadas el 2026-11-12 | 26 | 107 |
| Seguimientos aprobados el 2026-11-13 | 4 | 12 |
| Entorno de desarrollo | 1 | 1 |
| **Total del plan** | **109** | **559** |

- **Estado al 2026-11-13:** T44–T112 y T114–T147 terminadas; T113 sigue pendiente (requiere dispositivos). Se agregan 4 tareas de seguimiento (T148–T151, 12 h estimadas) surgidas de T145, T146 y T147 y registradas en `docs/REVISION_PENDIENTE.md`. T151 necesita una definición del usuario antes de implementarse.
- **Estado al 2026-11-12:** T44–T112 y T114–T121 terminadas; T113 pendiente (requiere dispositivos). Se agregan 26 tareas (T122–T147, 107 h estimadas). Quedan 27 tareas y 115 h estimadas. T113 pasa a depender de las nuevas tareas de cliente.
- **Estado al 2026-11-08:** T44–T47 terminadas (18 h estimadas). Quedan 74 tareas y 421 h estimadas: 66 del plan original (382 h) y 8 agregadas el 2026-11-08 (T114–T121, 39 h). Las cifras siguientes describen el plan original del 2026-10-11.
- **Único plan pendiente: 70 tareas (T44–T113), 400 horas.** Sustituye las 18 tareas pendientes anteriores; no se ejecutan además de este listado.
- **Funcionalidad, infraestructura y pruebas previas al diseño: 61 tareas, 346 horas.** La fase visual depende de T104 y suma 9 tareas, 54 horas; navegación, selección de destinos y Activos/Finalizados quedan conectados y probados antes.
- **Máximo por tarea: 8 horas.** No quedan tareas XL; backend/frontend separados con sus pruebas y dependencias.
- **Diferencia con el total del PRD: no calculable.** El PRD vigente no contiene una estimación total en horas.
- **Comparación equivalente:** las 18 tareas pendientes antiguas sumaban 96 horas; su reemplazo suma 400 horas, **+304 horas pendientes**. No se suman las 96 horas anteriores.
- El listado histórico completo estimaba 61 tareas y 316 horas. Manteniendo T01–T43 intactas (43 tareas, 220 horas estimadas), la referencia histórica más el reemplazo pendiente suma **113 tareas y 620 horas estimadas**, **+304 horas**; las 220 horas no son tiempo real trabajado ni esfuerzo por repetir.
- Frente a la propuesta previa de 68 tareas/390 horas, esta corrección agrega dos PRs funcionales separados para las fechas y filtros de Mis viajes, explicita el rechazo de pending manual y actualiza pruebas/dependencias: **+10 horas**. No son listas acumulativas.
- Trello, tareas terminadas, listado histórico, PRD, diseño y código productivo no se modificaron.

## Preguntas abiertas

No hay ambigüedades funcionales bloqueantes registradas en el PRD aprobado. No se reabren consenso/votación, reparto, moneda, registro, cadenas o participación: esas decisiones ya están fijadas.

Antes de ejecutar las integraciones se deben obtener accesos AWS dev, configuración del proveedor push/APNs/FCM, acceso a macOS/dispositivos iOS y restricciones/credenciales de mapas si el proveedor elegido las requiere. Son prerequisitos operativos de T45/T46/T94, no tareas estimadas como desarrollo de nuevas reglas de negocio; las horas no incluyen esperas externas.
