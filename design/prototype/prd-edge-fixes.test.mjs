import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,currentTrip,command,localDate,localTime,localInstant} from './public/simulation.mjs';
import {createState} from './public/state.mjs';
import {renderScreen} from './public/playable-screens.mjs';
const render=(sim,view,extra={})=>renderScreen({...createState(),sim,view,destinationId:'roma',transportDirection:'outbound',activityId:'paseo',...extra});
const inputs=html=>Object.fromEntries([...html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)].map(x=>[x[1],x[2]]));
const exact=at=>{const d=new Date(at);return localTime(at)+':'+String(d.getSeconds()).padStart(2,'0')+'.'+String(d.getMilliseconds()).padStart(3,'0');};
const notices=(before,after)=>after.notifications.filter(n=>!before.notifications.some(x=>x.id===n.id));
const urban=()=>{const sim=createSimulation(),tr=currentTrip(sim).transports[0];Object.assign(tr,{type:'bus_local',departureAt:localInstant('2026-10-10','08:00'),details:{steps:[{line:'L1',fromStop:'Centro',toStop:'Aeropuerto',estimatedAt:new Date(Date.parse(localInstant('2026-10-11','10:15'))+30123).toISOString()}]}});return {sim,tr};};
const transportData=tr=>({destination:tr.destinationId,direction:tr.direction,transportType:tr.type,departurePlace:tr.departurePlace,arrivalPlace:tr.arrivalPlace,departuredate:localDate(tr.departureAt),departuretime:exact(tr.departureAt),arrivaldate:localDate(tr.arrivalAt),arrivaltime:exact(tr.arrivalAt),cost:''});
test('content-only activity edit preserves precise instant and compatible participation',()=>{
 const sim=createSimulation(),t=currentTrip(sim),a=t.activities[0];a.scheduledAt=new Date(Date.parse(a.scheduledAt)+30123).toISOString();
 t.activities.push({id:'precision-other',title:'Otro plan',destinationId:'roma',scheduledAt:new Date(Date.parse(localInstant('2026-10-12','14:00'))+15123).toISOString(),durationMinutes:60,participations:{nico:'going'},decisionRequired:{}});
 const data={...inputs(render(sim,'activity-edit')),description:'Cambió solo el texto',destination:'roma'};
 const result=command(sim,{type:'save-activity',id:a.id,data});assert.equal(result.error,undefined);
 const edited=currentTrip(result.state).activities[0];assert.equal(edited.scheduledAt,a.scheduledAt);assert.equal(edited.participations.nico,'going');assert.deepEqual(edited.decisionRequired,{});assert.doesNotMatch(notices(sim,result.state)[0].text,/Cambió el horario/);
});
test('precise activity inputs allow an explicit change without rounding the new instant',()=>{
 const sim=createSimulation(),a=currentTrip(sim).activities[0];a.scheduledAt=new Date(Date.parse(a.scheduledAt)+30123).toISOString();
 assert.equal(inputs(render(sim,'activity-edit')).time,exact(a.scheduledAt));
 const data={...inputs(render(sim,'activity-edit')),destination:'roma',time:'15:00:45.456'};
 const result=command(sim,{type:'save-activity',id:a.id,data});assert.equal(result.error,undefined);assert.equal(currentTrip(result.state).activities[0].scheduledAt,localInstant(data.date,data.time));
});
test('line-only urban edit preserves confirmed date and millisecond precision',()=>{
 const {sim,tr}=urban(),data={...transportData(tr),...inputs(render(sim,'transport-edit',{steps:1})),line0:'L2'};
 const result=command(sim,{type:'save-transport',data});assert.equal(result.error,undefined);assert.equal(currentTrip(result.state).transports.find(x=>x.id===tr.id).details.steps[0].estimatedAt,tr.details.steps[0].estimatedAt);
});
test('confirmed urban steps expose the actual local date, not just a clock',()=>{
 const {sim,tr}=urban(),values=inputs(render(sim,'transport-edit',{steps:1}));assert.equal(values.stepDate0,localDate(tr.details.steps[0].estimatedAt));assert.equal(values.stepTime0,exact(tr.details.steps[0].estimatedAt));
});
test('transport edits preserve precise departure and arrival when changing a place',()=>{
 const sim=createSimulation(),tr=currentTrip(sim).transports[0];tr.departureAt=new Date(Date.parse(tr.departureAt)+30123).toISOString();tr.arrivalAt=new Date(Date.parse(tr.arrivalAt)+15456).toISOString();
 const result=command(sim,{type:'save-transport',data:{...inputs(render(sim,'transport-edit')),destination:'roma',direction:'outbound',transportType:'flight',departurePlace:'Nueva terminal'}});assert.equal(result.error,undefined);const updated=currentTrip(result.state).transports.find(x=>x.id===tr.id);assert.equal(updated.departureAt,tr.departureAt);assert.equal(updated.arrivalAt,tr.arrivalAt);
});
test('invalid confirmed urban chronology rejects the full edit without moving any step',()=>{
 const {sim,tr}=urban();tr.details.steps.push({...tr.details.steps[0],line:'L3',estimatedAt:localInstant('2026-10-11','11:00')});
 const data={...transportData(tr),line0:'L1',fromStop0:'Centro',toStop0:'Aeropuerto',stepDate0:'2026-10-11',stepTime0:'12:00',line1:'L3',fromStop1:'Aeropuerto',toStop1:'Puerto',stepDate1:'2026-10-11',stepTime1:'11:00'};
 const result=command(sim,{type:'save-transport',data});assert.ok(result.error);assert.deepEqual(result.state,sim);
});
test('historical transport reads the clock and automatically requires review before editing',()=>{
 const {sim,tr}=urban();tr.details.steps[0]={line:'L1',fromStop:'Centro',toStop:'Aeropuerto',estimatedTime:'10:15'};
 const detail=render(sim,'transport-detail',{transportId:tr.id});assert.match(detail,/10:15/);assert.doesNotMatch(detail,/Invalid Date/);
 const edit=render(sim,'transport-edit');assert.match(edit,/id="history-design"/);assert.match(edit,/name="historyReviewed"/);assert.equal(inputs(edit).stepDate0,'');assert.equal(inputs(edit).stepTime0,'10:15');
});
test('historical transport cannot save without explicit review',()=>{
 const {sim,tr}=urban();tr.details.steps[0]={line:'L1',fromStop:'Centro',toStop:'Aeropuerto',estimatedTime:'10:15'};
 const result=command(sim,{type:'save-transport',data:{...transportData(tr),line0:'L1',fromStop0:'Centro',toStop0:'Aeropuerto',stepDate0:'2026-10-11',stepTime0:'10:15'}});assert.ok(result.error);assert.deepEqual(result.state,sim);
});
test('reviewed historical transport converts only on successful save',()=>{
 const {sim,tr}=urban();tr.details.steps[0]={line:'L1',fromStop:'Centro',toStop:'Aeropuerto',estimatedTime:'10:15'};
 const data={...transportData(tr),historyReviewed:'on',line0:'L1',fromStop0:'Centro',toStop0:'Aeropuerto',stepDate0:'2026-10-11',stepTime0:'10:15:30.123'};
 const result=command(sim,{type:'save-transport',data});assert.equal(result.error,undefined);const step=currentTrip(result.state).transports.find(x=>x.id===tr.id).details.steps[0];assert.equal(step.estimatedAt,localInstant(data.stepDate0,data.stepTime0));assert.equal(step.estimatedTime,undefined);
 const failed=command(sim,{type:'save-transport',data:{...data,stepDate0:'2026-10-13'}});assert.ok(failed.error);assert.deepEqual(failed.state,sim);
});
test('joining notifies the correct trip once, without duplicate notices on rejoin',()=>{
 const sim=createSimulation(),result=command(sim,{type:'join',id:'roma-public'}),added=notices(sim,result.state);assert.equal(added.length,1);assert.equal(added[0].tripId,'roma-public');assert.equal(added[0].view,'group');assert.match(added[0].text,/Nico/);
 const again=command(result.state,{type:'join',id:'roma-public'});assert.equal(notices(result.state,again.state).length,0);
});
test('expulsion notifies only the affected member and preserves existing identity',()=>{
 const sim=createSimulation(),result=command(sim,{type:'remove-member',id:'ana'}),added=notices(sim,result.state);assert.equal(added.length,1);assert.equal(added[0].userId,'ana');assert.equal(added[0].view,'trip-unavailable');assert.equal(result.state.people.ana.name,'Ana');assert.equal(notices(sim,command(sim,{type:'remove-member',id:'missing'}).state).length,0);
});
test('spontaneous creation notifies the new plan and the post only after successful atomic publication',()=>{
 const sim=createSimulation(),data={description:'Una cena que surgió',photos:[],spontaneous:{name:'Cena improvisada',destination:'roma',date:'2026-10-14',time:'21:00'}};
 const result=command(sim,{type:'publish-post',data});assert.equal(result.error,undefined);const added=notices(sim,result.state);assert.equal(added.length,2);assert.ok(added.some(n=>n.title==='Nuevo plan'&&n.record===currentTrip(result.state).activities.at(-1).id));assert.ok(added.some(n=>n.title==='Nuevo recuerdo'));
 const failed=command(sim,{type:'publish-post',data:{...data,spontaneous:{...data.spontaneous,date:'2026-10-30'}}});assert.ok(failed.error);assert.equal(notices(sim,failed.state).length,0);
});
