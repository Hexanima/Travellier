import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from './public/simulation.mjs';
import {createState} from './public/state.mjs';
import {catalog} from './public/catalog.mjs';
const ui=await import('./public/playable-screens.mjs').catch(()=>({}));
test('phone copy reads as a product rather than commentary about the prototype',()=>{assert.equal(typeof ui.renderScreen,'function');for(const {id} of catalog.filter(x=>x.id!=='foundations')){const html=ui.renderScreen({...createState(),view:id,sim:createSimulation(),date:'2026-10-12',postId:'cafe-post',activityId:id==='vote'?'museos':'paseo',destinationId:'roma',memberId:'juli',transportDirection:'outbound'});assert.ok(html.length>80,id);assert.ok(!/ejemplo|simulad|simulaci|fictici|ilustrativ|prototipo|\bPRD\b|esta muestra|no se guardó ni/i.test(html),id);}});
test('finished trips show meaningful travel records and active tab stays separate',()=>{const s={...createState(),view:'trips',sim:createSimulation(),filter:'finished'};const html=ui.renderScreen(s);assert.match(html,/Vendimia en Mendoza/);assert.match(html,/Un finde junto al mar/);assert.ok(!html.includes('Escapada a Bariloche'));});
test('post details use the chosen post and its actual expense',()=>{const html=ui.renderScreen({...createState(),view:'post',sim:createSimulation(),postId:'river-post'});assert.match(html,/Una mañana junto al río/);assert.ok(!html.includes('Cuatro cafés'));});
