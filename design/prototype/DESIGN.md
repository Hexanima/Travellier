---
name: Travellier · diseño azul
description: Sistema azul aprobado, reconstruido desde los exports originales de Figma.
colors:
  navy-brand: "#16324f"
  navy-pressed: "#11263a"
  navy-ink: "#1c2c3c"
  navy-muted: "#5e6c79"
  navy-paper: "#faf8f4"
  navy-surface: "#ffffff"
  navy-on-brand-muted: "#c5d5e5"
  navy-soft: "#eaf0f6"
  navy-line: "#d9dfe4"
  navy-focus: "#264b70"
  disabled-surface: "#f0ebe3"
  error-ink: "#bc3030"
  form-error-ink: "#a13333"
  voting-bg: "#fcf3dc"
  success-bg: "#e6f2eb"
  success-ink: "#25634b"
  studio-bg: "#f0f1f1"
typography:
  display:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: "40px"
  title:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "32px"
  heading:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: "26px"
  body:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  body-small:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  caption:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "18px"
rounded:
  linked: "8px"
  control: "12px"
  card: "16px"
  pill: "999px"
  circle: "50%"
spacing:
  tight: "4px"
  small: "8px"
  group: "12px"
  card: "16px"
  content: "24px"
  spacious: "32px"
components:
  button-navy:
    backgroundColor: "{colors.navy-brand}"
    textColor: "{colors.navy-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "16px"
    height: "52px"
    width: "100%"
  button-navy-pressed:
    backgroundColor: "{colors.navy-pressed}"
    textColor: "{colors.navy-surface}"
    rounded: "{rounded.control}"
  button-navy-disabled:
    backgroundColor: "{colors.navy-soft}"
    textColor: "{colors.navy-muted}"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.navy-surface}"
    textColor: "{colors.navy-brand}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "15px"
    height: "52px"
    width: "100%"
  button-secondary-disabled:
    backgroundColor: "{colors.disabled-surface}"
    textColor: "{colors.navy-muted}"
    rounded: "{rounded.control}"
  text-field:
    backgroundColor: "{colors.navy-surface}"
    textColor: "{colors.navy-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "15px 16px"
    height: "56px"
    width: "100%"
  comment-field:
    backgroundColor: "{colors.navy-surface}"
    textColor: "{colors.navy-ink}"
    rounded: "{rounded.control}"
    padding: "12px"
  trip-card:
    backgroundColor: "{colors.navy-brand}"
    textColor: "{colors.navy-surface}"
    rounded: "{rounded.card}"
    padding: "24px"
    height: "260px"
    width: "100%"
  transport-card:
    backgroundColor: "{colors.navy-soft}"
    rounded: "{rounded.card}"
    padding: "16px"
  day-selected:
    backgroundColor: "{colors.navy-brand}"
    textColor: "{colors.navy-surface}"
    rounded: "{rounded.control}"
    width: "50px"
  confirmation:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "8px"
    width: "100px"
---

# Design System: Travellier · diseño azul

**Estado · 2026-10-11:** diseño aprobado y fijado por el usuario junto con el PRD v1 como referencia de implementación. Conservar este sistema y los flujos de `public/`; cambiar diseño o reglas requiere solicitud o aprobación explícita del usuario. No implica integración productiva ni tareas completadas.

## Overview

**Creative North Star: "El Travellier original, en azul"**

La autoridad visual son los exports entregados por el usuario de Fundamentos, Viajes e Itinerario, junto con los frames originales 7:5 y 9:5. La elección aprobada conserva Manrope, composición, jerarquía y geometría en una sola paleta azul. El estudio chocolate queda archivado en `versions/chocolate-study/`.

Este sistema describe el prototipo local de `public/`, cuya base visual fue aprobada el 2026-10-11: siete composiciones originales de Figma, fundamentos y extensiones hasta las 56 entradas del catálogo vigente. Post y Galería forman parte del diseño v1, no de los exports originales. La aplicación objetivo sigue siendo React + Capacitor para iOS y Android; el prototipo no acredita implementación productiva.

