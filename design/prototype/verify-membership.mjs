import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// T117: salida, titularidad, roles, moneda de transportes y ex integrantes en el navegador, a 320/390 px.
const root=new URL('./public/',import.meta.url),types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:'+server.address().port,phone=page.locator('.phone');
 const button=name=>phone.getByRole('button',{name,exact:true}),text=()=>phone.innerText();
 const open=async screen=>{await page.goto(base+'/?mode=app&screen='+screen);await page.evaluate(()=>document.fonts.ready);};
 const fit=async()=>assert.equal(await phone.locator('.phone-body').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 const reset=async()=>{await page.goto(base);await page.evaluate(()=>localStorage.clear());};
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});
  // Owner removes admin with a confirmation; the owner badge stays.
  await reset();await open('group');assert.match(await text(),/Titular/);assert.equal(await phone.locator('.role-badge').count(),4);await fit();
  assert.equal(await phone.locator('[data-value="member-manage"]').first().getAttribute('aria-label'),'Gestionar a Ana');
  await phone.locator('[data-value="member-manage"]').first().click();assert.match(await text(),/Gestionar a Ana/);assert.ok(await button('Transferir titularidad').isVisible());await fit();
  await button('Quitar admin').click();assert.match(await text(),/¿Quitar admin a Ana\?/);await fit();
  await button('Confirmar: quitar admin a Ana').click();assert.match(await text(),/Con quién viajamos/);assert.equal(await phone.locator('.role-badge',{hasText:'Participante'}).count(),3);
  // Owner cannot just leave: transfers first (separate step), then leaves.
  await button('Salir del viaje').click();assert.match(await text(),/Sos el titular/);await fit();
  await button('Transferir la titularidad').click();assert.match(await text(),/Transferir la titularidad/);
  const select=phone.locator('[name="newOwner"]'),check=phone.locator('[name="confirmTransfer"]'),submit=phone.locator('form button[type="submit"]'),formError=phone.locator('#transfer-owner-design-error');
  assert.equal(await select.inputValue(),'','sin preselección');assert.equal(await phone.locator('[data-owner-name]').innerText(),'la persona elegida');
  await submit.click();assert.equal(await formError.getAttribute('role'),'alert');assert.equal(await formError.isVisible(),true);assert.match(await formError.innerText(),/Elegí a la persona que será titular/);assert.equal(await select.getAttribute('aria-invalid'),'true');assert.equal(await select.evaluate(el=>el===document.activeElement),true,'foco en el selector');await fit();
  await select.selectOption('martin');assert.equal(await phone.locator('[data-owner-name]').innerText(),'Martín');
  await submit.click();assert.match(await formError.innerText(),/Confirmá que entendés/);assert.equal(await check.getAttribute('aria-invalid'),'true');assert.equal(await check.evaluate(el=>el===document.activeElement),true,'foco en la casilla');await fit();
  await check.check();await submit.click();
  assert.match(await text(),/Titularidad transferida/);assert.ok(await button('Ahora salir del viaje').isVisible());assert.equal(await button('Salir del viaje').count(),0);await fit();
  await button('Ahora salir del viaje').click();assert.match(await text(),/Saliste de Italia, sin apuro/);assert.equal(await phone.locator('.trip-card,.other-trip',{hasText:'Italia'}).count(),0);assert.match(await text(),/Escapada a Bariloche/);
  // Expelling keeps the person in expenses and balance, labelled as a former member.
  await reset();await open('group');await phone.locator('[data-value="member-manage"][data-record="juli"]').click();await button('Expulsar').click();assert.match(await text(),/¿Expulsar a Juli\?/);await fit();
  await button('Confirmar expulsión de Juli').click();assert.equal(await phone.locator('.member-row',{hasText:'Juli'}).count(),0);
  await open('expenses');assert.match(await text(),/Incluye a un ex integrante/);await fit();
  // Transport cost: currency field, summary by currency and the previous record without currency.
  await reset();await open('transports');assert.match(await text(),/Costo de transporte por persona/);assert.match(await text(),/Moneda sin indicar/);assert.match(await text(),/No es un gasto ni entra en el balance/);await fit();
  await page.goto(base+'/?mode=app&screen=transport-edit');assert.equal(await phone.locator('[name="costCurrency"]').count(),1);await fit();
  await phone.locator('[name="cost"]').fill('120');await phone.locator('[name="costCurrency"]').selectOption('');await phone.locator('#transport-design button[type="submit"]').click();const cc=phone.locator('[name="costCurrency"]');assert.equal(await cc.getAttribute('aria-invalid'),'true');assert.equal(await cc.evaluate(el=>el===document.activeElement),true,'foco en moneda');assert.match(await phone.locator('#transport-design-error').innerText(),/moneda/i);await fit();
  // Participant preview hides role management.
  await reset();await page.setViewportSize({width:1280,height:900});await page.goto(base+'/?screen=group');await page.selectOption('#role-select','participant');assert.equal(await phone.locator('[data-value="member-manage"]').count(),0);assert.ok(await button('Salir del viaje').isVisible());
 }
 assert.deepEqual(errors,[]);
 console.log('verify-membership: ok');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
