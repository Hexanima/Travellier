# Contexto del proyecto: Travellier

## Fuente de verdad

- El producto de la primera versión está definido en `docs/versiones/v1/PRD.md`, aprobado y fijado como referencia de implementación el 2026-10-11. Consultarlo antes de implementar o modificar comportamiento funcional.
- `docs/versiones/v1/PRD-original.md` conserva sin cambios el primer PRD incorporado al repositorio (commit `c72ca71`, entonces `docs/PRD.md`). Mantener únicamente el original y `PRD.md` vigente; registrar los cambios autorizados directamente en este último mediante Git. No crear revisiones por cada conversación.
- El PRD y el diseño azul vigente quedaron fijados por el usuario el 2026-10-11. No cambiar alcance, reglas funcionales ni diseño sin una solicitud o aprobación explícita del usuario. Esta referencia guía la implementación, pero no acredita servicios reales ni tareas completadas.
- El listado de tareas no se considera actualizado a las modificaciones del PRD automáticamente. No modificarlo ni implementar cambios de producto como efecto lateral de actualizar el PRD; el usuario revisará las tareas después.
- Si una decisión de implementación contradice el PRD o requiere una nueva regla de negocio, señalarlo y pedir definición antes de asumirla.
- El proyecto comienza desde un template; que un módulo actual sea mínimo no implica que sea una funcionalidad ya implementada.
- El diseño azul aprobado se conserva en `design/prototype/public/`, separado del código productivo; `design/prototype/README.md` explica cómo explorarlo. El contrato visual vigente está en `design/prototype/DESIGN.md`.
- `design/prototype/PRD-AUDIT.md` documenta la evaluación contra el PRD actual, diferencias pendientes y límites de servicios simulados. La aprobación visual y los tests locales no acreditan cumplimiento productivo; no dar sus hallazgos por corregidos ni sus tareas por realizadas.

## Producto

Travellier es una aplicación mobile para iOS y Android que permite a grupos organizar y documentar viajes.

- El cliente es React empaquetado con Capacitor. No hay plataforma web pública en alcance.
- El backend objetivo es AWS Lambda + API Gateway con Node.js.
- MongoDB Atlas almacena datos relacionales mediante colecciones y referencias.
- Las fotos se cargan directo a S3 mediante presigned URLs.
- La autenticación usa JWT y refresh tokens manejados por el backend.

## Arquitectura

- Respetar Clean Architecture: `domain` no depende de `apps/*`; las dependencias apuntan hacia el dominio.
- Mantener entidades, value objects, casos de uso, errores, resultados y puertos en `domain`.
- Mantener los detalles HTTP, AWS, MongoDB, S3 y Capacitor en adaptadores de `apps/*`.
- Usar TypeScript y el contrato discriminado `Result` ya presente en el template para resultados de dominio.

## Reglas funcionales clave

