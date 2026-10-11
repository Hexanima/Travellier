import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,currentTrip,command,localInstant,localDate} from './public/simulation.mjs';
import {inputTime,urbanSteps} from './public/timing.mjs';
import {createState} from './public/state.mjs';
import {renderScreen} from './public/playable-screens.mjs';
const urban=()=>{
 const sim=createSimulation(),tr=currentTrip(sim).transports[0];tr.type='bus_local';
 tr.details={steps:Array.from({length:7},(_,i)=>({line:'L'+(i+1),fromStop:'Parada '+i,toStop:'Parada '+(i+1),estimatedAt:localInstant('2026-10-12',String(i).padStart(2,'0')+':00')}))};
 const data={destination:tr.destinationId,direction:tr.direction,transportType:tr.type,departurePlace:tr.departurePlace,arrivalPlace:tr.arrivalPlace,departuredate:localDate(tr.departureAt),departuretime:inputTime(tr.departureAt),arrivaldate:localDate(tr.arrivalAt),arrivaltime:inputTime(tr.arrivalAt)};
 tr.details.steps.forEach((row,i)=>Object.assign(data,{['line'+i]:row.line,['fromStop'+i]:row.fromStop,['toStop'+i]:row.toStop,['stepDate'+i]:localDate(row.estimatedAt),['stepTime'+i]:inputTime(row.estimatedAt)}));
 return {sim,tr,data};
};
test('saving a line edit preserves every confirmed urban step beyond five',()=>{
 const {sim,tr,data}=urban();data.line0='L1 corregida';
 const result=command(sim,{type:'save-transport',data});assert.equal(result.error,undefined);
 const steps=currentTrip(result.state).transports.find(x=>x.id===tr.id).details.steps;
 assert.equal(steps.length,7);assert.equal(steps[0].line,'L1 corregida');assert.deepEqual(steps.slice(1),tr.details.steps.slice(1));
});
test('chronological validation includes steps beyond five',()=>{
 const {sim,data}=urban(),before=structuredClone(sim);data.stepTime5='23:00';
 const result=command(sim,{type:'save-transport',data});assert.match(result.error||'',/orden cronológico/);assert.deepEqual(sim,before);
});
test('new urban steps beyond five use the same rollover validation',()=>{
 const {tr,data}=urban();for(const key of Object.keys(data))if(key.startsWith('stepDate'))delete data[key];
 assert.equal(urbanSteps(data,null,tr.departureAt,tr.arrivalAt).length,7);
});
const expenseFixture=()=>{const sim=createSimulation(),t=currentTrip(sim);t.expenseMode='balance';t.members.push({id:'elena',name:'Elena',role:'participant'});return {sim,t,draft:structuredClone(t.posts[0].expense)};};
const expenseHtml=(sim,draft)=>renderScreen({...createState(),sim,view:'expense-edit',draft});
test('existing expense offers new members for explicit inclusion without replacing agreed shares',()=>{
 const {sim,t,draft}=expenseFixture(),before=structuredClone(draft),html=expenseHtml(sim,draft);
 assert.match(html,/name="shareAddMember"/);assert.match(html,/<option value="elena"[^>]*>Elena<\/option>/);assert.match(html,/data-action="add-share"/);
 assert.deepEqual([...html.matchAll(/name="shareMember\d+" value="([^"]+)"/g)].map(x=>x[1]),t.members.slice(0,4).map(m=>m.id));assert.deepEqual(draft,before);
});
test('eligible share picker excludes already included and departed members',()=>{
 const {sim,draft}=expenseFixture();draft.shares.push({memberId:'former',unit:'amount',value:2});
 const html=expenseHtml(sim,draft),picker=html.match(/<select[^>]*name="shareAddMember"[^>]*>([\s\S]*?)<\/select>/)?.[1]||'';
 assert.match(picker,/value="elena"/);assert.doesNotMatch(picker,/value="(?:nico|ana|martin|juli|former)"/);assert.match(html,/name="shareMember4" value="former"/);
});
test('a complete share list has no duplicate-member addition controls',()=>{
 const {sim,draft}=expenseFixture();draft.shares.push({memberId:'elena',unit:'excluded'});
 assert.doesNotMatch(expenseHtml(sim,draft),/data-action="add-share"/);
});
