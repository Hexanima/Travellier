import {expenseSummary,expensePayments} from './expenses.mjs';
import {savedInstant,urbanSteps,hasHistoricalSteps} from './timing.mjs';
import {durationFrom,activityEnd,activityTimeLabel,participationConflicts,conflictSnapshot,confirmationMatches} from './activities.mjs';
// State for the local design playground. No accounts, credentials or services are persisted.
export const localInstant=(date,time='00:00')=>new Date(date+'T'+time).toISOString();
export const localDate=value=>{const d=new Date(value);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
export const localTime=value=>new Date(value).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false});
const transport=(destination,direction,from,date,time,to,endDate,endTime,type='other')=>({id:destination+'-'+direction,destinationId:destination,direction,type,departurePlace:from,arrivalPlace:to,departureAt:localInstant(date,time),arrivalAt:localInstant(endDate,endTime),details:type==='flight'?{flightNumber:'AZ 681',airline:'ITA Airways'}:{},costPerPerson:null});
const member=(id,name,role='participant')=>({id,name,role});
const trip=(id,name,destination,date,end,description)=>({id,name,description,visibility:'private',inviteCode:id.toUpperCase()+'26',expenseMode:'register',joined:true,members:[member('nico','Nico','admin'),member('ana','Ana'),member('martin','Martín')],destinations:[{id:id+'-dest',name:destination,order:1}],transports:[transport(id+'-dest','outbound','Buenos Aires',date,'08:00',destination,date,'13:00','car'),transport(id+'-dest','return',destination,end,'18:00','Buenos Aires',end,'23:00','car')],activities:[],posts:[]});
export function createSimulation(){
 const italy=trip('italia','Italia, sin apuro','Roma','2026-10-12','2026-10-22','Roma, Florencia y Venecia, entre amigos.');
 italy.inviteCode='ITALIA26';italy.members=[member('nico','Nico','admin'),member('ana','Ana','admin'),member('martin','Martín'),member('juli','Juli')];
 italy.destinations=[{id:'roma',name:'Roma',order:1},{id:'florencia',name:'Florencia',order:2},{id:'venecia',name:'Venecia',order:3}];
 italy.transports=[transport('roma','outbound','Ezeiza','2026-10-11','22:45','Fiumicino','2026-10-12','09:45','flight'),transport('roma','return','Roma','2026-10-16','18:00','Florencia','2026-10-16','21:00','bus_long'),transport('florencia','outbound','Roma','2026-10-16','18:00','Florencia','2026-10-16','21:00','bus_long'),transport('florencia','return','Florencia','2026-10-19','18:00','Venecia','2026-10-20','09:00','bus_long'),transport('venecia','outbound','Florencia','2026-10-19','18:00','Venecia','2026-10-20','09:00','bus_long'),transport('venecia','return','Venecia','2026-10-22','18:00','Buenos Aires','2026-10-23','09:00','flight')];
 italy.transports.filter(t=>t.type==='bus_long').forEach(t=>t.details={company:'Itabus'});
 italy.activities=[{id:'paseo',title:'Paseo por Trastevere',destinationId:'roma',scheduledAt:localInstant('2026-10-12','15:00'),description:'Un paseo por el barrio, sin apuro.',mapsUrl:'https://www.google.com/maps/search/?api=1&query=Piazza+Santa+Maria+Roma',place:'Piazza Santa Maria, Roma',participations:{nico:'going',ana:'going',juli:'going'}},{id:'museos',title:'Museos Vaticanos',destinationId:'roma',scheduledAt:localInstant('2026-10-13','10:00'),description:'Una mañana para recorrer los museos y la Capilla Sixtina.',place:'Viale Vaticano, Roma',mapsUrl:'https://www.google.com/maps/search/?api=1&query=Museos+Vaticanos',participations:{}},{id:'tiber',title:'Último paseo por el Tíber',destinationId:'roma',scheduledAt:localInstant('2026-10-16','10:00'),description:'Un último paseo junto al río antes de salir hacia Florencia.',place:'Ponte Sant’Angelo, Roma',mapsUrl:'https://www.google.com/maps/search/?api=1&query=Ponte+Sant+Angelo+Roma',participations:{ana:'going',juli:'going'}}];

 italy.activities.forEach((a,i)=>Object.assign(a,{durationMinutes:[90,180,60][i],createdBy:['ana','juli','ana'][i],decisionRequired:{}}));
 italy.activities.find(a=>a.id==='museos').participations={ana:'going',juli:'going',martin:'not_going'};
 const post=(id,title,author,date,time,description,photos,activityId=null,transportId=null,amount=null)=>({id,title,authorId:author,day:date,createdAt:localInstant(date,time),description,photos,activityId,transportId,parentPostId:null,mapsUrl:'',likes:['ana','juli','martin'],comments:[],expense:amount===null?null:{totalAmount:amount,breakdown:title,paidBy:null}});
 italy.posts=[post('cafe-post','El primer paseo','ana','2026-10-12','16:30','Salimos a caminar sin mirar el mapa. Terminamos en esta mesa, con cuatro cafés y la sensación de que el viaje por fin había empezado.',['cafe','street','lane'],'paseo',null,18),post('flight-post','Rumbo a Roma','martin','2026-10-12','09:50','Llegamos a Fiumicino. Un café antes de salir hacia el centro.',[],null,'roma-outbound',8),post('museum-post','Después de los museos','juli','2026-10-13','13:30','Después de los museos, caminamos hasta Castel Sant’Angelo. Un rato junto al río antes de seguir.',['castle'],'museos',null,48),post('river-post','Una mañana junto al río','juli','2026-10-16','11:10','El último paseo por Roma. El puente, el sol y un rato sin apuro.',['tiber'],'tiber'),post('transfer-post','Nos vemos, Roma','ana','2026-10-16','18:30','Mochilas listas, próximos planes: Florencia.',['street'],null,'roma-return')];
 italy.posts[0].mapsUrl=italy.activities[0].mapsUrl;italy.posts[0].comments=[{id:'martin-comment',authorId:'martin',text:'La mejor forma de arrancar.',createdAt:localInstant('2026-10-12','16:42'),likes:['ana']},{id:'own-comment',authorId:'nico',text:'Mañana repetimos.',createdAt:localInstant('2026-10-12','16:45'),likes:[]}];
 italy.posts.filter(p=>p.expense).forEach(p=>p.expense.currency='EUR');
 Object.assign(italy.posts[0].expense,{payments:[{memberId:'ana',unit:'amount',value:12},{memberId:'nico',unit:'amount',value:6}],shares:italy.members.map(m=>({memberId:m.id,unit:'remainder'}))});
 Object.assign(italy.posts[1].expense,{payments:[{memberId:'martin',unit:'amount',value:8}],shares:italy.members.map(m=>({memberId:m.id,unit:'remainder'}))});
 Object.assign(italy.posts[2].expense,{payments:[{memberId:'juli',unit:'percent',value:50},{memberId:'nico',unit:'amount',value:12}],shares:italy.members.map(m=>({memberId:m.id,unit:'remainder'}))});
 italy.posts.push(
  {...post('gelato-post','El paseo siguió con helado','nico','2026-10-12','17:15','Después del café seguimos por las callecitas. Juli encontró una heladería y terminamos probando un sabor cada uno.',['lane']),parentPostId:'cafe-post'},
  {...post('gelato-text-post','El pistacho ganó por lejos','juli','2026-10-12','17:25','Confirmado: pistacho para repetir mañana. Martín sigue defendiendo el chocolate.',[]),parentPostId:'gelato-post'},
  {...post('gelato-photo-post','Una última vuelta por el barrio','martin','2026-10-12','18:10','Nos quedamos un rato más. Esta calle con las luces encendidas fue mi parte favorita del paseo.',['street']),parentPostId:'gelato-post'}
 );
 const trips=[italy,trip('bariloche','Escapada a Bariloche','Bariloche','2027-02-12','2027-02-17','Lagos, senderos y unos días entre amigos.'),trip('mendoza','Vendimia en Mendoza','Mendoza','2026-03-05','2026-03-09','Bodegas, montaña y largas sobremesas.'),trip('costa','Un finde junto al mar','Mar del Plata','2026-08-15','2026-08-17','Caminatas por la costa y café frente al mar.'),trip('roma-public','Roma en buena compañía','Roma','2026-11-10','2026-11-14','Museos, pasta y paseos por el centro.'),trip('sierras-public','Senderos de Córdoba','Córdoba','2026-12-05','2026-12-08','Un finde de caminatas por las sierras.')];
 const publicRome=trips.find(t=>t.id==='roma-public');publicRome.transports=[transport('roma-public-dest','outbound','Ezeiza','2026-11-10','08:00','Fiumicino','2026-11-10','22:00','flight'),transport('roma-public-dest','return','Fiumicino','2026-11-14','08:00','Ezeiza','2026-11-14','22:00','flight')];
 trips.slice(-2).forEach(t=>{t.visibility='public';t.joined=false;t.members=t.members.filter(m=>m.id!=='nico');t.members[0].role='admin';});
 return {people:Object.fromEntries(italy.members.map(m=>[m.id,{id:m.id,name:m.name}])),now:localInstant('2026-10-16','22:00'),profile:{id:'nico',name:'Nico',email:'nico.garcia@gmail.com',avatar:null},tripId:'italia',role:'admin',sequence:100,trips,permissions:{push:false,calendar:false,photos:true},notifications:[{id:'n1',title:'Nuevo recuerdo',text:'Ana compartió «Nos vemos, Roma».',tripId:'italia',view:'post',record:'transfer-post'},{id:'n2',title:'Nuevo comentario',text:'Martín comentó «El primer paseo».',tripId:'italia',view:'comments',record:'cafe-post'},{id:'n3',title:'Nuevo plan',text:'Juli agregó Museos Vaticanos. Elegí si te sumás.',tripId:'italia',view:'participation',record:'museos'},{id:'n4',title:'Un plan para compartir',text:'Paseo por Trastevere, el lunes a las 15:00.',tripId:'italia',view:'participation',record:'paseo'},{id:'n5',title:'Alguien se sumó',text:'Juli se unió a Italia, sin apuro.',tripId:'italia',view:'group'}]};
}
export const currentTrip=s=>s.trips.find(t=>t.id===s.tripId);
export function canLinkPost(t,postId,parentId){
 const seen=new Set(postId?[postId]:[]);let p=t.posts.find(x=>x.id===parentId);
 if(!p)return false;
 while(p){if(seen.has(p.id))return false;seen.add(p.id);p=t.posts.find(x=>x.id===p.parentPostId);}
 return true;
}
export function postActivityId(t,post){
 const seen=new Set();let p=post;
 while(p&&!seen.has(p.id)){seen.add(p.id);if(!p.parentPostId)return p.activityId||null;p=t.posts.find(x=>x.id===p.parentPostId);}
 return null;
}
export const expenseDate=(t,post)=>localDate(t.activities.find(a=>a.id===postActivityId(t,post))?.scheduledAt||post.createdAt);

