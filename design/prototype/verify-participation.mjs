import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {catalog} from './public/catalog.mjs';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],shots=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:'+server.address().port,phone=page.locator('.phone'),dialog=page.locator('#activity-dialog');
 const button=name=>phone.getByRole('button',{name,exact:true}),input=name=>phone.locator('[name="'+name+'"]');
 const open=async screen=>{await page.goto(base+'/?mode=app&screen='+screen);await page.evaluate(()=>document.fonts.ready);};
 const fit=async()=>assert.equal(await phone.locator('.phone-body').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 const reset=async()=>{await page.goto(base);await page.evaluate(()=>localStorage.clear());};
 const fillPlan=async(name,time)=>{await input('name').fill(name);await input('date').fill('2026-10-13');await input('time').fill(time);await input('durationHours').fill('1');};
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});await reset();await open('add');await fillPlan('Almuerzo con Ana','14:00');await button('Crear actividad').click();
  assert.equal(await button('Voy').getAttribute('aria-pressed'),'true');assert.match(await phone.innerText(),/14:00 – 15:00/);
  await open('participation');await button('Editar actividad').click();await input('date').fill('2026-10-13');await input('time').fill('14:30');await button('Guardar cambios').click();
  assert.equal(await button('Voy').getAttribute('aria-pressed'),'false');assert.equal(await button('No voy').getAttribute('aria-pressed'),'false');
  assert.ok(await phone.getByRole('button',{name:'Modificado: revisá tu participación'}).isVisible());
  await phone.getByRole('button',{name:'Modificado: revisá tu participación'}).click();assert.match(await dialog.innerText(),/Se modificó el horario/);await dialog.getByRole('button',{name:'Entendido'}).click();
  await page.reload();assert.ok(await phone.getByRole('button',{name:'Modificado: revisá tu participación'}).isVisible());if(width===390)shots.push(['modified-mobile.png',await page.screenshot()]);
  await button('Voy').click();assert.ok(await dialog.isVisible());assert.match(await dialog.innerText(),/Almuerzo con Ana/);
  await dialog.getByRole('button',{name:'Conservar mis planes'}).click();assert.equal(await button('Voy').getAttribute('aria-pressed'),'false');assert.ok(await phone.getByRole('button',{name:'Modificado: revisá tu participación'}).isVisible());
  await button('Voy').click();if(width===390)shots.push(['conflict-mobile.png',await page.screenshot()]);
  await dialog.getByRole('button',{name:'Cambiar de plan'}).click();assert.equal(await button('Voy').getAttribute('aria-pressed'),'true');assert.equal(await phone.getByRole('button',{name:'Modificado: revisá tu participación'}).count(),0);await fit();
  await open('add');await fillPlan('Una tarde en el centro','14:45');await button('Crear actividad').click();assert.ok(await dialog.isVisible());
  await dialog.getByRole('button',{name:'Conservar mis planes'}).click();assert.equal(await phone.getAttribute('data-screen'),'add');assert.equal(await input('name').inputValue(),'Una tarde en el centro');
  await button('Crear actividad').click();await dialog.getByRole('button',{name:'Cambiar de plan'}).click();assert.equal(await phone.getAttribute('data-screen'),'participation');assert.equal(await button('Voy').getAttribute('aria-pressed'),'true');
  // A new memory and its spontaneous activity remain unpublished when the choice is cancelled.
  await open('compose');await input('description').fill('Nos encontramos para caminar.');await phone.locator('[data-value="post-links"]').click();await phone.locator('[data-action="link-kind"][data-value="activity"]').click();await button('Crear actividad espontánea').click();
  await input('name').fill('Caminata por Roma');await input('date').fill('2026-10-13');await input('time').fill('15:00');await input('durationHours').fill('1');await button('Agregar al recuerdo').click();await button('Publicar recuerdo').click();
  assert.ok(await dialog.isVisible());await dialog.getByRole('button',{name:'Conservar mis planes'}).click();assert.equal(await phone.getAttribute('data-screen'),'compose');assert.equal(await input('description').inputValue(),'Nos encontramos para caminar.');
  await button('Publicar recuerdo').click();await dialog.getByRole('button',{name:'Cambiar de plan'}).click();assert.equal(await phone.getAttribute('data-screen'),'post');
  // Reject an activity whose end, rather than only its start, exceeds the window.
  await open('add');await input('name').fill('Un paseo antes de salir');await input('date').fill('2026-10-16');await input('time').fill('17:30');await input('durationHours').fill('1');await button('Crear actividad').click();assert.match(await phone.locator('.inline-error').innerText(),/actividad completa/);
  await reset();
  for(const {id} of catalog){await open(id);if(id==='foundations')continue;await fit();assert.ok(!/En votación|Votar actividades|Confirmá tu email/.test(await phone.innerText()),id);assert.equal(await phone.locator('[data-action="vote"]').count(),0,id);assert.equal(await phone.locator('img').evaluateAll(images=>images.filter(i=>i.complete&&i.naturalWidth===0).length),0,id);}
  await open('itinerary');if(width===390)shots.push(['itinerary-mobile.png',await page.screenshot()]);
  await open('activity-edit');const h=await input('durationHours').boundingBox(),m=await input('durationMinutesPart').boundingBox();assert.equal(h.y,m.y,'duration uses one compact row');if(width===390)shots.push(['edit-mobile.png',await page.screenshot()]);
  await open('feed');if(width===1280)shots.push(['diary-desktop.png',await page.screenshot()]);
  console.log('Participation, atomic drafts, persistence and '+catalog.length+' screens pass at '+width+'px');
 }
 // Registration has no mandatory name or email gate and does not persist credentials.
 await reset();await open('register');assert.equal(await input('name').count(),0);await input('email').fill('viajero@correo.com');await input('password').fill('UnaClaveParaViajar');await button('Crear cuenta').click();assert.equal(await phone.getAttribute('data-screen'),'trips');assert.ok(!await page.evaluate(()=>Object.values(localStorage).some(x=>/UnaClaveParaViajar|viajero@correo.com/.test(x))));
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const out=new URL('./review/participation/',import.meta.url);await mkdir(out,{recursive:true});for(const [name,buffer]of shots)await writeFile(new URL(name,out),buffer);
