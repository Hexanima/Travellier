# Cobertura visual del PRD v1

## Evaluación vigente · diseño aprobado · 2026-10-11

La referencia completa es [PRD-AUDIT.md](PRD-AUDIT.md): cobertura por módulo y por criterio de aceptación, diferencias reproducidas y límites del prototipo. Sustituye las afirmaciones de cumplimiento y decisiones pendientes de los registros históricos siguientes.

El diseño azul y el recorrido fueron aprobados por el usuario. Las doce diferencias reproducidas se corrigieron por solicitud posterior: duración/fecha de fin, recuerdos bajo su actividad raíz, avisos de edición, conservación de instantes exactos, revisión histórica antes de editar, avisos de ingreso/expulsión/actividad espontánea, reparto completable tras cambiar de modo, navegación de avisos por ID y tránsito durante todo el traslado, conservación de más de cinco tramos e incorporación explícita de nuevos integrantes al reparto y agrupación de publicaciones según la zona actual. Push, mapas embebidos, autenticación y sincronización nativa siguen siendo representaciones; los tests no acreditan producción.

Evidencia del 2026-10-11: 191 pruebas unitarias aprobadas; regresiones F1–F12 y participación/catálogo verificadas a 320/390/1280 px. La auditoría inicial de 55 vistas queda como historial. Selector de destinos, scroll y separación destino/calendario se volvieron a verificar. El PRD en curso incorpora las decisiones visuales ya acordadas; la corrección posterior no modificó PRD, original, tareas ni código productivo.

## Adaptación vigente al PRD · 11 de octubre de 2026

El catálogo activo contiene 56 vistas (fundamentos y 55 vistas de teléfono), sin votación, aprobación colectiva ni confirmación obligatoria de email. Conserva el sistema azul y las pestañas compartidas.

- Actividad nueva: autor en «Voy»; otros integrantes sin responder. Duración opcional con fin derivado; validación del intervalo completo contra la ventana del destino.
- Participación: confirmación explícita ante todos los planes personales incompatibles. Cancelar conserva estado y borrador; confirmar cambia únicamente las participaciones propias.
- Edición de horario/duración: participantes afectados a «Sin responder», conservando otros planes; marca personal «Modificado» en itinerario y detalle, explicación accesible y aviso complementario.
- Persistencia de la marca al navegar/recargar; solo una respuesta explícita guardada la elimina. Snapshot de viajes local, sin datos de acceso ni fotos temporales del dispositivo.
- Actividad espontánea, post y cambio de participación se guardan juntos o no se guarda ninguno.
- Calendario: todos los planes, con hora de fin cuando existe duración. Registro: email y contraseña; nombre/avatar en perfil.
- Se conservan las cadenas/ramificaciones, comentarios y likes separados, publicación automática más reciente primero, fotos por actividad, galería alineada, pagos/repartos por moneda y modo app de viewport completo.

Comprobación vigente: pruebas unitarias y `verify-participation.mjs`, con el catálogo completo y flujos a 320/390/1280 px. Capturas en `review/participation/`. Se modela atomicidad local; no hay backend, push ni calendario nativo reales. No se modificaron PRD, original, tareas ni implementación de producción.

## Registro histórico: recorrido interactivo local

La versión activa agrega registros mutables en memoria compartidos por todos los módulos. Crear y editar viajes, destinos, transportes, actividades, posts, comentarios, fotos y gastos cambia las listas y los detalles relacionados. Las confirmaciones de baja y expulsión afectan el modelo local; no datos externos. El estado se reinicia al recargar. Las aclaraciones quedan fuera del teléfono.

`simulation.mjs` valida fechas derivadas, ventanas de actividad, conflictos de transporte, publicación atómica con actividad espontánea y controles de admin. El diario y la galería leen las fotos guardadas en posts. Los viajes finalizados son registros distintos de los activos. El portapapeles, selector de archivos y descarga .ics funcionan en el navegador. No hay permisos nativos, autenticación, S3 ni envío de push reales. Balance y consenso permanecen sin cálculos por las decisiones abiertas del PRD.

Evidencia actual: 52 pruebas unitarias aprobadas; `verify-playable.mjs` recorrió creación y edición completas, voto reemplazable, participación, comentarios, tres vínculos independientes, expulsión conservando identidad, join público/privado, exportación .ics, perfil y reintento. El batch de vistas pasó las comprobaciones de copy, imágenes y overflow de las 60 vistas a 320/1280px. `review/playable/` reúne 154 capturas válidas y 26 hojas; incluye desktop/mobile y user-390. Las recapturas enfocadas actualizan las vistas afectadas. No acredita ejecución nativa ni exhaustividad de todas las combinaciones.

