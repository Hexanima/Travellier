import test from 'node:test';
import assert from 'node:assert/strict';
import {renderScreen} from './public/playable-screens.mjs';
import {createState} from './public/state.mjs';
import {createSimulation,currentTrip} from './public/simulation.mjs';
const sim=createSimulation(),t=currentTrip(sim),root=t.posts[0];
// A -> B; B -> C and D. These test records isolate the rendering contract.
for(const [id,parentPostId,description,photos] of [['b',root.id,'El helado después del paseo',['street']],['c','b','Una vuelta por la plaza',[]],['d','b','Las luces del barrio',['lane']]])t.posts.push({...root,id,parentPostId,activityId:null,transportId:null,title:description,description,photos,comments:[],expense:null});
const screen=(postId=root.id,extra={})=>renderScreen({...createState(),view:'post',sim,postId,...extra});
test('detail defaults to direct children without mixing grandchildren or textual comments',()=>{
 const html=screen();
 assert.match(html,/role="tablist"/);assert.match(html,/Recuerdos · \d/);assert.match(html,/Comentarios · 2/);
 assert.match(html,/data-child-post="b"/);assert.doesNotMatch(html,/data-child-post="c"|data-child-post="d"/);
 assert.doesNotMatch(html,/La mejor forma de arrancar\.|class="comment-form"/);
 assert.match(html,/Continuar recuerdo/);
});
test('a branch shows a compact parent reference and only its own children',()=>{
 const html=screen('b');
 assert.match(html,/class="post-parent"[^>]*data-record="cafe-post"/);
 assert.match(html,/data-child-post="c"/);assert.match(html,/data-child-post="d"/);
 assert.match(html,/Una vuelta por la plaza/);assert.match(html,/Las luces del barrio/);
});
test('comments tab keeps comments, independent likes and a textual composer',()=>{
 const html=screen(root.id,{postTab:'comments',commentDraft:'Nos vemos & seguimos'});
 assert.match(html,/La mejor forma de arrancar\./);assert.match(html,/data-action="comment-like"/);
 assert.match(html,/class="comment-form"/);assert.match(html,/Nos vemos &amp; seguimos/);
 assert.doesNotMatch(html,/data-child-post=/);
});
test('text-only leaf retains continuation affordance and honest empty state',()=>{
 const html=screen('c');assert.match(html,/Todavía no hay continuaciones/);assert.match(html,/Continuar recuerdo/);
 assert.doesNotMatch(html,/photo-frame|data-child-post=/);
});
test('initial trip includes a realistic branching chain that is reachable without publishing',()=>{
 const initial=currentTrip(createSimulation()),child=initial.posts.find(p=>p.parentPostId==='cafe-post');
 assert.ok(child);assert.equal(initial.posts.filter(p=>p.parentPostId===child.id).length,2);
});
