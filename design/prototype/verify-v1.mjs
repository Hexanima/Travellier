import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {catalog} from './public/catalog.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1200}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
const base=new URL('./review/v1/',import.meta.url);await mkdir(base,{recursive:true});
const file=name=>new URL(name,base).pathname.replace(/^\/([A-Z]:)/,'$1');
const nav=async view=>{await page.locator('#scenario-select').selectOption('default');await page.locator('#screen-select').selectOption(view);};
async function capture(name){await page.evaluate(()=>{scrollTo(0,0);document.querySelector('.phone-body')?.scrollTo(0,0);});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const clip=await page.locator('.phone').evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};});await page.screenshot({path:file(name+'.png'),clip,fullPage:true,animations:'disabled'});}
async function fullContent(name){await page.locator('.phone').evaluate(el=>el.style.height=(el.offsetHeight+Math.max(0,el.querySelector('.phone-body').scrollHeight-el.querySelector('.phone-body').clientHeight))+'px');await capture(name+'-content');}
const report=[];
await page.goto('http://127.0.0.1:4173/');await page.evaluate(()=>document.fonts.ready);
for(const width of [1280,320]){
 await page.setViewportSize({width,height:1200});
 for(const {id} of catalog){
  await nav(id);await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>Promise.all([...document.images].map(x=>x.decode())));
  const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth>innerWidth,body:document.querySelector('.phone-body')?document.querySelector('.phone-body').scrollWidth>document.querySelector('.phone-body').clientWidth:false,broken:[...document.images].filter(x=>!x.complete||x.naturalWidth===0).length}));
  assert.equal(overflow.page,false,id+' page '+width);assert.equal(overflow.body,false,id+' body '+width);assert.equal(overflow.broken,0,id+' broken image');
  if(id==='foundations'){await page.screenshot({path:file('foundations-'+width+'.png'),fullPage:true});continue;}
  assert.equal(await page.locator('.phone').getAttribute('data-screen'),id);await capture(id+'-'+width);
  // Capture long content fully through a temporary expansion, in addition to the actual viewport.
  if(width===1280){const long=await page.locator('.phone-body').evaluate(el=>el.scrollHeight>el.clientHeight+40);if(long){await page.locator('.phone').evaluate(el=>el.style.height=(el.offsetHeight+el.querySelector('.phone-body').scrollHeight-el.querySelector('.phone-body').clientHeight)+'px');await capture(id+'-content');}}
  report.push({id,width,...overflow});
 }
}
await page.setViewportSize({width:1280,height:1200});
await nav('compose');await page.locator('[name="description"]').fill('<b>Un recuerdo</b>');await page.locator('.list-row[data-value="post-links"]').click();
for(const value of ['activity','post','transport'])await page.locator('[data-action="link"][data-value="'+value+'"]').click();assert.equal(await page.locator('.link-choice[aria-pressed=true]').count(),3);await page.locator('.v1-content [data-value="compose"]').click();assert.equal(await page.locator('[name="description"]').inputValue(),'<b>Un recuerdo</b>');
await nav('expense-edit');assert.equal(await page.locator('[name="paidBy"]').count(),0);await page.locator('#expense-select').selectOption('balance');assert.equal(await page.locator('[name="paidBy"]').count(),1);await capture('expense-balance');
await nav('group');await page.locator('#role-select').selectOption('participant');assert.equal(await page.getByRole('button',{name:'Expulsar',exact:true}).count(),0);await capture('group-participant');await nav('trip-settings');assert.equal(await page.getByRole('button',{name:'Eliminar viaje',exact:true}).count(),0);await page.locator('#role-select').selectOption('admin');
await nav('transport-edit');for(const type of ['bus_long','bus_local','car','other','flight']){await page.locator('[name="transportType"]').selectOption(type);assert.equal(await page.locator('[name="transportType"]').inputValue(),type);if(type==='bus_local')assert.equal(await page.locator('.urban-steps fieldset').count(),2);await capture('transport-'+type);await fullContent('transport-'+type);}
await nav('comments');await page.locator('[name="comment"]').fill('<b>Qué lindo</b>');await page.locator('.comment-form button').click();assert.equal(await page.locator('.comment-thread b').count(),0);await page.locator('[data-action="comment-like"][data-value="martin"]').click();assert.equal(await page.locator('[data-action="comment-like"][data-value="martin"]').getAttribute('aria-pressed'),'true');await capture('comments-interaction');
for(const [id,scenario] of [['feed','empty'],['discover','empty'],['expenses','empty'],['notifications','empty'],['group','empty'],['feed','error'],['feed','loading'],['upload','error'],['upload','loading'],['upload','success'],['push-permission','denied'],['push-permission','success'],['calendar-permission','denied'],['photo-permission','denied'],['compose','error']]){await nav(id);await page.locator('#scenario-select').selectOption(scenario);if(id==='compose')await page.locator('#post-design button[type="submit"]').click();await capture(id+'-'+scenario);await fullContent(id+'-'+scenario);}
await page.locator('#expense-select').selectOption('register');await nav('trips');await page.screenshot({path:file('desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:1200});await page.screenshot({path:file('mobile.png'),fullPage:true});
assert.deepEqual(errors,[]);await writeFile(file('verification.json'),JSON.stringify({screens:catalog.length,report,errors},null,2));
console.log('V1 verification passed: '+catalog.length+' screens at 1280/320, forms, independent links, comment likes, admin/participant, five transport types and 14 state specimens.');
await browser.close();
