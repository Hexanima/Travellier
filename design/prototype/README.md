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

## Pruebas

```sh
node --test --test-concurrency=1 *.test.mjs
```

La comprobación vigente es `node verify-participation.mjs`: recorre las 56 vistas del catálogo a 320/390/1280 px, cambios de plan, cancelación, actividad espontánea, persistencia y registro. Las capturas están en `review/participation/`.

Los scripts históricos `verify-*.mjs` y de capturas pueden conservar supuestos de entregas anteriores y usan Playwright del runtime local de Codex; no son necesarios para abrir el prototipo y no se agregan a los comandos de la aplicación.
