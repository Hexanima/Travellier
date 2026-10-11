# Evaluación del diseño contra el PRD v1

Fecha: 2026-10-11. Fuente: [PRD en curso](../../docs/versiones/v1/PRD.md), incluidos sus criterios de aceptación. Referencia visual: `public/`, diseño azul aprobado por el usuario. No es una auditoría de PR, de las tareas ni del código productivo.

## Resultado

El diseño expresa coherentemente Travellier y cubre los módulos y recorridos principales del PRD. **Las doce diferencias reproducidas en las cinco evaluaciones se corrigieron en el prototipo por solicitud del usuario.** La cobertura sigue siendo parcial respecto del producto real: el HTML representa integraciones nativas/backend y no acredita producción.

La evaluación inicial no modificó la UI ni sus reglas. La corrección posterior mantiene el sistema azul y los flujos aprobados, sin modificar el PRD, las tareas ni el código productivo. No se generaron otras versiones del PRD.

## Hallazgos iniciales · corregidos el 2026-10-11

Las reproducciones siguientes describen el estado anterior a la corrección; se conservan como historial. Evidencia actual: `prd-audit-fixes.test.mjs`, `verify-prd-audit-fixes.mjs` y `review/prd-audit/fixes/`.

### F1 · P2 · Duración y fecha de fin incompletas

- **PRD:** §3.5 y DUR-02 exigen inicio, fin y duración; al cruzar medianoche debe distinguirse la fecha de fin.
- **Ubicación:** `public/playable-screens.mjs:16`, usado en itinerario, detalle y calendario; `public/app.mjs:20`, etiquetas del modal de conflictos.
- **Reproducción:** una actividad del 12 de octubre a las 23:30, duración 90 minutos, muestra `lunes, 12 de octubre` y `23:30 – 01:00 · Hora local`, sin `13 de octubre` ni `1 h 30 min`.
- **Impacto:** puede interpretarse mal cuándo termina el plan. El cálculo y la validación de duración existen; lo incompleto es la presentación.
- **Recomendación:** una etiqueta común de intervalo con duración y fecha de fin cuando cambie el día, reutilizada por las vistas y confirmaciones. Comando sugerido: `$impeccable harden`.
- **Corrección verificada:** `activityTimeLabel` centraliza inicio, fin y duración en itinerario, detalle, calendario, modales y avisos. Incluye fecha de fin al cruzar medianoche y años al cruzar el año. Sin duración conserva solo el inicio, sin inventar fin.

### F2 · P2 · Recuerdo vinculado repetido como publicación del día

- **PRD:** §3.4/§3.6 y POST-04: actividad y descendientes bajo su raíz; solo recuerdos independientes se proyectan por día de publicación.
- **Ubicación:** `public/playable-screens.mjs:118`–`120`, filtro de recuerdos del itinerario.
- **Reproducción:** vincular un recuerdo publicado el 16 de octubre a Museos Vaticanos del 13. Aparece bajo los museos el 13 y vuelve a mostrarse como entrada del día 16.
- **Causa:** se excluyen las actividades presentes en el día seleccionado, no todos los recuerdos con actividad raíz.
- **Impacto:** mezcla fecha de publicación con fecha del plan, pese a que el diario ya reúne todas las publicaciones. La atribución del gasto sí utiliza la raíz correctamente.
- **Recomendación:** distinguir recuerdos independientes de los que proyectan una actividad raíz; no alterar publicación, vínculo ni diario. Comando sugerido: `$impeccable harden`.
- **Corrección verificada:** el itinerario excluye del listado independiente todo recuerdo con actividad raíz, incluidos descendientes. La publicación original y el diario se conservan; quitar el vínculo devuelve la proyección por publicación.

### F3 · P2 · Avisos incompletos al editar actividad

- **PRD:** §3.5, §7, EDI-01 y NOT-01 requieren notificar cambios de contenido/ubicación y explicar horario/duración y conflictos a los afectados.
- **Ubicación:** `public/simulation.mjs:116`–`126`.
- **Reproducción:** editar únicamente título/descripción guarda la actividad, pero agrega **cero** notificaciones. Los avisos de inicio/duración usan solo el nuevo inicio; el mensaje no detalla la duración modificada ni los horarios de los planes incompatibles.
- **Impacto:** el grupo puede no advertir un cambio guardado; quien queda pendiente recibe una explicación menos completa que la especificada. «Modificado» sí aparece y conserva su decisión pendiente.
- **Recomendación:** avisos por todos los cambios relevantes y etiquetas temporales completas, separados del indicador persistido. No notificar operaciones fallidas. Comando sugerido: `$impeccable harden`.
- **Corrección verificada:** los cambios de contenido, ubicación y destino también generan avisos. Los cambios de inicio/duración se distinguen y muestran intervalos completos, incluidos los planes incompatibles. Compatibles y marcas pendientes se conservan; abrir avisos o cancelar no consume «Modificado». No se notifican guardados fallidos ni ediciones sin cambios.

