# PRD — App de Viajes Grupales

**Versión del producto:** v1 · **Estado:** aprobado y fijado como referencia de implementación · **Última actualización:** 2026-10-11

**Documento original:** [PRD-original.md](PRD-original.md), conservado sin cambios desde su primera incorporación al repositorio. Este es el único PRD vigente; los cambios autorizados se registran directamente aquí y se versionan mediante Git, sin crear archivos nuevos por cada conversación. Actualizarlo no modifica las tareas ni acredita implementación en el prototipo o la aplicación. Las decisiones pendientes están en §9.

**Cierre de planificación · 2026-10-11:** el usuario fija este PRD y el diseño azul actual como referencia para implementar y comparar las tareas. No se reabren decisiones de alcance, reglas funcionales o diseño sin una solicitud o aprobación explícita del usuario. Las integraciones reales y la revisión de tareas siguen pendientes; esta aprobación no las da por realizadas.

**Referencia de diseño aprobada:** [prototipo navegable](../../../design/prototype/README.md), conservado en `design/prototype/public/`. El usuario aprobó su identidad azul y los flujos explorables el 2026-10-11. La [evaluación contra este PRD](../../../design/prototype/PRD-AUDIT.md) distingue cobertura, diferencias observadas y servicios simulados; la aprobación visual no acredita cumplimiento total ni implementación productiva. Se mantiene este PRD y el original, sin nuevas copias de versión.

## Tabla de contenidos

