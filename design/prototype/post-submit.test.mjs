import test from 'node:test';
import assert from 'node:assert/strict';
import {renderScreen} from './public/playable-screens.mjs';
import {createState} from './public/state.mjs';
import {createSimulation} from './public/simulation.mjs';
import {catalog} from './public/catalog.mjs';
for(const [view,label] of [['compose','Publicar recuerdo'],['post-edit','Guardar cambios']])test(view+' confirms directly from the bottom of the editor',()=>{
 const html=renderScreen({...createState(),view,sim:createSimulation(),date:'2026-10-12',draft:{description:'Café en el barrio'}});
 assert.match(html,new RegExp('<button class="primary" type="submit">'+label+'</button></form>'));
 assert.doesNotMatch(html,/Revisar publicación|data-value="upload"/);
});
test('loading keeps submission in the editor and prevents repeat publication',()=>{
 const html=renderScreen({...createState(),view:'compose',scenario:'loading',sim:createSimulation(),date:'2026-10-12'});
 assert.match(html,/<button[^>]*type="submit"[^>]*disabled[^>]*aria-busy="true"[^>]*>Publicando…/);
});
test('the removed review screen is not a navigable catalog entry',()=>assert.ok(!catalog.some(x=>x.id==='upload')));
