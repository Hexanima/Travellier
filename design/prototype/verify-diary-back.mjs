import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});page.on('pageerror',e=>errors.push(e.message));
  const phone=page.locator('.phone'),body=phone.locator('.phone-body'),url='http://127.0.0.1:'+server.address().port;
  const click=label=>phone.getByRole(['Diario','Fotos','Posts','Grupo','Itinerario'].includes(label)?'tab':'button',{name:label,exact:true}).click();
  const assertView=async expected=>assert.equal(await phone.getAttribute('data-screen'),expected);
  await page.goto(url+'/?mode=app');await phone.locator('[data-action=trip][data-value=italia]').click();
  await phone.locator('[data-action=date][data-value="2026-10-13"]').click();
  await body.evaluate(el=>{el.scrollTop=200;});const scroll=await body.evaluate(el=>el.scrollTop);
  await click('Diario');await assertView('feed');await click('Itinerario');
  await assertView('itinerary');assert.ok(await phone.getByText('martes, 13 de octubre',{exact:true}).isVisible());
  assert.ok(Math.abs(await body.evaluate(el=>el.scrollTop)-scroll)<2,'restores itinerary scroll');
  await click('Diario');await click('Fotos');await click('Itinerario');await assertView('itinerary');
  await phone.locator('.phone-header .icon-button').first().click();await assertView('trips');
  await page.goto(url+'/?mode=app&screen=feed');await phone.locator('.phone-header .icon-button').first().click();await assertView('trips');
  await phone.locator('[data-action=trip][data-value=bariloche]').click();await click('Diario');
  await click('Itinerario');await assertView('itinerary');
  assert.ok(await phone.getByText('Escapada a Bariloche',{exact:true}).isVisible());
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: diary tabs preserve itinerary date/scroll/current trip; root Back → trips; mobile/desktop');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