## Contrato vigente del diseño aprobado · 2026-10-11

- Un único sistema azul: Manrope, navy, fondo blanco cálido, superficies blancas y azul suave. Sin paleta marrón, votación ni estados de aprobación de actividad.
- Itinerario/Diario/Grupo comparten cabecera y pestañas persistentes. Diario conserva Posts/Fotos. Detalles y editores vuelven al contexto de origen; cambiar de día mantiene el scroll.
- El destino es un botón que abre las paradas ordenadas con fechas y horarios derivados de transportes. Elegir una lleva a su primer día; cerrar conserva posición. El panel usa los mismos tokens de superficie y texto, con presentación inferior en móvil.
- Actividades: duración opcional, participación propia Voy/No voy y conflictos con confirmación. «Modificado» es un indicador personal de decisión requerida, no un estado global; abrir la explicación no lo consume.
- Recuerdos: compositor directo sin revisión intermedia, un solo Vincular a → Post/Actividad y cadenas con ramificaciones. Comentarios textuales separados. Detalle de actividad con Recuerdos/Fotos y acceso al post de origen.
- Diario/Fotos: publicación descendente, grid alineada arriba y acción circular flotante. El último elemento puede desplazarse por encima del botón.
- Modo app: ocupa el ancho y alto disponibles, sin carcasa, barra de sistema ficticia ni controles de estudio. El marco de 390×844 describe únicamente el modo estudio.
- Estado local persistido para viajes/participaciones/recuerdos y avisos; no se guardan credenciales ni fotos temporales del dispositivo. El `.ics` es descargable; autenticación, push, mapas embebidos y sincronización nativa no son servicios implementados.

[PRD-AUDIT.md](PRD-AUDIT.md) documenta las cinco evaluaciones y sus doce hallazgos corregidos: intervalo/duración/fecha de fin compartidos, recuerdos bajo su actividad raíz, avisos completos de edición, conservación de instantes, revisión histórica conectada, avisos de membresía/actividad espontánea, reparto completable tras activar balance, aviso identificado por ID y tránsito continuo, tramos urbanos sin truncamiento e incorporación explícita de nuevos integrantes al reparto y publicación agrupada según la zona actual sin reescribir instantes. El selector de persona y su botón reutilizan los campos y botones secundarios, sin un modal ni estilos nuevos. Se mantuvo la base visual con Impeccable; la revisión histórica y la propuesta de reparto reutilizan los campos y tarjetas existentes, y los días intermedios usan la misma tarjeta de traslado con sus fechas originales. Las medidas, componentes y ejemplos de estados del baseline que siguen se conservan como referencia histórica; sus menciones a votación, siete pantallas, resets o extras no describen el comportamiento vigente. El sidecar `.impeccable/design.json` conserva los especímenes de la extracción original; no es la fuente de reglas funcionales.

**Key Characteristics:**

- Una paleta azul aprobada y superficies planas.
- Manrope, jerarquía compacta y fechas con cifras tabulares.
- Ruta y divisores originales, iconos SVG y fotografías acreditadas solo en los extras.

## Colors

Azul profundo y blanco cálido conservan el carácter del original; los colores semánticos describen estados.

### Primary

- **Navy brand:** acciones primarias, tarjeta de viaje, destino y selección.
- **Navy pressed / focus:** pulsación primaria y foco visible.

### Neutral

- **Ink / muted:** texto principal y secundario.
- **Paper / surface:** fondo cálido y tarjetas de lectura blancas.
- **Soft / line:** transporte, selección suave, bordes y divisores.
- **On-brand muted:** datos secundarios y trazos de ruta sobre azul.
- **Disabled surface:** fondo de campos y secundarios deshabilitados.
- **Studio background:** marco externo del prototipo.

Success comunica confirmación; voting identifica la votación con texto navy; error distingue los especímenes de campo y los avisos de formulario. No son paletas alternativas.

