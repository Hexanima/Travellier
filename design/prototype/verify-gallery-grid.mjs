import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),captures=new URL('./review/gallery-grid/',import.meta.url),live=process.argv.includes('--live');
const types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));if(!live)await mkdir(captures,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
try{
 for(const [width,app] of [[390,true],[320,true],[1280,true],[1280,false]]){
  const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(3000);page.on('pageerror',e=>errors.push(e.message));
  const phone=page.locator('.phone'),url=live?'http://127.0.0.1:5500/design/prototype/public':'http://127.0.0.1:'+server.address().port;
  await page.goto(url+'/?screen=gallery'+(app?'&mode=app':''));await page.evaluate(()=>document.fonts.ready);
  const check=async label=>{
   const boxes=await phone.locator('.gallery-item').evaluateAll(items=>items.map(el=>{const b=el.getBoundingClientRect(),img=el.querySelector('img').getBoundingClientRect(),title=el.querySelector('small').getBoundingClientRect();return {top:b.top,bottom:b.bottom,height:b.height,imageTop:img.top,imageBottom:img.bottom,imageHeight:img.height,titleTop:title.top};}));
   for(const b of boxes){assert.ok(Math.abs(b.top-b.imageTop)<1,`${width} / ${label}: image is top-aligned (offset ${b.imageTop-b.top}px)`);assert.ok(b.titleTop>=b.imageBottom,'caption follows image');}
   assert.ok(boxes.every(b=>Math.abs(b.height-boxes[0].height)<1),`${width} / ${label}: all grid rows have equal-height cells`);
   for(let i=1;i<boxes.length;i++)if(Math.abs(boxes[i].top-boxes[i-1].top)<1){assert.ok(Math.abs(boxes[i].height-boxes[i-1].height)<1,'cells in one row share height');assert.ok(Math.abs(boxes[i].imageTop-boxes[i-1].imageTop)<1,'images in one row share top');assert.ok(Math.abs(boxes[i].imageHeight-boxes[i-1].imageHeight)<1,'images keep equal heights');}
   assert.ok(await phone.evaluate(el=>el.scrollWidth<=el.clientWidth));
  };
  await check('original captions');
  if(!live&&app&&[390,1280].includes(width))await page.screenshot({path:fileURLToPath(new URL(width+'-gallery.png',captures))});
  await phone.locator('.gallery-item small').nth(3).evaluate(el=>{el.textContent='Una última vuelta por el barrio antes de volver a casa, con todas las fotos y los recuerdos que nos llevamos del viaje.';});
  await phone.locator('.gallery-byline').nth(3).evaluate(el=>{el.textContent='Martín Rodríguez Fernández · 12 oct';});await check('long title and author');
  await phone.locator('.gallery-item').nth(3).click();assert.equal(await phone.getAttribute('data-screen'),'photo-viewer');
  assert.equal(await phone.locator('.viewer-photo img').getAttribute('src'),'assets/street.jpg');
  await phone.getByRole('button',{name:'Volver',exact:true}).click();assert.equal(await phone.getAttribute('data-screen'),'gallery');await check('return');
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: top-aligned photos/captions, equal-height cells per row, long titles/authors, source viewer/Back and no overflow at 320/390/1280px + study mode');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
