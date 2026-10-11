import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),captures=new URL('./review/publication-date/',import.meta.url);
const types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await mkdir(captures,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
const published=new Date('2026-10-28T21:35:00-03:00').toISOString();
try{
 for(const [name,width,height] of [['compact',320,740],['mobile',390,844],['desktop',1280,844]]){
  const page=await browser.newPage({viewport:{width,height},timezoneId:'America/Argentina/Buenos_Aires'});page.setDefaultTimeout(3500);page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date(published));
  const phone=page.locator('.phone'),click=label=>phone.getByRole('button',{name:label,exact:true}).click();
  const fresh=screen=>page.goto('http://127.0.0.1:'+server.address().port+'/?mode=app&screen='+screen);
  const shot=async(label)=>{
   assert.ok(await phone.evaluate(el=>el.scrollWidth<=el.clientWidth),'no horizontal overflow');
   const contrasts=await phone.evaluate(el=>{
    const luminance=value=>{const rgb=value.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
    const bg=luminance(getComputedStyle(el).backgroundColor);
    return [...el.querySelectorAll('.gallery-byline,.publication-date')].map(x=>{const fg=luminance(getComputedStyle(x).color);return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);});
   });assert.ok(contrasts.every(ratio=>ratio>=4.5),'new metadata meets text contrast');
   if(name==='compact')return;await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:fileURLToPath(new URL(name+'-'+label+'.png',captures))});
  };
  await fresh('feed');await click('Compartir un recuerdo');
  assert.equal(await phone.locator('[name=day],[name=date],[name=time]').count(),0);
  await phone.locator('[name=description]').fill('El café que nos quedó pendiente compartir.');await shot('compose');
  await click('Agregar fotos');await phone.locator('[data-action=pick-photo][data-value=cafe]').click();await click('Agregar al recuerdo');
  await phone.locator('[data-value=post-links]').click();await phone.locator('[data-action=link-kind][data-value=activity]').click();await phone.locator('[data-action=link-activity][data-value=paseo]').click();
  await click('Publicar recuerdo');assert.equal(await phone.getAttribute('data-screen'),'post');
  assert.equal(await phone.locator('.post-author small').textContent(),'28 oct · 21:35');
  await click('Editar post');assert.equal(await phone.locator('.publication-date time').getAttribute('datetime'),published);
  assert.equal(await phone.locator('[name=day],[name=date],[name=time]').count(),0);await shot('edit');
  await page.clock.setFixedTime(new Date('2026-10-30T22:10:00-03:00'));
  await phone.locator('[name=description]').fill('El café y la sobremesa que nos faltaba compartir.');await click('Guardar cambios');
  assert.equal(await phone.locator('.post-author small').textContent(),'28 oct · 21:35');
  await click('Volver');assert.equal(await phone.getAttribute('data-screen'),'feed');
  assert.equal(await phone.locator('article').first().locator('p').first().textContent(),'El café y la sobremesa que nos faltaba compartir.');
  await phone.getByRole('tab',{name:'Fotos',exact:true}).click();
  assert.equal(await phone.locator('.gallery-item').first().locator('small').textContent(),'El café y la sobremesa que nos faltaba compartir');
  assert.equal(await phone.locator('.gallery-item').first().locator('.gallery-byline').textContent(),'Nico · 28 oct');await shot('gallery');
  await phone.locator('.gallery-item').first().click();assert.equal(await phone.locator('.viewer-photo time').getAttribute('datetime'),published);
  const fullDate=await phone.locator('.viewer-photo time').textContent();assert.match(fullDate,/28.*oct.*2026 · 21:35/);await shot('viewer');
  await click('Ver recuerdo');assert.ok((await phone.locator('.photo-frame img').getAttribute('src')).endsWith('cafe.jpg'));
  await click('Volver');await click('Volver');await phone.getByRole('tab',{name:'Itinerario',exact:true}).click();
  await phone.locator('[data-action=date][data-value="2026-10-12"]').click();
  assert.ok(await phone.getByRole('button',{name:/^El café y la sobremesa/}).isVisible());
  assert.equal(await phone.locator('[data-action=date]').last().getAttribute('data-value'),'2026-10-23');

  await fresh('trips');await click('Finalizados');await phone.locator('[data-action=trip][data-value=mendoza]').click();
  await phone.getByRole('tab',{name:'Diario',exact:true}).click();
  await click('Compartir un recuerdo');
  await phone.locator('[name=description]').fill('Por fin las fotos de Mendoza.');await click('Publicar recuerdo');
  assert.equal(await phone.getAttribute('data-screen'),'post');assert.equal(await phone.locator('.post-author small').textContent(),'30 oct · 22:10');
  await click('Volver');assert.equal(await phone.getAttribute('data-screen'),'feed');
  assert.equal(await phone.locator('article').first().locator('p').first().textContent(),'Por fin las fotos de Mendoza.');
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: automatic actual publication date, edit preserves original, chronological posts/photos, source viewer, late activity memories and finished-trip publication at 320/390/1280px');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
