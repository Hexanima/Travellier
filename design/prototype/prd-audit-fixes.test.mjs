import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from './public/state.mjs';
import {createSimulation,currentTrip,command,localDate,localTime,localInstant} from './public/simulation.mjs';
import {renderScreen} from './public/playable-screens.mjs';
const screen=(sim,view,extra={})=>renderScreen({...createState(),sim,view,date:'2026-10-12',destinationId:'roma',activityId:'paseo',...extra});
const planData=a=>({name:a.title,description:a.description||'',mapsUrl:a.mapsUrl||'',place:a.place||'',destination:a.destinationId,date:localDate(a.scheduledAt),time:localTime(a.scheduledAt),durationMinutes:a.durationMinutes});
test('known activity duration is visible in itinerary, detail and calendar',()=>{
 const sim=createSimulation();for(const view of ['itinerary','participation','calendar'])assert.match(screen(sim,view),/15:00 – 16:30 · 1 h 30 min/,view);
});
test('overnight activity labels distinguish its end date',()=>{
 const sim=createSimulation(),a=currentTrip(sim).activities.find(a=>a.id==='paseo');a.scheduledAt=localInstant('2026-10-12','23:30');
 for(const view of ['itinerary','participation','calendar'])assert.match(screen(sim,view),/23:30 – 13 oct[^<]*01:00 · 1 h 30 min/,view);
});
test('unknown duration still has only a start without an invented end',()=>{
 const sim=createSimulation(),a=currentTrip(sim).activities.find(a=>a.id==='paseo');a.durationMinutes=null;
 const facts=screen(sim,'participation').match(/<section class="detail-facts">[\s\S]*?<\/section>/)[0];assert.match(facts,/15:00 · Hora local/);assert.doesNotMatch(facts,/ – | min| h /);
});
test('year-boundary activity labels identify both years',()=>{
 const sim=createSimulation(),a=currentTrip(sim).activities.find(a=>a.id==='paseo');a.scheduledAt=localInstant('2026-12-31','23:30');
 const facts=screen(sim,'participation').match(/<section class="detail-facts">[\s\S]*?<\/section>/)[0];assert.match(facts,/2026/);assert.match(facts,/2027/);assert.match(facts,/1 h 30 min/);
});
test('late activity memories and branching descendants do not project as independent publications',()=>{
 const sim=createSimulation(),t=currentTrip(sim),p={...t.posts[0],id:'late-root',title:'Una tarde en el museo',activityId:'museos',parentPostId:null,transportId:null,createdAt:localInstant('2026-10-16','12:00'),day:'2026-10-16'};
 const child={...p,id:'late-child',activityId:null,parentPostId:p.id,title:'Después del museo'};t.posts.push(p,child);
 const published=screen(sim,'itinerary',{date:'2026-10-16'}),activity=screen(sim,'itinerary',{date:'2026-10-13'});
 for(const id of [p.id,child.id]){assert.ok(!published.includes('data-record="'+id+'"'));assert.ok(activity.includes('data-record="'+id+'"'));assert.ok(screen(sim,'feed').includes('data-record="'+id+'"'));}
 const unlinked=command(sim,{type:'save-links',id:p.id,data:{}});assert.ok(screen(unlinked.state,'itinerary',{date:'2026-10-16'}).includes('data-record="'+p.id+'"'));
});
test('content and location edits notify without detaching or consuming pending markers',()=>{
 for(const [field,value]of [['name','Un paseo nuevo'],['description','Una descripción nueva'],['mapsUrl','https://maps.google.com/?q=Roma']]){
  const sim=createSimulation(),a=currentTrip(sim).activities.find(a=>a.id==='paseo');a.participations.martin='pending';a.decisionRequired.martin={reason:'schedule_conflict',changedFields:['scheduledAt'],changedAt:'2026-10-11T12:00:00.000Z'};
  const result=command(sim,{type:'save-activity',id:a.id,data:{...planData(a),[field]:value}});assert.equal(result.error,undefined);
  const notices=result.state.notifications.filter(n=>!sim.notifications.some(old=>old.id===n.id));assert.equal(notices.length,1,field);assert.match(notices[0].title,/actualizada/i);
  const edited=currentTrip(result.state).activities.find(x=>x.id===a.id);assert.deepEqual(edited.participations,a.participations);assert.deepEqual(edited.decisionRequired,a.decisionRequired);
 }
});
test('duration conflict notification identifies changed duration and full incompatible intervals',()=>{
 const sim=createSimulation(),t=currentTrip(sim),a=t.activities.find(x=>x.id==='paseo');a.scheduledAt=localInstant('2026-10-13','10:00');a.durationMinutes=30;a.participations={nico:'going',ana:'going'};
 t.activities.find(x=>x.id==='museos').participations={};t.activities.push({id:'other',title:'Almuerzo',destinationId:'roma',scheduledAt:localInstant('2026-10-13','12:00'),durationMinutes:120,participations:{nico:'going'},decisionRequired:{}});
 const result=command(sim,{type:'save-activity',id:a.id,data:{...planData(a),durationMinutes:180}}),notice=result.state.notifications.find(n=>n.userId==='nico'&&n.record===a.id);
 assert.match(notice.text,/Cambió la duración/);assert.match(notice.text,/10:00 – 13:00 · 3 h/);assert.match(notice.text,/Almuerzo[^.]*12:00 – 14:00 · 2 h/);
 assert.equal(currentTrip(result.state).activities.find(x=>x.id===a.id).participations.ana,'going');assert.ok(!result.state.notifications.some(n=>n.userId==='ana'&&n.record===a.id));
});
test('failed or unchanged edits generate no change notification',()=>{
 const sim=createSimulation(),a=currentTrip(sim).activities.find(x=>x.id==='paseo');
 const same=command(sim,{type:'save-activity',id:a.id,data:planData(a)});assert.deepEqual(same.state.notifications,sim.notifications);
 const failed=command(sim,{type:'save-activity',id:a.id,data:{...planData(a),date:'2026-10-16',time:'17:30',durationMinutes:120}});assert.ok(failed.error);assert.deepEqual(failed.state,sim);
});