- Un Trip agrupa integrantes, destinos, transportes, itinerario, actividades, posts y gastos.
- Las fechas de un Trip no se cargan manualmente: se derivan de `arrivalAt` y `departureAt` de los transportes. `itineraryDays` es una proyección visual del calendario.
- Un día puede incluir tránsito y actividad. Las actividades se habilitan desde la llegada y hasta la salida del destino.
- Un Trip puede tener destinos secuenciales ordenados.
- Las actividades tienen un único funcionamiento basado en participación individual, sin modo configurable ni aprobación colectiva. Distintas personas pueden hacer planes simultáneos; no hay exclusividad horaria global para el Trip.
- Crear una actividad marca «Voy» al autor; los demás empiezan sin responder. Cada integrante actual modifica solo su propia participación mediante «Voy / No voy», antes, durante o después de la actividad.
- La agenda personal no admite «Voy» en actividades con superposición detectada. El modal identifica todas las incompatibles y ofrece conservar la participación actual o cambiar de plan. Confirmar guarda atómicamente «No voy» en las anteriores incompatibles y «Voy» en la elegida; cancelar no cambia nada. No afecta actividades ni participantes ajenos.
- Crear una actividad con conflicto en la agenda del autor requiere esa misma confirmación antes del guardado conjunto de actividad, participación y post si corresponde. Cancelar no publica ni retira participaciones.
- Una actividad sin participantes permanece visible. Dejar de asistir o cambiar de plan no equivale a eliminarla. La participación registrada no verifica automáticamente presencia física.
- La duración estimada es opcional en actividades planificadas y espontáneas; el fin se deriva del inicio y la duración. Sin duración no se inventa un intervalo y se detecta al menos igualdad de inicio. Con duración, el fin debe caber en la ventana del destino; excederla se rechaza, también al cambiar transportes. Fin e inicio contiguos no se superponen.
- Editar inicio o duración revisa la agenda de cada participante «Voy». Quienes tengan conflictos pasan a «Sin responder» (pending) solo en la actividad editada y reciben una marca persistida decisionRequired con motivo schedule_conflict y fecha UTC; no se les asigna «No voy». Incluye creador/editor si corresponde; conserva otros planes y participaciones compatibles. Cambiar solo contenido/ubicación no desvincula.
- Edición, desvinculaciones y marcas se guardan atómicamente y se serializan con cambios concurrentes. Un fallo no guarda parcialmente ni notifica una desvinculación no realizada. El sistema puede retirar esa participación por conflicto, pero nadie puede elegir manualmente la asistencia ajena.
- Cada afectado ve «Modificado» en itinerario y detalle, con «Voy / No voy» sin seleccionar. Pulsarlo explica el cambio y solicita decidir nuevamente. Es personal, persistido y accesible; no depende de push ni de lectura del aviso. Solo guardar una respuesta explícita elimina decisionRequired. Cancelar un cambio de plan, fallar al guardar u otra edición conserva el estado neutro y la marca. Se notifican el nuevo horario, los planes incompatibles y el motivo como complemento del indicador.
- Eliminar una actividad elimina sus participaciones, no otros planes. Los recuerdos y sus cadenas se conservan; se retira el vínculo directo a la actividad eliminada. No reasignar participantes automáticamente.
- Un post puede ser independiente o vincularse a una actividad; un hijo se vincula solo a su padre inmediato y admite ramificaciones. La actividad raíz se proyecta recorriendo la cadena. El transporte puede venir vinculado desde su detalle.
- La fecha/hora del post se asigna automáticamente al publicar, no cambia al editar y permite publicar fuera de las fechas del viaje. Diario y fotos se ordenan por publicación descendente; los posts no requieren `dayId`.
- La actividad espontánea precarga la fecha/hora actuales, ajustables y sujetas a la ventana de actividad; puede registrar un momento ya ocurrido respetando esos límites y la agenda personal.
- Los pagos realizados y el reparto acordado son independientes: pagos múltiples por monto/porcentaje; partes fijas, porcentuales, resto en partes iguales o exclusión. Balance solo para gastos con pagos/reparto completos, por moneda (ARS/EUR/USD), en centavos y sin conversiones. Conservar datos al cambiar de modo de gastos.
- Un gasto se atribuye al día de su actividad raíz; sin actividad, al de publicación. No cambiar la fecha original del post.
- No hay datos previos de producción que migrar; esto no autoriza borrar datos dev. Los eventos nativos vinculados se actualizan cuando cambia el plan; un ICS descargado requiere nueva exportación/importación.
- Registrarse solo requiere email y contraseña. La cuenta se habilita sin verificación obligatoria de correo; nombre y avatar pertenecen al perfil.
- Fotos, comentarios, likes de posts y likes de comentarios son entidades separadas.
- Los gastos pertenecen a posts. Cada Trip usa modo `register` o `balance`; estos modos de gastos no son modos de actividades.
- Los roles del Trip son `admin` y `participant`; ambos pueden crear y editar actividades, posts y comentarios. Solo admin puede expulsar integrantes.

## Alcance

- En scope: notificaciones push e integración con calendario nativo.
- Fuera del alcance inicial: offline, chat grupal, templates de viaje y exportación de resumen en PDF.

## Convenciones de datos

- Usar `ObjectId` de MongoDB para identificadores y referencias entre colecciones.
- Preservar las colecciones y los índices definidos en el PRD, en particular los índices compuestos únicos para membresías, participaciones y likes.
- Los campos de relación desnormalizados por `tripId` existen para consultas eficientes y deben mantenerse consistentes.
