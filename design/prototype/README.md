# Travellier · prototipo de diseño

Diseño aprobado en HTML, CSS y JavaScript, separado de `apps/web` y del backend. Conserva la propuesta azul y los flujos navegables como referencia de implementación; no es una implementación de producción.

**Diseño y PRD aprobados y fijados el 2026-10-11.** El usuario cierra la planificación actual y los establece como referencia para implementar y comparar las tareas. Cambiar alcance, reglas o diseño requiere solicitud o aprobación explícita del usuario. [Evaluación contra el PRD](PRD-AUDIT.md): las doce diferencias de las cinco evaluaciones están corregidas y verificadas en el prototipo; se conservan los límites de integración real. No se modificaron las tareas ni el código productivo.

Las correcciones muestran duración y fecha de fin, mantienen los recuerdos bajo su actividad raíz y completan los avisos de edición, ingreso, expulsión y actividad espontánea. Las ediciones conservan los instantes exactos; los tramos históricos requieren revisión explícita antes de guardarse. Un gasto de registro permite completar su reparto al activar balance, cada aviso abre su viaje y el transporte aparece también en los días intermedios. Los traslados urbanos permiten más de cinco tramos sin truncarlos y los gastos permiten agregar explícitamente nuevos integrantes al reparto, conservando pagos y partes acordadas. El itinerario deriva el día de publicación desde su instante UTC y la zona actual, sin depender del día local almacenado. Las suites `prd-audit-fixes`, `prd-edge-fixes`, `prd-flow-fixes` `prd-editing-fixes` y `prd-local-day` verifican estos casos en unidades y navegador; hay 191 pruebas aprobadas. Se conservaron los componentes azules con Impeccable.

## Live Server

Abrí `design/prototype/public` como carpeta en VS Code y seleccioná **Open with Live Server** sobre `index.html`.

Agregá `?v=playable&mode=app` a la URL para explorar únicamente la app, ocupando todo el ancho y alto disponibles. Sin `mode=app` se muestra el estudio con su índice de pantallas y controles.

Para verlo desde el celular, conectá ambos dispositivos a la misma red, activá `liveServer.settings.useLocalIp` y usá la IP de la PC y el puerto de Live Server. Permití el acceso del servidor únicamente en redes privadas si Windows lo solicita.

## Servidor Node

Desde `design/prototype`:

```sh
node server.mjs
```

Abrí <http://127.0.0.1:4173/?v=playable&mode=app>. Este servidor escucha solo en la PC; Live Server es la opción para acceder desde el celular. Si el puerto 4173 está ocupado, cerrá la vista previa anterior antes de iniciarlo.

No abras el HTML directamente como archivo: los módulos JavaScript necesitan un servidor HTTP.

## Destinos en el itinerario

El banner del destino abre las paradas del viaje en orden, con fechas y horarios locales de llegada/salida derivados de los transportes. Elegir una lleva a su primer día sin salir del itinerario. Las fechas compartidas conservan la parada seleccionada; cerrar el selector no cambia el día ni el scroll. Los destinos sin transportes completos indican qué falta, sin inventar fechas.

Pruebas: `destination-picker.test.mjs`, `verify-destination-picker.mjs` (320/390/1280 px). Capturas: `review/destination-picker/`. Se reutilizan los tokens azules y componentes existentes siguiendo Impeccable. Cambios limitados al prototipo.

## Archivos

- `public/`: pantallas, estilos, navegación, estado local, fotos, iconos y fuente.
- `PRODUCT.md`, `DESIGN.md` y `.impeccable/`: contexto y sistema visual conservados.
- `playable-direction.md` y `V1-COVERAGE.md`: decisiones y cobertura del prototipo.
- `ASSETS.md`: procedencia de los recursos visuales.
- `review/blue-import/exports/` y `review/figma-base/`: referencias originales de Figma.
- `*.test.mjs`: pruebas del modelo y las pantallas.

El PRD del producto sigue siendo [docs/versiones/v1/PRD.md](../../docs/versiones/v1/PRD.md). Las actividades, participaciones, recuerdos y avisos del recorrido se conservan localmente en este navegador. «Reiniciar recorrido» restaura los registros iniciales; no se crean cuentas ni se envían datos al backend. No se persisten email, contraseña, permisos ni fotos seleccionadas desde el dispositivo. Las limitaciones detalladas están en `PRODUCT.md` y en el modo estudio.

Las versiones descartadas y las capturas de verificaciones anteriores permanecen en la carpeta original fuera del repositorio; no se importaron como parte del diseño vigente. Algunas referencias históricas en los documentos conservados apuntan a ese archivo anterior.