### F4 · P1 · Ediciones de contenido alteraban instantes confirmados

- **PRD:** §3.3/§3.4 y EDI-01 requieren conservar instantes UTC y participaciones compatibles; editar contenido no debe cambiar horarios.
- **Reproducción:** guardar la descripción de una actividad a las 15:00:30.123 la movía a las 15:00:00 y podía desvincular al autor por un conflicto recién introducido. Editar una línea urbana podía mover un tramo confirmado del 11 al 10 de octubre; modificar lugares también redondeaba salida/llegada.
- **Causa:** formularios con precisión de minutos y reconstrucción incondicional de fechas a partir del primer día posible.
- **Corrección verificada:** los campos conservan segundos/milisegundos; los valores temporales sin cambios reutilizan el instante UTC original. Los tramos confirmados muestran fecha local explícita. Una cronología inválida se rechaza completa, sin desplazar otros tramos ni retirar participaciones por una edición de contenido.

### F5 · P2 · Revisión histórica no conectada al flujo de edición

- **PRD:** §3.3 exige leer horarios históricos sin inferir fecha/zona y confirmarlos antes de convertirlos.
- **Reproducción:** un tramo con `estimatedTime: '10:15'` y sin `estimatedAt` mostraba `Invalid Date`; Editar abría el formulario ordinario. La revisión histórica existía únicamente como espécimen del catálogo.
- **Corrección verificada:** el detalle muestra la hora original y «Sin fecha ni zona horaria». Editar conduce a la revisión con fecha vacía y hora precargada. Confirmar valida la cronología sin persistir; solo Guardar transporte convierte los datos. Volver o un error conserva los valores originales. Reutiliza los campos y tarjetas azules comunes.

### F6 · P2 · Eventos sin aviso local

- **PRD:** §7 y NOT-01 incluyen ingreso al viaje, expulsión y creación de actividades espontáneas.
- **Reproducción:** unirse y expulsar no generaban avisos; publicar una actividad espontánea solo generaba «Nuevo recuerdo».
- **Corrección verificada:** ingresar genera un aviso del viaje correcto, sin duplicarlo al reingresar; expulsar genera un aviso dirigido exclusivamente al integrante afectado, sin borrar su identidad; la publicación espontánea genera «Nuevo plan» y «Nuevo recuerdo» tras el guardado conjunto. Operaciones rechazadas no producen avisos. No implica entrega push real.

### F7 · P1 · Reparto vacío al pasar de registro a balance

- **PRD:** EXP-01 / §3.8 requieren conservar gastos incompletos y permitir completarlos; el editor propone inicialmente repartir el resto entre integrantes.
- **Reproducción:** publicar un gasto de EUR 100 en registro y activar balance. Editar el gasto dejaba «Cómo se reparte» vacío, sin personas ni forma de agregarlas: `shares: []` impedía aplicar la propuesta inicial.
- **Corrección verificada:** un reparto inexistente o vacío ofrece a los integrantes con «Resto en partes iguales». Es solo una propuesta del formulario, no una escritura al cambiar de modo ni al abrirlo. Confirmar guarda las partes explícitas; un reparto previo y los pagos existentes se conservan. El flujo real de edición completa el gasto y lo incluye en balance.

### F8 · P2 · Un aviso abría el viaje equivocado

- **PRD:** §7 requiere avisos de los eventos del Trip; el acceso debe corresponder al aviso elegido.
- **Reproducción:** unirse a Roma y luego Córdoba; pulsar el ingreso de Roma abría Córdoba porque ambos avisos apuntaban a Grupo con registro vacío.
- **Corrección verificada:** cada fila identifica el ID único de su aviso. El controlador usa su Trip, vista y registro, no busca el primero que comparta ruta. Se conserva el filtro de avisos personales y el contexto de navegación. Ambos ingresos abren el grupo correcto.

### F9 · P2 · Días intermedios de transporte presentados como libres

