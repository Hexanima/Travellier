import {travelStorageKey,encodeTravelState,restoreTravelState} from './prototype-storage.mjs';
import {activityTimeLabel} from './activities.mjs';
import {hasHistoricalSteps,urbanSteps,savedInstant} from './timing.mjs';
import {createState} from './state.mjs';
import {createSimulation,currentTrip,command,tripDays,destinationWindow,localDate,localTime,validatePostLinks} from './simulation.mjs';
import {renderScreen,asset,btn,go,calendarFile,galleryPhotos,tripNavigation,tripSection,diaryAction,spontaneousDefaults,expensePreview,destinationChoices,destinationForDate,renderDestinationPicker} from './playable-screens.mjs';
import {expenseFormData,expenseSummary} from './expenses.mjs';
import {foundations} from './exported-screens.mjs';
import {catalog,groups,titleFor} from './catalog.mjs';
import {escapeHtml as e,backFor} from './v1-screens.mjs';
let state={...createState(),sim:createSimulation(),date:'2026-10-12',postId:'cafe-post',activityId:'paseo',destinationId:'roma',memberId:'juli',transportDirection:'outbound',transportId:'roma-outbound',steps:1,history:[],drafts:{},postOrigin:'compose',editPostId:null,inviteCode:'ITALIA26',notice:''};
try{state.sim=restoreTravelState(state.sim,localStorage.getItem(travelStorageKey));}catch{}
function persistTravel(){try{localStorage.setItem(travelStorageKey,encodeTravelState(state.sim));}catch{toast('Los cambios siguen disponibles durante este recorrido, pero no se pudieron guardar en este navegador.');}}
let pendingDecision=null;
const dialog=document.querySelector('#activity-dialog');
const destinationPicker=document.querySelector('#destination-picker');
destinationPicker.addEventListener('toggle',event=>{
 const opened=event.newState==='open';document.querySelector('.destination-trigger')?.setAttribute('aria-expanded',String(opened));
 if(opened)(destinationPicker.querySelector('[aria-current="true"]:not(:disabled)')||destinationPicker.querySelector('.destination-choice:not(:disabled)')||destinationPicker.querySelector('[data-action="close-destinations"]'))?.focus({preventScroll:true});
});
const scheduleLabel=a=>activityTimeLabel(a,true);
function showConflict(confirmation,action,follow,onSuccess){
 pendingDecision={action:structuredClone(action),follow,onSuccess,conflicts:confirmation.conflicts};
 dialog.innerHTML='<h2 id="activity-dialog-title">Ya tenés otro plan</h2><p id="activity-dialog-description">Para sumarte a «'+e(confirmation.activity.title)+'» ('+e(scheduleLabel(confirmation.activity))+'), necesitás dejar estos planes:</p><ul class="conflict-plans">'+confirmation.conflicts.map(a=>'<li><strong>'+e(a.title)+'</strong><span>'+e(scheduleLabel(a))+'</span></li>').join('')+'</ul><p class="small-copy">Solo cambia tu participación. Los planes y las respuestas del resto del grupo se conservan.</p><div class="dialog-actions">'+btn('Conservar mis planes','cancel-decision','','secondary')+btn('Cambiar de plan','confirm-decision','','primary')+'</div>';
 if(!dialog.open)dialog.showModal();
}
function showDecisionInfo(id){
 const a=currentTrip(state.sim)?.activities.find(x=>x.id===id),decision=a?.decisionRequired?.[state.sim.profile.id];if(!decision)return;
 pendingDecision=null;
 dialog.innerHTML='<h2 id="activity-dialog-title">Revisá tu participación</h2><p id="activity-dialog-description">Se modificó '+(decision.changedFields.includes('durationMinutes')?'el horario o la duración':'el horario')+' de esta actividad y coincidió con otro plan que tenías marcado. Por eso se retiró tu participación.</p><section class="decision-plan"><strong>'+e(a.title)+'</strong><p>'+e(scheduleLabel(a))+'</p></section><p>Seguís sin responder. Revisá el nuevo horario y elegí Voy o No voy.</p><div class="dialog-actions">'+btn('Entendido','cancel-decision','','primary')+'</div>';
 dialog.showModal();
}
dialog.addEventListener('cancel',()=>{pendingDecision=null;});
const composer=['compose','post-edit','post-links','spontaneous','expense-edit','photo-picker','photo-permission'];
const contexts=['view','date','postId','postTab','photo','activityId','activityTab','galleryActivityId','galleryPhoto','destinationId','memberId','transportDirection','transportId','commentId','publicTripId','editPostId','postOrigin','linkStandalone','linkKind','steps'];
const snapshot=()=>({...Object.fromEntries(contexts.map(x=>[x,state[x]])),tripId:state.sim.tripId,tripRole:state.sim.role,bodyScrollTop:document.querySelector('.phone-body')?.scrollTop||0});
state.commentDrafts={};
state.tripPanels={};
function rememberTripPanel(){
 if(!tripSection(state.view))return;
 const panels=state.tripPanels[state.sim.tripId]||={};panels[state.view==='mixed-day'?'itinerary':state.view]=snapshot();
 if(['feed','gallery'].includes(state.view))panels.diary=state.view;
}
function switchTripTab(view,main=false){
 rememberTripPanel();const panels=state.tripPanels[state.sim.tripId]||{};
 const target=main&&view==='feed'?panels.diary||'feed':view;if(target===state.view)return;
 if(panels[target])restore(panels[target]);else open(target,'',true);
 document.querySelector('#'+(main?'trip':'diary')+'-tab-'+(main?tripSection(target):target))?.focus({preventScroll:true});
}
function leaveTrip(){rememberTripPanel();state.history=[];open('trips','',true);}
const commentDraftKey=()=>state.sim.tripId+':'+state.postId;
const draftKey=()=>composer.includes(state.view)?'post:'+state.sim.tripId+':'+(state.editPostId||'new'):['transport-edit','transport-impact','transport-history'].includes(state.view)?'transport:'+state.sim.tripId+':'+state.destinationId+':'+state.transportDirection:['activity-edit','add','delete-activity'].includes(state.view)?'activity:'+state.sim.tripId+':'+(state.view==='add'?'new':state.activityId):'form:'+state.sim.tripId+':'+state.view+':'+state.destinationId;
function capture(){const form=document.querySelector('.phone form:not(.comment-form)');if(!form||['login-design','register-design','join-form','profile-design'].includes(form.id))return;let data=Object.fromEntries(new FormData(form));if(form.id==='expense-design')data=expenseFormData(data);const key=draftKey(),d=state.drafts[key]||{};if(form.id==='spontaneous-design')d.spontaneousDraft=data;else Object.assign(d,data);state.drafts[key]=d;state.draft=d;}
function hydrate(){state.draft=state.drafts[draftKey()]||{};}
function open(view,record='',replace=false,captureDraft=true){
 rememberTripPanel();
 if(captureDraft)capture();if(!replace&&(state.view!==view||view==='post'&&record&&record!==state.postId))state.history=[...state.history,snapshot()].slice(-50);
 const t=currentTrip(state.sim),from=state.view;state.notice='';
 if(view==='post-links'&&from!=='spontaneous')state.linkKind=null;
 if(view==='post'&&(from!=='post'||record&&record!==state.postId)){state.postTab='children';state.photo=0;}
 if(['post','comments','post-edit'].includes(view)&&record)state.postId=record;
 if(view==='comment-edit'&&record)state.commentId=record;
 if(['participation'].includes(view)&&(from!==view||record&&record!==state.activityId))state.activityTab='memories';
 if(['participation','activity-edit','delete-activity'].includes(view)&&record)state.activityId=record;
 if(['destination-edit','delete-destination'].includes(view))state.destinationId=record||state.destinationId;
 if(view==='remove-member')state.memberId=record||state.memberId;
 if(view==='public-trip')state.publicTripId=record||state.publicTripId;
 if(['transport-edit','transport-detail'].includes(view)&&record){const tr=t?.transports.find(x=>x.id===record);if(tr){state.destinationId=tr.destinationId;state.transportDirection=tr.direction;state.transportId=tr.id;state.transportType=tr.type;state.steps=tr.details.steps?.length||1;}else{const d=t?.destinations.find(x=>record===x.id+'-return'||record===x.id+'-outbound');if(d){state.destinationId=d.id;state.transportDirection=record.endsWith('-return')?'return':'outbound';state.transportId=record;state.transportType='flight';state.steps=1;}}}
 if(view==='mixed-day'){state.date='2026-10-16';state.destinationId='roma';}
 if(view==='post-edit'&&!composer.includes(from)){const p=t?.posts.find(p=>p.id===state.postId);state.editPostId=p?.id||null;state.postOrigin='post-edit';state.linkStandalone=false;const key='post:'+state.sim.tripId+':'+(p?.id||'new');state.drafts[key]||={description:p?.description||'',photos:p?.photos.slice()||[],mapsUrl:p?.mapsUrl||'',activityId:p?.activityId||'',parentPostId:p?.parentPostId||'',transportId:p?.transportId||'',...p?.expense,totalAmount:p?.expense?.totalAmount??'',breakdown:p?.expense?.breakdown||'',paidBy:p?.expense?.paidBy||''};}
 if(view==='compose'&&!composer.includes(from)){state.editPostId=null;state.postOrigin='compose';state.linkStandalone=false;const key='post:'+state.sim.tripId+':new';state.drafts[key]||={description:'',photos:[]};if(record&&t?.activities.some(a=>a.id===record))state.drafts[key].activityId=record;if(record&&t?.transports.some(x=>x.id===record))state.drafts[key].transportId=record;const parent=t?.posts.find(p=>p.id===record);if(parent)Object.assign(state.drafts[key],{parentPostId:parent.id,activityId:'',transportId:'',spontaneous:null});}
 if(view==='post-links'&&from==='post'){const p=t?.posts.find(p=>p.id===state.postId);state.editPostId=p?.id;state.postOrigin='post-edit';state.linkStandalone=true;state.drafts['post:'+state.sim.tripId+':'+p?.id]={...p,...p?.expense,totalAmount:p?.expense?.totalAmount??'',breakdown:p?.expense?.breakdown||'',paidBy:p?.expense?.paidBy||''};}
 if(view==='add'){state.drafts['activity:'+state.sim.tripId+':new']||={};}
 if(view==='join'&&record){state.inviteCode=state.sim.trips.find(t=>t.id===record)?.inviteCode||state.inviteCode;}
 if(view==='transport-edit'){
  const transport=t?.transports.find(x=>x.destinationId===state.destinationId&&x.direction===state.transportDirection);
  const draft=state.drafts['transport:'+state.sim.tripId+':'+state.destinationId+':'+state.transportDirection];
  if(hasHistoricalSteps(transport)&&!draft?.historyReviewed)view='transport-history';
 }
 state.view=view;hydrate();
 if(view==='spontaneous'&&!state.draft.spontaneousDraft){state.draft.spontaneousDraft={...spontaneousDefaults(),...state.draft.spontaneous};state.drafts[draftKey()]=state.draft;}
 render();focusHeading();
}
function exportCalendar(){const t=currentTrip(state.sim),url=URL.createObjectURL(new Blob([calendarFile(t)],{type:'text/calendar;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='travellier-itinerario.ics';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Calendario exportado.');}
function studioOpen(view){if(view==='participation')state.activityId=currentTrip(state.sim)?.activities[0]?.id;if(view==='comment-edit'){state.postId='cafe-post';state.commentId='own-comment';}if(['post-edit','post-links'].includes(view))state.view='post';open(view,'',true);}
const activityViews=['participation'];
const activityView=()=> 'participation';
function restore(previous){Object.assign(state,previous);if(previous.tripId&&state.sim.trips.some(t=>t.id===previous.tripId))state.sim.tripId=previous.tripId;state.sim.role=previous.tripRole||currentTrip(state.sim)?.members.find(m=>m.id==='nico')?.role||'participant';state.notice='';hydrate();render();focusHeading();const body=document.querySelector('.phone-body');if(body)body.scrollTop=previous.bodyScrollTop||0;}
function fallbackBack(){
 let parent=activityViews.includes(state.view)||state.view==='add'?'itinerary':state.view==='post'?'feed':state.view==='location'?'post':state.view==='photo-viewer'&&state.galleryActivityId?activityView():state.view==='post-links'&&state.linkStandalone?'post':backFor(state.view,{...state,activityOrigin:activityView()});
 if(parent==='itinerary'&&activityViews.includes(state.view)){const a=currentTrip(state.sim)?.activities.find(a=>a.id===state.activityId);if(a){state.date=localDate(a.scheduledAt);state.destinationId=a.destinationId;}}
 open(parent,'',true);
}
function back(){capture();if(tripSection(state.view)){leaveTrip();return;}const previous=state.history.pop();if(previous)restore(previous);else fallbackBack();}
function returnView(view,record='',captureDraft=true){
 if(captureDraft)capture();const field=activityViews.includes(view)?'activityId':['post','comments'].includes(view)?'postId':view==='transport-detail'?'transportId':null,id=record||(field?state[field]:null);
 const index=state.history.findLastIndex(x=>(x.view===view||activityViews.includes(view)&&activityViews.includes(x.view))&&(!x.tripId||x.tripId===state.sim.tripId)&&(!field||x[field]===id));
 if(index>=0){const previous=state.history[index];state.history=state.history.slice(0,index);restore(previous);}else open(view,record,true,captureDraft);
}
function moveGallery(delta){const photos=galleryPhotos(currentTrip(state.sim),state.galleryActivityId),next=Math.max(0,Math.min((state.galleryPhoto||0)+delta,photos.length-1));if(!photos.length||next===state.galleryPhoto)return;state.galleryPhoto=next;render();document.querySelector('.viewer-photo')?.focus({preventScroll:true});}
function publishCurrentPost(){
 capture();if(state.scenario==='loading')return;
 if(state.scenario==='error'){state.scenario='default';const error=document.querySelector('#post-design .inline-error');if(error){error.hidden=false;error.textContent='No pudimos guardar el recuerdo. Tu borrador se conserva; volvé a intentar.';error.tabIndex=-1;error.focus();}return;}
 const key=draftKey(),savedId=state.editPostId;
 apply({type:'publish-post',id:savedId,data:state.draft},true,()=>{delete state.drafts[key];state.history=state.history.filter(x=>!composer.includes(x.view));state.editPostId=null;state.postOrigin='compose';});
}
function chooseLink(link){
 const key=draftKey(),next={...state.draft,activityId:'',parentPostId:'',transportId:'',spontaneous:null,...link};
 const error=validatePostLinks(currentTrip(state.sim),next,state.editPostId);
 if(error){const el=document.querySelector('.phone .inline-error');if(el){el.hidden=false;el.textContent=error;}else toast(error);return;}
 if(state.linkStandalone){if(!apply({type:'save-links',id:state.postId,data:next},true,()=>{delete state.drafts[key];state.linkStandalone=false;}))return;}
 else{state.drafts[key]=next;open(state.postOrigin,'',true);}
 // The picker is a subflow: the next Back leaves the editor, not a completed picker.
 while(state.history.length&&['post-links','spontaneous',state.postOrigin].includes(state.history.at(-1).view))state.history.pop();
}
function focusHeading(){const h=document.querySelector('.phone-header h2,.trip-name');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
function toast(message){state.notice=message;const n=document.querySelector('#phone-notice');if(n){n.hidden=false;n.querySelector('p').textContent=message;}document.querySelector('#announcement').textContent=message;}
function apply(action,follow=true,onSuccess){if(state.scenario==='loading')return false;if(state.scenario==='error'){toast('No pudimos guardar los cambios. Tu decisión anterior se conserva; volvé a intentar.');return false;}const result=command(state.sim,action);if(result.confirmation){showConflict(result.confirmation,action,follow,onSuccess);return false;}if(result.error){const el=document.querySelector('.phone .inline-error');if(el){el.hidden=false;el.textContent=result.error;el.tabIndex=-1;el.focus();}else toast(result.error);return false;}state.sim=result.state;persistTravel();state.role=state.sim.role;if(action.type==='publish-post'&&state.sim.postId)state.postId=state.sim.postId;if(action.type==='save-activity'&&state.sim.activityId)state.activityId=state.sim.activityId;if(['delete-trip','create-trip'].includes(action.type))state.history=[];if(follow&&result.view){if(['profile','settings','save-destination','save-transport','save-activity','delete-activity','delete-destination','remove-member','edit-comment','save-links','publish-post','permission'].includes(action.type))returnView(result.view);else open(result.view,'',true);}else render();if(result.message)toast(result.message);onSuccess?.();return true;}
function activeTrip(){const t=currentTrip(state.sim);if(!t)return;state.expenseMode=t.expenseMode;if(!t.destinations.some(d=>d.id===state.destinationId))state.destinationId=t.destinations[0]?.id;if(!tripDays(t).includes(state.date))state.date=tripDays(t)[0]||localDate(state.sim.now);}
const appTitle=view=>({post:'Recuerdo',balance:'Balance',location:'Ubicación','post-links':'Vincular recuerdo','invite-fallback':'Invitación','connection-error':'Sin conexión','delete-destination':'Eliminar destino','mixed-day':'Itinerario'})[view]||titleFor(view);
function header(){const t=currentTrip(state.sim),home=['trips','empty','discover','profile'].includes(state.view),tripView=Boolean(tripSection(state.view));return home?'<header class="phone-header home-header"><h2>'+titleFor(state.view)+'</h2>'+btn(asset('home-imgIconBell'),'view','notifications','icon-button','aria-label="Notificaciones"')+'</header>':tripView?'<header class="phone-header">'+btn(asset('day-imgIconBack'),'leave-trip','','icon-button','aria-label="Volver a Mis viajes"')+'<div class="trip-heading"><p class="trip-name">'+e(t?.name||'Mis viajes')+'</p><p class="trip-meta">'+(t?.members.length||0)+(t?.members.length===1?' integrante':' integrantes')+'</p></div>'+btn(asset('day-imgIconMore'),'view','trip-settings','icon-button','aria-label="Opciones del viaje"')+'</header>':'<header class="phone-header detail-header">'+btn(asset('day-imgIconBack'),'back','','icon-button','aria-label="Volver"')+'<h2>'+appTitle(state.view)+'</h2><span class="header-placeholder"></span></header>';}
function render(){
 state.commentDraft=state.commentDrafts[commentDraftKey()]||'';
 activeTrip();const t=currentTrip(state.sim);state.inviteUrl=location.origin+location.pathname+'?invite='+encodeURIComponent(t?.inviteCode||state.inviteCode);
 const comparison=document.querySelector('#comparison');comparison.dataset.variant='blue';
 comparison.innerHTML=state.view==='foundations'?foundations({asset,stitch:(name,cls)=>'<span class="figma-icon '+cls+'" style="--asset:url(assets/figma/'+name+'.svg)"></span>'}):'<section class="proposal blue-proposal"><div class="proposal-label blue-label"><span class="swatch"></span>Travellier<small>Azul y blanco</small></div><div class="phone blue" data-screen="'+state.view+'"><div class="status-bar"><span>9:41</span><span class="status-icons">5G · 100%</span></div>'+header()+tripNavigation(state)+'<div class="phone-body"><section id="phone-notice" class="phone-notice" role="status" '+(state.notice?'':'hidden')+'><p>'+e(state.notice)+'</p>'+btn('Cerrar','dismiss','','text-button')+'</section>'+renderScreen(state)+'</div>'+diaryAction(state)+(['trips','empty','discover','profile'].includes(state.view)?'<nav class="main-nav" aria-label="Navegación principal">'+['trips','discover','profile'].map((v,i)=>btn(asset(['home-imgIconBag','home-imgIconPin','home-imgIconUsers'][i])+['Viajes','Descubrir','Perfil'][i],'view',v,'', 'aria-pressed="'+(state.view===v)+'"')).join('')+'</nav>':'')+'</div></section>';
 document.querySelector('#screen-select').value=state.view;document.querySelector('#role-select').value=state.sim.role;document.querySelector('#expense-select').value=t?.expenseMode||'register';document.querySelector('#scenario-select').value=state.scenario;
 for(const b of document.querySelectorAll('.screen-switch button,#screen-index button'))b.setAttribute('aria-pressed',String(b.dataset.value===state.view));
}
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-action]');if(!b)return;const {action,value,record}=b.dataset,t=currentTrip(state.sim);
 if(action==='view'){if(b.textContent.trim()==='Reintentar'){state.scenario='default';}if(!b.closest('.phone'))studioOpen(value);else open(value,record);return;}
 if(action==='back'){back();return;}if(action==='dismiss'){state.notice='';document.querySelector('#phone-notice').hidden=true;return;}
 if(action==='leave-trip'){leaveTrip();return;}
 if(action==='trip-tab'||action==='diary-tab'){switchTripTab(value,action==='trip-tab');return;}
 if(action==='return-view'){returnView(value,record);return;}
 if(action==='post-tab'){const scroll=document.querySelector('.phone-body').scrollTop;state.postTab=value==='comments'?'comments':'children';render();document.querySelector('.phone-body').scrollTop=scroll;document.querySelector('#post-tab-'+state.postTab)?.focus({preventScroll:true});return;}
 if(action==='activity-tab'){const scroll=document.querySelector('.phone-body').scrollTop;state.activityTab=value==='photos'?'photos':'memories';render();document.querySelector('.phone-body').scrollTop=scroll;document.querySelector('#activity-tab-'+state.activityTab)?.focus({preventScroll:true});return;}
 if(action==='continue-post'){open('compose',value);return;}
 if(action==='link-kind'){capture();state.history.push(snapshot());state.linkKind=value;state.notice='';render();focusHeading();return;}
 if(action==='link-post'||action==='link-activity'||action==='unlink-post'){chooseLink(action==='link-post'?{parentPostId:value}:action==='link-activity'?{activityId:value}:{});return;}
 if(action==='filter'){state.filter=value;state.notice='';render();return;}
 if(action==='destination-picker'){destinationPicker.innerHTML=renderDestinationPicker(t,state.destinationId);return;}
 if(action==='close-destinations'){destinationPicker.hidePopover();document.querySelector('.destination-trigger')?.focus({preventScroll:true});return;}
 if(action==='configure-destinations'){destinationPicker.hidePopover();open('destinations');return;}
 if(action==='choose-destination'){
  const d=destinationChoices(t).find(x=>x.id===value&&x.available);if(!d)return;
  destinationPicker.hidePopover();state.destinationId=d.id;state.date=d.firstDay;state.view='itinerary';state.notice='';render();
  const strip=document.querySelector('.live-date-strip'),selected=strip?.querySelector('[data-value="'+state.date+'"]');
  if(strip&&selected){const r=selected.getBoundingClientRect(),parent=strip.getBoundingClientRect();strip.scrollLeft+=r.left-parent.left-(strip.clientWidth-r.width)/2;}
  document.querySelector('.destination-trigger')?.focus({preventScroll:true});rememberTripPanel();return;
 }
 if(action==='date'){
  if(state.date===value)return;
  const top=document.querySelector('.phone-body')?.scrollTop||0,left=document.querySelector('.live-date-strip')?.scrollLeft||0;
  state.date=value;state.destinationId=destinationForDate(t,value,state.destinationId);
  render();
  document.querySelector('.live-date-strip [data-value="'+value+'"]')?.focus({preventScroll:true});
  document.querySelector('.phone-body').scrollTop=top;
  document.querySelector('.live-date-strip').scrollLeft=left;
  return;
 }
 if(action==='trip'||action==='join-public'){rememberTripPanel();if(apply({type:action==='trip'?'select-trip':'join',id:value})){state.history=[];state.date=tripDays(currentTrip(state.sim))[0];state.destinationId=currentTrip(state.sim).destinations[0].id;state.activityId=currentTrip(state.sim).activities[0]?.id;state.postId=currentTrip(state.sim).posts[0]?.id;const previous=state.tripPanels[state.sim.tripId]?.itinerary;if(previous)restore(previous);else open('itinerary','',true);}return;}
 if(action==='open-activity'){const a=t.activities.find(x=>x.id===(record||value));open('participation',a?.id);return;}
 if(action==='open-transport'){open('transport-detail',record||value);return;}
 if(action==='notification'){const n=state.sim.notifications.find(n=>n.id===value&&(!n.userId||n.userId===state.sim.profile.id));if(n){capture();state.history=[...state.history,snapshot()].slice(-50);state.sim.tripId=n.tripId;state.sim.role=currentTrip(state.sim)?.members.find(m=>m.id==='nico')?.role||'participant';activeTrip();open(n.view,n.record||'',true);}return;}
 if(action==='decision-info'){showDecisionInfo(value);return;}
 if(action==='cancel-decision'){pendingDecision=null;dialog.close();return;}
 if(action==='confirm-decision'){const pending=pendingDecision;pendingDecision=null;dialog.close();if(pending)apply({...pending.action,confirmedConflicts:pending.conflicts},pending.follow,pending.onSuccess);return;}
 if(action==='participation'){apply({type:action,id:state.activityId,value},false);return;}
 if(['remove-member','delete-trip','delete-destination','delete-activity'].includes(action)){apply({type:action,id:value});return;}
 if(action==='post-like'){const scroll=document.querySelector('.phone-body').scrollTop;apply({type:'post-like',id:state.postId},false);document.querySelector('.phone-body').scrollTop=scroll;return;}
 if(action==='comment-like'){const scroll=document.querySelector('.phone-body').scrollTop;apply({type:'comment-like',id:value,postId:state.postId},false);document.querySelector('.phone-body').scrollTop=scroll;return;}
 if(action==='pick-photo'){const key=draftKey(),d=state.drafts[key]||{};d.photos=d.photos?.includes(value)?d.photos.filter(id=>id!==value):[...(d.photos||[]),value];state.drafts[key]=d;hydrate();render();return;}
 if(action==='photo'){state.photo++;render();return;}
 if(action==='open-photo'){state.galleryPhoto=Number(value);state.galleryActivityId=b.dataset.activity||null;open('photo-viewer');return;}
 if(action==='gallery-next'||action==='gallery-prev'){moveGallery(action==='gallery-next'?1:-1);return;}
 if(action==='photo-post'){open('post',value);state.photo=Number(b.dataset.photoIndex)||0;render();return;}
 if(action==='add-step'||action==='remove-step'){
  capture();state.steps=Math.max(1,state.steps+(action==='add-step'?1:-1));
  if(action==='remove-step')for(const key of Object.keys(state.draft)){const match=key.match(/^(line|fromStop|toStop|stepDate|stepTime)(\d+)$/);if(match&&Number(match[2])>=state.steps)delete state.draft[key];}
  render();if(action==='add-step')document.querySelector('[name="line'+(state.steps-1)+'"]')?.focus();return;
 }
 if(action==='add-share'){
  capture();const memberId=state.draft.shareAddMember,shares=state.draft.shares||[];
  if(!t.members.some(m=>m.id===memberId)||shares.some(row=>row.memberId===memberId))return;
  state.draft.shares=[...shares,{memberId,unit:'remainder'}];delete state.draft.shareAddMember;state.drafts[draftKey()]=state.draft;
  render();document.querySelector('[name="shareUnit'+shares.length+'"]')?.focus();return;
 }
 if(action==='add-payment'||action==='remove-payment'){capture();const payments=state.draft.payments||[];if(action==='add-payment')payments.push({memberId:'nico',unit:'amount',value:''});else payments.splice(Number(value),1);state.draft.payments=payments;state.drafts[draftKey()]=state.draft;render();if(action==='add-payment')document.querySelector('[name="paymentValue'+(payments.length-1)+'"]')?.focus();return;}
 if(action==='remove-spontaneous'||action==='remove-expense'){capture();if(action==='remove-spontaneous')delete state.draft.spontaneous;else for(const key of ['totalAmount','breakdown','paidBy','payments','shares','currency'])delete state.draft[key];state.drafts[draftKey()]=state.draft;returnView(state.postOrigin,'',false);return;}
 if(action==='logout'){state.history=[];open('login','',true);return;}
 if(action==='copy-code'||action==='copy-link'){try{await navigator.clipboard.writeText(action==='copy-code'?t.inviteCode:state.inviteUrl);toast(action==='copy-code'?'Código copiado.':'Enlace copiado.');}catch{toast('No pudimos copiar. Mantené presionado el código o enlace para copiarlo.');}return;}
 if(action==='export-calendar'){exportCalendar();return;}
 if(action==='mock'){if(state.view==='push-permission')apply({type:'permission',id:'push'});else if(state.view==='calendar-permission')apply({type:'permission',id:'calendar'});else if(state.view==='photo-permission')apply({type:'permission',id:'photos'});else if(value)open(value);else if(b.textContent.includes('.ics'))exportCalendar();else toast('Podés continuar desde los ajustes del dispositivo.');return;}
 if(action==='pending'){const routes={'Crear viaje':'create-trip','Opciones del viaje':'trip-settings','Editar actividad':'activity-edit','Agregar actividad':'add','Notificaciones':'notifications','Perfil':'profile','Descubrir':'discover','Agregar a mi calendario':'calendar'};if(routes[value])open(routes[value]);return;}
});
document.addEventListener('submit',event=>{
 const f=event.target;if(!f.closest('.phone'))return;event.preventDefault();const data=Object.fromEntries(new FormData(f));capture();
 if(f.id==='post-design'){publishCurrentPost();return;}
 if(state.scenario==='error'){const el=f.querySelector('.inline-error');if(el){el.hidden=false;el.textContent='No pudimos guardar los cambios. Revisá tu conexión y volvé a intentar.';el.tabIndex=-1;el.focus();}return;}
 if(f.id==='trip-design'){if(apply({type:'create-trip',data})){state.destinationId=currentTrip(state.sim).destinations[0].id;state.transportDirection='outbound';state.postId=null;state.activityId=null;state.date=localDate(state.sim.now);open('transports','',true);}return;}
 if(f.id==='settings-design'){apply({type:'settings',data});return;}
 if(f.id==='destination-design'){apply({type:'save-destination',id:state.destinationId==='new'?null:state.destinationId,data});return;}
 if(f.id==='transport-design'){if(apply({type:'save-transport',data})){delete state.drafts['transport:'+state.sim.tripId+':'+state.destinationId+':'+state.transportDirection];state.transportDirection='return';open('transports','',true);}return;}
 if(f.id==='activity-form'){const key=draftKey();apply({type:'save-activity',id:state.view==='activity-edit'?state.activityId:null,data},true,()=>{delete state.drafts[key];state.draft={};});return;}
 if(f.id==='spontaneous-design'){chooseLink({spontaneous:data});return;}
 if(f.id==='expense-design'){const error=expenseSummary(state.draft).error;if(error){const el=f.querySelector('.inline-error');el.hidden=false;el.textContent=error;el.tabIndex=-1;el.focus();return;}returnView(state.postOrigin);return;}
 if(f.classList.contains('comment-form')){const scroll=document.querySelector('.phone-body').scrollTop;if(apply({type:'comment',postId:state.postId,text:data.comment},false)){delete state.commentDrafts[commentDraftKey()];const input=document.querySelector('#comment-blue');if(input)input.value='';}document.querySelector('.phone-body').scrollTop=scroll;document.querySelector('#comment-blue')?.focus({preventScroll:true});return;}
 if(f.id==='comment-edit-design'){apply({type:'edit-comment',postId:state.postId,id:state.commentId,text:data.text});return;}
 if(f.id==='profile-design'){apply({type:'profile',data});return;}
 if(f.id==='join-form'){state.inviteCode=data.code;if(apply({type:'join',code:data.code})){state.history=[];activeTrip();}return;}
 if(f.id==='register-design'){state.sim.profile={...state.sim.profile,name:'Vos',email:data.email};state.sim.people.nico.name='Vos';state.sim.trips.forEach(t=>{t.joined=false;t.members=t.members.filter(m=>m.id!=='nico');});persistTravel();open('trips');return;}
 if(f.id==='login-design'){state.sim.profile.email=data.email;open('trips');return;}
 if(f.id==='history-design'){
  const tr=currentTrip(state.sim)?.transports.find(x=>x.destinationId===state.destinationId&&x.direction===state.transportDirection);
  if(!hasHistoricalSteps(tr)){open('transport-edit','',true);return;}
  const review={...state.draft,...data};tr.details.steps.forEach((step,i)=>Object.assign(review,{['line'+i]:review['line'+i]??step.line,['fromStop'+i]:review['fromStop'+i]??step.fromStop,['toStop'+i]:review['toStop'+i]??step.toStop}));
  try{
   const start=review.departuredate?savedInstant(review.departuredate,review.departuretime,tr.departureAt):tr.departureAt,end=review.arrivaldate?savedInstant(review.arrivaldate,review.arrivaltime,tr.arrivalAt):tr.arrivalAt;
   urbanSteps(review,tr,start,end);
  }catch(error){delete state.draft.historyReviewed;const el=f.querySelector('.inline-error');el.hidden=false;el.textContent=error.message;el.tabIndex=-1;el.focus();return;}
  state.draft.historyReviewed='on';open('transport-edit','',true);return;
 }
});
document.addEventListener('change',event=>{
 if(event.target.closest('#expense-design')&&/^(paymentUnit|shareUnit)/.test(event.target.name)){capture();const name=event.target.name;render();document.querySelector('[name="'+name+'"]')?.focus();return;}
 const el=event.target;if(el.id==='screen-select'){state.history=[];studioOpen(el.value);return;}
 if(el.id==='role-select'){capture();state.sim.role=el.value;render();return;}
 if(el.id==='expense-select'){capture();const t=currentTrip(state.sim);if(t)t.expenseMode=el.value;render();return;}
 if(el.id==='scenario-select'){capture();state.scenario=el.value;render();return;}
 if(el.name==='transportType'){capture();state.transportType=el.value;render();return;}
 if(el.name==='destination'&&state.view==='transports'){state.destinationId=el.value;render();return;}
 if(el.id==='photo-files'){const d=state.drafts[draftKey()]||{};d.photos=[...(d.photos||[]),...[...el.files].map(file=>URL.createObjectURL(file))];state.drafts[draftKey()]=d;hydrate();render();return;}
 if(el.id==='avatar-file'&&el.files[0]){state.sim.profile.avatar=URL.createObjectURL(el.files[0]);render();}
});
document.addEventListener('input',event=>{if(!event.target.closest('#expense-design'))return;capture();const preview=document.querySelector('#expense-preview');if(preview)preview.innerHTML=expensePreview(state.draft);});
document.addEventListener('input',event=>{
 if(event.target.matches('.comment-form [name=comment]'))state.commentDrafts[commentDraftKey()]=event.target.value;
 if(event.target.dataset.search==='public'){const q=event.target.value.trim().toLocaleLowerCase('es');let count=0;for(const row of document.querySelectorAll('.public-results .list-row')){row.hidden=!row.textContent.toLocaleLowerCase('es').includes(q);if(!row.hidden)count++;}document.querySelector('#no-results').hidden=count>0;}
 if(event.target.matches('#join-form [name=code]')){const code=event.target.value.trim().toUpperCase(),t=state.sim.trips.find(t=>t.inviteCode===code),preview=document.querySelector('#invite-preview');preview.hidden=!t;preview.textContent=t?t.name+' · '+t.destinations.map(d=>d.name).join(' · ')+' · '+t.members.length+' integrantes':'';}
});
document.addEventListener('keydown',event=>{
 const tripTab=event.target.closest('[data-action="trip-tab"],[data-action="diary-tab"]');
 if(tripTab&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
  event.preventDefault();const tabs=[...tripTab.closest('[role=tablist]').querySelectorAll('[role=tab]')],index=tabs.indexOf(tripTab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();return;
 }
 if(event.target.closest('.viewer-photo')&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();moveGallery(event.key==='ArrowRight'?1:-1);return;}
 const tab=event.target.closest('[data-action="post-tab"],[data-action="activity-tab"]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
 const values=tab.dataset.action==='activity-tab'?['memories','photos']:['children','comments'],prefix=tab.dataset.action==='activity-tab'?'activity':'post';
 event.preventDefault();const selected=event.key==='Home'?values[0]:event.key==='End'?values[1]:values[values.indexOf(tab.dataset.value)===0?1:0];document.querySelector('#'+prefix+'-tab-'+selected)?.click();
});
let galleryTouch=null;
document.addEventListener('touchstart',event=>{galleryTouch=event.target.closest('.viewer-photo')&&event.touches.length===1?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;},{passive:true});
document.addEventListener('touchend',event=>{if(!galleryTouch||!event.changedTouches.length)return;const dx=event.changedTouches[0].clientX-galleryTouch.x,dy=event.changedTouches[0].clientY-galleryTouch.y;galleryTouch=null;if(state.view==='photo-viewer'&&Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy))moveGallery(dx<0?1:-1);},{passive:true});
document.addEventListener('touchcancel',()=>{galleryTouch=null;},{passive:true});
document.querySelector('#credits-button').addEventListener('click',event=>{const panel=document.querySelector('#credits');panel.hidden=!panel.hidden;event.target.setAttribute('aria-expanded',String(!panel.hidden));});
function setAppOnly(enabled){
 if(enabled && state.view==='foundations')studioOpen('trips');
 document.body.classList.toggle('app-only',enabled);
 const toggle=document.querySelector('#studio-toggle');
 toggle.textContent='Solo app';
 toggle.setAttribute('aria-pressed',String(enabled));
 const url=new URL(location.href);
 if(enabled)url.searchParams.set('mode','app');else url.searchParams.delete('mode');
 history.replaceState(null,'',url);
}
document.querySelector('#studio-toggle').addEventListener('click',()=>setAppOnly(!document.body.classList.contains('app-only')));
document.querySelector('#reset-prototype').addEventListener('click',()=>{localStorage.removeItem(travelStorageKey);location.assign(location.pathname+'?v=participation');});
document.querySelector('#notice-dismiss').addEventListener('click',()=>document.querySelector('#notice').hidden=true);
document.querySelector('#screen-select').innerHTML=groups.map(([name,items])=>'<optgroup label="'+name+'">'+items.map(([id,title])=>'<option value="'+id+'">'+title+'</option>').join('')+'</optgroup>').join('');
document.querySelector('#screen-index').innerHTML=groups.map(([name,items],i)=>'<details '+(i===0?'open':'')+'><summary>'+name+'</summary>'+items.map(([id,title])=>btn(title,'view',id,'','aria-pressed="false"')).join('')+'</details>').join('');
const query=new URLSearchParams(location.search);if(query.has('invite')){state.inviteCode=query.get('invite');state.view='join';}else if(catalog.some(x=>x.id===query.get('screen')))studioOpen(query.get('screen'));
render();
setAppOnly(query.get('mode')==='app');
