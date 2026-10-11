export const groups=[
 ['Base de Figma',[['foundations','Fundamentos'],['trips','Mis viajes'],['empty','Primer viaje'],['join','Invitación'],['itinerary','Itinerario'],['add','Agregar actividad'],['participation','Detalle de actividad']]],
 ['Acceso y perfil',[['welcome','Bienvenida'],['login','Iniciar sesión'],['register','Crear cuenta'],['profile','Perfil'],['profile-edit','Editar perfil'],['session-expired','Sesión vencida']]],
 ['Viajes y grupo',[['discover','Viajes públicos'],['public-trip','Unirse a viaje público'],['create-trip','Crear viaje'],['trip-settings','Opciones del viaje'],['group','Integrantes'],['invite-share','Compartir invitación'],['remove-member','Expulsar integrante'],['delete-trip','Eliminar viaje'],['trip-unavailable','Sin acceso'],['invite-fallback','Link sin app instalada']]],
 ['Destinos y transporte',[['destinations','Destinos ordenados'],['destination-edit','Editar destino'],['delete-destination','Eliminar destino vacío'],['transports','Ida y vuelta'],['transport-edit','Configurar transporte'],['transport-detail','Detalle del traslado'],['transport-impact','Cambio bloqueado'],['transport-history','Revisar horarios históricos'],['mixed-day','Tránsito y actividades']]],
 ['Actividades',[['activity-edit','Editar actividad'],['delete-activity','Eliminar actividad']]],
 ['Diario y fotos',[['feed','Diario del grupo'],['post','Detalle del post'],['compose','Nuevo recuerdo'],['post-edit','Editar post'],['post-links','Vincular recuerdo'],['spontaneous','Actividad espontánea'],['photo-picker','Elegir fotos'],['photo-permission','Permiso de fotos'],['location','Vista de ubicación'],['gallery','Galería grupal'],['photo-viewer','Visor de foto'],['comments','Comentarios y likes'],['comment-edit','Editar comentario']]],
 ['Gastos',[['expense-edit','Gasto del post'],['expenses','Registro de gastos'],['balance','Balance del grupo']]],
 ['Notificaciones y calendario',[['notifications','Notificaciones'],['push-permission','Permiso de avisos'],['calendar','Exportar calendario'],['calendar-permission','Permiso de calendario']]],
 ['Estados de sistema',[['loading','Cargando'],['connection-error','Error y reintento']]]
];
export const catalog=groups.flatMap(([group,items])=>items.map(([id,title])=>({id,title,group})));
export const sourceViews=['foundations','trips','empty','join','itinerary','add','participation','post','gallery'];
export const titleFor=view=>catalog.find(x=>x.id===view)?.title||'Travellier';
