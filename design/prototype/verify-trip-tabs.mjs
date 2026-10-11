import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createSimulation,currentTrip} from './public/simulation.mjs';
const expectedPosts=currentTrip(createSimulation()).posts.slice().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
const captures=new URL('./review/trip-tabs/',import.meta.url);await mkdir(captures,{recursive:true});
try{
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(2500);page.on('pageerror',e=>errors.push(e.message));
  const phone=page.locator('.phone'),body=phone.locator('.phone-body'),url=process.argv.includes('--live')?'http://127.0.0.1:5500/design/prototype/public':'http://127.0.0.1:'+server.address().port;
  const tab=label=>phone.getByRole('tab',{name:label,exact:true}),back=()=>phone.locator('.phone-header .icon-button').first().click();
  const assertView=async expected=>assert.equal(await phone.getAttribute('data-screen'),expected);
  // Live Server reloads on capture writes, which would reset the in-memory trip.
  const capture=async name=>{if(!process.argv.includes('--live'))await page.screenshot({path:fileURLToPath(new URL(width+'-'+name+'.png',captures))});};
  const shared=async (selected,diary)=>{
   for(const label of ['Itinerario','Diario','Grupo'])assert.ok(await tab(label).isVisible());
   assert.equal(await tab(selected).getAttribute('aria-selected'),'true');
   assert.ok(await phone.getByText('Italia, sin apuro',{exact:true}).isVisible());
   if(diary){assert.ok(await tab('Posts').isVisible());assert.ok(await tab('Fotos').isVisible());}
   assert.equal(await phone.getByRole('tabpanel',{name:selected,exact:true}).count(),1);
   assert.ok(await phone.getByRole('button',{name:'Volver a Mis viajes',exact:true}).isVisible());
  };
  await page.goto(url+'/?mode=app&screen=itinerary');await shared('Itinerario',false);
  await phone.locator('[data-action=date][data-value="2026-10-13"]').click();
  await body.evaluate(el=>{el.scrollTop=180;});const itineraryScroll=await body.evaluate(el=>el.scrollTop);
  await tab('Diario').click();await assertView('feed');await shared('Diario',true);
  assert.deepEqual(await phone.locator('.feed-post [data-record],.feed-text [data-record]').evaluateAll(rows=>rows.map(row=>row.dataset.record)),expectedPosts.map(p=>p.id),'newest posts first');
  await capture('posts');
  const tabsY=await tab('Diario').evaluate(el=>el.getBoundingClientRect().top);
  await body.evaluate(el=>{el.scrollTop=300;});const feedScroll=await body.evaluate(el=>el.scrollTop);
  assert.equal(await tab('Diario').evaluate(el=>el.getBoundingClientRect().top),tabsY);
  await tab('Fotos').click();await assertView('gallery');await shared('Diario',true);
  assert.deepEqual(await phone.locator('.gallery-item small').allTextContents(),expectedPosts.flatMap(p=>p.photos.map(()=>p.title)),'newest source posts first in Photos');
  await capture('photos');
  await tab('Fotos').press('Home');await assertView('feed');assert.equal(await body.evaluate(el=>el.scrollTop),feedScroll);
  assert.equal(await tab('Posts').evaluate(el=>el===document.activeElement),true);
  await tab('Posts').press('ArrowRight');await assertView('gallery');
  await body.evaluate(el=>{el.scrollTop=100;});const photoScroll=await body.evaluate(el=>el.scrollTop);
  await phone.locator('[data-action=open-photo]').first().dispatchEvent('click');await assertView('photo-viewer');assert.equal(await phone.locator('.trip-navigation').count(),0);
  assert.equal(await phone.locator('[data-action=photo-post]').getAttribute('data-value'),expectedPosts.find(p=>p.photos.length).id,'photo viewer keeps exact source after sorting');
  await back();await assertView('gallery');assert.equal(await body.evaluate(el=>el.scrollTop),photoScroll);await shared('Diario',true);
  await tab('Grupo').click();await assertView('group');await shared('Grupo',false);assert.equal(await tab('Fotos').count(),0);
  await capture('group');
  await phone.getByRole('button',{name:'Invitar al grupo',exact:true}).click();assert.equal(await phone.locator('.trip-navigation').count(),0);await back();await assertView('group');
  await tab('Diario').click();await assertView('gallery');
  await tab('Itinerario').click();await assertView('itinerary');assert.ok(await phone.getByText('martes, 13 de octubre',{exact:true}).isVisible());assert.equal(await body.evaluate(el=>el.scrollTop),itineraryScroll);
  await phone.locator('[data-action=open-activity][data-value=museos]').first().click();assert.equal(await phone.locator('.trip-navigation').count(),0);await back();await assertView('itinerary');
  await tab('Itinerario').press('End');await assertView('group');await tab('Grupo').press('ArrowLeft');await assertView('gallery');
  await back();await assertView('trips');
  await phone.locator('[data-action=trip][data-value=bariloche]').click();await tab('Diario').click();await assertView('feed');await back();
  await phone.locator('[data-action=trip][data-value=italia]').click();await tab('Diario').click();await assertView('gallery');
  for(const scenario of ['empty','error','loading']){await page.locator('#scenario-select').selectOption(scenario,{force:true});await shared('Diario',true);await tab('Posts').click();await shared('Diario',true);await tab('Fotos').click();}
  await page.locator('#scenario-select').selectOption('default',{force:true});await tab('Itinerario').click();
  await body.evaluate(el=>{el.scrollTop=0;});
  await capture('itinerary');
  assert.ok(await phone.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: shared trip/diary tabs, persistent headers, keyboard, per-trip panel/scroll memory, detail returns and list states at 320/390/1280px');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
