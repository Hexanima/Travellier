import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {localInstant} from './public/simulation.mjs';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true}),shots=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(3000);page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install({time:new Date(localInstant('2026-10-16','22:37'))});
 const phone=page.locator('.phone'),button=name=>phone.getByRole('button',{name,exact:true}),input=name=>phone.locator('[name="'+name+'"]');
 const base=process.argv.includes('--live')?'http://127.0.0.1:5500/design/prototype/public':'http://127.0.0.1:'+server.address().port;
 const open=async screen=>{await page.goto(base+'/?mode=app&screen='+screen);await page.evaluate(()=>document.fonts.ready);};
 const fit=async()=>assert.equal(await phone.locator('.phone-body').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});await open('vote');
  await button('Voy').click();assert.equal(await button('Voy').getAttribute('aria-pressed'),'true');
  assert.ok(await phone.getByText('En votación',{exact:true}).isVisible());assert.ok(await button('Me gusta · 2').isVisible());await fit();
  if(width===390)shots.push(['vote.png',await page.screenshot()]);
  await button('Me gusta · 2').click();assert.ok(await phone.getByText('Confirmada',{exact:true}).isVisible());assert.equal(await button('Voy').getAttribute('aria-pressed'),'true');assert.equal(await phone.locator('[data-action="vote"]').count(),0);
  await open('compose');await phone.locator('[data-value="post-links"]').click();await phone.locator('[data-action="link-kind"][data-value="activity"]').click();await button('Crear actividad espontánea').click();assert.equal(await input('date').inputValue(),'2026-10-16');assert.equal(await input('time').inputValue(),'22:37');
  await input('date').fill('2026-10-13');await input('time').fill('11:20');await input('name').fill('Un café después de los museos');
  await phone.locator('.phone-header [data-action="back"]').click();await button('Crear actividad espontánea').click();
  assert.equal(await input('date').inputValue(),'2026-10-13');assert.equal(await input('time').inputValue(),'11:20');await fit();
  await button('Agregar al recuerdo').click();assert.ok(await phone.getByText('Actividad · Un café después de los museos',{exact:true}).isVisible());
  await input('description').fill('Un café para descansar y seguir caminando.');await button('Publicar recuerdo').click();assert.equal(await phone.getAttribute('data-screen'),'post');
  await open('calendar');assert.ok(await phone.getByRole('heading',{name:'Días de actividad',exact:true}).isVisible());assert.ok(await phone.getByRole('heading',{name:'Actividades confirmadas',exact:true}).isVisible());await fit();
  const downloadPromise=page.waitForEvent('download');await button('Exportar archivo .ics').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'travellier-itinerario.ics');
  const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const ics=Buffer.concat(chunks).toString();assert.ok(ics.includes('UID:day-roma-2026-10-12@travellier'));assert.ok(ics.includes('DTEND:'));assert.ok(!ics.includes('UID:museos@'));
  if(width===390)shots.push(['calendar.png',await page.screenshot()]);
  await open('trip-settings');await input('expenseMode').selectOption('balance');await button('Guardar configuración').click();
  await page.locator('#trip-tab-feed').click();await button('Compartir un recuerdo').click();await input('description').fill('Entradas para compartir');
  await phone.locator('[data-value="post-links"]').click();await phone.locator('[data-action="link-kind"][data-value="post"]').click();await phone.locator('[data-action="link-post"][data-value="gelato-post"]').click();
  await phone.locator('[data-value="expense-edit"]').click();await input('totalAmount').fill('1000');await input('currency').selectOption('ARS');
  await button('Agregar pago').click();await input('paymentUnit0').selectOption('percent');await input('paymentValue0').fill('50');
  await button('Agregar pago').click();await input('paymentMember1').selectOption('ana');await input('paymentValue1').fill('100');
  await input('shareUnit0').selectOption('amount');await input('shareValue0').fill('350');await input('shareUnit2').selectOption('excluded');
  assert.match(await phone.locator('#expense-preview').innerText(),/400,00/);
  await button('Agregar pago').click();await input('paymentMember2').selectOption('juli');await input('paymentValue2').fill('400');assert.match(await phone.locator('#expense-preview').innerText(),/Pagos completos/);
  await input('totalAmount').fill('1200');assert.match(await phone.locator('#expense-preview').innerText(),/100,00/);await input('totalAmount').fill('1000');await fit();
  if(width===390){await phone.locator('.phone-body').evaluate(el=>el.scrollTop=0);shots.push(['expense-editor.png',await page.screenshot()]);}
  await button('Agregar al post').click();await button('Publicar recuerdo').click();assert.equal(await phone.getAttribute('data-screen'),'post');
  assert.match(await phone.innerText(),/ARS 500,00/);assert.match(await phone.innerText(),/ARS 350,00/);assert.match(await phone.innerText(),/No participa del gasto/);
  await button('Editar post').click();await phone.locator('[data-value="expense-edit"]').click();assert.equal(await input('paymentValue0').inputValue(),'50');assert.equal(await input('shareValue0').inputValue(),'350');assert.equal(await input('currency').inputValue(),'ARS');
  await phone.locator('.phone-header [data-action="back"]').click();await button('Guardar cambios').click();
  // Navigate through the app without resetting the in-memory record.
  await phone.locator('.phone-header [data-action="back"]').click();await page.locator('#trip-tab-itinerary').click();
  await phone.locator('[data-action="date"][data-value="2026-10-12"]').click();assert.match(await phone.locator('[data-value="expenses"]').innerText(),/ARS 1\.000,00/);
  await phone.locator('[data-value="expenses"]').click();assert.match(await phone.innerText(),/Publicado el 16 oct/);await button('Ver balance').click();
  const ars=phone.locator('.balance-currency').filter({has:page.getByRole('heading',{name:'ARS',exact:true})});assert.match(await ars.innerText(),/150,00/);assert.match(await ars.innerText(),/75,00/);await fit();
  if(width===390){await phone.locator('.phone-body').evaluate(el=>el.scrollTop=0);shots.push(['balance.png',await page.screenshot()]);}
  console.log('PRD corrections browser flows pass at '+width+'px');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
// Persist captures only after closing the browser, so Live Server cannot reset a flow.
const captures=new URL('./review/prd-corrections/',import.meta.url);await mkdir(captures,{recursive:true});
for(const [name,buffer] of shots)await writeFile(new URL(name,captures),buffer);
