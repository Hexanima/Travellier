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
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const width of [320,390,1280])for(const mode of ['app','studio'])for(const screen of ['itinerary','mixed-day']){
  await page.setViewportSize({width,height:844});await page.goto('http://127.0.0.1:'+server.address().port+'/?screen='+screen+(mode==='app'?'&mode=app':''));await page.evaluate(()=>document.fonts.ready);
  const spacing=await page.locator('.itinerary-screen').evaluate(el=>{
   const banner=el.querySelector('.destination').getBoundingClientRect(),month=el.querySelector('.calendar-month').getBoundingClientRect();
   return {gap:month.top-banner.bottom,left:month.left-banner.left,overflow:el.scrollWidth>el.clientWidth};
  });
  assert.equal(spacing.gap,16,screen+' / '+mode+' / '+width+'px: destination needs breathing room before the date');
  assert.equal(spacing.left,0,'keep the existing left alignment');assert.equal(spacing.overflow,false);
  if(mode==='app'&&screen==='itinerary'&&[390,1280].includes(width))shots.push([width+'.png',await page.screenshot()]);
 }
 assert.deepEqual(errors,[]);console.log('Destination spacing: 16px; 12 viewport/mode/screen combinations pass.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const out=new URL('./review/itinerary-spacing/',import.meta.url);await mkdir(out,{recursive:true});for(const [name,buffer]of shots)await writeFile(new URL(name,out),buffer);