1. [Visión general](#1-visión-general)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Módulos y funcionalidades](#3-módulos-y-funcionalidades)
   - 3.1 [Auth](#31-auth)
   - 3.2 [Trips (Viajes)](#32-trips-viajes)
   - 3.3 [Transporte](#33-transporte)
   - 3.4 [Itinerario y días](#34-itinerario-y-días)
   - 3.5 [Actividades](#35-actividades)
   - 3.6 [Posts](#36-posts)
   - 3.7 [Fotos](#37-fotos)
   - 3.8 [Costos y gastos](#38-costos-y-gastos)
4. [Modelo de datos](#4-modelo-de-datos-mongodb-atlas)
5. [Arquitectura AWS](#5-arquitectura-aws)
6. [Flujos principales](#6-flujos-principales)
7. [Funcionalidades adicionales en scope](#7-funcionalidades-adicionales-en-scope)
8. [Consideraciones futuras](#8-consideraciones-futuras)
9. [Criterios de aceptación y decisiones pendientes](#9-criterios-de-aceptación-y-decisiones-pendientes)

---

## 1. Visión general

Aplicación **mobile** para **organizar viajes grupales**: planificar el transporte, armar el itinerario día a día, registrar actividades, publicar posts con fotos y gastos, y mantener a todos los participantes sincronizados en tiempo real.

**Plataformas:** iOS y Android (mismo codebase con React JS + Capacitor).
**Usuarios objetivo:** Grupos de amigos o familia que viajan juntos y quieren centralizar la organización en un solo lugar.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React JS + Capacitor (iOS / Android) |
| Auth | Manual — JWT + bcrypt desde Lambda (sin Cognito) |
| API | AWS API Gateway + AWS Lambda (Node.js) |
| Base de datos | MongoDB Atlas |
| Almacenamiento de fotos | AWS S3 (presigned URLs) |
| Uploads | Presigned URLs (upload directo cliente → S3, sin pasar por Lambda) |
| Deep links | Custom URL Scheme (`com.travellier.app://`) interceptado por Capacitor |

---

## 3. Módulos y funcionalidades

### 3.1 Auth

- Registro con email y contraseña — password hasheado con bcrypt desde Lambda.
- La cuenta queda habilitada al registrarse: v1 no exige confirmar el correo para iniciar sesión o usar la app. No hay pantalla ni deep link obligatorio de verificación. Nombre y avatar pertenecen al perfil, no son requisitos adicionales para crear la cuenta.
- Login con email y contraseña — responde con access token (JWT) y refresh token.
- El access token se incluye en el header `Authorization: Bearer <token>` en cada request.
- Refresh token para renovar el access token sin re-login.
- Perfil de usuario: nombre, foto de perfil, datos básicos.
- Todos los endpoints (salvo registro y login) requieren JWT válido.
- El JWT se almacena en el dispositivo usando `@capacitor/preferences` (storage seguro nativo), nunca en localStorage.

---

### 3.2 Trips (Viajes)

Un **Trip** es el objeto raíz que agrupa todo: transporte, itinerario, actividades, posts y participantes.

#### Creación

- El usuario crea un Trip con: nombre, destino principal, descripción opcional.
- Las fechas **no se ingresan manualmente** — se derivan automáticamente de la configuración del transporte (ver sección 3.3).

#### Visibilidad

| Modo | Descripción |
|---|---|
| Privado (default) | Solo accesible por invitación |
| Público | Visible y joineable sin invitación |

#### Invitación

- **Código corto** (estilo lobby de juego, ej: `VIAJE-X7K2`) — se comparte manualmente, el usuario lo ingresa en la app.
- **Link de invitación** — URL que apunta a la API (`https://api.tuapp.com/invite/:code`), se puede compartir por cualquier medio (WhatsApp, etc.).
- Ambos métodos coexisten para el mismo Trip.

#### Flujo del link de invitación

El link apunta siempre a la API, que devuelve un HTML con JS que maneja la detección de la app:

```
Usuario toca el link
        │
        ▼
GET https://api.tuapp.com/invite/:code
        │
Lambda valida el código y devuelve HTML con JS
        │
JS intenta abrir → com.travellier.app://invite/:code
        │
        ├── App instalada: el OS la intercepta y abre la pantalla de join
        │
        └── App no instalada: después de ~1500ms sin respuesta,
            el JS muestra el HTML de fallback con instrucciones
            para descargar/instalar la app
```

#### Roles

| Rol | Permisos |
|---|---|
| Admin | Todo + puede expulsar participantes y eliminar el Trip/grupo |
| Participante | Crear/editar actividades, posts, comentarios y gestionar su propia participación — igual que admin salvo expulsión y eliminación del Trip |

- El creador del Trip es admin por defecto.
- Puede haber múltiples admins.

#### Baja del Trip/grupo

- Cualquier admin actual puede eliminar el Trip, previa confirmación explícita. Los integrantes y los registros existentes no bloquean esta operación.
- La baja elimina en cascada los datos del Trip en MongoDB: membresías, destinos, transportes, itinerario, actividades, participaciones, posts, referencias de fotos, gastos, likes y comentarios. No elimina cuentas de usuarios ni afecta otros Trips.
- Los permisos, la baja y la cascada se ejecutan en una sola transacción, serializada con las mutaciones del viaje y las nuevas membresías. Las invitaciones dejan de ser válidas y no pueden crear membresías huérfanas.
- Si hay referencias de fotos, sus claves S3 se conservan en trabajos durables `storageDeletionJobs` dentro de esa transacción. La limpieza física de S3 se completará con la integración de fotos (fase 6); todavía no hay un procesador de estos trabajos. Esto no bloquea la baja del grupo.
- El mínimo de un destino se aplica a Trips existentes, no a la eliminación del Trip completo.

#### Configuración del Trip

- **Modo de gastos:** solo registro / con balance entre participantes (default: solo registro).

---

### 3.3 Transporte

El transporte se configura en dos segmentos independientes: **ida** y **vuelta**. Cada segmento define las fechas límite del Trip y los días de tránsito en el itinerario.

#### Tipos de transporte disponibles

**Colectivo (urbano, paso a paso)**
- Se configuran múltiples tramos secuenciales.
- Cada tramo: línea/número, parada de origen, parada de destino, hora estimada.
- La hora estimada de cada tramo se guarda como `estimatedAt`, un instante UTC con fecha y precisión de milisegundos. Los tramos deben estar en orden cronológico (se permiten instantes iguales) y dentro de los límites inclusivos de salida y llegada del transporte.
- La interfaz permite ingresar horas locales: los tramos nuevos toman la primera fecha local cronológicamente posible desde la salida o el tramo anterior, pasando al día siguiente cuando corresponde. Los instantes ya confirmados no cambian al editar otros campos ni al cambiar la zona de visualización.
- Los registros históricos con `estimatedTime` en formato `HH:mm` siguen siendo legibles, sin inferir una fecha o zona horaria. Antes de editarlos, el usuario debe revisar y confirmar las horas en su zona local; la escritura los reemplaza por `estimatedAt`. Un horario inválido rechaza el cambio completo, sin modificar el transporte ni su itinerario.

**Ómnibus (larga distancia)**
- Terminal de origen.
- Fecha y hora de salida.
- Terminal de destino.
- Fecha y hora de llegada estimada.
- Empresa (opcional).
- Costo por persona (opcional).

**Avión**
- Aeropuerto de origen.
- Fecha y hora de salida.
- Aeropuerto de destino.
- Fecha y hora de llegada.
- Número de vuelo (opcional).
- Costo por persona (opcional).

**Auto / otro**
- Punto de salida, hora de salida, destino, hora estimada de llegada.

#### Multi-destino

Un Trip puede tener múltiples destinos secuenciales. Cada destino tiene su propio par transporte de llegada / transporte de salida. El sistema detecta automáticamente los días de actividad entre la llegada a un destino y la salida hacia el siguiente.

#### Baja de destinos

- Cualquier integrante puede eliminar un destino vacío, previa confirmación.
- Un Trip debe conservar al menos un destino: no se permite eliminar el único existente.
- Se bloquea la baja si el destino tiene transportes, días de itinerario o contenido asociado. No se elimina contenido en cascada.
- La opción de eliminar se oculta si es el único destino, tiene registros asociados o todavía no se pudo comprobar que está vacío.
- La validación y la baja se ejecutan en una misma transacción, serializada con los cambios de destinos y transportes. Los destinos restantes mantienen su orden relativo y se renumeran desde 1 sin duplicados.

**Ejemplo con un destino:**
```
Transporte ida:    salida domingo 24 20hs → llegada lunes 25 8hs
Transporte vuelta: salida domingo 31 20hs → llegada lunes 1 8hs
Días de actividad: lunes 25 (desde 8hs) → domingo 31 (hasta 20hs)
```

**Ejemplo multi-destino:**
```
Segmento 1 → Córdoba:    llegada miércoles 10hs / salida sábado 14hs
Segmento 2 → Carlos Paz: llegada sábado 17hs  / salida lunes 9hs
```

---

### 3.4 Itinerario y días

Los días del itinerario se **generan automáticamente** a partir de la configuración del transporte. No se ingresan fechas manualmente.

#### Lógica de generación

El sistema no trabaja con "días" como unidad primaria sino con **timestamps exactos**. Lo que importa es:
- `arrivalAt` del transporte de ida → desde ese momento hay tiempo de actividad.
- `departureAt` del transporte de vuelta → hasta ese momento hay tiempo de actividad.

El sistema agrupa ese rango en días calendario para mostrarlo en el itinerario, pero la ventana de actividad es puramente por hora, no por día. Esto resuelve naturalmente todos los casos:

```
Caso 1 — viaje de varios días:
  Ida:    domingo 24 20hs → llegada lunes 25 8hs
  Vuelta: domingo 31 20hs → llegada lunes 1 8hs
  Ventana de actividad: lunes 25 8hs → domingo 31 20hs

Caso 2 — viaje el mismo día:
  Ida:    lunes 25 8hs → llegada lunes 25 10hs
  Vuelta: lunes 25 18hs → llegada lunes 25 20hs
  Ventana de actividad: lunes 25 10hs → lunes 25 18hs

Caso 3 — multi-destino:
  Segmento 1 → Córdoba:    llegada miércoles 10hs / salida sábado 14hs
  Segmento 2 → Carlos Paz: llegada sábado 17hs   / salida lunes 9hs
```

Las fechas y horas de transportes, actividades y límites del itinerario se almacenan como **instantes UTC**. La interfaz los muestra y agrupa en días calendario según la **zona horaria local del usuario**, conservando los límites exactos, incluidos los milisegundos. Una llegada a las 08:00 habilita actividad desde las 08:00; la fecha calendario del segmento no habilita actividad desde medianoche. Cambiar la zona de visualización no modifica los timestamps ni las referencias compartidas del itinerario.

#### Regeneración y protección de datos

Al crear o modificar transportes, o cambiar el orden de destinos, se recalcula la proyección del Trip dentro de la misma transacción que el cambio. Las franjas que conservan destino, fecha UTC y tipo mantienen su `dayId`, aunque cambien sus límites u orden. Las franjas nuevas reciben un ObjectId y las obsoletas sin dependencias se retiran.

Si el cambio elimina una franja referenciada por actividades, deja el inicio de una actividad fuera de su ventana y franja correspondientes, o deja su fin indicado fuera de la ventana disponible del destino, se **rechaza el cambio y se conservan todos los datos anteriores**. No se borran ni reubican automáticamente actividades o posts; sus vínculos y datos asociados permanecen intactos. Los posts no dependen de un `dayId`: su fecha de publicación no bloquea cambios del transporte ni debe estar dentro del itinerario. Los recuerdos conservan sus referencias a actividades y transportes; la fecha de publicación no altera esas referencias.

#### Tipos de día

| Tipo | Descripción |
|---|---|
| Día de tránsito (ida) | Cubre el período desde la salida hasta la llegada al destino. Protagonista: transporte. Puede coincidir en fecha con el primer día de actividad. |
| Día de actividad | Días (o franjas horarias) dentro de la ventana de actividad. Protagonistas: actividades, posts, comidas. |
| Día de tránsito (vuelta) | Desde la hora de salida de regreso. Puede coincidir en fecha con el último día de actividad. |

#### Vista del día

Cada día muestra:
- Tipo de día (tránsito / actividad).
- Actividades planificadas o espontáneas correspondientes a ese día, con sus posts asociados.
- Posts independientes publicados ese día, si el día pertenece al itinerario; los recuerdos asociados a una actividad se muestran bajo ella aunque se hayan publicado después. Los recuerdos del transporte se consultan también desde el detalle del segmento, independientemente de su fecha de publicación.
- Resumen de gastos del día (si el modo gastos está activo).

#### Navegación visual acordada

- **Itinerario / Diario / Grupo** son pestañas del mismo Trip, con cabecera y selección consistentes, no páginas de listado independientes. Diario conserva sus pestañas **Posts / Fotos** al cambiar entre ambas.
- Los detalles y formularios se abren fuera de las pestañas. Volver restaura el origen, destino, día, pestaña y posición de lectura; volver desde las pestañas raíz sale a Mis viajes.
- Cambiar de día en el itinerario conserva el scroll del contenido y de la tira de fechas. Elegir nuevamente el mismo día no reinicia la vista.
- El banner del destino abre **Destinos del viaje**, en orden secuencial, con fechas y horarios locales de llegada/salida derivados de los transportes. Elegir una parada lleva a su primer día dentro del itinerario y deja visible esa fecha en la tira.
- Si dos destinos comparten una fecha, se conserva el destino elegido mientras esa fecha pertenezca a ambos. Cerrar el selector no cambia el día ni la posición. Los destinos sin transportes completos indican qué falta y no ofrecen un salto basado en fechas inventadas.
- La identidad visual aprobada usa azul profundo, blancos y superficies azul suave; no se combina con la propuesta marrón descartada. La app usa el espacio disponible del dispositivo. El modo estudio y sus textos explicativos pertenecen al prototipo, no a la app.

---

### 3.5 Actividades

Una **Actividad** es un plan que cualquier integrante propone o registra dentro de la ventana habilitada del itinerario. **Toda actividad tiene fecha y hora**, tanto si fue planificada como si surgió espontáneamente.

El funcionamiento es único: cada persona decide en qué actividades participar. No hay modos de actividades, votación, aprobación grupal ni planes ganadores. Distintos integrantes pueden hacer planes simultáneos.

#### Campos

- Título.
- Descripción (opcional).
- Día del itinerario al que pertenece.
- Fecha y hora (`scheduledAt`, obligatorias): momento previsto o momento en que ocurrió la actividad.
- Duración estimada (`durationMinutes`, opcional): tiempo en minutos; se carga en horas y minutos. Sin duración no se infiere una hora de fin.
- Ubicación con link de Google Maps (opcional).
- Creador de la actividad.
- Participación individual: «Voy / No voy / Sin responder».

#### Actividades planificadas y espontáneas

- **Planificada:** se crea desde un día del itinerario, ingresando fecha y hora previstas. Este formulario no incluye un selector de actividad planificada o espontánea.
- **Espontánea:** surge al registrar un post sobre una actividad que no estaba cargada. Desde el compositor se puede crearla y vincularle ese primer post en un mismo guardado. Se precargan fecha y hora actuales y se permite ajustarlas para registrar cuándo ocurrió.
- En ambos casos, `scheduledAt` es obligatorio, se almacena en UTC y debe estar dentro de la ventana de actividad del destino. La interfaz muestra la fecha y hora en la zona local del usuario.
- `scheduledAt` indica cuándo se realiza la actividad; `createdAt` indica cuándo se creó el registro. Se puede registrar una actividad ya realizada respetando los límites del itinerario.
- Al crear la actividad, el autor queda marcado **«Voy»**. No se marca automáticamente a ningún otro integrante.
- Si esa participación automática entra en conflicto con otra del autor, se usa la misma confirmación de cambio de participación descrita abajo. No se guarda una doble participación superpuesta ni se retira la anterior silenciosamente. Crear actividad, participación y, si corresponde, post vinculado se guarda conjuntamente; cancelar mantiene el borrador sin publicar ni cambiar participaciones.

Por ejemplo, si el grupo va a un restaurante el 25/09 a las 21:00 y lo registra a las 22:30, la actividad conserva el 25/09 a las 21:00 como fecha de realización y puede tener recuerdos asociados.

#### Duración estimada y límites del itinerario

- Crear y editar actividades permite indicar **«Duración estimada · opcional»** en horas y minutos.
- La duración debe ser positiva. El fin se deriva de `scheduledAt + durationMinutes`; no es otro campo independiente.
- Con duración, el itinerario y el detalle muestran, por ejemplo, **«10:00–11:30 · 1 h 30 min»**. Si termina otro día, también se distingue la fecha de fin.
- Sin duración, se muestra únicamente el inicio; no se asigna un fin ni una duración por defecto.
- Con duración, el intervalo completo debe caber en la ventana disponible del destino. Se rechaza excederla al crear, editar o recalcular transportes/itinerario; no basta mostrar una advertencia. Terminar exactamente en el límite está permitido. Cruzar medianoche es válido si el intervalo sigue dentro de esa ventana.
- Sin duración se valida el inicio sin inventar un intervalo.
- Cambiar inicio o duración conserva la participación de quienes siguen siendo compatibles. Quienes queden con conflictos en su agenda se desvinculan de la actividad editada y reciben una notificación, según las reglas de edición de abajo.

#### Participación individual y planes simultáneos

Cada integrante actual puede cambiar manualmente únicamente su propia participación mediante **«Voy / No voy»**. «Sin responder» es el estado inicial de quienes no respondieron; el creador empieza en «Voy». La participación puede actualizarse antes, durante o después de la actividad. La desvinculación automática por una edición que genere conflictos es una operación del sistema, no un permiso para elegir la asistencia de otras personas.

Una actividad está disponible desde que se crea, sin esperar aprobación ni una cantidad mínima de participantes. El grupo puede dividirse: de cinco integrantes, tres pueden ir a un plan y dos a otro en el mismo horario. Ambos permanecen en el itinerario.

Marcar «No voy» o cambiar a otro plan no elimina ni cancela la actividad. Incluso si el creador deja de participar o nadie queda marcado «Voy», la propuesta y sus recuerdos permanecen visibles. Se puede mostrar **«Sin participantes»**; las respuestas expresan participación registrada, no una verificación automática de presencia física.

No existe exclusividad horaria para todo el Trip. La restricción corresponde a la **agenda personal**: una persona no puede mantener «Voy» en actividades cuyo horario se detecta como superpuesto.

#### Superposición y cambio de participación

- Cuando ambas duraciones están indicadas, hay conflicto si sus intervalos se intersectan. Fin e inicio contiguos no se superponen.
- Sin duración no se inventa un fin. Se detecta al menos una misma hora de inicio, presentada como **«Mismo horario»**; no se afirma haber calculado un intervalo desconocido.
- Al intentar marcar «Voy», se comprueban las otras actividades del mismo Trip donde esa persona ya figura como participante.
- Si no hay conflicto, se guarda «Voy» en la actividad elegida.
- Si hay conflicto, un modal identifica **todas** las actividades afectadas y sus horarios y ofrece conservar la participación actual o cambiar a la elegida. La superposición no se guarda como una simple advertencia.
- Confirmar el cambio guarda conjuntamente «No voy» en las actividades incompatibles y «Voy» en la elegida. Cancelar no cambia ningún registro.
- No se modifican datos, horarios ni participaciones de otras personas; las actividades que deja el usuario siguen disponibles para el resto.
- La comprobación y el cambio se realizan de forma atómica, serializados con otros cambios de participación, horarios, membresía y eliminación del Trip. Si el horario o los conflictos cambiaron mientras se confirmaba, se informa y se vuelve a solicitar una decisión, sin guardar parcialmente.

**Ejemplo:** A va de 10:00 a 12:00 y B de 11:00 a 13:00. Si Nico figura «Voy» en A e intenta sumarse a B, ve:

> Ya participás en A, de 10:00 a 12:00. Para sumarte a B, de 11:00 a 13:00, tenés que dejar de participar en A.
>
> **Mantener A** · **Cambiar a B**

Cambiar a B actualiza únicamente la participación de Nico: A → «No voy», B → «Voy». Ana puede seguir en A y Juli puede estar en B.

#### Edición de actividades

Admins y participantes pueden editar actividades respetando la ventana del itinerario. Se notifican los cambios de contenido, horario, duración y ubicación. No hay bloqueos ni cierres derivados de una aprobación colectiva.

Al guardar un cambio de inicio o duración:

- Se comprueba la nueva franja contra las otras actividades del mismo Trip donde cada participante actual figura «Voy», con las mismas reglas de superposición de la agenda personal.
- Quienes tengan conflictos dejan de figurar «Voy» y pasan a **«Sin responder» en la actividad editada** (`pending`), con una marca persistida de **decisión requerida por cambio de horario**. No se registra «No voy» como si lo hubieran elegido. Esto incluye al creador o al editor si participaban y ahora tienen un conflicto; no hay excepción por rol.
- Se conservan sus participaciones en los otros planes. No se borran ni reprograman actividades y no se les asigna otro plan.
- Cada persona desvinculada recibe una notificación que identifica la actividad editada, su nuevo horario, las actividades incompatibles y el motivo: **«Cambió el horario y se superpone con otro plan. Se retiró tu participación; revisá la actividad y elegí de nuevo.»** Si el conflicto se debe a duración, se indica ese cambio. La notificación complementa el estado visible dentro de la app, nunca es su único soporte.
- Se mantienen las participaciones compatibles y los estados «No voy» o «Sin responder» existentes. Las marcas de decisión requerida ya pendientes se conservan hasta una respuesta explícita del afectado; otra edición o la desaparición del conflicto no las borra. Cambiar solo título, descripción o ubicación no desvincula participantes.
- Guardar la edición, las desvinculaciones a `pending` y sus marcas es atómico y se serializa con los cambios de participación, horarios, membresía y eliminación. Se notifican únicamente cambios guardados; un guardado fallido no modifica actividad, participaciones ni marcas ni anuncia una desvinculación.

La actividad permanece visible aunque nadie siga participando. Quien fue desvinculado decide nuevamente «Voy / No voy»; «Voy» usa la comprobación normal de agenda y permite cambiar de plan con confirmación.

#### Indicador personal de actividad modificada

- El afectado ve **«Modificado»** junto a la actividad en el itinerario y en su detalle. Es un indicador personal, no un estado global de la actividad ni una alerta para quienes conservaron su participación.
- Su participación se muestra **«Sin responder»**, sin seleccionar «Voy» ni «No voy». La marca explica que ya había participado y necesita volver a decidir; no se confunde con una negativa voluntaria.
- El indicador usa el lenguaje visual azul existente, texto y una acción reconocible; no depende solo del color. Es accesible por toque y teclado y anuncia que permite consultar el motivo.
- Al pulsarlo abre información como: **«Se modificó el horario de esta actividad y coincidió con otro plan que tenías marcado. Por eso se retiró tu participación. Revisá el nuevo horario y elegí si vas o no.»** Si el origen es una modificación de duración, el texto lo aclara.
- Consultar o cerrar esa información, abrir la notificación o visitar el detalle no elimina la marca.
- El indicador y su causa se guardan por usuario y actividad, no solo en memoria del cliente ni como notificación leída. Se conservan al cerrar y volver a abrir la app y se muestran aunque el usuario tenga las notificaciones desactivadas o no haya recibido el push.
- Guardar explícitamente **«Voy»** o **«No voy»** elimina la marca en la misma operación que guarda esa respuesta. La actividad sigue visible.
- Si «Voy» encuentra un conflicto, se ofrece el cambio de plan habitual. La marca se elimina solo al confirmar y guardar la participación; cancelar, un error o un guardado fallido conserva «Sin responder» y el indicador.
- La desvinculación no reserva el intervalo en la agenda personal: únicamente «Voy» lo hace.

#### Posts asociados

- Cualquier miembro puede crear posts vinculados a una actividad en cualquier momento (antes, durante o después).
- Múltiples posts pueden asociarse a la misma actividad de forma independiente. También pueden formar cadenas con ramificaciones; los hijos se vinculan exclusivamente a su padre inmediato y la actividad raíz se obtiene recorriendo la cadena, sin duplicar el vínculo en cada hijo.
- La vinculación también puede hacerse o modificarse **después de crear el post**.
- El detalle de actividad reúne **Recuerdos / Fotos** en pestañas. Recuerdos muestra miniaturas cuando hay fotos y admite recuerdos solo textuales; Fotos agrega las imágenes de los posts de esa actividad, incluidos los descendientes de sus cadenas. Abrir una imagen permite consultar su recuerdo de origen. No se crea un álbum independiente.

#### Eliminación de actividades

- Admins y participantes pueden eliminar cualquier actividad del Trip, con los mismos permisos y confirmación explícita.
- La eliminación conserva los posts asociados y establece su `activityId` en `null`. No modifica fecha de publicación, autoría, vínculos con transporte u otros posts, fotos, gastos, comentarios ni likes. Los descendientes conservan su cadena aunque deje de proyectar una actividad raíz.
- Se eliminan únicamente las participaciones de esa actividad. No se elimina otro plan ni se reasigna automáticamente a sus participantes.
- Cambiar la propia participación no equivale a eliminar la actividad; quedarse sin participantes tampoco la elimina.
- La operación se serializa con cambios de participación, horarios, itinerario y eliminación del Trip.
- Solo los miembros actuales pueden crear, consultar, editar o eliminar actividades, incluso en Trips públicos.

---

### 3.6 Posts

Un **Post** es el registro de un momento del viaje. Puede estar planificado (asociado a una actividad), espontáneo, o vinculado a un tramo de transporte (fotos y momentos durante el viaje en sí).

#### Campos

- Autor.
- Descripción / texto libre.
- Fotos (una o varias, subidas a S3).
- Ubicación con link de Google Maps (opcional).
- Fecha y hora de publicación (`createdAt`), asignadas automáticamente al publicar y conservadas al editar; no se elige un día del itinerario.
- Gastos (opcional — ver sección 3.8).
- Vinculaciones (ver abajo).

#### Vinculaciones

Un post puede vincularse a:
- Una **actividad** (muchos posts → una actividad).
- **Otro post** (muchos hijos → su padre inmediato). Admite ramificaciones: A → B → C y B → D. Se rechazan vínculos consigo mismo o con un descendiente que creen ciclos.
- Un **transporte** (muchos posts → un segmento de transporte, para fotos y momentos durante el viaje).
- Ninguno (post independiente). Un post hijo solo tiene vínculo con su padre; la actividad raíz es una proyección de la cadena, no una segunda relación directa.

El compositor centraliza la elección en **«Vincular a» → Post / Actividad**. Actividad permite seleccionar una existente o crear una espontánea. El transporte puede venir preseleccionado al compartir desde su detalle; no se agrega como tercer selector simultáneo al compositor.

Se pueden publicar recuerdos antes, durante o después del viaje, incluso si ya finalizó o no tiene transportes configurados. La publicación no amplía el itinerario. Diario y galería grupal se ordenan por fecha de publicación, **más reciente primero**. Las actividades espontáneas mantienen su propia fecha/hora obligatoria y validación dentro de la ventana de actividad, independientemente de la publicación.

El detalle de un post muestra sus continuaciones directas y permite abrirlas para recorrer las ramificaciones. Los comentarios siguen siendo texto y tienen likes independientes; no reemplazan a los recuerdos hijos.

Crear o editar un recuerdo termina con **Publicar recuerdo / Guardar cambios** en el mismo formulario, sin una pantalla intermedia de revisión. Los borradores se conservan al volver de fotos, vínculos y gastos y ante errores de validación o guardado. En las pestañas Posts y Fotos del diario, un botón circular flotante permite iniciar un recuerdo sin llegar al final del listado; no tapa el último elemento al desplazarse.

La vinculación puede configurarse **al crear el post o en cualquier momento posterior**, permitiendo que dos personas que publicaron por separado sobre el mismo momento puedan vincular sus posts después.

Si la actividad todavía no existe, el compositor permite crear una **actividad espontánea junto con el post**. La actividad y su vinculación se guardan conjuntamente; un error no debe dejar una actividad ni un post creados parcialmente. También se conserva la opción de publicar un post independiente sin actividad.

#### Mapa in-app

Cuando un post o actividad tiene un link de Google Maps, la app muestra:
- **Vista previa embebida** — mapa estático o WebView con el punto marcado, visible dentro de la app sin salir de ella.
- **Botón "Abrir en Maps"** — abre Google Maps o la app de mapas nativa del dispositivo para navegación e indicaciones.

#### Interacciones

- **Likes** por cualquier miembro.
- **Comentarios** de texto por cualquier miembro.
- **Likes en comentarios** — cada comentario puede ser likeado por cualquier miembro, de forma independiente al like del post.

#### Vista en el itinerario

Dentro de cada día del itinerario se muestran:
1. Actividades planificadas o espontáneas, cada una con sus posts asociados y descendientes de la cadena, aunque se hayan publicado en otra fecha.
2. Posts independientes publicados ese día, ordenados cronológicamente, siempre que el día exista en el itinerario.
3. En días de tránsito: recuerdos del transporte correspondiente. El detalle del transporte permite consultar todos sus recuerdos, incluidos los publicados después.

El diario es la vista completa de publicaciones; el itinerario es una proyección de planes y recuerdos. Los gastos se atribuyen al día de la actividad vinculada, incluida la actividad raíz de una cadena. Sin actividad, se atribuyen al día de publicación. La fecha original del post no cambia; el registro de gastos distingue fecha del gasto y publicación cuando difieren. Los gastos fuera del itinerario permanecen consultables desde el resumen del Trip. Cambiar o eliminar la actividad raíz recalcula esta proyección, sin modificar los importes ni la fecha original del post.

---

### 3.7 Fotos

- Las fotos se suben directamente a **S3 vía presigned URLs** (el cliente sube directo, sin pasar por Lambda).
- Se sirven directamente desde S3 usando la URL del objeto.
- Las fotos siempre están en el contexto de un post — no existe un álbum independiente.
- La "galería grupal" es la vista agregada de todas las fotos de todos los posts del Trip.
- En la vista de fotos del diario, las filas tienen altura común y cada elemento se alinea arriba, aunque sus títulos ocupen distintas líneas. Las fotos mantienen acceso al post de origen y el orden descendente de publicación del diario.

---

### 3.8 Costos y gastos

Los gastos son parte de los **posts** — no un módulo separado. Al crear o editar un post, se puede agregar información de gasto.

#### Campos de gasto en un post

- Monto total del gasto.
- Moneda del gasto: ARS, EUR o USD.
- Desglose libre (ej: "agua 5000, entrada 8000, almuerzo 20000") — opcional.
- Pagos realizados — opcionales, configurables en modo balance. Un mismo gasto puede tener varios pagos, por una o varias personas, indicando monto fijo o porcentaje del total.
- Reparto acordado — configurable en modo balance, separado de los pagos realizados. Cada persona puede asumir un monto fijo, un porcentaje, una parte igual del resto o no participar de ese gasto.

#### Pagos y reparto

«Nico pagó 50%» y «Ana pagó 100» registran aportes realizados; no definen por sí solos cuánto le corresponde asumir a cada persona. Por ejemplo, en un gasto de 1000 se puede acordar que Nico asuma 350, Martín no participe y Ana/Juli se repartan los 650 restantes: 325 cada una. Quien haya adelantado el dinero se registra por separado en pagos.

El editor propone inicialmente repartir el resto entre los integrantes; el usuario puede cambiar cualquier parte o excluir personas antes de guardar. Los pagos no pueden superar el total y las partes fijas/porcentuales no pueden excederlo. Si faltan pagos o reparto, el gasto se conserva y se señala lo que falta completar, sin inventar un pagador ni una deuda por el importe sin registrar. El balance incluye únicamente gastos con pagos completos y reparto completo; los demás permanecen consultables y editables.

Los cálculos se realizan en centavos, redondeando a dos decimales. El resto en partes iguales distribuye los centavos sobrantes en el orden del listado. Cuando pagos o partes porcentuales cubren exactamente el total, se ajusta el residuo de redondeo en las últimas filas porcentuales para conservar todos los centavos. La interfaz indica que los porcentajes se recalculan sobre el monto total mostrado; los montos fijos no cambian al modificar ese total.

Los balances y totales se muestran separados por moneda, sin conversión automática ni suma de monedas distintas. Cambiar de modo conserva los pagos y el reparto registrados, aunque el modo registro no calcule deudas. Los gastos siguen perteneciendo a posts; la actividad agrupa sus recuerdos y no se convierte en un segundo registro de gasto.

#### Modos (configurables por Trip)

**Modo registro (default)**
- Los gastos quedan registrados en cada post como información.
- No se calculan deudas ni balances.
- Útil para tener memoria de cuánto se gastó y en qué.

**Modo balance**
- Además del registro, el sistema calcula quién le debe cuánto a quién.
- Se puede activar en cualquier momento sin perder los registros anteriores.
- Vista de resumen de balance accesible desde el Trip.
- Las compensaciones sugeridas comparan pagos realizados con partes acordadas, por moneda. Se muestran como «persona A le debe a persona B», sin ejecutar transferencias ni marcar cobros realizados. Los registros anteriores que no tengan moneda, pagos o reparto completos aparecen como gastos por completar.

---

## 4. Modelo de datos (MongoDB Atlas)

Todas las colecciones usan `_id: ObjectId` generado por MongoDB como identificador primario. Las referencias entre colecciones se almacenan como `ObjectId`.

---

### Colección: `users`

```js
{
  _id: ObjectId,
  email: String,          // unique, index
  passwordHash: String,   // bcrypt
  name: String,
  avatarS3Key: String,    // null si no tiene foto
  createdAt: Date
}
```

---

### Colección: `refreshTokens`

```js
{
  _id: ObjectId,
  userId: ObjectId,       // ref: users
  token: String,          // hashed, index
  expiresAt: Date,
  createdAt: Date
}
```

---

### Colección: `trips`

```js
{
  _id: ObjectId,
  name: String,
  description: String,    // null si no tiene
  visibility: String,     // "private" | "public"
  inviteCode: String,     // único, index (ej: "VIAJE-X7K2")
  expenseMode: String,    // "register" | "balance"
  createdBy: ObjectId,    // ref: users
  createdAt: Date
}
```

---

### Colección: `tripMembers`

```js
{
  _id: ObjectId,
  tripId: ObjectId,       // ref: trips, index
  userId: ObjectId,       // ref: users, index
  role: String,           // "admin" | "participant"
  joinedAt: Date
}
// Index compuesto único: { tripId, userId }
```

---

### Colección: `destinations`

Cada Trip tiene uno o más destinos ordenados. En trips simples hay un solo documento.

```js
{
  _id: ObjectId,
  tripId: ObjectId,       // ref: trips, index
  name: String,
  order: Number,          // 1, 2, 3... para multi-destino
  createdAt: Date
}
```

---

### Colección: `transports`

Un transporte por segmento (ida o vuelta) por destino.

```js
{
  _id: ObjectId,
  tripId: ObjectId,         // ref: trips, index
  destinationId: ObjectId,  // ref: destinations
  direction: String,        // "outbound" | "return"
  type: String,             // "bus_local" | "bus_long" | "flight" | "car" | "other"
  departurePlace: String,
  departureAt: Date,
  arrivalPlace: String,
  arrivalAt: Date,
  costPerPerson: Number,    // null si no aplica
  details: Object           // estructura flexible según tipo:
  // bus_local:  { steps: [{ line, fromStop, toStop, estimatedAt: Date }] }
  // Lectura histórica: estimatedTime: "HH:mm"; no se acepta en nuevas escrituras.
  // bus_long:   { company, terminal }
  // flight:     { flightNumber, airline }
  // car | other: {}
}
```

---

### Colección: `itineraryDays`

Generados automáticamente al configurar los transportes. No se crean manualmente.

```js
{
  _id: ObjectId,
  tripId: ObjectId,         // ref: trips, index
  destinationId: ObjectId,  // ref: destinations
  date: Date,               // fecha calendario del día
  type: String,             // "transit_out" | "activity" | "transit_return" | "arrival"
  startsAt: Date,           // hora desde la que el día está "activo"
  endsAt: Date,             // hora hasta la que el día está "activo" (null si no aplica)
  order: Number             // orden dentro del itinerario del trip
}
```

---

### Colección: `activities`

```js
{
  _id: ObjectId,
  tripId: ObjectId,         // ref: trips, index
  dayId: ObjectId,          // ref: itineraryDays, index
  title: String,
  description: String,      // null si no tiene
  scheduledAt: Date,        // obligatorio, no null; fecha y hora previstas o de realización, en UTC
  durationMinutes: Number,  // duración positiva opcional; null si no está indicada
  mapsUrl: String,          // null si no tiene
  createdBy: ObjectId,      // ref: users
  createdAt: Date
}
```

---

### Colección: `activityParticipations`

Participación individual en una actividad del mismo Trip. El creador recibe `going` al crearla; el resto empieza sin responder (ausencia de registro o `pending` sin marca). Cada miembro actual modifica manualmente solo su propia participación. El cambio entre planes se guarda atómicamente: se retira `going` de las actividades incompatibles y se asigna a la elegida, previa confirmación explícita. La validación no permite guardar simultáneamente participaciones superpuestas de una misma persona.

El índice único impide duplicar la participación a una actividad, pero no basta para controlar conflictos entre varias. La comprobación de agenda y la escritura deben serializarse con cambios de horarios, participación, membresía y eliminación; no se guarda parcialmente. Actualizar participación no modifica ni elimina la actividad.

Al editar inicio o duración, el sistema actualiza a `pending` únicamente los registros `going` de esa actividad que queden superpuestos con otros planes del participante y guarda `decisionRequired` con la causa y el instante del cambio. No elimina el registro ni lo convierte en una negativa voluntaria. Conserva los otros planes, las participaciones compatibles y las marcas pendientes; edición y actualizaciones son atómicas y generan notificaciones a los afectados. Esta operación del sistema no habilita a un usuario a cambiar manualmente la participación ajena.

`decisionRequired` solo acompaña un estado `pending` generado por ese conflicto. Una persona sin respuesta previa no recibe esa marca. Leer o consultar la explicación no la consume: solo una respuesta explícita `going` o `not_going` guardada correctamente deja `decisionRequired: null`, atómicamente con el estado. Un error, cancelación o cambio adicional no la elimina. La interfaz deriva «Modificado» de este dato persistido, no del permiso de push ni de una notificación leída.
```js
{
  _id: ObjectId,
  activityId: ObjectId,     // ref: activities, index
  userId: ObjectId,         // ref: users
  tripId: ObjectId,         // ref: trips (desnormalizado para queries)
  status: String,           // "going" | "not_going" | "pending"
  decisionRequired: {       // null normalmente; persistido por usuario/actividad
    reason: String,          // "schedule_conflict": inicio o duración modificados
    changedFields: [String], // "scheduledAt" y/o "durationMinutes", para explicar el cambio
    changedAt: Date          // instante UTC del cambio que retiró su participación
  },
  updatedAt: Date
}
// Index compuesto único: { activityId, userId }
```

---



### Colección: `posts`

```js
{
  _id: ObjectId,
  tripId: ObjectId,         // ref: trips, index
  authorId: ObjectId,       // ref: users
  description: String,      // null si no tiene
  mapsUrl: String,          // null si no tiene
  activityId: ObjectId,    // ref: activities — null si no está vinculado a actividad
  parentPostId: ObjectId,  // ref: posts — padre inmediato; excluye vínculo directo a actividad/transporte
  transportId: ObjectId,   // ref: transports — null si no está vinculado a un transporte
  createdAt: Date          // instante de publicación automático, inmutable al editar
}
```

---

### Colección: `postPhotos`

```js
{
  _id: ObjectId,
  postId: ObjectId,         // ref: posts, index
  tripId: ObjectId,         // ref: trips (desnormalizado para queries)
  s3Key: String,            // clave en S3 para construir la URL
  order: Number,            // orden dentro del post
  uploadedAt: Date
}
```

---

### Colección: `postExpenses`

Un documento por post (si tiene gasto). Relación 1:1 con post.

```js
{
  _id: ObjectId,
  postId: ObjectId,         // ref: posts, unique index
  tripId: ObjectId,         // ref: trips (desnormalizado para queries)
  totalAmount: Number,
  currency: String,        // ARS | EUR | USD
  breakdown: String,        // texto libre, null si no tiene desglose
  payments: [{
    userId: ObjectId,       // ref: users — quien realizó el pago
    unit: String,          // amount | percent
    value: Number          // monto fijo o porcentaje del total
  }],
  shares: [{
    userId: ObjectId,       // ref: users — quien asume esta parte
    unit: String,          // amount | percent | remainder | excluded
    value: Number          // solo para amount/percent; null para remainder/excluded
  }],
  createdAt: Date
}
```

Cada usuario aparece como máximo una vez en `shares`; puede tener varios pagos. Los importes resueltos se calculan desde total, moneda y estas reglas. El `paidBy` único anterior se migra como un pago del 100% por esa persona; no se inventa el reparto de gastos históricos sin esa información. El prototipo usa `memberId` como alias local de `userId`; no representa un nuevo identificador de membresía.

---

### Colección: `postLikes`

```js
{
  _id: ObjectId,
  postId: ObjectId,         // ref: posts, index
  userId: ObjectId,         // ref: users
  tripId: ObjectId,         // ref: trips (desnormalizado para queries)
  createdAt: Date
}
// Index compuesto único: { postId, userId }
```

---

### Colección: `comments`

```js
{
  _id: ObjectId,
  postId: ObjectId,         // ref: posts, index
  authorId: ObjectId,       // ref: users
  tripId: ObjectId,         // ref: trips (desnormalizado para queries)
  text: String,
  createdAt: Date
}
```

---

### Colección: `commentLikes`

```js
{
  _id: ObjectId,
  commentId: ObjectId,      // ref: comments, index
  userId: ObjectId,         // ref: users
  tripId: ObjectId,         // ref: trips (desnormalizado para queries)
  createdAt: Date
}
// Index compuesto único: { commentId, userId }
```

---

### Índices recomendados

```
users:                  { email: 1 } unique
refreshTokens:          { token: 1 }, { userId: 1 }, { expiresAt: 1 } (TTL)
trips:                  { inviteCode: 1 } unique, { visibility: 1 }
tripMembers:            { tripId: 1, userId: 1 } unique, { userId: 1 }
destinations:           { tripId: 1, order: 1 }
transports:             { tripId: 1 }, { destinationId: 1 }
itineraryDays:          { tripId: 1, order: 1 }
activities:             { tripId: 1 }, { dayId: 1 }
activityParticipations: { activityId: 1, userId: 1 } unique, { tripId: 1, userId: 1, status: 1 }
posts:                  { tripId: 1, createdAt: -1 }, { activityId: 1 }, { parentPostId: 1 }, { transportId: 1 }
postPhotos:             { postId: 1 }
postExpenses:           { postId: 1 } unique
postLikes:              { postId: 1, userId: 1 } unique
comments:               { postId: 1, createdAt: 1 }
commentLikes:           { commentId: 1, userId: 1 } unique
```

---

## 5. Arquitectura AWS

```
Cliente (React + Capacitor)
        │
        ├──── HTTPS ──────────► API Gateway
        │                            │
        │                     Lambda Functions
        │                            │
        │                 ┌──────────┴──────────┐
        │           MongoDB Atlas             AWS S3
        │           (base de datos)           (fotos)
        │
        └──── Presigned URL ──────────────────► S3
             (upload directo, sin pasar por Lambda)
```

**Auth flow:**
```
Cliente ──► POST /auth/register ──► Lambda (bcrypt hash) ──► MongoDB
Cliente ──► POST /auth/login    ──► Lambda (bcrypt compare) ──► JWT + Refresh Token
Cliente ──► POST /auth/refresh  ──► Lambda (valida refresh token) ──► nuevo JWT
```

**Upload de fotos:**
```
1. Cliente ──► GET /posts/:id/upload-url ──► Lambda ──► S3 presigned URL
2. Cliente ──► PUT <presigned URL> ──────────────────► S3 (directo)
3. Cliente ──► PATCH /posts/:id/photos ──► Lambda ──► MongoDB (guarda s3Key)
```

---

## 6. Flujos principales

### Crear un Trip
1. Usuario autenticado crea Trip con nombre y destino.
2. Configura transporte de ida (tipo, salida, llegada).
3. Configura transporte de vuelta (tipo, salida, llegada).
4. El sistema genera automáticamente los días del itinerario.
5. Se genera código de invitación y deep link.
6. El creador queda como admin.

### Unirse a un Trip
1. Usuario recibe código corto o link de invitación.
2. **Por código:** lo ingresa manualmente en la app → pantalla de confirmación de join.
3. **Por link:** la API devuelve HTML que intenta abrir `com.travellier.app://invite/:code`. Si la app está instalada, Capacitor la intercepta y abre la pantalla de join. Si no está instalada, después de ~1500ms muestra el HTML de fallback con instrucciones de instalación.
4. Usuario confirma unirse → queda como participante.

### Crear una actividad
1. Desde un día del itinerario se indica título, fecha y hora previstas y duración opcional, sin elegir un modo de actividad.
2. Se validan los límites del destino y los conflictos con actividades donde el autor ya figura «Voy».
3. Si hay conflicto, se ofrece conservar la participación actual o cambiar al nuevo plan. Confirmar registra el cambio; cancelar no publica la actividad ni modifica participaciones.
4. Se guardan conjuntamente la actividad y la participación «Voy» del creador. Los demás integrantes quedan sin responder y pueden sumarse o elegir otras actividades.
5. La actividad aparece en el itinerario sin aprobación grupal. Puede coexistir con planes simultáneos de otras personas.
6. Para una actividad espontánea creada desde el compositor se guarda también el post vinculado en la misma operación.

### Editar una actividad
1. Cualquier integrante actual puede editar respetando los límites del itinerario.
2. Si cambia inicio o duración, se revisa la agenda de quienes figuran «Voy». Quienes tengan conflictos pasan a «Sin responder» únicamente en la actividad editada, con la marca persistida de decisión requerida; se conservan los demás registros.
3. Se guardan juntos edición, participaciones y marcas. Se notifica el nuevo horario, el conflicto y el motivo; en el itinerario y detalle del afectado aparece «Modificado», aunque no tenga push activadas. Un fallo no guarda parcialmente ni notifica una desvinculación no realizada.
4. Con duración indicada, se rechaza cualquier cambio que deje el fin fuera de la ventana disponible.

### Cambiar la participación
1. Desde el detalle, el integrante actual usa «Voy / No voy» en «Tu participación».
2. Guardar «No voy» cambia únicamente su registro y elimina su marca de decisión requerida si existía; la actividad sigue visible aunque quede sin participantes.
3. Para «Voy», se comprueba su agenda personal. Sin conflicto se guarda directamente; con conflicto se muestran todas las actividades incompatibles y se pide confirmación.
4. Confirmar guarda de forma atómica «No voy» en las incompatibles y «Voy» en la elegida. Guardar «Voy» elimina la marca de decisión requerida de la elegida; cancelar o fallar conserva «Sin responder» y su marca si existían, sin guardar parcialmente.
5. Ningún otro participante cambia de actividad y ninguna propuesta se elimina. El mismo flujo está disponible antes, durante y después de la actividad.

### Crear un post
1. Desde el itinerario (día o actividad) o desde un botón global.
2. El usuario agrega descripción, fotos, ubicación y/o gasto.
3. Puede vincularlo a una actividad o a otro post al crearlo, o hacerlo después. Si registra una actividad que no estaba cargada, puede crearla como espontánea dentro del compositor y guardar juntos la actividad y el post vinculado.
4. Al confirmar se asigna la fecha y hora de publicación y aparece en el diario, más reciente primero. Si está vinculado a una actividad, también se muestra bajo ella aunque se publique después; si es independiente, se proyecta en su fecha de publicación solo cuando esa fecha está dentro del itinerario.

### Vincular posts después de creados
1. Desde el post, opción "vincular a...".
2. El usuario elige una actividad o un post existente del mismo Trip.
3. La vinculación se guarda y el post aparece anidado en el itinerario bajo esa actividad o junto al post relacionado.

---

## 7. Funcionalidades adicionales en scope

### Notificaciones push

Integradas con el ciclo de vida del Trip. Eventos que disparan notificación a los miembros relevantes:

- Nuevo post creado en el Trip.
- Nueva actividad propuesta.
- Actividad editada, indicando los cambios relevantes de horario, duración, ubicación o contenido.
- Participante desvinculado automáticamente por un conflicto tras editar inicio o duración: notificación dirigida al afectado, indicando la actividad editada, su nuevo horario y los otros planes incompatibles, e invitando a volver a decidir. Solo se envía tras guardar el cambio. El estado `pending` y el indicador personal «Modificado» se conservan y consultan dentro de la app, independientemente de entrega, lectura o permiso de push.
- Nuevo miembro se unió al Trip.
- Miembro expulsado (solo al afectado).
- Nuevo comentario en un post.

Implementación: AWS SNS o un servicio de push (Firebase Cloud Messaging) invocado desde Lambda al ocurrir cada evento.

### Integración con calendario

Desde el Trip, el usuario puede exportar los días de actividad a su calendario nativo del dispositivo (Google Calendar / Apple Calendar) vía el plugin de Capacitor `@capacitor/calendar` o generando un archivo `.ics` descargable.

Se exportan: nombre del Trip, días de actividad con sus horarios y actividades con hora y lugar. Si hay duración estimada, el evento incluye el fin derivado; sin duración no se inventa uno. Los eventos nativos vinculados se actualizan cuando cambia el horario, la duración o los datos del plan, sin duplicarlos. Se conserva la referencia al evento nativo; al eliminar una actividad, se retira su evento vinculado. Si no hay permisos o falla la actualización, no se informa como sincronizado.

Un archivo `.ics` ya descargado es estático y no puede modificarse en el calendario desde la app. En ese caso se genera una exportación nueva con identificadores estables de evento para importar de nuevo; no se promete actualización automática de la copia anterior. La importación y su tratamiento de duplicados dependen del calendario receptor.

---

## 8. Consideraciones futuras

- **Modo offline** — ver el itinerario sin conexión durante el viaje.
- **Chat grupal** del Trip.
- **Templates de viaje** — reusar la estructura de un Trip anterior.
- **Exportar resumen del viaje** — PDF con fotos, posts y gastos.

---

## 9. Criterios de aceptación y decisiones pendientes

### Criterios de aceptación acordados

| ID | Criterio |
| --- | --- |
| DUR-01 | Crear/editar actividades planificadas o espontáneas permite duración estimada opcional en horas/minutos. |
| DUR-02 | Con duración se muestran inicio/fin y duración; sin ella se muestra solo inicio, sin inferir un intervalo. |
| DUR-03 | Inicio y fin indicado deben caber en la ventana disponible; excederla rechaza crear, editar o cambiar transportes/itinerario. El fin exactamente en el límite es válido. |
| ACT-01 | Las actividades están disponibles al crearse, sin modo configurable, aprobación colectiva ni cantidad mínima de participantes. |
| ACT-02 | Se pueden crear planes simultáneos para distintas personas; ninguna propuesta se elimina automáticamente por no tener participantes. |
| PAR-01 | Tres de cinco integrantes pueden ir a A y dos a B en el mismo horario; ambas actividades permanecen en el itinerario. |
| PAR-02 | Una persona no mantiene «Voy» en actividades con superposición detectada. El modal identifica todos los conflictos y ofrece conservar su participación o cambiar de plan. |
| PAR-03 | Fin e inicio contiguos no se superponen. Sin duración no se inventa un intervalo; se detecta al menos la misma hora de inicio. |
| PAR-04 | El creador queda «Voy» al crear la actividad. Los demás empiezan sin responder y solo modifican su propia participación. |
| PAR-05 | Confirmar un cambio guarda conjuntamente «No voy» en las actividades incompatibles y «Voy» en la elegida; cancelar no modifica registros. |
| PAR-06 | Cambiar de plan no modifica actividades ni participaciones ajenas. Dejar de asistir no elimina la propuesta, aunque nadie siga marcado «Voy». |
| PAR-07 | Cada integrante actual puede cambiar su participación antes, durante y después de la actividad, sin editar sus datos. |
| PAR-08 | Si crear una actividad entra en conflicto con la agenda del autor, se confirma el cambio antes del guardado conjunto. Cancelar no publica actividad ni post vinculado ni retira participaciones existentes. |
| PAR-09 | La comprobación de agenda y escritura son atómicas y serializadas con cambios concurrentes. Si los conflictos cambiaron, se informa sin guardar parcialmente ni retirar otra participación silenciosamente. |
| EDI-01 | Editar conserva las participaciones compatibles y notifica los cambios. Un cambio solo de título, descripción o ubicación no desvincula a nadie. |
| EDI-02 | Si cambiar inicio o duración genera conflicto, los afectados pasan a «Sin responder» solo en la actividad editada, con marca persistida de decisión requerida, incluidos creador/editor si corresponde. No se les asigna «No voy»; sus otros planes y las participaciones compatibles permanecen intactos. |
| EDI-03 | Edición, desvinculaciones y marcas se guardan atómicamente y se serializan con cambios concurrentes. Un fallo no cambia registros parcialmente ni notifica una desvinculación no guardada. La actividad permanece aunque quede sin participantes. |
| EDI-04 | El afectado ve «Modificado» en itinerario y detalle, con ambos botones de participación sin seleccionar. Pulsarlo explica por qué se retiró su participación y le pide decidir nuevamente. No se muestra como afectado a quien conservó su participación. |
| EDI-05 | El indicador es personal y persistido; cerrar/reabrir la app, leer el aviso o no tener push activadas no lo elimina. No depende solo del color y es operable por toque y teclado. |
| EDI-06 | Solo guardar explícitamente «Voy» o «No voy» elimina la marca. Si «Voy» exige cambiar de plan, cancelar ese modal o fallar al guardar mantiene estado neutro e indicador. Otra edición tampoco consume una decisión pendiente. |
| DEL-01 | Admins y participantes pueden eliminar una actividad con confirmación explícita. Sus participaciones se retiran sin reasignar integrantes a otros planes. |
| DEL-02 | Eliminar una actividad conserva recuerdos, fotos, gastos y cadenas; los posts vinculados retiran su referencia directa a la actividad eliminada. Las otras actividades permanecen. |
| AUTH-01 | Registrarse solo requiere email y contraseña; la cuenta puede iniciar sesión y usar la app sin verificar el correo. |
| NOT-01 | Se notifican nuevas actividades y ediciones. Cada afectado por una desvinculación automática recibe el nuevo horario, los planes incompatibles y el motivo; no se notifica como desvinculado a quien conservó su participación. |
| CAL-01 | Los eventos nativos vinculados se actualizan sin duplicar cuando cambia el plan; un archivo ICS descargado requiere nueva exportación/importación y no se anuncia como actualizado automáticamente. |
| NAV-01 | Itinerario, Diario y Grupo comparten cabecera y pestañas; Diario conserva Posts/Fotos en ambos listados. Los detalles vuelven a su origen y las pestañas raíz salen a Mis viajes. |
| NAV-02 | Cambiar de día mantiene el scroll del itinerario y de la tira de fechas; pulsar el día seleccionado no reinicia la vista. |
| NAV-03 | El banner abre destinos ordenados con fechas/horarios derivados. Elegir uno lleva a su primer día; una fecha compartida conserva el destino elegido. Cerrar no cambia día ni scroll. |
| NAV-04 | Un destino con transportes incompletos indica qué falta, sin inventar fechas ni habilitar un salto no disponible. |
| POST-01 | El compositor tiene un solo Vincular a → Post / Actividad; esta última permite crear una espontánea. Un hijo solo apunta a su padre inmediato, admite ramas y no permite ciclos. |
| POST-02 | Publicación automática e inmutable al editar; Diario y Fotos muestran lo más reciente primero y permiten publicar fuera del viaje sin ampliar el itinerario. |
| POST-03 | Confirmar se hace al final del compositor, sin revisión intermedia; volver o un error conserva el borrador. Posts/Fotos del diario tienen acceso flotante a crear un recuerdo. |
| POST-04 | Los recuerdos de actividad y sus descendientes se proyectan bajo su actividad raíz, aunque se publiquen después. Solo los independientes se proyectan por publicación; el diario reúne todos. |
| FOTO-01 | El detalle de actividad permite recorrer Recuerdos/Fotos de su cadena raíz y abrir el post de origen; la galería del Trip reúne fotos de posts, sin álbum independiente. |
| FOTO-02 | La grid de Fotos alinea los elementos arriba y conserva filas de igual altura aun con títulos de varias líneas. |
| EXP-01 | Pagos múltiples y reparto configurable son independientes; incompletos se conservan sin deudas inventadas y cambiar de modo no pierde datos. |
| EXP-02 | Totales y balances se separan por ARS/EUR/USD, en centavos y sin conversiones; el gasto se atribuye a la actividad raíz o a publicación si no tiene actividad. |

Estos criterios describen el producto acordado, no pruebas ejecutadas ni tareas completadas. No implican que el prototipo o el código productivo ya cumplan este PRD.

### Casos operativos pendientes de definición

No quedan decisiones pendientes registradas en esta sección. Ante un conflicto generado por editar inicio o duración, el afectado deja de figurar «Voy» en esa actividad, queda en «Sin responder» con «Modificado» persistido y recibe una notificación complementaria. El indicador le explica el cambio y desaparece solo al guardar su nueva decisión; sus otros planes se conservan.

Esto no acredita implementación ni sustituye la revisión posterior de las tareas y del prototipo.
