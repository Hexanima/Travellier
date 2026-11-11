import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,currentTrip,command} from './public/simulation.mjs';
import {createState} from './public/state.mjs';
import {renderScreen} from './public/playable-screens.mjs';
const screen=(sim,view,extra={})=>renderScreen({...createState(),sim,view,date:'2026-10-12',postId:'museum-post',activityId:'paseo',destinationId:'roma',...extra});
const expelled=()=>{const s=createSimulation();currentTrip(s).expenseMode='balance';return command(s,{type:'remove-member',id:'juli'}).state;};
const current=()=>{const s=createSimulation();currentTrip(s).expenseMode='balance';return s;};
test('nobody is labelled as a former member while everyone is in the group',()=>{
 const s=current();
 for(const view of ['post','expenses','balance','expense-edit'])assert.ok(!screen(s,view,{draft:currentTrip(s).posts.find(p=>p.id==='museum-post').expense}).includes('ex integrante'),view);
});
test('expense detail names the former member in payments and shares and keeps the amounts',()=>{
 const html=screen(expelled(),'post');
 assert.match(html,/Juli <span class="role-badge">ex integrante<\/span> · EUR 24,00 \(50%\)/);
 assert.match(html,/Juli <span class="role-badge">ex integrante<\/span> · EUR 12,00/);
 assert.match(html,/Nico · EUR 12,00/);assert.ok(!/Nico[^<]*ex integrante/.test(html));
});
test('the share editor identifies the former member and lets the group redistribute the share',()=>{
 const s=expelled(),draft=structuredClone(currentTrip(s).posts.find(p=>p.id==='museum-post').expense);
 const html=screen(s,'expense-edit',{draft});
 assert.match(html,/<legend>Juli · ex integrante<\/legend>/);
 assert.match(html,/<option value="juli" selected>Juli · ex integrante<\/option>/);
 assert.match(html,/Parte de Juli · ex integrante/);
 assert.match(html,/No participa del gasto/);
 assert.ok(!/<option value="juli">/.test(html.split('Persona para agregar')[1]||''));
});
test('the expense list flags expenses that keep a former member',()=>{
 const html=screen(expelled(),'expenses');
 assert.equal((html.match(/Incluye a un ex integrante/g)||[]).length,3);
 assert.ok(!screen(current(),'expenses').includes('ex integrante'));
});
test('the balance keeps the former member in transfers and labels them',()=>{
 const html=screen(expelled(),'balance');
 assert.match(html,/Juli · ex integrante<\/strong><span>le debe a/);
 assert.match(html,/le debe a (Ana|Nico|Martín)/);
});
test('posts, comments and photos keep the person name without a label outside expenses',()=>{
 const s=expelled();
 for(const view of ['feed','gallery','comments'])assert.ok(!screen(s,view,{postId:'cafe-post'}).includes('ex integrante'),view);
 assert.match(screen(s,'post'),/<strong>Juli<\/strong><small>/);
});
test('the former member keeps a name in the registry and the group no longer lists them',()=>{
 const s=expelled();assert.equal(s.people.juli.name,'Juli');
 assert.ok(!screen(s,'group').includes('Juli'));
});
