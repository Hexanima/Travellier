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
 const page=await browser.newPage();page.setDefaultTimeout(3000);page.on('pageerror',e=>errors.push(e.message));
 const picker=()=>page.locator('#destination-picker'),banner=()=>page.locator('.destination-trigger'),day=d=>page.locator('.live-date-strip [data-value="'+d+'"]');
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});await page.goto('http://127.0.0.1:'+server.address().port+'/?mode=app&screen=itinerary');await page.evaluate(()=>document.fonts.ready);
  assert.equal(await banner().count(),1,'banner must open the destination picker');
  // Keep the entire trigger visible so Playwright's click does not scroll it into view.
  const before=await page.locator('.phone-body').evaluate(el=>{el.scrollTop=4;return el.scrollTop;});
  await banner().click();await picker().waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('.destination-trigger')?.getAttribute('aria-expanded')==='true');
  assert.deepEqual(await picker().locator('.destination-choice strong').allTextContents(),['Roma','Florencia','Venecia']);assert.match(await picker().innerText(),/Llegada[\s\S]*09:45/);assert.match(await picker().innerText(),/21:00/);
  assert.equal(await picker().evaluate(el=>el.scrollWidth>el.clientWidth),false);assert.equal(await picker().locator('[aria-current="true"]').count(),1);
  assert.equal(await picker().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)','picker must inherit the opaque app surface, not reveal the itinerary through its content');
  if(width===390||width===1280)shots.push(['picker-'+width+'.png',await page.screenshot()]);
  await page.keyboard.press('Escape');assert.ok(!await picker().isVisible());assert.equal(await page.locator('.phone-body').evaluate(el=>el.scrollTop),before);assert.equal(await banner().evaluate(el=>document.activeElement===el),true);
  await banner().press('Enter');await picker().waitFor({state:'visible'});await picker().locator('[data-value="florencia"]').click();
  assert.equal(await page.locator('.destination-name').innerText(),'Florencia');assert.equal(await day('2026-10-16').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.phone').getAttribute('data-screen'),'itinerary');assert.equal(await page.locator('#trip-tab-itinerary').getAttribute('aria-selected'),'true');
  const visible=await day('2026-10-16').evaluate(el=>{const r=el.getBoundingClientRect(),parent=el.parentElement.getBoundingClientRect();return r.left>=parent.left&&r.right<=parent.right;});assert.ok(visible,'jump reveals the first date within the strip');
  await day('2026-10-17').click();await day('2026-10-16').click();assert.equal(await page.locator('.destination-name').innerText(),'Florencia','shared day retains selected destination');
  await banner().click();assert.equal(await picker().locator('[data-value="florencia"]').getAttribute('aria-current'),'true');await picker().locator('[data-value="venecia"]').click();assert.equal(await day('2026-10-20').getAttribute('aria-pressed'),'true');
  await banner().click();await picker().getByRole('button',{name:'Cerrar destinos'}).click();assert.ok(!await picker().isVisible());assert.equal(await page.locator('.destination-name').innerText(),'Venecia');
  console.log('Destination selection, exact bounds, cancellation, keyboard and shared dates pass at '+width+'px');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const out=new URL('./review/destination-picker/',import.meta.url);await mkdir(out,{recursive:true});for(const [name,buffer]of shots)await writeFile(new URL(name,out),buffer);
