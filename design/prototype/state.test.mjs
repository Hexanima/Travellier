import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('./public/state.mjs').catch(() => ({}));
test('linked activity opens its own itinerary day',()=>{
 let state=api.transition(api.createState(),{type:'day',value:13});
 state=api.transition(state,{type:'view',value:'post'});
 state=api.transition(state,{type:'activity'});
 assert.equal(state.view,'itinerary');assert.equal(state.day,12);
});
test('initial state opens the original Figma trips screen in blue only', () => {
  assert.equal(typeof api.createState, 'function', 'missing prototype state implementation');
  const s=api.createState(); assert.equal(s.view,'trips'); assert.equal(s.variant,'blue'); assert.equal(s.day,12);
});

test('all exported screens and foundations are reachable',()=>{
 for(const view of ['foundations','empty','join','add','participation']) assert.equal(api.transition(api.createState(),{type:'view',value:view}).view,view);
});

test('retired palette cannot be selected',()=>{
 const s=api.createState();assert.equal(api.transition(s,{type:'variant',value:'leather'}).variant,'blue');
});

test('retired voting actions do not change state',()=>{
 const s=api.createState();assert.ok(!('vote' in s));assert.ok(!('votingEnabled' in s));assert.deepEqual(api.transition(s,{type:'vote',value:'up'}),s);
});
test('Figma calendar accepts all six visible days and rejects out-of-trip values',()=>{
 const s=api.createState();for(const day of [12,13,14,15,16,17])assert.equal(api.transition(s,{type:'day',value:day}).day,day);
 assert.equal(api.transition(s,{type:'day',value:99}).day,12);
});
test('trip filter preserves all memory interactions',()=>{
 let s=api.transition(api.createState(),{type:'like'});s=api.transition(s,{type:'filter',value:'finished'});
 assert.equal(s.filter,'finished');assert.equal(s.liked,true);
 s=api.transition(s,{type:'view',value:'trips'});assert.equal(s.view,'trips');
});
test('navigation preserves likes and individual participation', () => {
  assert.equal(typeof api.transition,'function');
  let s=api.createState(); s=api.transition(s,{type:'participation',value:'not_going'}); s=api.transition(s,{type:'like'}); s=api.transition(s,{type:'view',value:'post'});
  assert.equal(s.participation,'not_going'); assert.equal(s.liked,true); assert.equal(s.view,'post');
});
test('collage selection is unique and capped at four photos', () => {
  assert.equal(typeof api.transition,'function');
  let s=api.createState(); for(const id of [0,1,2,3,4])s=api.transition(s,{type:'select',value:id});
  assert.deepEqual(s.selected,[0,1,2,3]); s=api.transition(s,{type:'select',value:1});assert.deepEqual(s.selected,[0,2,3]);
});
test('invalid screens and variant names cannot corrupt state', () => {
  assert.equal(typeof api.transition,'function');
  const s=api.createState();assert.deepEqual(api.transition(s,{type:'view',value:'invalid'}),s);assert.deepEqual(api.transition(s,{type:'variant',value:'invalid'}),s);
});
test('comments reject empty input and store plain text', () => {
  assert.equal(typeof api.transition,'function');
  const s=api.createState();assert.equal(api.transition(s,{type:'comment',value:'  '}).comments.length,0);
  assert.deepEqual(api.transition(s,{type:'comment',value:' <b>Buen viaje</b> '}).comments,['<b>Buen viaje</b>']);
});
test('post photos cycle within their three-photo collection', () => {
  assert.equal(typeof api.transition,'function');
  let s=api.createState();for(let n=0;n<4;n++)s=api.transition(s,{type:'photo'});assert.equal(s.photo,1);
});
