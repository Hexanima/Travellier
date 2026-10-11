import test from 'node:test';
import assert from 'node:assert/strict';
import {renderScreen} from './public/playable-screens.mjs';
import {createState} from './public/state.mjs';
import {createSimulation,currentTrip,postActivityId} from './public/simulation.mjs';
const screen=(extra={},sim=createSimulation())=>renderScreen({...createState(),sim,view:'participation',activityId:'paseo',...extra});
test('activity defaults to memories with thumbnails, text-only rows and both counts',()=>{
 const sim=createSimulation(),posts=currentTrip(sim).posts.filter(p=>postActivityId(currentTrip(sim),p)==='paseo');
 const html=screen({},sim);
 assert.match(html,new RegExp('Recuerdos · '+posts.length));
 assert.match(html,new RegExp('Fotos · '+posts.reduce((n,p)=>n+p.photos.length,0)));
 assert.match(html,/id="activity-tab-memories"[^>]*aria-selected="true"/);
 assert.match(html,/class="activity-memory-thumb"/);
 assert.match(html,/El pistacho ganó por lejos/);
 assert.doesNotMatch(html,/class="activity-photo-grid"/);
});
test('activity photo grid includes chain descendants but excludes other activity photos',()=>{
 const html=screen({activityTab:'photos'});
 assert.match(html,/class="activity-photo-grid"/);
 assert.match(html,/data-photo-post="gelato-photo-post"/);
 assert.doesNotMatch(html,/data-photo-post="museum-post"|assets\/castle.jpg/);
 assert.match(html,/data-activity="paseo"/);
 assert.doesNotMatch(html,/class="activity-memory-thumb"/);
 assert.match(html,/Compartir un recuerdo/);
});
test('activity without photos keeps an honest empty state and existing composer action',()=>{
 const sim=createSimulation();currentTrip(sim).posts.forEach(p=>p.photos=[]);
 const html=screen({activityTab:'photos'},sim);
 assert.match(html,/Fotos · 0/);assert.match(html,/Todavía no hay fotos de esta actividad/);
 assert.match(html,/Compartir un recuerdo/);assert.doesNotMatch(html,/data-action="open-photo"/);
});
test('viewer restricts navigation to activity photos and links the exact source photo',()=>{
 const sim=createSimulation(),t=currentTrip(sim),photos=t.posts.filter(p=>postActivityId(t,p)==='paseo').flatMap(p=>p.photos.map((id,index)=>({id,index,post:p})));
 const html=screen({view:'photo-viewer',galleryActivityId:'paseo',galleryPhoto:photos.length-1},sim);
 assert.match(html,new RegExp('data-value="'+photos.at(-1).post.id+'"'));
 assert.match(html,new RegExp('data-photo-index="'+photos.at(-1).index+'"'));
 assert.match(html,/Ver recuerdo/);assert.match(html,/data-action="gallery-next"[^>]*disabled/);
 assert.match(html,new RegExp(photos.length+' / '+photos.length));
});
test('trip gallery remains independent from a previously viewed activity',()=>{
 const html=screen({view:'gallery',galleryActivityId:'paseo'});
 assert.match(html,/Fotos del viaje/);assert.match(html,/Después de los museos/);
 assert.doesNotMatch(html,/data-activity="paseo"/);
});