- **PRD:** §3.4 define tránsito como todo el período entre salida y llegada.
- **Reproducción:** un traslado del 10 de octubre a las 20:00 al 12 a las 09:45 dejaba el día 11 como «Un día por armar», sin transporte visible. La validación de actividades sí rechazaba guardar antes de llegar.
- **Corrección verificada:** el traslado aparece todos los días de su intervalo local. Los intermedios indican «En tránsito», sin inventar una nueva hora de salida; cada tarjeta muestra fechas y horas originales. Los extremos conservan Salida/Llegada, un mismo día muestra ambos y los segmentos compartidos no se duplican. Detalle/Volver mantiene el día de origen; no se amplían las ventanas de actividades.

### F10 · P2 · Tramos urbanos limitados y truncados al guardar

- **PRD:** §3.3 admite múltiples tramos secuenciales, sin un máximo de cinco.
- **Reproducción:** «Agregar tramo» no supera cinco; al cargar un registro válido con seis tramos y editar una línea, el guardado descarta silenciosamente el sexto.
- **Causa:** límites independientes de cinco en el controlador y en `urbanSteps`.
- **Corrección verificada:** el formulario agrega tramos sin ese límite y guarda/valida todos los ingresados, conservando los instantes confirmados. «Quitar último» retira también sus campos del borrador para que no reaparezcan al guardar. Un tramo posterior al quinto fuera de los límites rechaza el cambio completo.

### F11 · P2 · Nuevos integrantes ausentes del reparto existente

- **PRD:** §3.8 y EXP-01 requieren reparto configurable, independiente de los pagos y conservación del acuerdo existente.
- **Reproducción:** Elena se incorpora al Trip; aparece como posible pagadora, pero no hay forma de incluirla en el reparto de un gasto anterior.
- **Corrección verificada:** selector «Persona para agregar» y botón «Agregar persona al reparto» dentro del editor. Solo ofrece integrantes actuales todavía ausentes; los registros de personas anteriores se conservan. Agregar propone «Resto en partes iguales», ajustable a monto, porcentaje o exclusión antes de guardar. Abrir el editor no modifica el acuerdo; cancelar o fallar no persiste cambios. Se conservan pagos y partes previas, sin duplicar personas.

### F12 · P2 · Publicación proyectada en un día obsoleto al cambiar de zona

- **PRD:** §3.4 y POST-04 requieren agrupación visual según la fecha local del instante de publicación, sin modificarlo.
- **Reproducción:** publicar el 12 de octubre a las 22:00 en Buenos Aires y consultar desde Roma. Diario muestra 13 oct a las 03:00, pero Itinerario coloca el recuerdo el 12 por usar el campo local `day` guardado al publicar.
- **Corrección verificada:** el filtro del itinerario deriva el día desde `createdAt` en la zona actual, igual que los demás horarios y el resumen de gastos. El campo `day` anterior no es fuente de la proyección y no requiere migración ni escritura para visualizar. Se conservan instantes UTC con milisegundos, vínculos, fotos, gastos y orden del diario. Los recuerdos de actividad siguen bajo su raíz; los independientes y los del transporte usan su fecha local de publicación.

**Hallazgos acumulados:** P0 = 0; P1 = 2; P2 = 10. **Pendientes de esos hallazgos: 0.** Las integraciones pendientes de la sección siguiente no se cuentan como bugs del HTML; resolver F1–F12 no acredita una implementación productiva completa.

## Cobertura por módulo