## Adaptación al PRD vigente · 11 de octubre

- Actividades sin votación ni aprobación global; el autor queda en «Voy».
- Agenda personal con confirmación para cambiar de plan cuando hay superposiciones.
- Duración opcional en horas/minutos y validación de inicio y fin contra los transportes.
- Ediciones incompatibles dejan la participación «Sin responder», con «Modificado» personal y explicación accesible. La marca solo se elimina al guardar «Voy» o «No voy».
- Registro con email y contraseña, sin confirmación obligatoria de correo.
- Calendario con todos los planes y hora de fin cuando hay duración.

Se conservan el azul, las pestañas compartidas, las cadenas de recuerdos, las fotos por actividad y los gastos configurables. Estos cambios corresponden al prototipo; no modifican la implementación, el PRD ni las tareas.

## Salida, titularidad y moneda de transportes · T117 (pendiente de aprobación)

Propuesta de diseño para los cambios del PRD del 2026-11-08, **pendiente de aprobación del usuario**. Detalle, decisiones provisorias y límites en [PRD-AUDIT.md](PRD-AUDIT.md). Solo cambia el prototipo.

Cómo explorarlo (servidor Node o Live Server, `?mode=app` para ver solo la app; sin ese parámetro se muestra el estudio):

- **Grupo con titular y roles:** `?mode=app&screen=group`. Nico es titular (insignia «Titular»), Ana es admin, Martín y Juli son participantes. «Gestionar» abre `member-manage` con las acciones según el rol de quien mira; «Hacer admin»/«Quitar admin» abre `role-change`; «Transferir titularidad» abre `transfer-owner`.
- **Titular que intenta salir:** en Grupo, «Salir del viaje» (`screen=leave-owner`): elegir transferir o eliminar. Transferir lleva después a la confirmación de salida (`screen=leave-trip`); al confirmar se vuelve a Mis viajes.
- **Salir como admin o participante:** transferir la titularidad a otra persona y volver a «Salir del viaje», o unirse desde Descubrir a «Roma en buena compañía» (allí Ana es titular y vos participante). El control del estudio «Vista del rol: Participante» muestra la vista de un participante sin cambiar la membresía.
- **Expulsar:** Grupo → «Gestionar» → «Expulsar» (`screen=remove-member`). Un admin solo expulsa participantes; el titular también admins; nadie expulsa al titular. «Eliminar viaje» (Opciones del viaje, `screen=delete-trip`) solo aparece para el titular.
- **Moneda de transportes:** `?mode=app&screen=transports` muestra «Costo de transporte por persona» por moneda y el costo previo en «Moneda sin indicar». `screen=transport-edit` tiene el selector «Moneda del costo»; el detalle del traslado (`screen=transport-detail`) muestra el costo con su moneda. Para ver el vuelo Venecia → Buenos Aires con la moneda sin indicar, elegir el destino Venecia en «Ida y vuelta» y abrir su salida.
- **Ex integrantes en gastos y balance:** expulsar a Juli y abrir Gastos (`screen=expenses`), el detalle de un gasto en un post (`screen=post`) y Balance (`screen=balance`, con el control «Gastos: Balance»). Juli aparece como «Juli · ex integrante», con sus pagos y partes conservados.

«Reiniciar recorrido» restaura los datos iniciales, incluidos los costos y monedas de ejemplo (los estados guardados antes de esta entrega no los tienen).

Pruebas: `membership-ownership.test.mjs`, `transport-currency.test.mjs` y `former-members.test.mjs`; recorrido en navegador: `node verify-membership.mjs` (320/390 px). Pantallas nuevas en el catálogo: `member-manage`, `role-change`, `transfer-owner`, `leave-trip` y `leave-owner` (61 entradas en total). La validación con Impeccable la hace la sesión principal después de esta entrega.

## Pruebas

```sh
node --test --test-concurrency=1 *.test.mjs
```

La comprobación vigente es `node verify-participation.mjs`: recorre las vistas del catálogo (56 cuando se ejecutó; hoy son 61 y no se volvió a correr en T117) a 320/390/1280 px, cambios de plan, cancelación, actividad espontánea, persistencia y registro. Las capturas están en `review/participation/`.

Los scripts históricos `verify-*.mjs` y de capturas pueden conservar supuestos de entregas anteriores y usan Playwright del runtime local de Codex; no son necesarios para abrir el prototipo y no se agregan a los comandos de la aplicación.
