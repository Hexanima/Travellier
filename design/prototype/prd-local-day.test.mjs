import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const run=(zone,source,data)=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{cwd:fileURLToPath(new URL('./',import.meta.url)),env:{...process.env,TZ:zone},input:JSON.stringify(data),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
};
const fixture=(zone='America/Argentina/Buenos_Aires',extra={})=>run(zone,`
 import {readFileSync} from 'node:fs';
 import {createSimulation,command,currentTrip} from './public/simulation.mjs';
 const extra=JSON.parse(readFileSync(0,'utf8'));
 const result=command(createSimulation(),{type:'publish-post',data:{description:'Una noche para recordar',photos:['street'],...extra}},()=> '2026-10-13T01:00:00.123Z');
 console.log(JSON.stringify({sim:result.state,id:currentTrip(result.state).posts.at(-1).id}));
`,extra);
const project=(data,zone)=>run(zone,`
 import {readFileSync} from 'node:fs';
 import {renderScreen,galleryPhotos} from './public/playable-screens.mjs';
 import {createState} from './public/state.mjs';
 import {currentTrip,localDate,expenseDate} from './public/simulation.mjs';
 const {sim,id}=JSON.parse(readFileSync(0,'utf8')),before=JSON.stringify(sim),t=currentTrip(sim),p=t.posts.find(p=>p.id===id);
 const views=Object.fromEntries(['2026-10-12','2026-10-13'].map(date=>[date,renderScreen({...createState(),sim,view:'itinerary',date,destinationId:'roma'})]));
 console.log(JSON.stringify({localDay:localDate(p.createdAt),found:Object.fromEntries(Object.entries(views).map(([date,html])=>[date,html.includes('data-record="'+id+'"')])),unchanged:JSON.stringify(sim)===before,post:p,expenseDay:expenseDate(t,p),photoOrder:galleryPhotos(t).map(x=>x.post.id)}));
`,data);
test('Buenos Aires publication moves visually to its local day in Rome',()=>{
 const result=project(fixture(),'Europe/Rome');assert.equal(result.localDay,'2026-10-13');assert.equal(result.found['2026-10-13'],true);assert.equal(result.found['2026-10-12'],false);
});
test('Rome publication moves visually to its local day in Buenos Aires',()=>{
 const result=project(fixture('Europe/Rome'),'America/Argentina/Buenos_Aires');assert.equal(result.localDay,'2026-10-12');assert.equal(result.found['2026-10-12'],true);assert.equal(result.found['2026-10-13'],false);
});
test('publication projection does not require the legacy day field',()=>{
 const data=fixture();delete data.sim.trips[0].posts.find(p=>p.id===data.id).day;
 assert.equal(project(data,'Europe/Rome').found['2026-10-13'],true);
});
test('changing display zone preserves publication, relationships, photos, expenses and ordering',()=>{
 const data=fixture(undefined,{totalAmount:10,currency:'EUR'}),before=structuredClone(data.sim.trips[0].posts.at(-1));
 const argentina=project(data,'America/Argentina/Buenos_Aires'),rome=project(data,'Europe/Rome');
 for(const result of [argentina,rome]){assert.equal(result.unchanged,true);assert.deepEqual(result.post,before);}
 assert.deepEqual(argentina.photoOrder,rome.photoOrder);assert.equal(argentina.expenseDay,'2026-10-12');assert.equal(rome.expenseDay,'2026-10-13');
});
test('activity-linked descendants still project under their root activity rather than publication day',()=>{
 const data=fixture(undefined,{parentPostId:'gelato-post'}),result=project(data,'Europe/Rome');
 assert.equal(result.found['2026-10-12'],true);assert.equal(result.found['2026-10-13'],false);assert.equal(result.post.parentPostId,'gelato-post');assert.equal(result.post.activityId,null);
});
test('independent continuations use their own publication instant, not the parent or stored day',()=>{
 const data=fixture(),post=data.sim.trips[0].posts.at(-1);post.parentPostId='flight-post';data.sim.trips[0].posts.find(p=>p.id==='flight-post').transportId=null;
 const result=project(data,'Europe/Rome');assert.equal(result.found['2026-10-13'],true);assert.equal(result.found['2026-10-12'],false);
});
test('transport memories also follow publication local day without changing the transport link',()=>{
 const data=fixture(undefined,{transportId:'roma-outbound'}),post=data.sim.trips[0].posts.at(-1);post.createdAt='2026-10-12T01:00:00.123Z';post.day='2026-10-11';
 const result=project(data,'Europe/Rome');assert.equal(result.found['2026-10-12'],true);assert.equal(result.post.transportId,'roma-outbound');assert.equal(result.unchanged,true);
});
