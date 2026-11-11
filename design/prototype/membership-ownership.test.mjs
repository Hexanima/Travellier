import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,currentTrip,command,viewerRole,tripOwnerId,localInstant} from './public/simulation.mjs';
import {createState,transition,views} from './public/state.mjs';
import {catalog} from './public/catalog.mjs';
import {renderV1} from './public/v1-screens.mjs';
import {renderScreen,transferFormError} from './public/playable-screens.mjs';
import {restoreTravelState,encodeTravelState} from './public/prototype-storage.mjs';
const newViews=['member-manage','role-change','transfer-owner','leave-trip','leave-owner'];
const member=(s,id)=>currentTrip(s).members.find(m=>m.id===id);
// Nico stays admin but Ana holds the ownership.
const asAdmin=()=>{const s=createSimulation();currentTrip(s).ownerId='ana';return s;};
const asParticipant=()=>{const s=asAdmin();member(s,'nico').role='participant';s.role='participant';return s;};
const screen=(s,view,extra={})=>renderScreen({...createState(),sim:s,view,date:'2026-10-12',postId:'cafe-post',activityId:'paseo',destinationId:'roma',memberId:'juli',...extra});
const hasAdmin=s=>currentTrip(s).members.some(m=>m.role==='admin');

test('every trip has one owner who is always an admin',()=>{
 const s=createSimulation();
 for(const t of s.trips){assert.ok(t.ownerId,t.id);assert.equal(t.members.find(m=>m.id===t.ownerId)?.role,'admin',t.id);}
 assert.equal(tripOwnerId(currentTrip(s)),'nico');
 assert.equal(viewerRole(s),'owner');
});
test('viewer role combines real membership with the design role preview',()=>{
 assert.equal(viewerRole(asAdmin()),'admin');assert.equal(viewerRole(asParticipant()),'participant');
 const s=createSimulation();s.role='participant';assert.equal(viewerRole(s),'participant');assert.equal(member(s,'nico').role,'admin');assert.equal(tripOwnerId(currentTrip(s)),'nico');
 assert.equal(transition(createState(),{type:'role',value:'participant'}).role,'participant');
});
test('only the owner changes roles and the owner role cannot change',()=>{
 let r=command(createSimulation(),{type:'set-role',id:'martin',value:'admin'});assert.equal(r.error,undefined);assert.equal(member(r.state,'martin').role,'admin');
 r=command(r.state,{type:'set-role',id:'ana',value:'participant'});assert.equal(member(r.state,'ana').role,'participant');
 assert.ok(hasAdmin(r.state));
 for(const s of [asAdmin(),asParticipant()]){const out=command(s,{type:'set-role',id:'martin',value:'admin'});assert.ok(out.error);assert.deepEqual(out.state,s);}
 const own=command(createSimulation(),{type:'set-role',id:'nico',value:'participant'});assert.match(own.error,/titular/);
 assert.ok(command(createSimulation(),{type:'set-role',id:'martin',value:'owner'}).error);
 assert.ok(command(createSimulation(),{type:'set-role',id:'ausente',value:'admin'}).error);
});
test('transfer makes the target admin and owner and keeps the previous owner as admin',()=>{
 const r=command(createSimulation(),{type:'transfer-owner',id:'martin'});assert.equal(r.error,undefined);
 const t=currentTrip(r.state);assert.equal(t.ownerId,'martin');assert.equal(member(r.state,'martin').role,'admin');assert.equal(member(r.state,'nico').role,'admin');
 assert.equal(viewerRole(r.state),'admin');
 for(const out of [command(r.state,{type:'delete-trip'}),command(r.state,{type:'set-role',id:'ana',value:'participant'}),command(r.state,{type:'transfer-owner',id:'ana'}),command(r.state,{type:'remove-member',id:'martin'})])assert.ok(out.error);
 for(const s of [asAdmin(),asParticipant()])assert.ok(command(s,{type:'transfer-owner',id:'martin'}).error);
 assert.ok(command(createSimulation(),{type:'transfer-owner',id:'nico'}).error);
 assert.ok(command(createSimulation(),{type:'transfer-owner',id:'ausente'}).error);
});
test('expulsion respects the owner, admin and participant hierarchy',()=>{
 const admin=asAdmin();
 assert.equal(command(admin,{type:'remove-member',id:'juli'}).error,undefined);
 assert.match(command(admin,{type:'remove-member',id:'ana'}).error,/titular/);
 member(admin,'martin').role='admin';assert.match(command(admin,{type:'remove-member',id:'martin'}).error,/titular/);
 assert.equal(command(createSimulation(),{type:'remove-member',id:'ana'}).error,undefined);
 assert.match(command(createSimulation(),{type:'remove-member',id:'nico'}).error,/./);
 assert.ok(command(asParticipant(),{type:'remove-member',id:'juli'}).error);
});
test('only the owner deletes the trip',()=>{
 assert.equal(command(createSimulation(),{type:'delete-trip'}).error,undefined);
 assert.match(command(asAdmin(),{type:'delete-trip'}).error,/titular/);
 assert.ok(command(asParticipant(),{type:'delete-trip'}).error);
});
test('leaving retires access, keeps records and only removes participation in activities not started',()=>{
 const s=asParticipant(),t=currentTrip(s);
 t.activities.push({id:'cena',title:'Cena de despedida',destinationId:'roma',scheduledAt:localInstant('2026-10-21','21:00'),durationMinutes:null,description:'',mapsUrl:'',place:'',createdBy:'ana',decisionRequired:{nico:{reason:'schedule_conflict',changedFields:['scheduledAt'],changedAt:s.now}},participations:{nico:'going',ana:'going'}});
 t.activities.find(a=>a.id==='paseo').participations.nico='going';
 const posts=t.posts.length,r=command(s,{type:'leave-trip'});assert.equal(r.error,undefined);
 const left=r.state.trips.find(x=>x.id===t.id);
 assert.equal(left.joined,false);assert.ok(!left.members.some(m=>m.id==='nico'));assert.equal(left.posts.length,posts);
 assert.equal(left.activities.find(a=>a.id==='paseo').participations.nico,'going');
 const cena=left.activities.find(a=>a.id==='cena');assert.ok(!('nico' in cena.participations));assert.ok(!('nico' in cena.decisionRequired));assert.equal(cena.participations.ana,'going');
 assert.equal(r.state.people.nico.name,'Nico');assert.equal(r.view,'trips');assert.notEqual(r.state.tripId,t.id);
 assert.ok(hasAdmin({...r.state,tripId:t.id}));
});
test('expulsion applies the same rule to participations',()=>{
 const s=createSimulation(),t=currentTrip(s);
 t.activities.push({id:'cena',title:'Cena',destinationId:'roma',scheduledAt:localInstant('2026-10-21','21:00'),durationMinutes:null,description:'',mapsUrl:'',place:'',createdBy:'ana',decisionRequired:{},participations:{juli:'going',ana:'going'}});
 const r=command(s,{type:'remove-member',id:'juli'});assert.equal(r.error,undefined);
 const out=currentTrip(r.state);assert.ok(!('juli' in out.activities.find(a=>a.id==='cena').participations));assert.equal(out.activities.find(a=>a.id==='paseo').participations.juli,'going');
});
test('the owner cannot leave without transferring or deleting, and a trip never loses its admin',()=>{
 const own=command(createSimulation(),{type:'leave-trip'});assert.match(own.error,/transfer/i);assert.match(own.error,/elimin/i);
 const solo=createSimulation(),t=currentTrip(solo);t.members=t.members.filter(m=>m.id==='nico');
 assert.match(command(solo,{type:'leave-trip'}).error,/elimin/i);
 let s=command(createSimulation(),{type:'transfer-owner',id:'ana'}).state;
 assert.ok(hasAdmin(s));
 const left=command(s,{type:'leave-trip'});assert.equal(left.error,undefined);
 assert.ok(left.state.trips.find(x=>x.id==='italia').members.some(m=>m.role==='admin'));
 assert.equal(left.state.trips.find(x=>x.id==='italia').ownerId,'ana');
});
test('group lists the owner and offers role actions by viewer role',()=>{
 const owner=screen(createSimulation(),'group');
 assert.match(owner,/class="role-badge owner">Titular</);assert.match(owner,/class="role-badge">Admin</);assert.match(owner,/Participante/);
 assert.equal((owner.match(/data-action="view" data-value="member-manage"/g)||[]).length,3);
 assert.match(owner,/Salir del viaje/);
 const admin=screen(asAdmin(),'group');
 assert.equal((admin.match(/data-value="member-manage"/g)||[]).length,2);assert.match(admin,/Ana[\s\S]*Titular/);assert.match(admin,/Salir del viaje/);
 const participant=screen(asParticipant(),'group');
 assert.ok(!participant.includes('member-manage'));assert.ok(!participant.includes('Expulsar'));assert.match(participant,/Salir del viaje/);
});
test('group leave entry depends on being the owner',()=>{
 assert.match(screen(createSimulation(),'group'),/data-value="leave-owner"/);
 assert.match(screen(asAdmin(),'group'),/data-value="leave-trip"/);
});
test('member management offers only the actions allowed for the target',()=>{
 const owner=screen(createSimulation(),'member-manage',{memberId:'juli'});
 assert.match(owner,/Hacer admin/);assert.match(owner,/Expulsar/);assert.match(owner,/Transferir titularidad/);assert.ok(!owner.includes('Quitar admin'));
 const ownerOnAdmin=screen(createSimulation(),'member-manage',{memberId:'ana'});
 assert.match(ownerOnAdmin,/Quitar admin/);assert.match(ownerOnAdmin,/Expulsar admin/);assert.ok(!ownerOnAdmin.includes('Hacer admin'));
 const admin=asAdmin();member(admin,'martin').role='participant';
 const onParticipant=screen(admin,'member-manage',{memberId:'juli'});
 assert.match(onParticipant,/Expulsar/);assert.ok(!onParticipant.includes('Hacer admin'));assert.ok(!onParticipant.includes('Transferir'));
 const onAdmin=screen(admin,'member-manage',{memberId:'ana'});
 assert.ok(!onAdmin.includes('data-action="view" data-value="remove-member"'));assert.match(onAdmin,/titular/);
 assert.match(screen(asParticipant(),'member-manage',{memberId:'juli'}),/solo/i);
});
test('role change and expulsion ask for confirmation naming the person',()=>{
 const make=screen(createSimulation(),'role-change',{memberId:'juli'});
 assert.match(make,/¿Hacer admin a Juli\?/);assert.match(make,/data-action="set-role" data-value="juli" data-record="admin"/);
 const remove=screen(createSimulation(),'role-change',{memberId:'ana'});
 assert.match(remove,/¿Quitar admin a Ana\?/);assert.match(remove,/data-action="set-role" data-value="ana" data-record="participant"/);
 assert.match(screen(createSimulation(),'remove-member',{memberId:'ana'}),/¿Expulsar a Ana\?/);
 assert.match(screen(asAdmin(),'role-change',{memberId:'juli'}),/titular/);
});
test('transfer requires an explicit confirmation and explains the previous owner stays admin',()=>{
 const html=screen(createSimulation(),'transfer-owner',{memberId:'martin'});
 assert.match(html,/id="transfer-owner-design"/);assert.match(html,/<option value="" selected>Elegí una persona<\/option>/);assert.ok(!/<option value="[a-z]+" selected>/.test(html));assert.ok(!html.includes('<option value="nico"'));
 assert.match(html,/type="checkbox" name="confirmTransfer"/);assert.ok(!/<input type="checkbox" [^>]*required/.test(html));assert.match(html,/<form id="transfer-owner-design" class="v1-form" novalidate>/);assert.match(html,/Entiendo que <span data-owner-name>la persona elegida<\/span> pasa a ser titular/);assert.match(html,/id="transfer-owner-design-error" role="alert" hidden/);assert.match(html,/seguís como admin/i);
 assert.match(screen(asAdmin(),'transfer-owner'),/solo el titular/i);
});
test('the owner who tries to leave chooses between transferring and deleting',()=>{
 const html=screen(createSimulation(),'leave-owner');
 assert.match(html,/Sos el titular/);assert.match(html,/data-value="transfer-owner" data-record="leave"/);assert.match(html,/data-value="delete-trip"/);
 assert.ok(!html.includes('data-action="leave-membership"'));
 const solo=createSimulation();currentTrip(solo).members=currentTrip(solo).members.filter(m=>m.id==='nico');
 const only=screen(solo,'leave-owner');assert.match(only,/data-value="delete-trip"/);assert.ok(!only.includes('data-value="transfer-owner"'));
 assert.match(screen(createSimulation(),'leave-trip'),/Sos el titular/);
 assert.match(screen(asAdmin(),'leave-owner'),/solo para el titular/i);
});
test('leaving confirmation explains what stays and what is removed',()=>{
 const html=screen(asParticipant(),'leave-trip');
 assert.match(html,/¿Salir de Italia, sin apuro\?/);assert.match(html,/ex integrante/);assert.match(html,/todavía no empezaron/);assert.match(html,/data-action="leave-membership"/);
});
test('delete trip and settings text name the owner as the only one who can delete',()=>{
 assert.match(screen(asAdmin(),'delete-trip'),/solo el titular/i);assert.ok(!screen(asAdmin(),'delete-trip').includes('data-action="delete-trip"'));
 assert.match(screen(createSimulation(),'delete-trip'),/data-action="delete-trip"/);
 assert.ok(!screen(asAdmin(),'trip-settings').includes('Eliminar viaje'));assert.match(screen(createSimulation(),'trip-settings'),/Eliminar viaje/);
});
test('new screens are reachable, listed once and never mention voting',()=>{
 for(const view of newViews){assert.ok(views.includes(view),view);assert.equal(catalog.filter(x=>x.id===view).length,1);assert.equal(transition(createState(),{type:'view',value:view}).view,view);}
 for(const view of [...newViews,'group','delete-trip']){const html=screen(createSimulation(),view);assert.ok(html.length>150,view);assert.ok(!/vot(o|ar|aci)/i.test(html),view);assert.ok(!html.includes('undefined'),view);}
});
test('stored trips without an owner fall back to their first admin',()=>{
 const s=createSimulation();const stored=JSON.parse(encodeTravelState(s));for(const t of stored.trips)delete t.ownerId;
 const restored=restoreTravelState(createSimulation(),JSON.stringify(stored));
 assert.equal(tripOwnerId(currentTrip(restored)),'nico');assert.equal(viewerRole(restored),'owner');
});

