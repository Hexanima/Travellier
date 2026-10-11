import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,currentTrip,command,localDate,localInstant,localTime,tripDates,tripDays,postActivityId} from './public/simulation.mjs';
import {renderScreen,galleryPhotos} from './public/playable-screens.mjs';
import {createState} from './public/state.mjs';
const published=localInstant('2026-10-28','21:35'),clock=()=>published;
const publish=(s,data={},id)=>command(s,{type:'publish-post',id,data:{description:'Un recuerdo que me faltaba compartir',...data}},clock);
const screen=(sim,view,extra={})=>renderScreen({...createState(),sim,view,date:'2026-10-12',postId:'cafe-post',...extra});
const label=at=>new Date(at).toLocaleDateString('es-AR',{day:'numeric',month:'short',year:'numeric'});

test('publication uses the clock, ignores supplied dates and does not expand the itinerary',()=>{
 const s=createSimulation(),before=tripDates(currentTrip(s)),days=tripDays(currentTrip(s));
 const r=publish(s,{day:'2026-10-22',createdAt:localInstant('2026-10-22'),photos:['cafe']});
 assert.equal(r.error,undefined);const t=currentTrip(r.state),p=t.posts.at(-1);
 assert.equal(p.createdAt,published);assert.equal(p.day,localDate(published));
 assert.deepEqual(tripDates(t),before);assert.deepEqual(tripDays(t),days);
 assert.equal(galleryPhotos(t)[0].post.id,p.id);
 assert.equal([...screen(r.state,'feed').matchAll(/data-value="post" data-record="([^"]+)"/g)][0][1],p.id);
});
test('ordinary publication uses the device clock rather than the frozen travel scenario',()=>{
 const before=Date.now(),r=command(createSimulation(),{type:'publish-post',data:{description:'Café',day:'2026-10-12'}}),after=Date.now();
 const at=Date.parse(currentTrip(r.state).posts.at(-1).createdAt);
 assert.ok(at>=before&&at<=after);
});
test('editing preserves the original publication date even when draft and clock differ',()=>{
 const s=createSimulation(),p=currentTrip(s).posts.find(p=>p.id==='gelato-post'),original=p.createdAt;
 const r=publish(s,{day:'2026-10-22',createdAt:published,photos:p.photos},p.id);
 assert.equal(r.error,undefined);const updated=currentTrip(r.state).posts.find(x=>x.id===p.id);
 assert.equal(updated.createdAt,original);assert.equal(updated.day,localDate(original));
});
test('finished trips still accept memories without changing their dates',()=>{
 const s=createSimulation();s.tripId='mendoza';const before=tripDates(currentTrip(s)),r=publish(s);
 assert.equal(r.error,undefined);assert.equal(currentTrip(r.state).posts.at(-1).createdAt,published);
 assert.deepEqual(tripDates(currentTrip(r.state)),before);
});
test('a trip without transport dates can accept and compose memories',()=>{
 const s=createSimulation();currentTrip(s).transports=[];
 assert.match(screen(s,'compose'),/id="post-design"/);
 const r=publish(s);assert.equal(r.error,undefined);assert.deepEqual(tripDays(currentTrip(r.state)),[]);
});
test('a continuation has its own publication date and only inherits root activity context',()=>{
 const s=createSimulation(),r=publish(s,{parentPostId:'gelato-post'});
 assert.equal(r.error,undefined);const t=currentTrip(r.state),p=t.posts.at(-1);
 assert.equal(p.createdAt,published);assert.equal(p.day,localDate(published));
 assert.equal(p.activityId,null);assert.equal(postActivityId(t,p),'paseo');
 assert.match(screen(r.state,'itinerary'),/Un recuerdo que me faltaba compartir/);
});
test('a spontaneous activity keeps its scheduled date independently of publication',()=>{
 const s=createSimulation(),spontaneous={name:'Un café al sol',destination:'roma',date:'2026-10-12',time:'16:00'};
 const r=publish(s,{spontaneous});assert.equal(r.error,undefined);
 const t=currentTrip(r.state);assert.equal(t.activities.at(-1).scheduledAt,localInstant('2026-10-12','16:00'));
 assert.equal(t.posts.at(-1).createdAt,published);
 const failed=publish(s,{spontaneous:{...spontaneous,time:'08:00'}});
 assert.ok(failed.error);assert.deepEqual(failed.state,s);
});
for(const view of ['compose','post-edit'])test(view+' has no editable post date',()=>{
 const html=screen(createSimulation(),view);
 assert.doesNotMatch(html,/name="(?:day|date|time)"|Día del itinerario/);
 assert.match(html,/id="post-design"/);
 if(view==='post-edit')assert.match(html,/Publicado el/);
});
test('trip photos identify author/date and their viewer shows the full original timestamp',()=>{
 const s=createSimulation(),p=currentTrip(s).posts.find(p=>p.id==='gelato-post');
 const html=screen(s,'gallery');assert.match(html,/gallery-byline/);assert.match(html,/Nico · 12 oct/);
 const index=galleryPhotos(currentTrip(s)).findIndex(x=>x.post.id===p.id),viewer=screen(s,'photo-viewer',{galleryPhoto:index});
 assert.ok(viewer.includes(label(p.createdAt)));assert.ok(viewer.includes(localTime(p.createdAt)));
 assert.match(viewer,/Ver recuerdo/);
 const edit=screen(s,'post-edit',{postId:p.id});assert.ok(edit.includes(p.createdAt));assert.ok(edit.includes(label(p.createdAt)));
});
