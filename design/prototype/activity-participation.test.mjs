import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,currentTrip,command,localInstant} from './public/simulation.mjs';
import {renderScreen,calendarFile} from './public/playable-screens.mjs';
import {createState} from './public/state.mjs';
import {catalog} from './public/catalog.mjs';
const at=time=>localInstant('2026-10-13',time);
const setup=()=>{const s=createSimulation();currentTrip(s).activities=[
 {id:'a',title:'Museo',destinationId:'roma',scheduledAt:at('10:00'),durationMinutes:120,participations:{nico:'going',ana:'going'},decisionRequired:{}},
 {id:'b',title:'Almuerzo',destinationId:'roma',scheduledAt:at('12:00'),durationMinutes:120,participations:{nico:'going',ana:'going'},decisionRequired:{}},
 {id:'c',title:'Paseo',destinationId:'roma',scheduledAt:at('11:00'),durationMinutes:120,participations:{juli:'going'},decisionRequired:{}}
];return s;};
const activity=(s,id)=>currentTrip(s).activities.find(a=>a.id===id);
const data=(overrides={})=>({name:'Plan',destination:'roma',date:'2026-10-13',time:'11:00',durationHours:'2',durationMinutesPart:'0',...overrides});
test('active design has no activity modes, approval states or email gate',()=>{
 const s=createSimulation();assert.ok(!('votingEnabled' in currentTrip(s)));assert.ok(currentTrip(s).activities.every(a=>!('status' in a)&&!('votes' in a)));
 assert.ok(!catalog.some(x=>['vote','proposed','vote-disabled','verify-email'].includes(x.id)));
 const html=renderScreen({...createState(),sim:s,view:'register'});assert.ok(!/name="name"|confirm.*email/i.test(html));
});
test('going requires an explicit choice listing every incompatible personal plan',()=>{
 const s=setup(),r=command(s,{type:'participation',id:'c',value:'going'});
 assert.deepEqual(r.state,s);assert.deepEqual(r.confirmation.conflicts.map(x=>x.id),['a','b']);
 const accepted=command(s,{type:'participation',id:'c',value:'going',confirmedConflicts:r.confirmation.conflicts});
 assert.equal(activity(accepted.state,'a').participations.nico,'not_going');assert.equal(activity(accepted.state,'b').participations.nico,'not_going');assert.equal(activity(accepted.state,'c').participations.nico,'going');assert.equal(activity(accepted.state,'a').participations.ana,'going');
});
test('creation and spontaneous memory defer all writes until conflict confirmation',()=>{
 for(const action of [{type:'save-activity',data:data()},{type:'publish-post',data:{description:'Un paseo',photos:[],spontaneous:data()}}]){
  const s=setup(),r=command(s,action);assert.deepEqual(r.state,s);assert.equal(r.confirmation.conflicts.length,2);
  const saved=command(s,{...action,confirmedConflicts:r.confirmation.conflicts});assert.ok(!saved.error&&!saved.confirmation);assert.equal(currentTrip(saved.state).activities.at(-1).participations.nico,'going');assert.equal(currentTrip(saved.state).activities.at(-1).durationMinutes,120);
 }
});
test('editing a schedule detaches only affected going members to pending with a persistent reason',()=>{
 const s=setup();activity(s,'c').participations={nico:'going',ana:'not_going',juli:'going'};activity(s,'c').scheduledAt=at('14:00');
 const r=command(s,{type:'save-activity',id:'c',data:data()},()=> '2026-10-11T12:00:00.000Z');const a=activity(r.state,'c');
 assert.equal(a.participations.nico,'pending');assert.equal(a.participations.ana,'not_going');assert.equal(a.participations.juli,'going');assert.equal(activity(r.state,'a').participations.nico,'going');
 assert.deepEqual(a.decisionRequired.nico,{reason:'schedule_conflict',changedFields:['scheduledAt'],changedAt:'2026-10-11T12:00:00.000Z'});
 assert.ok(r.state.notifications.some(n=>n.userId==='nico'&&n.record==='c'&&/Museo/.test(n.text)));
 const html=renderScreen({...createState(),sim:r.state,view:'participation',activityId:'c'});assert.match(html,/Modificado/);assert.equal((html.match(/aria-pressed="true"/g)||[]).length,0);
 const blocked=command(r.state,{type:'participation',id:'c',value:'going'});assert.deepEqual(blocked.state,r.state);assert.ok(blocked.confirmation);
 const answered=command(r.state,{type:'participation',id:'c',value:'not_going'});assert.equal(activity(answered.state,'c').decisionRequired.nico,undefined);
 const content=command(r.state,{type:'save-activity',id:'c',data:data({name:'Otro título'})});assert.deepEqual(activity(content.state,'c').decisionRequired.nico,a.decisionRequired.nico);
});
test('optional durations, contiguous intervals and destination end bounds are respected',()=>{
 const s=setup();let r=command(s,{type:'save-activity',data:data({time:'14:00'})});assert.ok(!r.error&&!r.confirmation);
 r=command(s,{type:'save-activity',data:data({date:'2026-10-16',time:'17:30',durationHours:'1'})});assert.match(r.error,/llegada|salida|destino/);assert.deepEqual(r.state,s);
 r=command(s,{type:'save-activity',data:data({durationHours:'',durationMinutesPart:'',time:'15:00'})});assert.equal(currentTrip(r.state).activities.at(-1).durationMinutes,null);
 r=command(s,{type:'save-activity',data:data({durationHours:'0',durationMinutesPart:'0'})});assert.ok(r.error);
 const ics=calendarFile(currentTrip(s));assert.ok(ics.includes('UID:c@travellier'));assert.ok(ics.includes('DTEND:'+new Date(at('13:00')).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')));
});
test('a changed conflict invalidates an earlier confirmation',()=>{
 const s=setup(),action={type:'participation',id:'c',value:'going'},r=command(s,action);activity(s,'a').scheduledAt=at('09:30');
 const stale=command(s,{...action,confirmedConflicts:r.confirmation.conflicts});assert.ok(stale.confirmation);assert.deepEqual(stale.state,s);
});
test('editing duration catches all affected members and a content edit keeps existing pending flags',()=>{
 const s=setup();activity(s,'a').durationMinutes=30;
 const r=command(s,{type:'save-activity',id:'a',data:data({time:'10:00',durationHours:'3'})});
 for(const user of ['nico','ana']){assert.equal(activity(r.state,'a').participations[user],'pending');assert.deepEqual(activity(r.state,'a').decisionRequired[user].changedFields,['durationMinutes']);}
 assert.equal(activity(r.state,'b').participations.ana,'going');
 const html=renderScreen({...createState(),sim:r.state,view:'itinerary',date:'2026-10-13',destinationId:'roma'});assert.match(html,/Modificado/);
});
test('changing transport validates activity end and keeps the prior travel data on error',()=>{
 const s=setup(),r=command(s,{type:'save-transport',data:{destination:'roma',direction:'return',type:'car',departurePlace:'Roma',arrivalPlace:'Florencia',departuredate:'2026-10-13',departuretime:'13:30',arrivaldate:'2026-10-13',arrivaltime:'15:00'}});
 assert.ok(r.error);assert.deepEqual(r.state,s);
});
test('the calendar preview includes all plans, not approval states',()=>{
 const s=setup(),html=renderScreen({...createState(),sim:s,view:'calendar'});assert.match(html,/Museo/);assert.match(html,/Almuerzo/);assert.match(html,/Paseo/);assert.doesNotMatch(html,/confirmada|votación/i);
});
test('loading activity forms disable their own save action without a new screen',()=>{
 const html=renderScreen({...createState(),sim:createSimulation(),view:'add',scenario:'loading'});assert.match(html,/type="submit"[^>]*disabled/);assert.match(html,/aria-busy="true"/);
});
test('unknown duration only reserves an equal start, without inferring an interval',()=>{
 const s=setup();activity(s,'a').durationMinutes=null;activity(s,'b').participations.nico='not_going';
 const later=command(s,{type:'participation',id:'c',value:'going'});assert.ok(!later.confirmation);
 activity(s,'c').scheduledAt=at('10:00');assert.ok(command(s,{type:'participation',id:'c',value:'going'}).confirmation);
});
test('failed decisions and unrelated members notifications do not clear the personal indicator',()=>{
 const s=setup(),a=activity(s,'c');a.participations.nico='pending';a.decisionRequired.nico={reason:'schedule_conflict',changedAt:'2026-10-11T12:00:00.000Z',changedFields:['scheduledAt']};
 const r=command(s,{type:'participation',id:'c',value:'invalid'});assert.ok(r.error);assert.deepEqual(r.state,s);
 s.notifications.push({id:'private',userId:'ana',title:'Solo para Ana',text:'Privado',view:'participation',record:'c'});assert.doesNotMatch(renderScreen({...createState(),sim:s,view:'notifications'}),/Solo para Ana/);
});