La revisión independiente no estuvo disponible por límite de uso del agente. La revisión y documentación finales usan el fallback inline de Impeccable, declarado en `review/playable/finish-review.md` y `documentation.md`. DESIGN.md y su sidecar no cambiaron.

## Registro histórico: entrega visual anterior

Los límites y resultados que siguen describen la versión previa, archivada en `versions/pre-playable/`; no sustituyen el alcance interactivo anterior.

Fuente: `C:/Users/nicol/Desktop/Neo Nico/Proyectos/Travellier/docs/versiones/v1/PRD.md`, consultado completo el 9 de octubre de 2026. Documento de cobertura del diseño, no modificación del PRD.

La muestra tiene 60 entradas navegables: fundamentos y 59 vistas de teléfono, incluyendo estados; `public/catalog.mjs` es el índice. Se eliminó la revisión intermedia de publicación por pedido del usuario. Todos los diseños usan el sistema azul aprobado. Las siete pantallas de Figma se conservan y reciben únicamente accesos/campos necesarios para completar el alcance. Post y Galería forman parte de las extensiones v1; no son exports originales. Copia previa en `versions/figma-blue-baseline/`.

| PRD | Diseño y variantes |
| --- | --- |
| 3.1 Auth | Bienvenida, login, registro, confirmación por deep link, perfil y edición, sesión vencida. Formularios nativos con validación, error recuperable, sin envío de credenciales. |
| 3.2 Trips | Mis viajes activos/finalizados, primer viaje, crear con destino/privacidad/defaults, configuración, público y confirmación de join, código/link, fallback sin app instalada, integrantes e invitaciones. Vista admin/participante en controles externos de estudio. Confirmación de expulsión, baja del viaje y estado sin acceso. |
| 3.3 Transporte | Destinos ordenados/edición, baja solo de borrador vacío, mínimo de un destino y bloqueos por registros explicados. Ida/vuelta por destino; avión, ómnibus, colectivo urbano con tramos, auto y otro. Campos específicos, costo opcional, salida/llegada locales, paso a medianoche, horarios históricos sujetos a revisión. |
| 3.4 Itinerario | Fechas derivadas de transportes, ventana horaria exacta, calendario original, día mixto con tránsito y actividad, posts anidados bajo actividad y transporte, resumen de gastos. Conflicto de cambio sin pérdida/reubicación de datos. |
| 3.5 Actividades | Formulario planificado sin selector de tipo, fecha/hora obligatorias, Maps opcional, propuesta/votación/confirmada, voto reemplazable y desactivado, participación personal independiente, edición y eliminación con posts conservados. Actividad espontánea dentro del compositor. |
| 3.6 Posts | Diario, detalle, creación/edición, vínculos independientes coexistentes a actividad/post/transporte, borrador con navegación, actividad espontánea y post en un solo guardado, ubicación/Maps ilustrativos, comentarios/editado y likes independientes. |
| 3.7 Fotos | Selector de referencia, explicación de permiso y permiso denegado, visor, galería de fotos de posts; carga, error/reintento y resultado simulados. No álbum independiente. |
| 3.8 Gastos | Monto/desglose en compositor, pagador opcional solo en balance, registros desde posts, cambio de modo sin perder datos. Balance representado sin cálculos no definidos. |
| 6 Flujos | Crear → transporte → itinerario; invitación → confirmar; actividad → votar/participar; diario → compositor → vínculos/fotos/gasto → revisión; vinculación posterior desde detalle. Todas las transiciones son muestras locales, no persistencia de negocio. |
| 7 Push | Lista de los eventos definidos y aviso personal de expulsión, explicación/permiso habilitado/denegado. No envío de push real. |
| 7 Calendario | Previsualización de días y actividades confirmadas con horario/lugar, permiso y denegación, alternativa .ics. No eventos ni archivos reales. |
| Transversales | Carga con esqueletos, listas vacías, error/reintento, error de formulario conservando campos, controles disabled/busy, validación de invitación, foco y navegación accesibles, objetivos ≥44px y movimiento reducido. |

## Revisión aprobada en conversación · 2026-10-10

La fila 3.6 de la tabla anterior documenta la cobertura histórica del PRD, no el flujo vigente. En el prototipo actual, crear/editar post ofrece un solo «Vincular a», con las opciones Post y Actividad. Solo Actividad permite crear una actividad espontánea. Los posts se encadenan y ramifican: un hijo apunta únicamente a su padre y hereda el contexto de actividad desde la raíz. Los comentarios textuales siguen separados. Se preservan vínculos de transporte existentes al editar sin cambiar la relación, pero no se agrega una tercera opción al selector.