| PRD | Cobertura del diseño | Diferencias / límite |
| --- | --- | --- |
| 3.1 Auth | Bienvenida, login, registro solo email/contraseña, perfil/edición, sesión vencida. | Sin autenticación, JWT, refresh ni almacenamiento seguro nativo reales. |
| 3.2 Trips | Activos/finalizados, creación, privacidad, invitación código/link, join público, grupo, admin/participante, confirmaciones de baja/expulsión y sin acceso. | Link/fallback y permisos de roles modelados localmente; no prueba deep links ni cascada Mongo/S3. |
| 3.3 Transporte | Destinos ordenados, llegada/salida, cinco tipos, tramos urbanos con fecha/precisión conservadas, revisión histórica conectada, costos opcionales, bloqueos por ventanas y baja de destino vacío. | No acredita regeneración transaccional, conservación de ObjectId/dayId ni todos los cambios de zona horaria. |
| 3.4 Itinerario | Calendario derivado, días mixtos y tránsito continuo, intervalos exactos con duración/fecha de fin, recuerdos bajo su raíz, navegación compartida, selector de destinos y scroll conservado. | La navegación no amplía fechas del viaje. |
| 3.5 Actividades | Sin votación/modo/aprobación; duración opcional, creator Voy, agenda individual, cambio confirmado, pendientes personales «Modificado», edición/baja, avisos completos, Recuerdos/Fotos. | Atomicidad en el modelo local, no concurrencia real de backend. |
| 3.6 Posts | Publicación automática inmutable, fuera del viaje, diario descendente, compositor directo, un Vincular a, cadenas/ramas, comentarios/likes separados y origen de navegación. | El mapa es una composición ilustrativa, no un mapa geográfico embebido; Abrir en Maps sí genera un link. |
| 3.7 Fotos | Selector/permiso, fotos de posts, galería, grid alineada arriba, visor y fotos de actividad/descendientes con origen. | No hay presigned URLs/S3 ni permisos nativos. Fotos temporales del dispositivo no sobreviven la recarga. |
| 3.8 Gastos | Moneda por gasto, pagos múltiples monto/%, partes configurables, exclusión, resto, incompletos completables desde balance, cambio de modo sin pérdida y fecha de raíz/publicación. | Cálculos locales en centavos; no persistencia compartida real ni transferencias. |
| 6 Flujos | Crear/unirse, transporte/itinerario, plan/participación, recuerdo/vínculo/actividad espontánea y retornos. | Los escenarios de error/carga son controles de estudio, no requests reales. |
| 7 Push | Avisos de edición, ingreso, expulsión personal y actividad espontánea; acceso por ID al Trip correcto, permiso/denegado e indicador personal complementario. | No entrega push, registro de dispositivo ni SNS/FCM. |
| 7 Calendario | Vista previa y descarga ICS con días/planes, DTEND solo con duración e identificadores estables por evento. | CAL-01 parcial: no se crean/actualizan/eliminan eventos nativos. UID de franjas basado en fecha local no demuestra estabilidad ante cambio de zona. |
| 8 Futuro | Offline, chat, templates, PDF, álbum/collage y export social no presentados como capacidades v1 activas. | No se añadieron requisitos futuros ni tareas. |
| 4–5 Datos/arquitectura | No son criterios de conformidad visual. | React/Capacitor, Lambda, MongoDB, S3, índices, seguridad y serialización se revisan en implementación, no desde HTML. |

## Matriz de criterios de aceptación

«Cubierto» significa observado en el diseño/modelo local, no implementado en producción. «Parcial» conserva el criterio pendiente de evidencia completa o de una diferencia documentada.

| Criterio | Estado | Evidencia o diferencia |
| --- | --- | --- |
| DUR-01 | Cubierto | Campos opcionales horas/minutos en planificada, edición y espontánea. |
| DUR-02 | Cubierto localmente | Etiqueta compartida de inicio, fin, duración y cambio de fecha/año; sin fin inventado. |
| DUR-03 | Cubierto localmente | Validación del intervalo completo; rechazos conservan datos; pruebas de fin y cambios de transporte. |
| ACT-01, ACT-02 | Cubiertos | Sin votación/estados; plan visible sin mínimos y sin baja automática. |
| PAR-01 | Cubierto en modelo | Participación por persona y planes simultáneos; no exclusividad global. |
| PAR-02, PAR-03 | Cubiertos | Todos los conflictos, contigüidad y mismo inicio sin duración inventada. |
| PAR-04 | Cubierto | Autor Voy y otros sin responder; cambios personales. |
| PAR-05, PAR-06 | Cubiertos localmente | Confirmar/cancelar cambia solo respuestas propias; no elimina planes. |
| PAR-07 | Cubierto | No hay cierre temporal de la participación. |
| PAR-08 | Cubierto localmente | Borrador/actividad espontánea/post se guardan juntos tras confirmar. |
| PAR-09 | Parcial | Modelo local rechaza snapshots cambiados; no serialización entre clientes ni backend. |
| EDI-01 | Cubierto localmente | Conserva instantes exactos y compatibles al editar contenido; avisos de contenido/ubicación y horario/duración. |
| EDI-02 | Cubierto localmente | Afectados pending con motivo/campos/UTC; otros planes conservados. |
| EDI-03 | Parcial | Modelo sin guardados parciales, pero sin concurrencia productiva. |
| EDI-04 | Cubierto | Marca personal en itinerario/detalle y explicación; Voy/No voy neutros. |
| EDI-05 | Parcial | Persiste tras recarga sin push; solo almacenamiento local, no cuenta/backend. |
| EDI-06 | Cubierto localmente | Solo respuesta guardada elimina marca; cancelar/error conserva pending. |
| DEL-01, DEL-02 | Cubiertos localmente | Confirmación, mismos roles, conserva cadenas/fotos/gastos; retira vínculo directo. |
| AUTH-01 | Cubierto visualmente | Registro email/contraseña sin verificación; no auth real. |
| NOT-01 | Parcial | Avisos locales de edición, ingreso, expulsión y espontánea; marca personal; ausencia de entrega push real. |
| CAL-01 | Parcial | ICS descargable; no sincronización nativa ni prueba completa de UID por cambio de zona. |
| NAV-01 | Cubierto | Componente común, selección/paneles accesibles y retorno al origen. |
| NAV-02 | Cubierto | Verificador de scroll y teclado a 320/390/1280 px. |
| NAV-03, NAV-04 | Cubiertos | Selector, fechas exactas, salto, día compartido, cierre y transportes incompletos. |
| POST-01 | Cubierto | Padre inmediato, ciclos rechazados, ramas y espontánea en Actividad. |
| POST-02 | Cubierto | Publicación automática, inmutable y descendente; permite recuerdos fuera del viaje. |
| POST-03 | Cubierto | Guardado directo, borradores y FAB común para Posts/Fotos. |
| POST-04 | Cubierto localmente | Raíz/descendientes solo bajo su actividad; independientes por publicación; diario sin cambios. |
| FOTO-01, FOTO-02 | Cubiertos | Actividad/descendientes, origen y grid alineada. |
| EXP-01, EXP-02 | Cubiertos en modelo | Pagos/partes separados, incompletos, centavos, monedas y fecha proyectada. |

