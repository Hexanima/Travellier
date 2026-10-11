import test from 'node:test';
import assert from 'node:assert/strict';
import * as screens from './public/playable-screens.mjs';
import {createState} from './public/state.mjs';
import {createSimulation} from './public/simulation.mjs';
const state=view=>({...createState(),sim:createSimulation(),view,date:'2026-10-12',destinationId:'roma'});

test('trip lists share one persistent tab component with correct selection',()=>{
 assert.equal(typeof screens.tripNavigation,'function');
 for(const view of ['itinerary','mixed-day','feed','gallery','group']){
  const html=screens.tripNavigation(state(view)),selected=view==='gallery'?'feed':view==='mixed-day'?'itinerary':view;
  assert.match(html,/role="tablist" aria-label="Secciones del viaje"/);
  for(const label of ['Itinerario','Diario','Grupo'])assert.ok(html.includes('>'+label+'</button>'));
  assert.match(html,new RegExp('id="trip-tab-'+selected+'"[^>]*aria-selected="true"'));
 }
});
test('both diary lists retain the same Posts and Fotos tabs',()=>{
 assert.equal(typeof screens.tripNavigation,'function');
 for(const view of ['feed','gallery']){
  const html=screens.tripNavigation(state(view));
  assert.match(html,/role="tablist" aria-label="Contenido del diario"/);
  assert.match(html,/>Posts<\/button>/);assert.match(html,/>Fotos<\/button>/);
  assert.match(html,new RegExp('id="diary-tab-'+view+'"[^>]*aria-selected="true"'));
 }
});
test('details and editors have no trip tabs',()=>{
 assert.equal(typeof screens.tripNavigation,'function');
 for(const view of ['post','participation','vote','photo-viewer','compose','post-edit'])assert.equal(screens.tripNavigation(state(view)),'');
});
test('trip panels identify the selected shared tabs without duplicate controls',()=>{
 for(const view of ['itinerary','feed','gallery','group']){
  const html=screens.renderScreen(state(view)),selected=view==='gallery'?'feed':view;
  assert.match(html,new RegExp('id="trip-panel" role="tabpanel" aria-labelledby="trip-tab-'+selected+'"'));
  if(['feed','gallery'].includes(view))assert.match(html,new RegExp('id="diary-panel" role="tabpanel" aria-labelledby="diary-tab-'+view+'"'));
  assert.doesNotMatch(html,/class="trip-tabs"|class="diary-mode"/);
 }
});