export function validatePostLinks(t,data,postId){
 if(data.parentPostId&&(data.activityId||data.spontaneous||data.transportId))return 'Un recuerdo encadenado se vincula solo a su post padre.';
 if(data.activityId&&!t.activities.some(x=>x.id===data.activityId)||data.parentPostId&&!t.posts.some(x=>x.id===data.parentPostId)||data.transportId&&!t.transports.some(x=>x.id===data.transportId))return 'Elegí un vínculo de este viaje.';
 if(data.parentPostId&&!canLinkPost(t,postId,data.parentPostId))return 'Elegí otro post: este vínculo formaría un ciclo.';
 if(data.spontaneous){const error=checkActivity(t,data.spontaneous);if(error)return error;}
 return null;
}
export function tripDates(t){const times=t.transports.flatMap(x=>[x.departureAt,x.arrivalAt]).sort();return {start:times[0]||null,end:times.at(-1)||null};}
export function tripDays(t){const {start,end}=tripDates(t);if(!start||!end)return [];const result=[],d=new Date(localDate(start)+'T12:00');for(let i=0;d<=new Date(localDate(end)+'T12:00')&&i<366;i++){result.push(localDate(d));d.setDate(d.getDate()+1);}return result;}
export function destinationWindow(t,id){const arrival=t.transports.find(x=>x.destinationId===id&&x.direction==='outbound')?.arrivalAt,departure=t.transports.find(x=>x.destinationId===id&&x.direction==='return')?.departureAt;return {arrival,departure};}
function checkActivity(t,data,previous){
 if(!data.name?.trim())return 'Poné un nombre para la actividad.';
 let time;try{time=savedInstant(data.date,data.time,previous?.scheduledAt);}catch{return 'Revisá la fecha y hora de la actividad.';}
 const durationMinutes=durationFrom(data);if(durationMinutes!==null&&(!Number.isInteger(durationMinutes)||durationMinutes<=0))return 'Indicá una duración positiva en horas y minutos, o dejala vacía.';
 const w=destinationWindow(t,data.destination),end=activityEnd({scheduledAt:time,durationMinutes});
 if(!w.arrival||!w.departure)return 'Configurá la ida y la vuelta del destino antes de agregar actividades.';
 if(time<w.arrival||time>w.departure||end&&end>w.departure)return 'La actividad completa debe quedar entre la llegada y la salida del destino.';
 return null;
}
export function command(state,action,clock=()=>new Date().toISOString()){
 const s=structuredClone(state),t=currentTrip(s),data=action.data||{},id=()=>String(++s.sequence),fail=error=>({state,error}),ok=(view,message)=>({state:s,view,message});
 const notify=(title,text,view,record,userId)=>s.notifications.unshift({id:id(),title,text,tripId:s.tripId,view,record,...(userId?{userId}:{})});
 const schedule=(data,previous)=>({scheduledAt:savedInstant(data.date,data.time,previous?.scheduledAt),durationMinutes:durationFrom(data)});
 const confirmParticipation=a=>{
  const conflicts=conflictSnapshot(participationConflicts(t,a,s.profile.id));
  if(conflicts.length&&!confirmationMatches(action.confirmedConflicts,conflicts))return {state,confirmation:{activity:{title:a.title,...scheduleInfo(a)},conflicts}};
  for(const other of conflicts)t.activities.find(x=>x.id===other.id).participations[s.profile.id]='not_going';
  a.participations[s.profile.id]='going';if(a.decisionRequired)delete a.decisionRequired[s.profile.id];return null;
 };
 const scheduleInfo=a=>({scheduledAt:a.scheduledAt,durationMinutes:a.durationMinutes??null});
 const spontaneousConfirmation=()=>{
  if(!data.spontaneous)return null;
  return confirmParticipation({id:null,title:data.spontaneous.name,...schedule(data.spontaneous),participations:{}});
 };
 const activityLink=()=>{if(!data.spontaneous)return data.activityId||null;const activityId='activity-'+id();t.activities.push({id:activityId,title:data.spontaneous.name.trim(),destinationId:data.spontaneous.destination,...schedule(data.spontaneous),description:'',mapsUrl:'',place:'',createdBy:s.profile.id,decisionRequired:{},participations:{[s.profile.id]:'going'}});notify('Nuevo plan',s.profile.name+' agregó «'+data.spontaneous.name.trim()+'».','participation',activityId);return activityId;};
 if(action.type==='create-trip'){if(!data.name?.trim()||!data.destination?.trim())return fail('Completá el nombre del viaje y el primer destino.');const key=id();s.trips.push({id:key,name:data.name.trim(),description:data.description||'',visibility:data.visibility||'private',inviteCode:'VIAJE-'+key,expenseMode:'register',joined:true,members:[member('nico',s.profile.name,'admin')],destinations:[{id:'dest-'+key,name:data.destination.trim(),order:1}],transports:[],activities:[],posts:[]});s.tripId=key;s.role='admin';return ok('transports','Viaje creado. Configurá cómo llegan y cómo vuelven.');}
 if(action.type==='profile'){s.profile.name=data.name.trim();s.people.nico.name=s.profile.name;if(data.avatar)s.profile.avatar=data.avatar;for(const trip of s.trips){const m=trip.members.find(x=>x.id==='nico');if(m)m.name=s.profile.name;}return ok('profile','Perfil actualizado.');}
 if(action.type==='permission'){s.permissions[action.id]=true;return ok(action.id==='push'?'notifications':action.id==='photos'?'photo-picker':'calendar',action.id==='calendar'?'Acceso al calendario habilitado.':action.id==='push'?'Notificaciones activadas.':'Acceso a fotos habilitado.');}
 if(action.type==='select-trip'){const selected=s.trips.find(x=>x.id===action.id);if(!selected?.joined)return fail('Unite al viaje para ver el itinerario.');s.tripId=selected.id;s.role=selected.members.find(x=>x.id==='nico')?.role||'participant';return ok('itinerary');}
 if(action.type==='join'){const selected=s.trips.find(x=>x.id===action.id||x.inviteCode===String(action.code).trim().toUpperCase());if(!selected)return fail('No encontramos esta invitación. Revisá el código y volvé a intentar.');s.tripId=selected.id;if(!selected.joined){selected.joined=true;selected.members.push(member('nico',s.profile.name));notify('Alguien se sumó',s.profile.name+' se unió a '+selected.name+'.','group','');}s.role=selected.members.find(x=>x.id==='nico').role;return ok('itinerary','Ya sos parte de '+selected.name+'.');}
 if(!t?.joined)return fail('Este viaje ya no está disponible.');
 if(['delete-trip','remove-member'].includes(action.type)&&s.role!=='admin')return fail('Solo un admin puede realizar esta acción.');
 if(action.type==='delete-trip'){s.trips=s.trips.filter(x=>x.id!==t.id);s.notifications=s.notifications.filter(x=>x.tripId!==t.id);s.tripId=s.trips.find(x=>x.joined)?.id||null;return ok('trips','Viaje eliminado.');}
 if(action.type==='remove-member'){const m=t.members.find(x=>x.id===action.id);if(!m||m.id==='nico')return fail('Elegí otro integrante.');t.members=t.members.filter(x=>x.id!==m.id);notify('Ya no sos parte de este viaje','Un admin te retiró de '+t.name+'. Tu cuenta y tus otros viajes se conservan.','trip-unavailable',t.id,m.id);return ok('group',m.name+' ya no forma parte del viaje.');}
 if(action.type==='settings'){if(!data.name?.trim())return fail('Poné un nombre para el viaje.');Object.assign(t,{name:data.name.trim(),description:data.description||'',visibility:data.visibility,expenseMode:data.expenseMode});return ok('itinerary','Configuración guardada.');}
 if(action.type==='save-destination'){if(!data.name?.trim())return fail('Poné un nombre para el destino.');let d=t.destinations.find(x=>x.id===action.id);if(!d){d={id:'dest-'+id(),name:data.name.trim(),order:t.destinations.length+1};t.destinations.push(d);}else d.name=data.name.trim();const position=Math.max(0,Math.min(t.destinations.length-1,Number(data.order||d.order)-1));t.destinations=t.destinations.filter(x=>x.id!==d.id);t.destinations.splice(position,0,d);t.destinations.forEach((x,i)=>x.order=i+1);return ok('destinations','Destino guardado.');}
 if(action.type==='delete-destination'){if(t.destinations.length<2||t.transports.some(x=>x.destinationId===action.id)||t.activities.some(x=>x.destinationId===action.id))return fail('Solo podés eliminar un destino vacío cuando quede al menos otro.');t.destinations=t.destinations.filter(x=>x.id!==action.id);t.destinations.forEach((x,i)=>x.order=i+1);return ok('destinations','Destino eliminado.');}
 if(action.type==='save-transport'){
  const key=data.destination+'-'+data.direction,old=t.transports.find(x=>x.id===key),details={};
  if(hasHistoricalSteps(old)&&!['on',true].includes(data.historyReviewed))return fail('Revisá y confirmá las fechas y horas de los tramos históricos antes de guardar.');
  let departureAt,arrivalAt;try{departureAt=savedInstant(data.departuredate,data.departuretime,old?.departureAt);arrivalAt=savedInstant(data.arrivaldate,data.arrivaltime,old?.arrivalAt);}catch{return fail('Completá fechas y horas válidas.');}if(arrivalAt<departureAt)return fail('La llegada no puede ser anterior a la salida.');if(!data.departurePlace?.trim()||!data.arrivalPlace?.trim())return fail('Completá el lugar de salida y de llegada.');
  if((data.type||data.transportType)==='flight')Object.assign(details,{flightNumber:data.flightNumber||'',airline:data.airline||''});if((data.type||data.transportType)==='bus_long')details.company=data.company||'';
  if((data.type||data.transportType)==='bus_local')try{details.steps=urbanSteps(data,old,departureAt,arrivalAt);}catch(error){return fail(error.message);}
  const value={id:key,destinationId:data.destination,direction:data.direction,type:data.type||data.transportType,departurePlace:data.departurePlace,arrivalPlace:data.arrivalPlace,departureAt,arrivalAt,details,costPerPerson:data.cost===''||data.cost==null?null:Number(data.cost)};
  t.transports=t.transports.filter(x=>x.id!==key);t.transports.push(value);const w=destinationWindow(t,data.destination);if(w.arrival&&w.departure&&w.arrival>w.departure)return fail('La salida del destino no puede quedar antes de la llegada.');
  for(const a of t.activities){const win=destinationWindow(t,a.destinationId);if(win.arrival&&a.scheduledAt<win.arrival||win.departure&&(activityEnd(a)||a.scheduledAt)>win.departure)return fail('El nuevo horario deja «'+a.title+'» fuera del destino. No se guardó ningún cambio.');}
  return ok('transports','Transporte guardado. El itinerario se actualizó.');
 }
 if(action.type==='save-activity'){
  let a=t.activities.find(x=>x.id===action.id);
  const error=checkActivity(t,data,a);if(error)return fail(error);
  if(action.id&&!a)return fail('Esta actividad ya no está disponible.');
  const value={title:data.name.trim(),description:data.description||'',destinationId:data.destination,...schedule(data,a),mapsUrl:data.mapsUrl||'',place:data.place||a?.place||''};
  if(!a){
   a={id:'activity-'+id(),createdBy:s.profile.id,decisionRequired:{},participations:{},...value};
   const confirmation=confirmParticipation(a);if(confirmation)return confirmation;
   t.activities.push(a);notify('Nuevo plan',s.profile.name+' agregó «'+a.title+'».','participation',a.id);
  }else{
   const changes=Object.keys(value).filter(key=>(a[key]??'')!==(value[key]??''));
   const changedFields=changes.filter(key=>['scheduledAt','durationMinutes'].includes(key));
   const changedSchedule=changedFields.length===2?'Cambiaron el horario y la duración':changedFields.includes('durationMinutes')?'Cambió la duración':'Cambió el horario';
   Object.assign(a,value);
   if(changedFields.length)for(const m of t.members){
    if(a.participations[m.id]!=='going')continue;
    const conflicts=participationConflicts(t,a,m.id);if(!conflicts.length)continue;
    a.participations[m.id]='pending';a.decisionRequired||={};
    a.decisionRequired[m.id]={reason:'schedule_conflict',changedFields,changedAt:clock()};
    notify('Revisá tu participación',changedSchedule+' de «'+a.title+'». Nuevo horario: '+activityTimeLabel(a,true)+'. Coincide con '+conflicts.map(x=>'«'+x.title+'» ('+activityTimeLabel(x,true)+')').join(', ')+'. Se retiró tu participación: elegí Voy o No voy.','participation',a.id,m.id);
   }
   if(changes.length){
    const details=[];
    if(changes.includes('title'))details.push('Título: «'+a.title+'».');
    if(changes.includes('description'))details.push('Cambió la descripción.');
    if(changes.includes('mapsUrl')||changes.includes('place'))details.push('Cambió la ubicación'+(a.place?': '+a.place:'')+'.');
    if(changes.includes('destinationId'))details.push('Destino: '+(t.destinations.find(d=>d.id===a.destinationId)?.name||'actualizado')+'.');
    if(changedFields.length)details.push(changedSchedule+'. Nuevo horario: '+activityTimeLabel(a,true)+'.'+(changes.includes('durationMinutes')&&a.durationMinutes==null?' Sin duración indicada; no hay hora de fin.':''));
    notify('Actividad actualizada','«'+a.title+'». '+details.join(' '),'participation',a.id);
   }
  }
  s.activityId=a.id;return ok('participation','Actividad guardada.');
 }
 if(action.type==='delete-activity'){t.activities=t.activities.filter(x=>x.id!==action.id);t.posts.filter(p=>p.activityId===action.id).forEach(p=>p.activityId=null);return ok('itinerary','Actividad eliminada. Los recuerdos se conservaron.');}
 if(action.type==='vote')return fail('Las actividades se organizan con Voy / No voy.');
 if(action.type==='participation'){
  const a=t.activities.find(x=>x.id===action.id);if(!a)return fail('Esta actividad ya no está disponible.');
  if(!['going','not_going'].includes(action.value))return fail('Elegí Voy o No voy.');
  if(!t.members.some(m=>m.id===s.profile.id))return fail('Unite al viaje para participar.');
  if(action.value==='going'){const confirmation=confirmParticipation(a);if(confirmation)return confirmation;}
  else{a.participations[s.profile.id]='not_going';if(a.decisionRequired)delete a.decisionRequired[s.profile.id];}
  return ok('participation');
 }
 if(action.type==='publish-post'){
  const linkError=validatePostLinks(t,data,action.id);if(linkError)return fail(linkError);
  if(!data.description?.trim()&&!data.photos?.length&&!data.totalAmount)return fail('Escribí algo, agregá fotos o registrá un gasto para publicar.');
  const previous=t.posts.find(x=>x.id===action.id)?.expense;
  const expense=data.totalAmount===''||data.totalAmount==null?null:{totalAmount:Number(data.totalAmount),breakdown:data.breakdown||'',currency:data.currency||previous?.currency||'',payments:data.payments??(data.paidBy?[{memberId:data.paidBy,unit:'percent',value:100}]:previous?expensePayments(previous):[]),shares:data.shares??previous?.shares??[],paidBy:null};
  if(expense){const summary=expenseSummary(expense);if(summary.error)return fail(summary.error);}
  const confirmation=spontaneousConfirmation();if(confirmation)return confirmation;
  const aId=activityLink();
  let p=t.posts.find(x=>x.id===action.id);if(!p){p={id:'post-'+id(),authorId:'nico',createdAt:clock(),likes:[],comments:[]};t.posts.push(p);notify('Nuevo recuerdo',s.profile.name+' compartió un recuerdo.','post',p.id);}Object.assign(p,{title:data.description?.trim().split(/[.!?\n]/)[0]?.slice(0,70)||'Un momento del viaje',description:data.description||'',day:localDate(p.createdAt),photos:data.photos||[],mapsUrl:data.mapsUrl||'',activityId:aId,parentPostId:data.parentPostId||null,transportId:data.transportId||null,expense});s.postId=p.id;return ok('post',action.id?'Recuerdo actualizado.':'Recuerdo publicado.');
 }
 if(action.type==='save-links'){
  const p=t.posts.find(x=>x.id===action.id);if(!p)return fail('Este recuerdo ya no está disponible.');
  const error=validatePostLinks(t,{...data,day:p.day},p.id);if(error)return fail(error);
  const confirmation=spontaneousConfirmation();if(confirmation)return confirmation;
  Object.assign(p,{activityId:activityLink(),parentPostId:data.parentPostId||null,transportId:data.transportId||null});
  return ok('post','Vínculo guardado.');
 }
 if(['comment','edit-comment','post-like','comment-like'].includes(action.type)){const p=t.posts.find(x=>x.id===(action.postId||action.id));if(!p)return fail('Este recuerdo ya no está disponible.');if(action.type==='comment'){if(!action.text?.trim())return fail('Escribí tu comentario.');p.comments.push({id:'comment-'+id(),authorId:'nico',text:action.text.trim().slice(0,280),createdAt:s.now,likes:[]});notify('Nuevo comentario',s.profile.name+' comentó '+p.title+'.','comments',p.id);}if(action.type==='edit-comment'){const c=p.comments.find(x=>x.id===action.id);if(!c||c.authorId!=='nico')return fail('Solo podés editar tus propios comentarios.');c.text=action.text.trim().slice(0,280);}if(action.type==='post-like')p.likes=p.likes.includes('nico')?p.likes.filter(x=>x!=='nico'):[...p.likes,'nico'];if(action.type==='comment-like'){const c=p.comments.find(x=>x.id===action.id);if(!c)return fail('Este comentario ya no está disponible.');c.likes=c.likes.includes('nico')?c.likes.filter(x=>x!=='nico'):[...c.likes,'nico'];}return ok('comments');}
 return ok();
}
