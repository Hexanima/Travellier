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
 const fit=async()=>assert.equal(await phone.locator('.phone-body').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 const capture=async(width,name)=>{if([390,1280].includes(width))shots.push([width+'-'+name+'.png',await page.screenshot()]);};
 const seed=async kind=>{
  await open('itinerary');await page.evaluate(async kind=>{
   const {createSimulation,currentTrip,command,localInstant}=await import('/simulation.mjs'),{travelStorageKey,encodeTravelState}=await import('/prototype-storage.mjs');
   let sim=createSimulation();
   if(kind==='notices'){sim=command(sim,{type:'join',id:'roma-public'}).state;sim=command(sim,{type:'join',id:'sierras-public'}).state;}
   if(kind==='expense'){currentTrip(sim).posts.forEach(post=>post.expense=null);sim=command(sim,{type:'publish-post',data:{description:'Entradas al museo',photos:[],totalAmount:100,currency:'EUR'}}).state;}
   if(kind==='transit'){const tr=currentTrip(sim).transports[0];tr.departureAt=localInstant('2026-10-10','20:00');tr.arrivalAt=localInstant('2026-10-12','09:45');}
   localStorage.clear();localStorage.setItem(travelStorageKey,encodeTravelState(sim));
  },kind);
 };
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});
  await seed('notices');await open('notifications');await phone.locator('.notification-list button').filter({hasText:'Nico se unió a Roma en buena compañía.'}).click();assert.match(await phone.locator('.phone-header').innerText(),/Roma en buena compañía/);await fit();await capture(width,'notice-trip');await button('Volver a Mis viajes').click();await button('Notificaciones').click();await phone.locator('.notification-list button').filter({hasText:'Nico se unió a Senderos de Córdoba.'}).click();assert.match(await phone.locator('.phone-header').innerText(),/Senderos de Córdoba/);
  await seed('expense');await open('trip-settings');await input('expenseMode').selectOption('balance');await button('Guardar configuración').click();await phone.getByRole('tab',{name:'Diario',exact:true}).click();await phone.locator('button').filter({hasText:/^Entradas al museo/}).click();await button('Editar post').click();await phone.locator('button').filter({hasText:/^Gasto: 100/}).click();
  assert.equal(await phone.locator('.expense-share').count(),4);assert.deepEqual((await saved()).trips[0].posts.at(-1).expense.shares,[]);await fit();await phone.locator('.expense-shares').scrollIntoViewIfNeeded();await capture(width,'complete-shares');
  await button('Agregar pago').click();await input('paymentValue0').fill('100');await button('Agregar al post').click();await button('Guardar cambios').click();const expense=(await saved()).trips[0].posts.at(-1).expense;assert.equal(expense.shares.length,4);assert.equal(expense.payments[0].value,'100');await open('balance');assert.match(await phone.locator('.balance-transfer').allTextContents().then(x=>x.join(' ')),/25,00/);
  await seed('transit');await open('itinerary');await phone.locator('[data-action="date"][data-value="2026-10-11"]').click();assert.equal(await phone.locator('.transport-card').count(),1);assert.match(await phone.locator('.transport-card').innerText(),/En tránsito/);assert.match(await phone.locator('.transport-card').innerText(),/10(?: de)? oct/);assert.match(await phone.locator('.transport-card').innerText(),/12(?: de)? oct/);assert.equal(await phone.locator('.empty-day').count(),0);await fit();await capture(width,'ongoing-transit');
  await button('Ezeiza → Fiumicino').click();assert.match(await phone.locator('.phone-body').innerText(),/Fiumicino/);await button('Volver').click();assert.equal(await phone.locator('[data-action="date"][data-value="2026-10-11"]').getAttribute('aria-pressed'),'true');
  await button('Agregar actividad').click();await input('name').fill('Un plan antes de llegar');await input('time').fill('12:00');await button('Crear actividad').click();assert.match(await phone.locator('.inline-error').innerText(),/entre la llegada y la salida/);
  console.log('Completing register expenses, exact notice navigation and ongoing transit pass at '+width+'px');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const out=new URL('./review/prd-audit/flow-fixes/',import.meta.url);await mkdir(out,{recursive:true});for(const [name,buffer] of shots)await writeFile(new URL(name,out),buffer);
