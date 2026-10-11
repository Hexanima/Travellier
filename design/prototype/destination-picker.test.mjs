import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from './public/state.mjs';
import {createSimulation,currentTrip,localDate} from './public/simulation.mjs';
import * as screens from './public/playable-screens.mjs';
test('itinerary banner is an accessible destination picker trigger',()=>{
 const html=screens.renderScreen({...createState(),sim:createSimulation(),view:'itinerary',date:'2026-10-12',destinationId:'roma'});
 assert.match(html,/popovertarget="destination-picker"/);assert.match(html,/aria-haspopup="dialog"/);assert.match(html,/Ver destinos/);
});
test('destination choices derive ordered dates and exact bounds from transports',()=>{
 assert.equal(typeof screens.destinationChoices,'function');const trip=currentTrip(createSimulation());trip.destinations.reverse();
 const choices=screens.destinationChoices(trip);assert.deepEqual(choices.map(x=>x.id),['roma','florencia','venecia']);assert.deepEqual(choices.map(x=>x.firstDay),['2026-10-12','2026-10-16','2026-10-20']);assert.ok(choices.every(x=>x.available));
 assert.equal(localDate(choices[0].departure),'2026-10-16');assert.equal(localDate(choices[1].arrival),'2026-10-16');
});
test('picker shows range, arrival, departure and the selected destination',()=>{
 assert.equal(typeof screens.renderDestinationPicker,'function');const html=screens.renderDestinationPicker(currentTrip(createSimulation()),'florencia');
 assert.match(html,/Roma/);assert.match(html,/Florencia/);assert.match(html,/Venecia/);assert.match(html,/Llegada/);assert.match(html,/Salida/);assert.match(html,/09:45/);assert.match(html,/21:00/);assert.match(html,/18:00/);assert.match(html,/2026/);
 assert.match(html,/data-value="florencia"[^>]*aria-current="true"/);assert.doesNotMatch(html,/data-value="roma"[^>]*aria-current="true"/);
});
test('incomplete transport does not invent a first day or offer an unavailable jump',()=>{
 assert.equal(typeof screens.destinationChoices,'function');const trip=currentTrip(createSimulation());trip.transports=trip.transports.filter(t=>t.id!=='florencia-return');
 const choice=screens.destinationChoices(trip).find(x=>x.id==='florencia');assert.equal(choice.available,false);assert.equal(choice.firstDay,null);
 const html=screens.renderDestinationPicker(trip,'roma');assert.match(html,/data-value="florencia"[^>]*disabled/);assert.match(html,/Falta configurar la salida/);
});
test('a shared date retains the explicitly selected destination',()=>{
 assert.equal(typeof screens.destinationForDate,'function');const trip=currentTrip(createSimulation());
 assert.equal(screens.destinationForDate(trip,'2026-10-16','florencia'),'florencia');assert.equal(screens.destinationForDate(trip,'2026-10-16','roma'),'roma');assert.equal(screens.destinationForDate(trip,'2026-10-20','roma'),'venecia');
});
test('destination names are escaped and a one-stop trip uses the same picker',()=>{
 assert.equal(typeof screens.renderDestinationPicker,'function');const trip=createSimulation().trips.find(t=>t.id==='bariloche');trip.destinations[0].name='<img src=x onerror=alert(1)>';
 const html=screens.renderDestinationPicker(trip,trip.destinations[0].id);assert.ok(!html.includes('<img src=x'));assert.match(html,/&lt;img/);assert.equal((html.match(/data-action="choose-destination"/g)||[]).length,1);
});
