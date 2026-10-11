import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],shots=[],base='http://127.0.0.1:'+server.address().port;
const argentina='America/Argentina/Buenos_Aires',rome='Europe/Rome';
try{
 for(const width of [320,390,1280])for(const [sourceZone,targetZone]of [[argentina,rome],[rome,argentina]]){
  // One isolated context/page at a time; never reads or changes the user's browser.
  const source=await browser.newContext({timezoneId:sourceZone,viewport:{width,height:844}}),sourcePage=await source.newPage();
  let fixture;
  try{
   await sourcePage.goto(base+'/?mode=app&screen=itinerary');
   fixture=await sourcePage.evaluate(async()=>{
    const {createSimulation,currentTrip,command}=await import('/simulation.mjs'),{encodeTravelState}=await import('/prototype-storage.mjs');
    const sim=command(createSimulation(),{type:'publish-post',data:{description:'Una noche para recordar',photos:['street'],totalAmount:10,currency:'EUR'}},()=> '2026-10-13T01:00:00.123Z').state,post=currentTrip(sim).posts.at(-1);
    return {json:encodeTravelState(sim),post};
   });
  }finally{await source.close();}
  const context=await browser.newContext({timezoneId:targetZone,viewport:{width,height:844}}),page=await context.newPage();page.setDefaultTimeout(4000);page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.goto(base+'/?mode=app&screen=itinerary');
   await page.evaluate(async json=>{const {travelStorageKey}=await import('/prototype-storage.mjs');localStorage.setItem(travelStorageKey,json);},fixture.json);await page.reload();await page.evaluate(()=>document.fonts.ready);
   const phone=page.locator('.phone'),postRow=()=>phone.locator('[data-action="view"][data-value="post"][data-record="'+fixture.post.id+'"]');
   const button=name=>phone.getByRole('button',{name,exact:true});
   const saved=()=>page.evaluate(async()=>{const {travelStorageKey}=await import('/prototype-storage.mjs');return localStorage.getItem(travelStorageKey);});
   const targetDay=targetZone===rome?'2026-10-13':'2026-10-12';
   for(const date of ['2026-10-12','2026-10-13']){await phone.locator('[data-action="date"][data-value="'+date+'"]').click();assert.equal(await postRow().count(),date===targetDay?1:0);}
   await phone.locator('[data-action="date"][data-value="'+targetDay+'"]').click();await postRow().scrollIntoViewIfNeeded();
   assert.equal(await saved(),fixture.json);assert.equal(await phone.locator('.phone-body').evaluate(el=>el.scrollWidth>el.clientWidth),false);
   if(targetZone===rome&&width!==320)shots.push([width+'-itinerary.png',await page.screenshot()]);
   await phone.getByRole('tab',{name:'Diario',exact:true}).click();const diaryPost=postRow().locator('..');assert.match(await diaryPost.innerText(),targetZone===rome?/13 oct/:/12 oct/);await diaryPost.scrollIntoViewIfNeeded();
   if(targetZone===rome&&width!==320)shots.push([width+'-diary.png',await page.screenshot()]);
   await postRow().click();await button('Editar post').click();await phone.locator('[name="description"]').fill('Una noche para recordar. Caminamos un rato más.');await button('Guardar cambios').click();
   const updated=JSON.parse(await saved()).trips.find(t=>t.id==='italia').posts.find(p=>p.id===fixture.post.id);
   for(const field of ['createdAt','activityId','parentPostId','transportId','photos','expense'])assert.deepEqual(updated[field],fixture.post[field],field);
   await page.goto(base+'/?mode=app&screen=itinerary');await phone.locator('[data-action="date"][data-value="'+targetDay+'"]').click();assert.equal(await postRow().count(),1);
   console.log('Local publication grouping '+sourceZone+' → '+targetZone+' passes at '+width+'px');
  }finally{await context.close();}
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const out=new URL('./review/prd-audit/local-day/',import.meta.url);await mkdir(out,{recursive:true});for(const [name,buffer]of shots)await writeFile(new URL(name,out),buffer);