Este cambio responde a la definición explícita del usuario. El PRD y las reglas productivas todavía conservan la versión anterior; su sincronización queda pendiente, sin modificar backend ni dominio. `PRODUCT.md` registra la decisión. El detalle incluye una referencia compacta al padre, hijos directos en Recuerdos, comentarios textuales separados por pestañas y «Continuar recuerdo» con vínculo precargado. El viaje inicial contiene una cadena con dos ramificaciones para explorar. Verificación actual: 65 pruebas unitarias aprobadas; `verify-post-thread.mjs` verifica navegación, ramas, retorno con posición conservada, pestañas/teclado, comentarios y publicación de hijos a 320/390/1280px. `verify-post-linking.mjs` conserva los flujos de vinculación y `verify-mobile-viewport.mjs` la regresión del navbar sin espacio extra. Las capturas nuevas están en `review/post-linking/` y `review/post-thread/`.

Crear/editar recuerdo ahora guarda directamente desde el botón al final del formulario, sin «Revisar publicación». Se conserva el borrador ante validaciones y fallas de guardado. `post-submit.test.mjs` y `verify-post-submit.mjs` verifican confirmación directa, errores/reintento y botón deshabilitado durante carga en desktop/mobile. La suite actual tiene 69 pruebas unitarias aprobadas. Las referencias anteriores a revisión/carga en una pantalla separada corresponden al diseño histórico, no al flujo actual.

## Decisiones abiertas, no supuestas

- Consenso para confirmar actividades: sección 3.5 dice pendiente. El flujo genérico de 6 no autoriza una regla automática; nunca confirmamos por un umbral.
- Contrapropuestas y tratamiento de votos al editar: pendiente en 3.5. Se informa sin borrar ni recalcular votos.
- Balance: faltan reparto, moneda/unidad, redondeos y tratamiento de pagador no indicado. Diseño de estado pendiente; no partes iguales ni deudas fabricadas. No define una nueva regla de negocio.
- Verificación de email: el PRD menciona el deep link, pero no precisa la condición de activación de cuenta. Pantalla ilustrativa sin bloquear realmente el login.
- Fotografía de perfil: solo muestra nombre/foto/email; no inventa cambio de email, eliminación de cuenta o recuperación de contraseña.
- No se supone visibilidad de actividades para no integrantes de un Trip público: se invita a unirse antes de consultar.

## Límites de la entrega

Es diseño HTML navegable, no implementación funcional. React/Capacitor, AWS, MongoDB, S3, JWT y transacciones siguen en la app en desarrollo. Las formas y confirmaciones no mutan datos reales. Borradores, votos, participación, selección de fotos, comentarios y likes son demostraciones en memoria que se reinician al recargar. La validación nativa del navegador y el chequeo de llegada anterior a salida no acreditan conversión UTC ni todas las restricciones de ventanas de transporte. No se crea historial real, no se prueba concurrencia o integridad de MongoDB y no se solicita ningún permiso nativo. Los datos de ejemplo no acreditan viajes/fotos del usuario.

Collage conserva la marca «Idea futura» de la exploración anterior. Offline, chat, templates y PDF están fuera de v1. No se revisó ni modificó el listado de tareas ni el código productivo. Figma permanece sin cambios.

## Evidencia

- Batch final informado por el agente principal: `node --test state.test.mjs foundations.test.mjs v1.test.mjs`, 34 pruebas aprobadas de estados, contexto, borradores, vínculos y renderizadores. No acredita servicios ni persistencia.
- `review/v1/verification.json`: 61 entradas y 120 verificaciones de viewport para las 60 vistas de teléfono a 320/1280px de navegador (teléfono 296/390px), sin overflow, imágenes rotas ni errores reportados. Fundamentos tiene sus dos capturas propias. `verify-v1.mjs` también genera cinco tipos de transporte, roles, estados y contenido largo.
- Batch informado por el agente principal: `node verify-blue.mjs`, regresión de las diez vistas originales/fundamentos y memoria previa a 320/390/1280px de navegador.
- `review/v1/context/verification.json`: PASS de secuencias F1–F3, con cero errores reportados y 11 capturas; incluye Venecia → día mixto → transporte Roma/Florencia y fecha completa del paseo del Tíber. Su PASS no sustituye el veredicto visual.
- `review/v1/finish-review.md`: revisión completa de 181 PNG (30 hojas con 177 entradas y cuatro capturas adicionales). `review/v1/finish-verdict-final.md`: `ship · clear`, F1–F3 resueltos tras confirmación enfocada de los hallazgos. No es una nueva auditoría completa ni aprobación productiva. `finish-verdict.md` conserva el estado intermedio como historial.
- Detector informado una vez: advisories de 13/11/22/28px; la revisión no identificó un defecto visual material adicional a partir de ellos. Escaneo de procedencia informado: seis rasters activos, cero orígenes faltantes, sin nuevos rasters.
- `review/v1/documentation.md`: evidencia documental y diferencias históricas de alcance del sistema conservado. No es un nuevo veredicto ni un test nativo.
