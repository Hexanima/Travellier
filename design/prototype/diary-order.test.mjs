import test from 'node:test';
import assert from 'node:assert/strict';
import {renderScreen,galleryPhotos} from './public/playable-screens.mjs';
import {createState} from './public/state.mjs';
import {createSimulation,currentTrip,postActivityId} from './public/simulation.mjs';
const newest=posts=>posts.slice().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
const feedIds=sim=>Array.from(renderScreen({...createState(),sim,view:'feed'}).matchAll(/data-value="post" data-record="([^"]+)"/g),match=>match[1]);

test('diary posts sort by publication timestamp, not insertion order or itinerary day',()=>{
 const sim=createSimulation(),t=currentTrip(sim),before=structuredClone(t.posts);
 assert.deepEqual(feedIds(sim),newest(t.posts).map(p=>p.id));
 assert.deepEqual(t.posts,before,'rendering does not reorder stored records');
});
test('trip photos follow newest source posts and preserve each source photo index',()=>{
 const t=currentTrip(createSimulation()),before=structuredClone(t.posts);
 const expected=newest(t.posts).flatMap(p=>p.photos.map((id,index)=>({id,index,post:p})));
 assert.deepEqual(galleryPhotos(t),expected);
 assert.deepEqual(t.posts,before);
});
test('same-day times, month/year boundaries and timezone offsets order by the actual instant',()=>{
 const sim=createSimulation(),t=currentTrip(sim);t.posts=t.posts.slice(0,4);
 const dates=['2027-01-01T00:00:00Z','2026-12-31T23:30:00-03:00','2026-12-31T23:00:00Z','2027-01-01T02:00:00Z'];
 t.posts.forEach((p,i)=>{p.createdAt=dates[i];p.day='2026-10-12';});
 assert.deepEqual(feedIds(sim),[t.posts[1].id,t.posts[3].id,t.posts[0].id,t.posts[2].id]);
 assert.deepEqual(galleryPhotos(t).map(x=>x.post.id),newest(t.posts).flatMap(p=>p.photos.map(()=>p.id)));
});
test('equal publication timestamps retain stable post and photo order',()=>{
 const sim=createSimulation(),t=currentTrip(sim);t.posts=t.posts.slice(0,3);
 t.posts.forEach(p=>{p.createdAt='2026-10-16T12:00:00Z';});
 assert.deepEqual(feedIds(sim),t.posts.map(p=>p.id));
 assert.deepEqual(galleryPhotos(t).map(x=>[x.post.id,x.index]),t.posts.flatMap(p=>p.photos.map((_,i)=>[p.id,i])));
});
test('diary sorting does not change activity-specific gallery order or scope',()=>{
 const t=currentTrip(createSimulation()),expected=t.posts.filter(p=>postActivityId(t,p)==='paseo').flatMap(p=>p.photos.map((id,index)=>({id,index,post:p})));
 assert.deepEqual(galleryPhotos(t,'paseo'),expected);
});