const kind=(html,view)=>(html.match(new RegExp('<button[^>]*data-value="'+view+'"[^>]*>','g'))||[])[0]||'';
test('transfer form validates by itself: person first, then confirmation, with the field to focus',()=>{
 const cands=currentTrip(createSimulation()).members.filter(m=>m.id!=='nico');
 assert.deepEqual(transferFormError({newOwner:'',confirmTransfer:'on'},cands).field,'newOwner');
 assert.deepEqual(transferFormError({newOwner:'nico',confirmTransfer:'on'},cands).field,'newOwner');
 assert.equal(transferFormError({newOwner:'martin'},cands).field,'confirmTransfer');
 assert.equal(transferFormError({newOwner:'martin',confirmTransfer:'on'},cands),null);
});
test('Eliminar el viaje is never a primary or filled button at the leave entries, including the sole owner',()=>{
 const solo=createSimulation();currentTrip(solo).members=currentTrip(solo).members.filter(m=>m.id==='nico');
 for(const [s,view] of [[createSimulation(),'leave-owner'],[createSimulation(),'leave-trip'],[solo,'leave-owner']]){
  const b=kind(screen(s,view),'delete-trip');assert.match(b,/class="danger-link"/,view);assert.ok(!/primary|danger-button/.test(b),view);
 }
 assert.match(kind(screen(createSimulation(),'leave-owner'),'transfer-owner'),/class="primary"/);
 assert.match(screen(createSimulation(),'delete-trip'),/class="danger-button"/);
});
test('owner note sits before the main action and the transfer ends with a direct leave CTA',()=>{
 const html=screen(createSimulation(),'leave-owner');
 assert.ok(html.indexOf('Transferir no te saca del viaje')<html.indexOf('data-value="transfer-owner"'));
 const after=screen(asAdmin(),'leave-trip',{afterTransfer:true});
 assert.match(after,/Titularidad transferida/);assert.match(after,/>Ahora salir del viaje</);assert.match(after,/data-action="leave-membership"/);
 const plain=screen(asAdmin(),'leave-trip');assert.ok(!plain.includes('Ahora salir del viaje'));assert.match(plain,/>Salir del viaje</);
});
test('delete trip says it cannot be undone and keeps the invitations sentence out of the accounts card',()=>{
 const html=screen(createSimulation(),'delete-trip');
 assert.match(html,/Esta acción no se puede deshacer/);
 const card=html.match(/<h4>No elimina cuentas ni otros viajes<\/h4><p>([^<]*)<\/p>/)[1];assert.ok(!card.includes('invitaciones'));
 assert.match(html,/<h4>Invitaciones<\/h4><p>Las invitaciones a este viaje dejan de funcionar/);
 assert.ok(!/type="checkbox"/.test(html));
});
test('group buttons name the person, and the member count is singular for one',()=>{
 const html=screen(createSimulation(),'group');
 assert.match(html,/aria-label="Gestionar a Ana"/);assert.match(html,/aria-label="Gestionar a Juli"/);assert.equal((html.match(/aria-label="Gestionar a /g)||[]).length,3);
 assert.match(html,/4 integrantes · /);
 const solo=createSimulation();currentTrip(solo).members=currentTrip(solo).members.filter(m=>m.id==='nico');
 const one=screen(solo,'group');assert.match(one,/1 integrante · /);assert.ok(!one.includes('1 integrantes'));
});
test('the catalog views rewritten by T117 never mention voting',()=>{
 for(const view of ['trip-settings','delete-trip','group','remove-member',...newViews])for(const role of ['admin','participant']){const html=renderV1({...createState(),view,role});assert.ok(html.length>100,view);assert.ok(!/vot(o|ar|aci)/i.test(html),view+' '+role);}
});