**The Blue Identity Rule.** La identidad usa la paleta azul aprobada; los colores de estado conservan su función semántica.

## Typography

**Display Font:** Manrope, con system-ui y sans-serif como fallback.
**Body Font:** la misma Manrope variable autoalojada.

**Character:** títulos claros y compactos, peso 700 para jerarquía y 600 para acciones y metadatos. Las medidas normativas están en el frontmatter.

### Hierarchy

- **Display:** título de la actividad en votación y presentación de fundamentos.
- **Title:** encabezados de pantalla, destino y tarjeta de viaje.
- **Heading:** nombre del viaje, día y títulos de actividades.
- **Body:** descripciones y relato del post.
- **Body small:** detalles de transporte, ubicaciones y comentarios.
- **Label:** botones, pestañas y nombres de autor.
- **Caption:** fecha, horario, estado y metadatos. Las leyendas de galería usan el mismo tamaño con peso regular.

Horarios y números de día usan cifras tabulares. Bajo 360px, nombre del viaje y títulos de eventos bajan a 16px, título y ruta de tarjeta a 22px y algunos metadatos a 11px. Display baja a 28/36. Son adaptaciones compactas, no una nueva escala general.

**The One Font Rule.** Las pantallas y los componentes conservan Manrope y la jerarquía del original.

## Layout

La pantalla tiene ancho máximo de 390px y altura de 844px. El cuerpo flexible tiene scroll propio; cabeceras y pies de acción quedan fuera de ese scroll. La barra de sistema conserva la presencia de los exports. El contenido habitual usa 24px horizontales. La tarjeta de viaje mide 260px de alto, con 24px internos y grupos de 12px; las tarjetas informativas usan 16px internos. El destino conserva un slot de texto de 260px que puede contraerse junto al pin de 24px.

Las pestañas de viaje conservan slots de 108/92/92px, separados por 8px. El calendario tiene seis días de hasta 50px y altura mínima de 64px. El itinerario alinea una columna horaria de 50px y tarjetas mediante un gap de 12px. La galería tiene dos columnas con gap de 12px e imágenes de 148px de alto; el post usa fotografía de 240px. Fecha y hora comparten una fila flexible y controles nativos.

El estudio tiene ancho máximo de 1140px y cabecera de 1260px. Fundamentos usa hasta 1120px con 40px internos; a 849px baja a 24px y reorganiza portada, colores y tarjetas; a 599px baja a 16px y apila tipos/componentes. Hasta 359px, el contenido mobile pasa a 16px horizontales, horario a 38px con gap de 10px, tarjetas de evento a 12px internos y galería a gap de 10px con imágenes de 125px. El marco del estudio pertenece al prototipo.

## Elevation & Depth

Fondo, marca y tono soft establecen la jerarquía. Tarjeta de viaje, destino, botones, calendario y tarjetas de lectura son planos; la sombra suave se limita al marco del teléfono.

### Shadow Vocabulary

- **Phone shell:** `0 12px 32px #0000000b`.

**The Flat Content Rule.** El contenido gana jerarquía con tono y espacio; la sombra actual pertenece al marco del prototipo.

## Shapes

Controles, campos y fotografías de galería usan curvas de 12px; tarjetas principales y carcasa, 16px. El enlace a actividad usa 8px; confirmación es una píldora y avatares y marcadores son círculos. Bordes de campos y pestañas del diario miden 1px. Divisor y ruta conservan los SVG originales en slots de 1.5px, teñidos con CSS masks sin redibujar geometrías.

## Components

### Buttons

Primario de marca/on-brand y secundario blanco/navy con borde line: ambos ocupan el ancho disponible y tienen altura mínima de 52px. Primario usa 16px internos y secundario 15px. Primario presionado/hover usa navy-pressed; secundario presionado conserva blanco y borde line. Primario deshabilitado usa soft/muted; secundario deshabilitado usa disabled-surface/muted.

