import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from './public/state.mjs';
import {createSimulation,currentTrip,command,localInstant} from './public/simulation.mjs';
import {renderScreen,calendarFile} from './public/playable-screens.mjs';
const state=view=>({...createState(),sim:createSimulation(),view,date:'2026-10-12',destinationId:'roma',activityId:'museos',draft:{}});

test('spontaneous activity defaults to the device date and time, not the selected itinerary day',()=>{
 const html=renderScreen(state('spontaneous'),localInstant('2026-10-16','22:37'));
 assert.match(html,/name="date" type="date" value="2026-10-16"/);
 assert.match(html,/name="time" type="time" value="22:37"/);
});
test('spontaneous activity preserves the date and time entered in its draft',()=>{
 const html=renderScreen({...state('spontaneous'),draft:{spontaneousDraft:{date:'2026-10-13',time:'11:20'}}},localInstant('2026-10-16','22:37'));
 assert.match(html,/name="date" type="date" value="2026-10-13"/);
 assert.match(html,/name="time" type="time" value="11:20"/);
});
for(const value of ['going','not_going','pending'])test('participation remains available with own response '+value,()=>{
 const s=state('participation');currentTrip(s.sim).activities.find(a=>a.id==='museos').participations.nico=value;
 const html=renderScreen(s);assert.match(html,/data-action="participation" data-value="going"/);assert.match(html,/data-action="participation" data-value="not_going"/);assert.doesNotMatch(html,/data-action="vote"/);
});
test('answering participation changes only the current member',()=>{
 const sim=createSimulation(),before=currentTrip(sim).activities.find(a=>a.id==='museos');
 const result=command(sim,{type:'participation',id:before.id,value:'going'}),after=currentTrip(result.state).activities.find(a=>a.id===before.id);
 assert.ok(!('status' in after));assert.equal(after.participations.ana,before.participations.ana);assert.equal(after.participations.nico,'going');
});
test('calendar preview includes destination activity windows as well as all activities',()=>{
 const html=renderScreen(state('calendar'));
 assert.match(html,/Días de actividad/);
 assert.match(html,/Roma/);assert.match(html,/Florencia/);assert.match(html,/Venecia/);
 assert.match(html,/Actividades del viaje/);
 assert.match(html,/Museos Vaticanos/);
});
test('calendar exports each activity day with exact boundary hours and no transit-only day',()=>{
 const t=currentTrip(createSimulation()),file=calendarFile(t),events=file.split('BEGIN:VEVENT').slice(1);
 const arrival=t.transports.find(x=>x.id==='roma-outbound').arrivalAt.replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const departure=t.transports.find(x=>x.id==='roma-return').departureAt.replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const first=events.find(x=>x.includes('UID:day-roma-2026-10-12@travellier'));
 const last=events.find(x=>x.includes('UID:day-roma-2026-10-16@travellier'));
 assert.ok(first,'arrival day');assert.ok(last,'departure day');
 assert.ok(first.includes('DTSTART:'+arrival));assert.ok(last.includes('DTEND:'+departure));
 assert.ok(!events.some(x=>x.includes('UID:day-roma-2026-10-11@')));
 assert.equal(events.filter(x=>x.includes('UID:paseo@')).length,1);
 assert.ok(events.some(x=>x.includes('UID:museos@')));
 assert.ok(file.includes('\r\n'));assert.ok(file.endsWith('END:VCALENDAR\r\n'));
});
test('trip with no complete destination window exports no activity-day event',()=>{
 const t=currentTrip(createSimulation());t.transports=[];t.activities=[];
 assert.ok(!calendarFile(t).includes('BEGIN:VEVENT'));
});
test('transport regeneration does not treat post publication dates as itinerary dependencies',()=>{
 const sim=createSimulation(),t=currentTrip(sim);t.activities=[];
 t.posts=[{...t.posts[0],activityId:null,parentPostId:null,transportId:null,day:'2026-10-11',createdAt:localInstant('2026-10-11','20:00')}];
 const result=command(sim,{type:'save-transport',data:{destination:'roma',direction:'outbound',type:'flight',departurePlace:'Ezeiza',arrivalPlace:'Fiumicino',departuredate:'2026-10-12',departuretime:'06:00',arrivaldate:'2026-10-12',arrivaltime:'09:45'}});
 assert.equal(result.error,undefined);assert.deepEqual(currentTrip(result.state).posts,t.posts);
});
test('late expense and a chained child expense use the root activity date',()=>{
 const sim=createSimulation();
 const result=command(sim,{type:'publish-post',data:{description:'Cena tardía',parentPostId:'gelato-post',totalAmount:100,currency:'EUR',photos:[]}},()=>localInstant('2026-10-28','20:00'));
 const html=renderScreen({...createState(),sim:result.state,view:'itinerary',date:'2026-10-12',destinationId:'roma'});
 assert.match(html,/Gastos del día[\s\S]*126/);
 const list=renderScreen({...createState(),sim:result.state,view:'expenses'});
 assert.match(list,/12 oct · Cena tardía/);
 assert.match(list,/Publicado el 28 oct/);
});