## Revisión técnica con Impeccable

**Integridad visual: pasa como sistema coherente**, no como conformidad completa del PRD. Las capturas conservan azul/Manrope, componentes compartidos, jerarquía de planes/recuerdos y la grid aprobada. No se introduce una estética alternativa.

| Dimensión | Puntuación orientativa | Observación |
| --- | --- | --- |
| Accesibilidad | 3/4 | Campos etiquetados; botones/tabs/diálogos semánticos y foco. No es certificación WCAG ni prueba con lector de pantalla. |
| Rendimiento | 2/4 | HTML local simple, pero listas completas, imágenes eager y reconstrucción del contenedor en cada render; sin prueba con viajes grandes. |
| Responsive | 3/4 | 165 combinaciones vista/ancho sin overflow; no pruebas nativas, de teclado virtual o escalado de texto del sistema. |
| Theming | 3/4 | Tokens comunes navy/paper/surface/soft; literales auxiliares y especímenes históricos. Dark mode no está en el alcance aprobado. |
| Integridad de implementación | 3/4 | Identidad específica y controles reales; F1–F12 corregidos. Sin validación productiva ni de todas las combinaciones. |
| **Total** | **14/20 · bueno** | Calidad del HTML observado, no madurez productiva. |

Detector ejecutado sobre `public/`: 21 avisos en total, 3 primarios y 18 advisory. Verificación contextual:

- `dark-glow`: falso positivo material; detecta la sombra desplazada de panel/diálogo sobre una página clara como un halo en una página oscura.
- Dos `border-accent-on-rounded`: falsos positivos materiales; corresponden al subrayado de pestañas, con radio 0/default, no a tarjetas redondeadas con borde decorativo.
- Advisory: tamaños compactos/mobile y de estudio, colores auxiliares y radios del marco/scrollbar fuera de la extracción original. No justifican reemplazar la identidad aprobada. El contrato vigente documenta los cambios sin reescribir los especímenes de origen.

La inspección automática detectó nueve objetivos pequeños: inputs de archivo transparentes de 1×1 y checkbox de 24×24 repetidos en tres anchos. No se consideran defectos táctiles confirmados: sus etiquetas visibles son accionables y de ≥44px. Cero campos visibles sin etiqueta en las 165 combinaciones. Esto no prueba todos los nombres accesibles ni todos los estados.

Contraste calculado para tokens principales: muted/paper **5,08:1**, muted/surface **5,39:1**, on-brand-muted/brand **8,75:1**. No se certifican todas las combinaciones/estados ni se infiere cumplimiento WCAG completo.

Limitación técnica a validar al implementar: paginación/lazy loading del diario y fotos para no cargar/renderizar el viaje entero. Comando sugerido: `$impeccable optimize`; no es un cambio de alcance del PRD ni un fallo de latencia medido. La corrección aplicó `$impeccable harden` reutilizando el sistema aprobado, sin un rediseño estético.

