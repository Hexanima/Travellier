import test from 'node:test';
import assert from 'node:assert/strict';
import {renderScreen} from './public/playable-screens.mjs';
import {createState} from './public/state.mjs';
import * as model from './public/simulation.mjs';
const screen=(view,extra={})=>renderScreen({...createState(),sim:model.createSimulation(),view,date:'2026-10-12',destinationId:'roma',postId:'cafe-post',...extra});

for(const view of ['compose','post-edit'])test(view+' has one linking entry and no separate spontaneous activity action',()=>{
 const html=screen(view,{draft:{description:'Un café',activityId:'paseo'}});
 assert.equal((html.match(/<strong>Vincular a<\/strong>/g)||[]).length,1);
 assert.doesNotMatch(html,/data-value="spontaneous"|name="activityId"|name="parentPostId"|name="transportId"/);
 assert.match(html,/Paseo por Trastevere/);
});
test('linking starts with only Post and Actividad choices',()=>{
 const html=screen('post-links');
 assert.match(html,/data-action="link-kind" data-value="post"/);
 assert.match(html,/data-action="link-kind" data-value="activity"/);
 assert.doesNotMatch(html,/<select|data-value="spontaneous"|uno, varios/);
});
test('only the activity branch offers spontaneous creation',()=>{
 assert.match(screen('post-links',{linkKind:'activity'}),/Crear actividad espontánea/);
 assert.match(screen('post-links',{linkKind:'activity'}),/data-action="link-activity"/);
 assert.doesNotMatch(screen('post-links',{linkKind:'post'}),/data-value="spontaneous"/);
 assert.match(screen('post-links',{linkKind:'post'}),/data-action="link-post"/);
});
test('post picker excludes self and descendants but allows branches',()=>{
 const sim=model.createSimulation(),t=model.currentTrip(sim);
 t.posts[1].parentPostId='cafe-post';t.posts[1].transportId=null;
 const html=screen('post-links',{sim,editPostId:'cafe-post',linkKind:'post'});
 assert.doesNotMatch(html,/data-action="link-post" data-value="(?:cafe-post|flight-post)"/);
 assert.match(html,/data-action="link-post" data-value="museum-post"/);
});
test('a child has only its parent and inherits activity context through the chain',()=>{
 const s=model.createSimulation(),r=model.command(s,{type:'publish-post',data:{description:'Otra foto del café',day:'2026-10-12',parentPostId:'cafe-post'}});
 assert.equal(r.error,undefined);
 const t=model.currentTrip(r.state),p=t.posts.at(-1);
 assert.equal(p.activityId,null);assert.equal(p.parentPostId,'cafe-post');
 assert.equal(model.postActivityId?.(t,p),'paseo');
 assert.match(screen('participation',{sim:r.state,activityId:'paseo'}),/Otra foto del café/);
});
test('links cannot create cycles or combine a parent with another direct attachment',()=>{
 const s=model.createSimulation();
 assert.ok(model.command(s,{type:'save-links',id:'cafe-post',data:{parentPostId:'cafe-post'}}).error);
 assert.ok(model.command(s,{type:'publish-post',data:{description:'Foto',day:'2026-10-12',parentPostId:'cafe-post',activityId:'paseo'}}).error);
 const child=model.command(s,{type:'publish-post',data:{description:'Hijo',day:'2026-10-12',parentPostId:'cafe-post'}});
 assert.ok(model.command(child.state,{type:'save-links',id:'cafe-post',data:{parentPostId:model.currentTrip(child.state).posts.at(-1).id}}).error);
});
test('linking an existing post to a new activity is atomic and preserves comments and photos',()=>{
 const s=model.createSimulation(),before=model.currentTrip(s).posts[0];
 const data={spontaneous:{name:'Un café más',destination:'roma',date:'2026-10-12',time:'16:00'}};
 const r=model.command(s,{type:'save-links',id:'cafe-post',data});
 assert.equal(r.error,undefined);
 const t=model.currentTrip(r.state),p=t.posts[0];
 assert.equal(t.activities.at(-1).id,p.activityId);
 assert.deepEqual(p.comments,before.comments);assert.deepEqual(p.photos,before.photos);assert.deepEqual(p.expense,before.expense);
 const failed=model.command(s,{type:'save-links',id:'cafe-post',data:{spontaneous:{...data.spontaneous,time:'08:00'}}});
 assert.ok(failed.error);assert.deepEqual(failed.state,s);
});
