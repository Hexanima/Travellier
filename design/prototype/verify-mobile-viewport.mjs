import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const publicRoot=new URL('./public/',import.meta.url);
const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=new URL(pathname==='/'?'index.html':'.'+pathname,publicRoot);
  if(!file.href.startsWith(publicRoot.href))throw Error('Outside public');
  const extension=file.pathname.slice(file.pathname.lastIndexOf('.'));
  const body=await readFile(file);
  res.writeHead(200,{'Content-Type':types[extension]||'application/octet-stream'});
  res.end(body);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],captures=new URL('./review/mobile-viewport/',import.meta.url);
await mkdir(captures,{recursive:true});
try{
 for(const {name,width,height,insets} of [
  {name:'mobile-contained',width:390,height:713,insets:{top:0,bottom:51}},
  {name:'mobile-no-inset',width:390,height:700,insets:{top:0,bottom:0}},
  {name:'landscape-safe',width:844,height:390,insets:{top:0,bottom:21,left:44,right:44}},
  {name:'desktop',width:1280,height:844,insets:{top:0,bottom:0}},
 ]){
  const page=await browser.newPage({viewport:{width,height},isMobile:width<1000});
  page.on('pageerror',e=>errors.push(e.message));
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets});
  await page.goto('http://127.0.0.1:'+server.address().port+'/?v=playable&mode=app');
  await page.locator('.main-nav').waitFor();
  const check=async()=>{
   const metrics=await page.evaluate(()=>{
    const phone=document.querySelector('.phone'),nav=document.querySelector('.main-nav');
    return{height:innerHeight,phoneBottom:phone.getBoundingClientRect().bottom,navBottom:nav?.getBoundingClientRect().bottom,navHeight:nav?.getBoundingClientRect().height,buttonBottom:nav?Math.max(...[...nav.children].map(el=>el.getBoundingClientRect().bottom)):null,pageOverflow:document.documentElement.scrollHeight>innerHeight};
   });
   assert.equal(metrics.phoneBottom,metrics.height,name+' app fills viewport');
   assert.equal(metrics.navBottom,metrics.height,name+' navbar background reaches the viewport bottom');
   // The browser contains its viewport inside the system's safe area. Do not reserve that space twice.
   assert.equal(metrics.navHeight,78,name+' navbar must not grow with system/browser insets');
   assert.equal(metrics.height-metrics.buttonBottom,12,name+' no extra white strip below navbar buttons');
   assert.equal(metrics.pageOverflow,false,name+' only inner content scrolls');
  };
  await check();
  assert.match(await page.locator('meta[name=viewport]').getAttribute('content'),/viewport-fit=contain/,'Browser manages the system safe area');
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:fileURLToPath(new URL(name+'.png',captures)),fullPage:true});
  await page.locator('.main-nav').getByRole('button',{name:'Perfil',exact:true}).click();
  await check();
  await page.setViewportSize({width,height:height-100});
  await check();
  await page.locator('.main-nav').getByRole('button',{name:'Viajes',exact:true}).click();
  await check();
  await page.locator('.phone').getByRole('button',{name:'Crear viaje',exact:true}).click();
  const phone=await page.locator('.phone').boundingBox();
  assert.equal(phone.y+phone.height,height-100,name+' form still fills viewport without a navbar');
  const bottomPadding=await page.locator('.phone-body').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom));
  assert.equal(bottomPadding,0,name+' do not duplicate browser-managed safe areas in forms');
  await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: compact navbar without duplicate safe-area space, browser-contained viewport, portrait/landscape/desktop and resize');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
