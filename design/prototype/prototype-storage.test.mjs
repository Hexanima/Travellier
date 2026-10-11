import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,currentTrip} from './public/simulation.mjs';
import {encodeTravelState,restoreTravelState} from './public/prototype-storage.mjs';
test('travel snapshots preserve pending decisions and omit account and temporary photo data',()=>{
 const s=createSimulation(),a=currentTrip(s).activities[0];a.participations.nico='pending';a.decisionRequired={nico:{reason:'schedule_conflict',changedAt:'2026-10-11T12:00:00.000Z',changedFields:['scheduledAt']}};
 currentTrip(s).posts[0].photos.push('blob:temporary');const json=encodeTravelState(s);assert.ok(!json.includes(s.profile.email));assert.ok(!json.includes('blob:temporary'));
 const restored=restoreTravelState(createSimulation(),json);assert.deepEqual(currentTrip(restored).activities[0].decisionRequired,a.decisionRequired);assert.equal(currentTrip(restored).activities[0].participations.nico,'pending');
 assert.deepEqual(restoreTravelState(s,'invalid'),s);
});
