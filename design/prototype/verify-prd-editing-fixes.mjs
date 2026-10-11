import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],shots=[];
try{
 const page=await browser.newPage(),base='http://127.0.0.1:'+server.address().port;page.setDefaultTimeout(4000);page.on('pageerror',error=>errors.push(error.message));
 const open=async screen=>{await page.goto(base+'/?mode=app&screen='+screen);await page.evaluate(()=>document.fonts.ready);};
 const phone=page.locator('.phone'),button=name=>phone.getByRole('button',{name,exact:true}),input=name=>phone.locator('[name="'+name+'"]');
 const saved=()=>page.evaluate(async()=>{const {travelStorageKey}=await import('/prototype-storage.mjs');return JSON.parse(localStorage.getItem(travelStorageKey));});
 const current=data=>data.trips.find(t=>t.id==='italia'),transport=data=>current(data).transports.find(t=>t.id==='roma-outbound'),expense=data=>current(data).posts.find(p=>p.id==='cafe-post').expense;
 const fit=async()=>assert.equal(await phone.locator('.phone-body').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 const capture=async(width,name)=>{await fit();if([390,1280].includes(width))shots.push([width+'-'+name+'.png',await page.screenshot()]);};
 const seed=async(kind,count=5)=>{
  await open('itinerary');await page.evaluate(async({kind,count})=>{
   const {createSimulation,currentTrip,localInstant}=await import('/simulation.mjs'),{travelStorageKey,encodeTravelState}=await import('/prototype-storage.mjs');
   const sim=createSimulation(),t=currentTrip(sim);
   if(kind==='urban'){const tr=t.transports[0];tr.type='bus_local';tr.details={steps:Array.from({length:count},(_,i)=>({line:'L'+(i+1),fromStop:'Parada '+i,toStop:'Parada '+(i+1),estimatedAt:localInstant('2026-10-12',String(i).padStart(2,'0')+':00')}))};}
   if(kind==='expense'){t.expenseMode='balance';t.members.push({id:'elena',name:'Elena',role:'participant'});t.posts[0].expense.shares[0]={memberId:'nico',unit:'amount',value:3};}
   localStorage.clear();localStorage.setItem(travelStorageKey,encodeTravelState(sim));
  },{kind,count});
 };
 const editExpense=async()=>{await open('post');await button('Editar post').click();await phone.getByRole('button',{name:/^Gasto: 18/}).click();};
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});
  await seed('urban');await open('transport-detail');await button('Editar transporte').click();await button('Agregar tramo').click();assert.equal(await phone.locator('[name^="line"]').count(),6);
  await input('line5').fill('L6');await input('fromStop5').fill('Parada 5');await input('toStop5').fill('Parada 6');await input('stepTime5').fill('05:00');await button('Agregar tramo').click();assert.equal(await phone.locator('[name^="line"]').count(),7);
  await input('line6').fill('L7');await input('fromStop6').fill('Parada 6');await input('toStop6').fill('Parada 7');await input('stepTime6').fill('06:00');await capture(width,'urban-steps');
  await button('Quitar último').click();assert.equal(await phone.locator('[name^="line"]').count(),6);await button('Guardar transporte').click();assert.equal(transport(await saved()).details.steps.length,6);
  await seed('urban',7);const before=transport(await saved()).details.steps;await open('transport-detail');await button('Editar transporte').click();await input('line0').fill('L1 corregida');await button('Guardar transporte').click();assert.deepEqual(transport(await saved()).details.steps.slice(1),before.slice(1));assert.equal(transport(await saved()).details.steps.length,7);
  await seed('urban',7);const valid=await saved();await open('transport-detail');await button('Editar transporte').click();await input('stepTime5').fill('23:00');await button('Guardar transporte').click();assert.match(await phone.locator('.inline-error').innerText(),/orden cronológico/);assert.deepEqual(await saved(),valid);
  await seed('expense');const agreement=expense(await saved());await editExpense();assert.equal(await phone.locator('.expense-share').count(),4);assert.deepEqual(expense(await saved()),agreement);await input('shareAddMember').selectOption('elena');await button('Agregar persona al reparto').scrollIntoViewIfNeeded();await capture(width,'share-picker');await button('Agregar persona al reparto').click();
  assert.equal(await phone.locator('.expense-share').count(),5);assert.equal(await phone.locator('[data-action="add-share"]').count(),0);assert.equal(await input('shareUnit4').evaluate(el=>el===document.activeElement),true);assert.deepEqual(expense(await saved()),agreement);
  await input('shareUnit4').selectOption('amount');await input('shareValue4').fill('2');await capture(width,'added-share');await button('Volver').click();await button('Volver').click();assert.deepEqual(expense(await saved()),agreement);
  await button('Editar post').click();await phone.getByRole('button',{name:/^Gasto: 18/}).click();assert.equal(await phone.locator('.expense-share').count(),5);assert.equal(await input('shareValue4').inputValue(),'2');
  await page.locator('#scenario-select').selectOption('error',{force:true});await button('Agregar al post').click();assert.match(await phone.locator('.inline-error').innerText(),/No pudimos guardar/);assert.deepEqual(expense(await saved()),agreement);await page.locator('#scenario-select').selectOption('default',{force:true});
  await button('Agregar al post').click();await button('Guardar cambios').click();const updated=expense(await saved());assert.equal(updated.shares.length,5);assert.equal(updated.shares[4].memberId,'elena');assert.equal(Number(updated.shares[4].value),2);assert.equal(Number(updated.shares[0].value),3);assert.deepEqual(updated.payments.map(p=>({...p,value:Number(p.value)})),agreement.payments);
  await page.reload();await editExpense();assert.equal(await phone.locator('.expense-share').count(),5);assert.equal(await phone.locator('[data-action="add-share"]').count(),0);await fit();
  console.log('Urban steps and explicit expense-share inclusion pass at '+width+'px');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const out=new URL('./review/prd-audit/editing-fixes/',import.meta.url);await mkdir(out,{recursive:true});for(const [name,buffer] of shots)await writeFile(new URL(name,out),buffer);
