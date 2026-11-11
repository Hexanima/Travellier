import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,currentTrip,command,localDate} from './public/simulation.mjs';
import {createState} from './public/state.mjs';
import {renderScreen,currencyErrorField} from './public/playable-screens.mjs';
import {transportCosts,tripBalance} from './public/expenses.mjs';
import {inputTime} from './public/timing.mjs';
const screen=(sim,view,extra={})=>renderScreen({...createState(),sim,view,date:'2026-10-12',destinationId:'roma',transportDirection:'outbound',transportId:'roma-outbound',steps:1,...extra});
const formData=(tr,extra={})=>({destination:tr.destinationId,direction:tr.direction,transportType:tr.type,departurePlace:tr.departurePlace,arrivalPlace:tr.arrivalPlace,departuredate:localDate(tr.departureAt),departuretime:inputTime(tr.departureAt),arrivaldate:localDate(tr.arrivalAt),arrivaltime:inputTime(tr.arrivalAt),cost:'',...extra});
const find=(s,id)=>currentTrip(s).transports.find(x=>x.id===id);
test('sample trip combines flight and bus costs in EUR and ARS and keeps one record without currency',()=>{
 const t=currentTrip(createSimulation());
 assert.deepEqual([t.transports.find(x=>x.id==='roma-outbound')].map(x=>[x.type,x.costPerPerson,x.costCurrency]),[['flight',780,'EUR']]);
 const currencies=new Set(t.transports.filter(x=>x.costPerPerson!=null).map(x=>x.costCurrency));
 assert.deepEqual([...currencies].map(String).sort(),['ARS','EUR','null']);
 assert.ok(t.transports.some(x=>x.type==='bus_long'&&x.costCurrency==='EUR'));assert.ok(t.transports.some(x=>x.type==='bus_long'&&x.costCurrency==='ARS'));
 assert.ok(t.transports.some(x=>x.costPerPerson!=null&&x.costCurrency==null));
});
test('saving a cost requires a valid currency and nothing is saved on failure',()=>{
 const s=createSimulation(),tr=find(s,'roma-outbound');
 for(const costCurrency of [undefined,'','BRL']){const r=command(s,{type:'save-transport',data:formData(tr,{cost:'900',costCurrency})});assert.ok(r.error,String(costCurrency));assert.deepEqual(r.state,s);}
 const ok=command(s,{type:'save-transport',data:formData(tr,{cost:'900',costCurrency:'USD'})});assert.equal(ok.error,undefined);
 const saved=find(ok.state,'roma-outbound');assert.equal(saved.costPerPerson,900);assert.equal(saved.costCurrency,'USD');
 assert.ok(command(s,{type:'save-transport',data:formData(tr,{cost:'-5',costCurrency:'EUR'})}).error);
});
test('clearing the cost clears its currency and no cost needs no currency',()=>{
 const s=createSimulation(),tr=find(s,'roma-outbound');
 const r=command(s,{type:'save-transport',data:formData(tr,{cost:'',costCurrency:'EUR'})});assert.equal(r.error,undefined);
 assert.equal(find(r.state,'roma-outbound').costPerPerson,null);assert.equal(find(r.state,'roma-outbound').costCurrency,null);
});
test('a previous record without currency can be kept only after choosing one',()=>{
 const s=createSimulation(),tr=find(s,'venecia-return');assert.equal(tr.costCurrency,null);assert.ok(tr.costPerPerson>0);
 assert.match(command(s,{type:'save-transport',data:formData(tr,{cost:String(tr.costPerPerson)})}).error,/moneda/i);
 const r=command(s,{type:'save-transport',data:formData(tr,{cost:String(tr.costPerPerson),costCurrency:'EUR'})});assert.equal(r.error,undefined);assert.equal(find(r.state,'venecia-return').costCurrency,'EUR');
});
test('transport costs are totalled per currency without converting and previous ones stay apart',()=>{
 const costs=transportCosts(currentTrip(createSimulation()));
 assert.deepEqual(costs.byCurrency.map(x=>[x.currency,x.total]),[['EUR',805],['ARS',18000]]);
 assert.equal(costs.unspecified.length,1);assert.equal(costs.unspecified[0].costPerPerson,450);
 const t=currentTrip(createSimulation());t.transports.forEach(x=>{x.costPerPerson=null;x.costCurrency=null;});
 assert.deepEqual(transportCosts(t),{byCurrency:[],unspecified:[]});
});
test('transport costs never enter the expense balance',()=>{
 const t=currentTrip(createSimulation()),before=JSON.stringify(tripBalance(t));
 t.transports.forEach(x=>{x.costPerPerson=1000;x.costCurrency='USD';});
 assert.equal(JSON.stringify(tripBalance(t)),before);assert.ok(!tripBalance(t).some(g=>g.currency==='USD'));
});
test('the transport form asks for the currency without preselecting one',()=>{
 const s=createSimulation();currentTrip(s).transports=currentTrip(s).transports.filter(x=>x.id!=='florencia-outbound');
 const blank=screen(s,'transport-edit',{destinationId:'florencia',transportDirection:'outbound',transportType:'flight',drafts:{}});
 assert.match(blank,/name="costCurrency"/);assert.match(blank,/<option value="" selected>Elegí una moneda<\/option>/);
 assert.match(screen(s,'transport-edit'),/<option value="EUR" selected>/);
 for(const type of ['flight','bus_long','bus_local','car','other'])assert.match(screen(s,'transport-edit',{draft:{transportType:type}}),/name="costCurrency"/,type);
});
test('a previous record without currency is flagged in its form and asks to choose one',()=>{
 const html=screen(createSimulation(),'transport-edit',{destinationId:'venecia',transportDirection:'return',transportId:'venecia-return',transportType:'flight'});
 assert.match(html,/Moneda sin indicar/);assert.match(html,/<option value="" selected>Elegí una moneda<\/option>/);
});
test('transport detail and overview show the cost with its currency',()=>{
 const s=createSimulation();
 const detail=screen(s,'transport-detail');assert.match(detail,/Costo por persona/);assert.match(detail,/EUR 780,00/);
 const unspecified=screen(s,'transport-detail',{destinationId:'venecia',transportDirection:'return',transportId:'venecia-return'});
 assert.match(unspecified,/450,00/);assert.match(unspecified,/Moneda sin indicar/);assert.ok(!/(ARS|EUR|USD) 450/.test(unspecified));
 assert.match(screen(s,'transports'),/EUR 780,00/);
 const free=createSimulation();find(free,'roma-outbound').costPerPerson=null;find(free,'roma-outbound').costCurrency=null;
 assert.ok(!screen(free,'transport-detail').includes('Costo por persona'));
});
test('trip transport summary lists each currency and the previous costs apart with the balance disclaimer',()=>{
 const html=screen(createSimulation(),'transports');
 assert.match(html,/Costo de transporte por persona/);assert.match(html,/EUR 805,00/);assert.match(html,/ARS 18\.000,00/);
 assert.match(html,/Moneda sin indicar/);assert.match(html,/450,00/);assert.match(html,/No es un gasto ni entra en el balance/);
 assert.ok(!/(ARS|EUR|USD) 18\.805|(ARS|EUR|USD) 19\.255|(ARS|EUR|USD) 805,00 · ARS/.test(html));
 const none=createSimulation();currentTrip(none).transports.forEach(x=>{x.costPerPerson=null;x.costCurrency=null;});
 assert.ok(!screen(none,'transports').includes('Costo de transporte por persona'));
});

