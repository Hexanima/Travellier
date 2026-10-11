// Regression guards for the explicitly removed voting feature.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,currentTrip,command} from './public/simulation.mjs';
import {createState} from './public/state.mjs';
import {renderScreen} from './public/playable-screens.mjs';
test('obsolete vote commands never change activities or participation',()=>{
 const s=createSimulation(),r=command(s,{type:'vote',id:'museos',value:'up'});assert.ok(r.error);assert.deepEqual(r.state,s);
});
test('settings do not restore an activity mode even when an obsolete payload includes one',()=>{
 const s=createSimulation(),t=currentTrip(s),r=command(s,{type:'settings',data:{name:t.name,visibility:'private',expenseMode:'register',votingEnabled:true}});assert.ok(!('votingEnabled' in currentTrip(r.state)));
});
test('activity detail and settings contain no voting or approval controls',()=>{
 const s=createSimulation();for(const view of ['participation','trip-settings'])assert.doesNotMatch(renderScreen({...createState(),sim:s,view,activityId:'museos'}),/votación|me gusta|name="votingEnabled"|Confirmada|Propuesta</i);
});
