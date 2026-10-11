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
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 const open=async()=>{await page.goto('http://127.0.0.1:'+server.address().port+'/?mode=app&screen=itinerary');await page.evaluate(()=>document.fonts.ready);};
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:600});await open();
  const body=()=>page.locator('.phone-body'),strip=()=>page.locator('.live-date-strip'),day=date=>page.locator('[data-action="date"][data-value="'+date+'"]');
  await body().evaluate(el=>el.scrollTop=20);const top=await body().evaluate(el=>el.scrollTop);assert.equal(top,20,'scenario must actually scroll');
  await day('2026-10-13').click();assert.equal(await body().evaluate(el=>el.scrollTop),top,'day changes retain content scroll');assert.equal(await day('2026-10-13').getAttribute('aria-pressed'),'true');
  assert.equal(await day('2026-10-13').evaluate(el=>document.activeElement===el),true,'focus remains on the selected date');
  await strip().evaluate(el=>el.scrollLeft=el.scrollWidth);const left=await strip().evaluate(el=>el.scrollLeft);
  if(width<700)assert.ok(left>0,'scenario must actually scroll the date strip');
  await day('2026-10-22').click();assert.equal(await strip().evaluate(el=>el.scrollLeft),left,'later dates must not reset the date strip');
  assert.equal(await page.locator('.destination-name').innerText(),'Venecia');
  await day('2026-10-21').press('Enter');assert.equal(await strip().evaluate(el=>el.scrollLeft),left,'keyboard date changes retain the strip position');
  assert.equal(await day('2026-10-21').getAttribute('aria-pressed'),'true');
  console.log('Itinerary content, date-strip scroll and keyboard focus pass at '+width+'px');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
