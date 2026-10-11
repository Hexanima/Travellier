import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),captures=new URL('./review/diary-fab/',import.meta.url),live=process.argv.includes('--live');
const types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));if(!live)await mkdir(captures,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
try{
 for(const [name,width,height,app] of [['compact',320,740,true],['mobile',390,844,true],['desktop',1280,844,true],['study',1280,1000,false]]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(3000);page.on('pageerror',e=>errors.push(e.message));
  const phone=page.locator('.phone'),body=phone.locator('.phone-body'),fab=phone.getByRole('button',{name:'Compartir un recuerdo',exact:true});
  const url=live?'http://127.0.0.1:5500/design/prototype/public':'http://127.0.0.1:'+server.address().port;
  const fresh=screen=>page.goto(url+'/?screen='+screen+(app?'&mode=app':''));
  const scenario=async value=>page.locator('#scenario-select').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},value);
  const shot=async label=>{if(live||!['mobile','desktop'].includes(name))return;await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:fileURLToPath(new URL(name+'-'+label+'.png',captures))});};
  const check=async()=>{
   assert.equal(await fab.count(),1);assert.equal(await phone.locator('.phone-body [data-value=compose]').count(),0);
   assert.ok(await fab.isVisible());assert.ok(await fab.isEnabled());
   const a=await fab.boundingBox(),container=await phone.boundingBox();
   assert.equal(a.width,56);assert.equal(a.height,56);
   assert.ok(a.x+a.width<=container.x+container.width-15);assert.ok(a.y+a.height<=container.y+container.height-15);
   assert.ok(await phone.evaluate(el=>el.scrollWidth<=el.clientWidth));
   assert.equal(await fab.evaluate(el=>getComputedStyle(el).borderRadius),'50%');
   await body.evaluate(el=>{el.scrollTop=el.scrollHeight;});
   assert.deepEqual(await fab.boundingBox(),a,'FAB remains anchored while scrolling');
   const last=phone.locator('.feed-post,.feed-text,.gallery-item').last();
   if(await last.count()){const b=await last.boundingBox();assert.ok(b.y+b.height<=a.y-12,'last item can scroll fully above the FAB');}
  };
  await fresh('feed');await check();await body.evaluate(el=>{el.scrollTop=0;});await shot('posts');
  await body.evaluate(el=>{el.scrollTop=el.scrollHeight;});const scroll=await body.evaluate(el=>el.scrollTop);
  await fab.focus();assert.equal(await fab.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');await page.keyboard.press('Enter');
  assert.equal(await phone.getAttribute('data-screen'),'compose');assert.equal(await phone.locator('.diary-fab').count(),0);
  await phone.locator('[name=description]').fill('La tarde que nos faltaba compartir.');await phone.getByRole('button',{name:'Volver',exact:true}).click();
  assert.equal(await phone.getAttribute('data-screen'),'feed');assert.ok(Math.abs(await body.evaluate(el=>el.scrollTop)-scroll)<2);
  await phone.getByRole('tab',{name:'Fotos',exact:true}).click();await check();await shot('photos');
  await fab.click();assert.equal(await phone.getAttribute('data-screen'),'compose');
  assert.equal(await phone.locator('[name=description]').inputValue(),'La tarde que nos faltaba compartir.');
  await phone.getByRole('button',{name:'Publicar recuerdo',exact:true}).click();assert.equal(await phone.getAttribute('data-screen'),'post');
  await phone.getByRole('button',{name:'Volver',exact:true}).click();assert.equal(await phone.getAttribute('data-screen'),'gallery');
  await phone.getByRole('tab',{name:'Grupo',exact:true}).click();assert.equal(await phone.locator('.diary-fab').count(),0);
  await phone.getByRole('tab',{name:'Diario',exact:true}).click();assert.equal(await phone.getAttribute('data-screen'),'gallery');
  for(const value of ['empty','loading','error']){await scenario(value);await check();}
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: circular anchored diary FAB, no duplicate footer, last-item clearance, keyboard compose, back/scroll/draft, photo publication and list states at 320/390/1280px + study mode');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
