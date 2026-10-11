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
 const page=await browser.newPage();page.setDefaultTimeout(4000);page.on('pageerror',error=>errors.push(error.message));
 const base='http://127.0.0.1:'+server.address().port,phone=page.locator('.phone');
 const open=async screen=>{await page.goto(base+'/?mode=app&screen='+screen);await page.evaluate(()=>document.fonts.ready);};
 const button=name=>phone.getByRole('button',{name,exact:true}),input=name=>phone.locator('[name="'+name+'"]');
 const fit=async()=>assert.equal(await phone.locator('.phone-body').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 const seed=async kind=>{
  await open('itinerary');
  await page.evaluate(async kind=>{
   const {createSimulation,currentTrip,localInstant}=await import('/simulation.mjs'),{travelStorageKey,encodeTravelState}=await import('/prototype-storage.mjs');
   const sim=createSimulation(),trip=currentTrip(sim);
   if(kind==='late'){
    const p={...trip.posts[0],id:'late-root-browser',title:'Tarde en los museos',activityId:'museos',parentPostId:null,transportId:null,createdAt:localInstant('2026-10-16','12:00'),day:'2026-10-16'};
    trip.posts.push(p,{...p,id:'late-child-browser',title:'Seguimos recorriendo',activityId:null,parentPostId:p.id});
   }
   if(kind==='duration'){
    const a=trip.activities.find(x=>x.id==='paseo');a.scheduledAt=localInstant('2026-10-13','10:00');a.durationMinutes=30;a.participations={nico:'going',ana:'going'};
    const other=trip.activities.find(x=>x.id==='museos');other.scheduledAt=localInstant('2026-10-13','12:00');other.durationMinutes=120;other.participations={nico:'going'};
   }
   localStorage.clear();localStorage.setItem(travelStorageKey,encodeTravelState(sim));
  },kind);
 };
 const capture=async(width,name)=>{if([390,1280].includes(width))shots.push([width+'-'+name+'.png',await page.screenshot()]);};
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});await seed('fresh');await open('add');
  await input('name').fill('Una noche por Roma');await input('date').fill('2026-10-12');await input('time').fill('23:30');await input('durationHours').fill('1');await input('durationMinutesPart').fill('30');await button('Crear actividad').click();
  assert.match(await phone.locator('.detail-facts').innerText(),/23:30 – 13 oct[^\n]*01:00 · 1 h 30 min/);await fit();await capture(width,'overnight');
  await phone.locator('.phone-header [data-action="back"]').click();assert.equal(await phone.getAttribute('data-screen'),'itinerary');assert.match(await phone.innerText(),/23:30 – 13 oct[^\n]*01:00 · 1 h 30 min/);await fit();
  await open('calendar');assert.match(await phone.innerText(),/23:30 – 13 oct[^\n]*01:00 · 1 h 30 min/);await fit();
  await seed('late');await open('itinerary');await phone.locator('[data-action="date"][data-value="2026-10-16"]').click();
  for(const id of ['late-root-browser','late-child-browser'])assert.equal(await phone.locator('[data-record="'+id+'"]').count(),0);
  await phone.locator('[data-action="date"][data-value="2026-10-13"]').click();for(const id of ['late-root-browser','late-child-browser'])assert.equal(await phone.locator('[data-record="'+id+'"]').count(),1);await fit();
  await phone.getByRole('tab',{name:'Diario',exact:true}).click();for(const id of ['late-root-browser','late-child-browser'])assert.equal(await phone.locator('[data-record="'+id+'"]').count(),1);
  await seed('fresh');await open('participation');await button('Editar actividad').click();await input('description').fill('Nos vemos en la entrada nueva.');await button('Guardar cambios').click();
  assert.equal(await button('Voy').getAttribute('aria-pressed'),'true');await open('notifications');assert.match(await phone.innerText(),/Actividad actualizada[\s\S]*Cambió la descripción/);await fit();
  await seed('duration');await open('participation');await button('Editar actividad').click();await input('durationHours').fill('3');await input('durationMinutesPart').fill('0');await button('Guardar cambios').click();
  assert.equal(await button('Voy').getAttribute('aria-pressed'),'false');assert.equal(await button('No voy').getAttribute('aria-pressed'),'false');assert.ok(await button('Modificado: revisá tu participación').isVisible());
  await open('notifications');const text=await phone.innerText();assert.match(text,/Cambió la duración/);assert.match(text,/10:00 – 13:00 · 3 h/);assert.match(text,/Museos Vaticanos[^\n]*12:00 – 14:00 · 2 h/);await fit();await capture(width,'edit-notices');
  await phone.locator('[data-action="notification"]').filter({hasText:'Revisá tu participación'}).click();assert.ok(await button('Modificado: revisá tu participación').isVisible());
  await button('Voy').click();const dialog=page.locator('#activity-dialog');assert.match(await dialog.innerText(),/10:00 – 13:00 · 3 h/);assert.match(await dialog.innerText(),/12:00 – 14:00 · 2 h/);assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);await capture(width,'conflict');
  await dialog.getByRole('button',{name:'Conservar mis planes'}).click();assert.ok(await button('Modificado: revisá tu participación').isVisible());
  console.log('F1 duration/end-date, F2 activity projection, F3 complete edit notices and decision retention pass at '+width+'px');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const out=new URL('./review/prd-audit/fixes/',import.meta.url);await mkdir(out,{recursive:true});for(const [name,buffer]of shots)await writeFile(new URL(name,out),buffer);