Fundamentos muestra normal, presionado, deshabilitado y cargando para ambos. Cargando conserva los colores habilitados con control deshabilitado y `aria-busy`; son especímenes, no solicitudes reales. Iconos usan áreas de 48px; los demás controles conservan al menos 44px. Invitación, calendario y participación son acciones sin relleno.

Foco general: contorno de 3px, separado 3px. Transiciones de fondo y texto de 150ms ease y pulsación de 1px solo con `prefers-reduced-motion: no-preference`.

### Chips

Confirmación usa success-bg/success-ink, radio pill y ancho de 100px en tarjetas. En detalle, los estados usan 118×32px y radio control. Propuesta usa soft/navy y votación voting-bg/navy. El export contiene Finalizado, omitido y explicado en Fundamentos porque el PRD solo define proposed/voting/confirmed; no se incorpora como regla de negocio.

### Cards / Containers

Viaje conserva ruta, avión, divisor, destinos, fechas e iniciales; marca con relleno plano. Destino comparte marca y curvas card. Transporte usa soft y actividad surface, grupos de 8px, ubicación con pin y participación individual. Posts usan surface, 16px internos y fotografía al borde horizontal. Las imágenes conservan su orientación.

### Inputs / Fields

Campos de formulario: surface, texto ink, borde line, radio control y 56px de alto. Foco representado: borde de 2px y padding compensado; foco por teclado: contorno de 2px separado 3px. Error del espécimen usa error-ink en borde y texto; deshabilitado usa disabled-surface/muted. Fundamentos muestra los cuatro estados del export. Comentario conserva 48px de alto, 12px internos, etiqueta accesible y límite de 280 caracteres. Fecha/hora usan controles nativos. La validación de invitación y envío de formularios son demostraciones locales.

### Navigation

Mis viajes conserva Viajes/Descubrir/Perfil con iconos originales, etiquetas caption y selección soft/navy. El viaje usa Itinerario/Diario/Grupo con selección navy/on-brand; el espécimen sin seleccionar usa paper, texto muted y ningún borde. Fundamentos conserva atrás, campana, más y cerrar. El diario agrega Posts/Fotos como extensión. Calendario, filtros y respuestas usan `aria-pressed`.

Voto y participación son individuales. El estado local se reinicia al recargar, no hay confirmación automática y la respuesta personal no altera Confirmada. Acciones fuera de la muestra anuncian que la pantalla no está incluida. Galería agrega fotos de posts, selecciona hasta cuatro y muestra un collage local como Idea futura. No hay autenticación, backend, cargas reales, publicación, exportación ni integración nativa en esta muestra.

## Do's and Don'ts

### Do:

- **Do** conservar la composición original, Manrope y la identidad azul elegida.
- **Do** aplicar la cascada de `public/styles.css`, `public/blue-export.css` y `public/foundation-states.css` en ese orden.
- **Do** conservar SVG originales y procedencia de las seis fotos en `ASSETS.md`.
- **Do** mantener foco visible, objetivos de al menos 44px y movimiento reducido.
- **Do** identificar simulaciones, especímenes de carga y conceptos futuros de forma explícita.

### Don't:

- **Don't** reintroducir la paleta marrón o material de equipaje en el sistema activo.
- **Don't** reintroducir Literata, polaroids, fotos inclinadas o encabezados poéticos sobredimensionados.
- **Don't** presentar Post/Galería como copias del Figma original o el prototipo como plataforma web pública.
- **Don't** presentar estado local como persistencia, publicación o funcionalidad nativa real.
- **Don't** convertir Finalizado en estado de actividad sin definición en el PRD.

No canonizado: estilos de los estudios archivados y glyphs decorativos del marco externo preexistente. Los últimos no definen el sistema de iconos original. El prototipo tiene cobertura acotada y controles nativos como adaptación accesible; no demuestra una implementación integral del producto. Contrato actual: `blue-import.md`; evidencia y revisión: `review/blue-import/`.
