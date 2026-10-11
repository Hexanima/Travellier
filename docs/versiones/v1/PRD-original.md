# PRD — App de Viajes Grupales

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
4. [Modelo de datos](#4-modelo-de-datos)
5. [Arquitectura AWS](#5-arquitectura-aws)
6. [Flujos principales](#6-flujos-principales)
7. [Funcionalidades adicionales en scope](#7-funcionalidades-adicionales-en-scope)
8. [Consideraciones futuras](#8-consideraciones-futuras)

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
| Deep links | Custom URL Scheme (`com.tuapp://`) interceptado por Capacitor |

---

## 3. Módulos y funcionalidades

### 3.1 Auth

- Registro con email y contraseña — password hasheado con bcrypt desde Lambda.
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
JS intenta abrir → com.tuapp://invite/:code
        │
        ├── App instalada: el OS la intercepta y abre la pantalla de join
        │
        └── App no instalada: después de ~1500ms sin respuesta,
            el JS muestra el HTML de fallback con instrucciones
            para descargar/instalar la app
```

El mismo patrón aplica para el link de confirmación de email (`/auth/verify/:token` → `com.tuapp://verify/:token`).

#### Roles

| Rol | Permisos |
|---|---|
| Admin | Todo + puede expulsar participantes |
| Participante | Crear/editar actividades, posts, comentarios, votar — igual que admin salvo expulsión |

- El creador del Trip es admin por defecto.
- Puede haber múltiples admins.

#### Configuración del Trip

- **Modo de votación en actividades:** habilitado / deshabilitado (default: deshabilitado).
- **Modo de gastos:** solo registro / con balance entre participantes (default: solo registro).

---

### 3.3 Transporte

El transporte se configura en dos segmentos independientes: **ida** y **vuelta**. Cada segmento define las fechas límite del Trip y los días de tránsito en el itinerario.

#### Tipos de transporte disponibles

**Colectivo (urbano, paso a paso)**
- Se configuran múltiples tramos secuenciales.
- Cada tramo: línea/número, parada de origen, parada de destino, hora estimada.

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

#### Tipos de día

| Tipo | Descripción |
|---|---|
| Día de tránsito (ida) | Cubre el período desde la salida hasta la llegada al destino. Protagonista: transporte. Puede coincidir en fecha con el primer día de actividad. |
| Día de actividad | Días (o franjas horarias) dentro de la ventana de actividad. Protagonistas: actividades, posts, comidas. |
| Día de tránsito (vuelta) | Desde la hora de salida de regreso. Puede coincidir en fecha con el último día de actividad. |

#### Vista del día

Cada día muestra:
- Tipo de día (tránsito / actividad).
- Actividades planificadas para ese día con sus posts asociados.
- Posts espontáneos sin actividad padre, incluyendo posts vinculados al transporte.
- Resumen de gastos del día (si el modo gastos está activo).

---

### 3.5 Actividades

Una **Actividad** es algo planificado para un día específico del itinerario.

#### Campos

- Título.
- Descripción (opcional).
- Día del itinerario al que pertenece.
- Hora estimada (opcional).
- Ubicación con link de Google Maps (opcional).
- Estado por participante: confirmado / no va / sin responder.

#### Participación individual

Cada miembro indica por separado si participará en la actividad. El hecho de que un miembro no haya participado **no marca la actividad como no realizada** para el resto del grupo.

#### Votación (opcional, configurable por Trip)

Si el modo votación está habilitado, una actividad puede pasar por el flujo:

```
Propuesta → En votación → Confirmada
```

Si el modo votación está deshabilitado, las actividades se crean directamente como confirmadas.

#### Posts asociados

- Cualquier miembro puede crear posts vinculados a una actividad en cualquier momento (antes, durante o después).
- Múltiples posts pueden asociarse a la misma actividad de forma independiente — no hay orden forzado ni cadena.
- La vinculación también puede hacerse o modificarse **después de crear el post**.

---

### 3.6 Posts

Un **Post** es el registro de un momento del viaje. Puede estar planificado (asociado a una actividad), espontáneo, o vinculado a un tramo de transporte (fotos y momentos durante el viaje en sí).

#### Campos

- Autor.
- Descripción / texto libre.
- Fotos (una o varias, subidas a S3).
- Ubicación con link de Google Maps (opcional).
- Día del itinerario al que pertenece.
- Hora de publicación.
- Gastos (opcional — ver sección 3.8).
- Vinculaciones (ver abajo).

#### Vinculaciones

Un post puede vincularse a:
- Una **actividad** (muchos posts → una actividad).
- **Otro post** (muchos posts → un post raíz, como "relacionado con").
- Un **transporte** (muchos posts → un segmento de transporte, para fotos y momentos durante el viaje).
- Cualquier combinación de las anteriores, o ninguna (post espontáneo independiente).

La vinculación puede configurarse **al crear el post o en cualquier momento posterior**, permitiendo que dos personas que publicaron por separado sobre el mismo momento puedan vincular sus posts después.

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
1. Actividades planificadas, cada una con sus posts asociados anidados.
2. Posts espontáneos sin actividad padre, ordenados cronológicamente.
3. En días de tránsito: posts vinculados al transporte correspondiente.

---

### 3.7 Fotos

- Las fotos se suben directamente a **S3 vía presigned URLs** (el cliente sube directo, sin pasar por Lambda).
- Se sirven directamente desde S3 usando la URL del objeto.
- Las fotos siempre están en el contexto de un post — no existe un álbum independiente.
- La "galería grupal" es la vista agregada de todas las fotos de todos los posts del Trip.

---

### 3.8 Costos y gastos

Los gastos son parte de los **posts** — no un módulo separado. Al crear o editar un post, se puede agregar información de gasto.

#### Campos de gasto en un post

- Monto total del gasto.
- Desglose libre (ej: "agua 5000, entrada 8000, almuerzo 20000") — opcional.
- Quién pagó — opcional, solo si el modo balance está activo.

#### Modos (configurables por Trip)

**Modo registro (default)**
- Los gastos quedan registrados en cada post como información.
- No se calculan deudas ni balances.
- Útil para tener memoria de cuánto se gastó y en qué.

**Modo balance**
- Además del registro, el sistema calcula quién le debe cuánto a quién.
- Se puede activar en cualquier momento sin perder los registros anteriores.
- Vista de resumen de balance accesible desde el Trip.

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
  votingEnabled: Boolean, // default: false
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
  // bus_local:  { steps: [{ line, fromStop, toStop, estimatedTime }] }
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
  scheduledAt: Date,        // null si no tiene hora definida
  mapsUrl: String,          // null si no tiene
  status: String,           // "proposed" | "voting" | "confirmed"
  createdBy: ObjectId,      // ref: users
  createdAt: Date
}
```

---

### Colección: `activityParticipations`

```js
{
  _id: ObjectId,
  activityId: ObjectId,     // ref: activities, index
  userId: ObjectId,         // ref: users
  tripId: ObjectId,         // ref: trips (desnormalizado para queries)
  status: String,           // "going" | "not_going" | "pending"
  updatedAt: Date
}
// Index compuesto único: { activityId, userId }
```

---

### Colección: `activityVotes`

Solo aplica cuando `trip.votingEnabled = true`.

```js
{
  _id: ObjectId,
  activityId: ObjectId,     // ref: activities, index
  userId: ObjectId,         // ref: users
  tripId: ObjectId,         // ref: trips (desnormalizado para queries)
  value: String,            // "up" | "down"
  createdAt: Date
}
// Index compuesto único: { activityId, userId }
```

---

### Colección: `posts`

```js
{
  _id: ObjectId,
  tripId: ObjectId,         // ref: trips, index
  dayId: ObjectId,          // ref: itineraryDays, index
  authorId: ObjectId,       // ref: users
  description: String,      // null si no tiene
  mapsUrl: String,          // null si no tiene
  activityId: ObjectId,    // ref: activities — null si no está vinculado a actividad
  parentPostId: ObjectId,  // ref: posts — null si no está vinculado a otro post
  transportId: ObjectId,   // ref: transports — null si no está vinculado a un transporte
  createdAt: Date
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
  breakdown: String,        // texto libre, null si no tiene desglose
  paidBy: ObjectId,         // ref: users — null si expenseMode = "register"
  createdAt: Date
}
```

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
activityParticipations: { activityId: 1, userId: 1 } unique
activityVotes:          { activityId: 1, userId: 1 } unique
posts:                  { tripId: 1 }, { dayId: 1 }, { activityId: 1 }, { parentPostId: 1 }, { transportId: 1 }
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
3. **Por link:** la API devuelve HTML que intenta abrir `com.tuapp://invite/:code`. Si la app está instalada, Capacitor la intercepta y abre la pantalla de join. Si no está instalada, después de ~1500ms muestra el HTML de fallback con instrucciones de instalación.
4. Usuario confirma unirse → queda como participante.

### Crear una actividad
1. Desde un día del itinerario, el usuario crea una actividad.
2. Si votación está habilitada: queda en estado "propuesta", el grupo vota, al alcanzar consenso pasa a "confirmada".
3. Si votación está deshabilitada: queda directamente "confirmada".
4. Cada miembro puede indicar si va o no va.

### Crear un post
1. Desde el itinerario (día o actividad) o desde un botón global.
2. El usuario agrega descripción, fotos, ubicación y/o gasto.
3. Puede vincularlo a una actividad o a otro post al crearlo, o hacerlo después.
4. El post aparece en el día correspondiente del itinerario.

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
- Alguien votó en una actividad.
- Actividad confirmada (al alcanzar consenso de votación).
- Nuevo miembro se unió al Trip.
- Miembro expulsado (solo al afectado).
- Nuevo comentario en un post.

Implementación: AWS SNS o un servicio de push (Firebase Cloud Messaging) invocado desde Lambda al ocurrir cada evento.

### Integración con calendario

Desde el Trip, el usuario puede exportar los días de actividad a su calendario nativo del dispositivo (Google Calendar / Apple Calendar) vía el plugin de Capacitor `@capacitor/calendar` o generando un archivo `.ics` descargable.

Se exportan: nombre del Trip, días de actividad con sus horarios, actividades confirmadas con hora y lugar.

---

## 8. Consideraciones futuras

- **Modo offline** — ver el itinerario sin conexión durante el viaje.
- **Chat grupal** del Trip.
- **Templates de viaje** — reusar la estructura de un Trip anterior.
- **Exportar resumen del viaje** — PDF con fotos, posts y gastos.
