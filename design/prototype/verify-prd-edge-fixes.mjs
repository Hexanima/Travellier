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
 const seed=async kind=>{
  await open('itinerary');await page.evaluate(async kind=>{
   const {createSimulation,currentTrip,localInstant}=await import('/simulation.mjs'),{travelStorageKey,encodeTravelState}=await import('/prototype-storage.mjs');
   const sim=createSimulation(),trip=currentTrip(sim),a=trip.activities[0],tr=trip.transports[0];
   if(kind==='precise'){
    a.scheduledAt=new Date(Date.parse(a.scheduledAt)+30123).toISOString();
    trip.activities.push({id:'precision-other',title:'Otro plan',destinationId:'roma',scheduledAt:new Date(Date.parse(localInstant('2026-10-12','14:00'))+15123).toISOString(),durationMinutes:60,participations:{nico:'going'},decisionRequired:{}});
   }
   if(['urban','history'].includes(kind))Object.assign(tr,{type:'bus_local',departureAt:localInstant('2026-10-10','08:00'),details:{steps:[{line:'L1',fromStop:'Centro',toStop:'Aeropuerto',...(kind==='history'?{estimatedTime:'10:15'}:{estimatedAt:new Date(Date.parse(localInstant('2026-10-11','10:15'))+30123).toISOString()})}]}});
   localStorage.clear();localStorage.setItem(travelStorageKey,encodeTravelState(sim));
  },kind);
 };
 const capture=async(width,name)=>{if([390,1280].includes(width))shots.push([width+'-'+name+'.png',await page.screenshot()]);};
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});await seed('precise');await open('participation');const before=await saved();await button('Editar actividad').click();assert.equal(await input('time').inputValue(),'15:00:30.123');await input('description').fill('Cambió solo el texto');await button('Guardar cambios').click();const after=await saved();assert.equal(after.trips[0].activities[0].scheduledAt,before.trips[0].activities[0].scheduledAt);assert.equal(await button('Voy').getAttribute('aria-pressed'),'true');assert.equal(await phone.locator('.decision-badge').count(),0);await fit();
  await seed('urban');await open('transport-detail');await button('Editar transporte').click();assert.equal(await input('stepDate0').inputValue(),'2026-10-11');assert.equal(await input('stepTime0').inputValue(),'10:15:30.123');await input('line0').fill('L2');await input('stepDate0').scrollIntoViewIfNeeded();await input('stepTime0').scrollIntoViewIfNeeded();await capture(width,'confirmed-step');await button('Guardar transporte').click();assert.equal((await saved()).trips[0].transports.find(x=>x.id==='roma-outbound').details.steps[0].estimatedAt,new Date('2026-10-11T10:15:30.123-03:00').toISOString());
  await seed('history');await open('transport-detail');assert.match(await phone.innerText(),/10:15 · Sin fecha ni zona horaria/);await button('Editar transporte').click();assert.equal(await phone.getAttribute('data-screen'),'transport-history');assert.equal(await input('stepDate0').inputValue(),'');assert.equal(await input('stepTime0').inputValue(),'10:15');await fit();await capture(width,'historical-review');
  await input('stepDate0').fill('2026-10-13');await input('historyReviewed').check();await button('Confirmar y continuar').click();assert.equal(await phone.getAttribute('data-screen'),'transport-history');assert.match(await phone.locator('.inline-error').innerText(),/salida|llegada/);assert.ok((await saved()).trips[0].transports[0].details.steps[0].estimatedTime);
  await input('stepDate0').fill('2026-10-11');await input('stepTime0').fill('10:15:30.123');await button('Confirmar y continuar').click();assert.equal(await phone.getAttribute('data-screen'),'transport-edit');assert.equal(await input('stepDate0').inputValue(),'2026-10-11');assert.ok((await saved()).trips[0].transports[0].details.steps[0].estimatedTime);await button('Guardar transporte').click();const converted=(await saved()).trips[0].transports.find(x=>x.id==='roma-outbound').details.steps[0];assert.equal(converted.estimatedTime,undefined);assert.match(converted.estimatedAt,/30\.123Z$/);
  await seed('history');await open('transport-detail');await button('Editar transporte').click();await phone.getByRole('button',{name:'Volver',exact:true}).click();assert.equal(await phone.getAttribute('data-screen'),'transport-detail');assert.ok((await saved()).trips[0].transports[0].details.steps[0].estimatedTime);
  await seed('fresh');await open('discover');await button('Roma en buena compañía Roma · 2 integrantes').click();await button('Unirme al viaje').click();await open('notifications');assert.match(await phone.innerText(),/Nico se unió a Roma en buena compañía/);await fit();
  await seed('fresh');await open('group');await phone.locator('[data-value="remove-member"][data-record="ana"]').click();await button('Confirmar expulsión de Ana').click();const expelled=(await saved()).notifications.find(n=>n.userId==='ana'&&n.view==='trip-unavailable');assert.ok(expelled);await open('notifications');assert.doesNotMatch(await phone.innerText(),/Un admin te retiró/);
  await seed('fresh');await open('compose');await input('description').fill('Una cena que surgió');await button('Vincular a Post o actividad · opcional').click();await phone.locator('[data-action="link-kind"][data-value="activity"]').click();await button('Crear actividad espontánea').click();await input('name').fill('Cena improvisada');await input('date').fill('2026-10-14');await input('time').fill('21:00');await button('Agregar al recuerdo').click();await button('Publicar recuerdo').click();await open('notifications');assert.match(await phone.innerText(),/Nuevo plan[\s\S]*Cena improvisada/);assert.match(await phone.innerText(),/Nuevo recuerdo/);await fit();await capture(width,'event-notices');
  console.log('Precise instants, historical review/cancel/validation and membership/spontaneous notices pass at '+width+'px');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const out=new URL('./review/prd-audit/edge-fixes/',import.meta.url);await mkdir(out,{recursive:true});for(const [name,buffer]of shots)await writeFile(new URL(name,out),buffer);
