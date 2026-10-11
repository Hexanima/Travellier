import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,currentTrip,command,localInstant} from './public/simulation.mjs';
import {createState} from './public/state.mjs';
import {renderScreen} from './public/playable-screens.mjs';
const render=(sim,view,extra={})=>renderScreen({...createState(),sim,view,date:'2026-10-11',destinationId:'roma',...extra});
const shareIds=html=>[...html.matchAll(/name="shareMember\d+" value="([^"]+)"/g)].map(x=>x[1]);
const transit=()=>{const sim=createSimulation(),tr=currentTrip(sim).transports[0];tr.departureAt=localInstant('2026-10-10','20:00');tr.arrivalAt=localInstant('2026-10-12','09:45');return {sim,tr};};

test('a register-mode expense with empty shares can be completed after enabling balance',()=>{
 let sim=command(createSimulation(),{type:'publish-post',data:{description:'Entradas al museo',photos:[],totalAmount:100,currency:'EUR'}}).state;
 const trip=currentTrip(sim),post=trip.posts.at(-1);assert.deepEqual(post.expense.shares,[]);trip.expenseMode='balance';
 const before=structuredClone(sim),html=render(sim,'expense-edit',{draft:post.expense});
 assert.deepEqual(shareIds(html),trip.members.map(m=>m.id));assert.deepEqual(sim,before);
 assert.equal((html.match(/value="remainder" selected/g)||[]).length,trip.members.length);
});
test('already agreed shares and payments are not replaced when editing in balance',()=>{
 const sim=createSimulation(),trip=currentTrip(sim);trip.expenseMode='balance';
 const draft={totalAmount:100,currency:'EUR',payments:[{memberId:'ana',unit:'amount',value:100}],shares:[{memberId:'nico',unit:'amount',value:35},{memberId:'ana',unit:'remainder'}]},before=structuredClone(draft);
 assert.deepEqual(shareIds(render(sim,'expense-edit',{draft})),['nico','ana']);assert.deepEqual(draft,before);
});
test('register mode continues to hide balance controls without changing saved data',()=>{
 const sim=createSimulation(),draft={totalAmount:100,currency:'EUR',payments:[],shares:[]},before=structuredClone(draft);
 assert.deepEqual(shareIds(render(sim,'expense-edit',{draft})),[]);assert.deepEqual(draft,before);
});
test('notification rows identify distinct notices even when their routes match',()=>{
 const sim=createSimulation();sim.notifications=[{id:'roma-join',title:'Alguien se sumó',text:'Roma',tripId:'roma-public',view:'group',record:''},{id:'cordoba-join',title:'Alguien se sumó',text:'Córdoba',tripId:'sierras-public',view:'group',record:''}];
 const html=render(sim,'notifications');assert.match(html,/data-action="notification" data-value="roma-join"/);assert.match(html,/data-action="notification" data-value="cordoba-join"/);
});
test('a middle travel day shows the ongoing transport rather than an empty day',()=>{
 const {sim}=transit(),html=render(sim,'itinerary');assert.match(html,/transport-card/);assert.match(html,/En tránsito/);assert.match(html,/Ezeiza → Fiumicino/);assert.doesNotMatch(html,/Un día por armar/);
 assert.match(html,/10(?: de)? oct/);assert.match(html,/12(?: de)? oct/);assert.match(html,/20:00/);assert.match(html,/09:45/);
});
test('ongoing travel preserves departure and arrival labels on their respective days',()=>{
 const {sim}=transit();assert.match(render(sim,'itinerary',{date:'2026-10-10'}),/card-caption">Salida</);assert.match(render(sim,'itinerary',{date:'2026-10-12'}),/card-caption">Llegada</);
 assert.doesNotMatch(render(sim,'itinerary',{date:'2026-10-13'}),/Ezeiza → Fiumicino/);
});
test('a same-day transport exposes both departure and arrival times',()=>{
 const sim=createSimulation(),tr=currentTrip(sim).transports[0];tr.departureAt=localInstant('2026-10-12','08:00');
 const html=render(sim,'itinerary',{date:'2026-10-12'});assert.match(html,/Salida y llegada/);assert.match(html,/08:00/);assert.match(html,/09:45/);
});
test('shared transport segments still appear only once on a middle travel day',()=>{
 const sim=createSimulation(),trip=currentTrip(sim),segments=trip.transports.filter(tr=>tr.departurePlace==='Roma'&&tr.arrivalPlace==='Florencia');
 for(const tr of segments){tr.departureAt=localInstant('2026-10-16','18:00');tr.arrivalAt=localInstant('2026-10-18','09:00');}
 const html=render(sim,'itinerary',{date:'2026-10-17'});assert.equal((html.match(/class="event-card transport-card"/g)||[]).length,1);assert.match(html,/En tránsito/);
});