test('the trip-wide cost total is labelled as such and sits before the destination selector',()=>{
 const html=screen(createSimulation(),'transports');
 assert.match(html,/<h4>Total del viaje<\/h4>/);assert.match(html,/no depende del destino elegido/);
 assert.ok(html.indexOf('Total del viaje')<html.indexOf('name="destination"'));
 assert.match(html,/Venecia · [^<]*→[^<]*450,00/);
});
test('a missing currency is an incomplete-data warning, not a muted metadata suffix',()=>{
 const s=createSimulation();
 const detail=screen(s,'transport-detail',{destinationId:'venecia',transportDirection:'return',transportId:'venecia-return'});
 assert.match(detail,/<section class="inline-note error"><h4>Moneda sin indicar<\/h4>/);assert.ok(!/450,00[^<]*Moneda sin indicar/.test(detail));
 const overview=screen(s,'transports',{destinationId:'venecia'});assert.match(overview,/inline-note error/);
});
test('the currency field is described by its help text and error, and failures point to it',()=>{
 const html=screen(createSimulation(),'transport-edit');
 assert.match(html,/<select name="costCurrency" aria-describedby="cost-currency-help transport-design-error">/);
 assert.match(html,/id="cost-currency-help"/);assert.match(html,/id="transport-design-error" role="alert"/);
 const s=createSimulation(),tr=find(s,'roma-outbound');
 const r=command(s,{type:'save-transport',data:formData(tr,{cost:'900',costCurrency:''})});
 assert.equal(currencyErrorField({type:'save-transport'},r.error),'costCurrency');
 assert.equal(currencyErrorField({type:'save-transport'},'Revisá el costo por persona.'),null);
 assert.equal(currencyErrorField({type:'settings'},r.error),null);
});
test('transport costs count a shared leg once and sum transports that differ in time or place separately',()=>{
 const base=currentTrip(createSimulation()).transports.find(x=>x.id==='roma-return');
 const copy=(id,patch)=>({...base,id,costPerPerson:10,costCurrency:'USD',...patch});
 const total=list=>transportCosts({transports:list}).byCurrency.find(x=>x.currency==='USD')?.total;
 assert.equal(total([copy('a',{}),copy('b',{})]),10);
 assert.equal(total([copy('a',{}),copy('b',{arrivalAt:'2026-10-17T21:00:00.000Z'})]),20);
 assert.equal(total([copy('a',{}),copy('b',{departurePlace:'Otra terminal'})]),20);
 assert.equal(total([copy('a',{}),copy('b',{arrivalPlace:'Otra ciudad'})]),20);
 assert.equal(total([copy('a',{}),copy('b',{departureAt:'2026-10-15T18:00:00.000Z'})]),20);
});
