# T31 — UTC, presentación local y referencias del itinerario

## Estado de la revisión

La auditoría retiró la observación sobre la división por medianoche UTC: no identificó incumplimientos de los criterios de aceptación de T31. La implementación existente conserva los timestamps exactos y documenta que la presentación local corresponde a T34.

Se descartó el borrador de corrección que exigía una zona IANA al generador. No se propone configurar una zona fija del Trip ni del destino.

## Criterio confirmado por el usuario

- Almacenar los timestamps como instantes UTC.
- Mostrar y agrupar el itinerario en la zona local del usuario.
- Conservar fecha, hora y milisegundos de los límites reales. Una llegada a las 08:00 habilita actividad desde las 08:00; `date` no habilita actividad desde medianoche.
- La ventana de actividad se extiende desde `arrivalAt` de la ida hasta `departureAt` de la vuelta. Se requieren ambos límites para generar esa ventana.
- Toda actividad, planificada o espontánea, requiere fecha y hora en `scheduledAt`. La espontánea precarga el momento actual y permite ajustarlo si se registra después de realizada.

## Propuesta de integración

El criterio de timestamps UTC, presentación local y fecha y hora obligatorias de las actividades quedó registrado en las secciones 3.4 y 3.5 del PRD. La siguiente propuesta organiza su integración en las tareas posteriores; no requiere modificar el generador T31.

### T31: proyección de almacenamiento

Mantener las franjas canónicas UTC actuales. `date` identifica el día UTC del segmento; `startsAt` y `endsAt` delimitan su intervalo exacto. Dos segmentos UTC pueden pertenecer a una misma fecha local.

### T32: persistencia y regeneración

Asignar y conservar las referencias compartidas `dayId` independientemente de la zona del lector. Cambiar la zona de visualización no ejecuta regeneraciones. Al modificar transportes, proteger actividades y posts dependientes conforme al alcance ya previsto en T32.

### T33 y T34: consulta y presentación local

Devolver los IDs y los intervalos UTC exactos. La interfaz divide esos intervalos por límites de calendario local y reúne las franjas que pertenezcan a la misma fecha local, preservando tipo y destino. Una sección visual puede contener segmentos con distintos `dayId`, y un segmento persistido puede contribuir a dos secciones visuales.

La fecha visual no reemplaza el `dayId` persistido. Las actividades se ubican visualmente por su `scheduledAt` obligatorio convertido a la zona del usuario; los posts con `createdAt`, por su timestamp correspondiente, conservando su contexto de actividad, transporte o destino.

### T35 y T36: actividades

Al crear o mover una actividad, resolver el segmento canónico de actividad que contiene `scheduledAt`, verificar pertenencia al Trip y al destino y validar el timestamp obligatorio contra los límites exactos. Una fecha local de la interfaz no es suficiente para elegir un único `dayId`.

### T37: carga de actividades

La actividad planificada solicita fecha y hora previstas. La espontánea precarga fecha y hora actuales y permite ajustarlas para indicar cuándo ocurrió. Convertir ese momento local a UTC al guardar; mostrarlo en la zona local al consultar. El momento de la actividad puede diferir de `createdAt` cuando se registra después.

## Ejemplo de presentación

Para llegada el 25/09 a las 10:00 y salida el 25/09 a las 23:00 en UTC-03, la actividad ocupa `25/09 13:00Z–26/09 02:00Z`.

El almacenamiento puede tener dos segmentos, separados en `26/09 00:00Z`. Ambos se presentan dentro del 25/09 local, desde las 10:00 hasta las 23:00. No se habilita actividad antes de las 10:00 ni después de las 23:00.

## Tests antes de implementar la integración

- T31: mantener la regresión de límites exactos, offsets de entrada, milisegundos, viajes de un día, múltiples días y múltiples destinos.
- T32: leer desde distintas zonas no modifica documentos ni referencias; la regeneración por cambios de transporte conserva o protege datos dependientes.
- T34: la ventana 10:00–23:00 UTC-03 ocupa una sola fecha local aunque provenga de dos segmentos UTC.
- T34: un segmento UTC que cruza medianoche local aparece en dos fechas visuales sin duplicar entidades ni alterar su ID.
- T34: cambios de horario con días locales de 23 y 25 horas; offsets fraccionarios; conservación de los extremos y los milisegundos.
- T35/T36: rechazar horarios fuera de la ventana de actividad y referencias ajenas al Trip; resolver correctamente un horario local cuya fecha UTC sea distinta.
- T35/T36: rechazar `scheduledAt` ausente, `null` o inválido en creación y edición; aceptar actividades planificadas y espontáneas con timestamp válido dentro de la ventana.
- T37: exigir fecha y hora para guardar; precargar el momento actual en actividades espontáneas, permitir editarlo y conservar el momento de realización al registrar posteriormente; convertir el horario local a UTC y mostrarlo de vuelta en la zona del usuario.

## Alcance actual

Este documento plantea la integración y los tests previos a implementarla. La actualización actual alcanza al PRD, las tareas de desarrollo afectadas y este plan; el código del generador T31 conserva su comportamiento.
