import test from 'node:test';
import assert from 'node:assert/strict';
import * as screens from './public/playable-screens.mjs';
import {createSimulation,currentTrip} from './public/simulation.mjs';
import {createState} from './public/state.mjs';
const state=(view,scenario='default')=>({...createState(),sim:createSimulation(),view,scenario});
for(const view of ['feed','gallery'])for(const scenario of ['default','empty','loading','error'])test(`${view} / ${scenario} has one accessible floating compose action`,()=>{
 const html=screens.diaryAction?.(state(view,scenario))||'';
 assert.match(html,/class="diary-fab"/);
 assert.match(html,/data-action="view" data-value="compose"/);
 assert.match(html,/aria-label="Compartir un recuerdo"/);
 assert.match(html,/<svg[^>]*aria-hidden="true"/);
 assert.equal((html.match(/<button/g)||[]).length,1);
 assert.doesNotMatch(html,/disabled/);
});
test('diary lists have no duplicate compose action at their scrolling bottom',()=>{
 for(const view of ['feed','gallery'])for(const scenario of ['default','empty','loading','error']){
  assert.doesNotMatch(screens.renderScreen(state(view,scenario)),/data-value="compose"/);
 }
});
test('an actual empty trip relies on the same floating diary action',()=>{
 const s=state('feed');currentTrip(s.sim).posts=[];
 assert.doesNotMatch(screens.renderScreen(s),/data-value="compose"/);
 assert.match(screens.diaryAction?.(s)||'',/aria-label="Compartir un recuerdo"/);
});
test('other trip panels, details and editors do not show a diary compose overlay',()=>{
 assert.equal(typeof screens.diaryAction,'function');
 for(const view of ['itinerary','group','trips','post','photo-viewer','participation','compose','post-edit'])assert.equal(screens.diaryAction(state(view)),'');
});