## Evidencia guardada y límites

- `node --test --test-concurrency=1 *.test.mjs`: **191 pruebas aprobadas**. Incluye las 150 anteriores, ocho regresiones F1–F3, doce F4–F6, ocho casos F7–F9, seis casos F10–F11 y siete casos F12. Los nuevos defectos se reprodujeron antes de implementar; los casos de conservación cubren comportamiento que ya funcionaba.
- `verify-prd-local-day.mjs`: F12 pasa al cambiar Buenos Aires → Roma y Roma → Buenos Aires a 320/390/1280 px, con estado persistido idéntico antes/después de consultar, fecha consistente entre Diario/Itinerario, guardado de edición sin cambiar publicación/vínculos/fotos/gasto y recarga. Sin errores JS ni overflow en los recorridos comprobados. Cuatro capturas móvil/escritorio en `review/prd-audit/local-day/`, inspeccionadas; Impeccable orientó conservar la interfaz azul sin cambios de componentes ni CSS.
- `verify-prd-editing-fixes.mjs`: F10–F11 pasan a 320/390/1280 px; agregar más de cinco tramos, quitar el último, conservar siete al editar y rechazar un sexto inválido; inclusión explícita de un integrante en un reparto previo, foco, borrador, error, guardado y recarga. Sin errores JS ni overflow en esos recorridos. Seis capturas en `review/prd-audit/editing-fixes/`; se reutilizan los campos y botones azules con Impeccable, sin cambios de CSS ni del PRD.
- `verify-prd-audit-fixes.mjs`: F1–F3 pasan a 320/390/1280 px, incluida lectura de aviso, cancelación del conflicto y conservación de «Modificado». Seis capturas móvil/escritorio en `review/prd-audit/fixes/`, inspeccionadas visualmente sin cambios adicionales.
- `verify-prd-edge-fixes.mjs`: F4–F6 pasan a 320/390/1280 px; edición precisa, revisión histórica con validación/cancelación y guardado diferido, avisos de membresía y espontánea. Sin errores JS ni overflow en los casos comprobados. Seis capturas en `review/prd-audit/edge-fixes/`; revisión visual inicial y una confirmación tras reutilizar el contenedor de tramos existente.
- `verify-prd-flow-fixes.mjs`: F7–F9 pasan a 320/390/1280 px; completar un gasto de registro tras activar balance, sin persistir partes al abrir; avisos de dos viajes con igual ruta; días intermedios, detalle/Volver y validación antes de llegar. Sin errores JS ni overflow en esos recorridos. Seis capturas en `review/prd-audit/flow-fixes/`, inspeccionadas móvil/escritorio; conserva los campos y tarjetas azules compartidos.
- `verify-participation.mjs`: catálogo de 56 entradas (fundamentos + 55 vistas), flujos y persistencia a 320/390/1280 px; registro sin correo obligatorio y sin guardar credenciales.
- Auditoría inicial `audit-prd.mjs`: **165 combinaciones** (55 vistas × 3 anchos), cero errores JS, overflow o imágenes rotas. `review/prd-audit/evidence.json` y 12 capturas conservan el estado anterior a las correcciones; los nuevos casos se verifican por separado. Los fixtures están aislados y no modifican datos del navegador del usuario.
- `verify-destination-picker.mjs`, `verify-itinerary-scroll.mjs`: selector/cancelación/teclado/día compartido y conservación del scroll en tres anchos.
- `verify-itinerary-spacing.mjs`: gap de 16px en 12 combinaciones ancho/modo/vista.
- Inspección visual acotada: capturas móvil de itinerario, actividad, galería y gasto, y escritorio de diario y estado balance-en-registro. El balance activo se verifica en el modelo unitario, no se presenta el estado en-registro como captura de deudas calculadas.
- Original y tareas conservan sus hashes previos. La evaluación no editó la UI/modelo; la corrección posterior solo modificó el prototipo y sus pruebas/documentación. Autenticación, push, S3, mapa geográfico, integración nativa, transacciones, concurrencia y sincronización entre usuarios no se acreditan aquí.

El PRD no registra nuevas dudas de negocio pendientes. **Las integraciones pendientes son trabajo de implementación/validación, no decisiones abiertas resueltas por esta auditoría.** El usuario podrá comparar después las tareas con el PRD sin que este informe las marque realizadas.
