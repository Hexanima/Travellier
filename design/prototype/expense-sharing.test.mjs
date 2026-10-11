import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,currentTrip,command,localInstant} from './public/simulation.mjs';
import {createState} from './public/state.mjs';
import {renderScreen} from './public/playable-screens.mjs';
const money=await import('./public/expenses.mjs').catch(()=>({}));
const expense={totalAmount:1000,currency:'ARS',payments:[{memberId:'ana',unit:'amount',value:1000}],shares:[{memberId:'nico',unit:'amount',value:350},{memberId:'ana',unit:'remainder'},{memberId:'juli',unit:'remainder'},{memberId:'martin',unit:'excluded'}]};
test('fixed contributions and the remaining share are independently configurable',()=>{
 assert.equal(typeof money.expenseSummary,'function');
 const result=money.expenseSummary(expense);
 assert.equal(result.error,null);assert.deepEqual(result.shares.map(x=>[x.memberId,x.amount]),[['nico',350],['ana',325],['juli',325],['martin',0]]);
});
test('multiple actual payers accept fixed amounts and percentages of the total',()=>{
 assert.equal(typeof money.expenseSummary,'function');
 const result=money.expenseSummary({...expense,payments:[{memberId:'nico',unit:'percent',value:50},{memberId:'ana',unit:'amount',value:100},{memberId:'juli',unit:'amount',value:400}]});
 assert.deepEqual(result.payments.map(x=>x.amount),[500,100,400]);assert.equal(result.remaining,0);
});
test('partial payment is reported without inventing the unpaid contribution',()=>{
 assert.equal(typeof money.expenseSummary,'function');
 const result=money.expenseSummary({...expense,payments:[{memberId:'nico',unit:'percent',value:50},{memberId:'ana',unit:'amount',value:100}]});
 assert.equal(result.remaining,400);assert.equal(result.complete,false);
});
test('overpayments and excessive allocation are rejected',()=>{
 assert.equal(typeof money.expenseSummary,'function');
 assert.match(money.expenseSummary({...expense,payments:[{memberId:'nico',unit:'percent',value:110}]}).error,/pago|porcentaje/i);
 assert.match(money.expenseSummary({...expense,shares:[{memberId:'nico',unit:'amount',value:1200}]}).error,/repart|total/i);
});
test('rounding remainder is distributed deterministically without losing cents',()=>{
 assert.equal(typeof money.expenseSummary,'function');
 const result=money.expenseSummary({...expense,totalAmount:10,payments:[{memberId:'ana',unit:'amount',value:10}],shares:['nico','ana','juli'].map(memberId=>({memberId,unit:'remainder'}))});
 assert.deepEqual(result.shares.map(x=>x.amount),[3.34,3.33,3.33]);
});
test('balance resolves actual payments against agreed shares, separately by currency',()=>{
 assert.equal(typeof money.tripBalance,'function');
 const t=currentTrip(createSimulation());t.posts=[{id:'one',expense},{id:'two',expense:{...expense,currency:'EUR'}}];
 const groups=money.tripBalance(t);
 assert.equal(groups.length,2);
 for(const group of groups)assert.deepEqual(group.transfers.map(x=>[x.from,x.to,x.amount]),[['nico','ana',350],['juli','ana',325]]);
});
test('expenses with incomplete payments are visible but do not create fabricated settlement transfers',()=>{
 assert.equal(typeof money.tripBalance,'function');
 const groups=money.tripBalance({posts:[{id:'one',expense:{...expense,payments:[{memberId:'ana',unit:'amount',value:100}]}}]});
 assert.equal(groups[0].pending.length,1);assert.deepEqual(groups[0].transfers,[]);
});
test('editing and switching to register mode preserve already recorded payments and shares',()=>{
 const sim=createSimulation(),t=currentTrip(sim);t.expenseMode='balance';
 let result=command(sim,{type:'publish-post',data:{description:'Entrada para todos',...expense,photos:[]}});
 assert.equal(result.error,undefined);const p=currentTrip(result.state).posts.at(-1);
 assert.deepEqual(p.expense.payments,expense.payments);assert.deepEqual(p.expense.shares,expense.shares);
 currentTrip(result.state).expenseMode='register';
 result=command(result.state,{type:'publish-post',id:p.id,data:{description:'Entrada para todos, guardada',totalAmount:1000,photos:[]}});
 assert.deepEqual(currentTrip(result.state).posts.at(-1).expense.payments,expense.payments);
});
test('late expense and a chained child expense use the root activity date',()=>{
 const sim=createSimulation();
 const result=command(sim,{type:'publish-post',data:{description:'Cena tardía',parentPostId:'gelato-post',totalAmount:100,currency:'EUR',photos:[]}},()=>localInstant('2026-10-28','20:00'));
 const html=renderScreen({...createState(),sim:result.state,view:'itinerary',date:'2026-10-12',destinationId:'roma'});
 assert.match(html,/Gastos del día[\s\S]*126/);
 const list=renderScreen({...createState(),sim:result.state,view:'expenses'});
 assert.match(list,/Cena tardía/);assert.match(list,/12 oct/);
});
test('payment and share editor replaces the single payer selector',()=>{
 const sim=createSimulation();currentTrip(sim).expenseMode='balance';
 const html=renderScreen({...createState(),sim,view:'expense-edit',draft:expense});
 assert.match(html,/Quién pagó/);assert.match(html,/Cómo se reparte/);
 assert.match(html,/Agregar pago/);assert.match(html,/Resto en partes iguales/);
 assert.doesNotMatch(html,/name="paidBy"/);
});
test('legacy single payer survives editing as a full payment',()=>{
 const sim=createSimulation(),t=currentTrip(sim);t.posts[0].expense.paidBy='ana';delete t.posts[0].expense.payments;t.expenseMode='balance';
 const result=command(sim,{type:'publish-post',id:t.posts[0].id,data:{description:'Cafés compartidos',totalAmount:18,photos:[]}});
 assert.equal(result.error,undefined);
 assert.deepEqual(money.expensePayments(currentTrip(result.state).posts[0].expense),[{memberId:'ana',unit:'percent',value:100}]);
});
test('percentage payments covering the total preserve every cent after rounding',()=>{
 const result=money.expenseSummary({...expense,totalAmount:17.99,payments:[{memberId:'nico',unit:'percent',value:50},{memberId:'ana',unit:'percent',value:50}],shares:[{memberId:'nico',unit:'percent',value:50},{memberId:'ana',unit:'percent',value:50}]});
 assert.equal(result.error,null);assert.equal(result.remaining,0);assert.equal(result.unallocated,0);
 assert.equal(result.payments.reduce((n,row)=>n+row.cents,0),1799);assert.equal(result.shares.reduce((n,row)=>n+row.cents,0),1799);
});
test('register mode does not expose calculated debts even on direct balance entry',()=>{
 const sim=createSimulation();
 const html=renderScreen({...createState(),sim,view:'balance'});
 assert.doesNotMatch(html,/le debe a/);assert.match(html,/Activar balance/);
});
