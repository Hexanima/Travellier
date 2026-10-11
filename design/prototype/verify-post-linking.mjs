import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),captures=new URL('./review/post-linking/',import.meta.url);
const types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await mkdir(captures,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
try{
 for(const [name,width,height] of [['mobile',390,844],['desktop',1280,844]]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(3000);page.on('pageerror',e=>errors.push(e.message));
  const phone=page.locator('.phone'),click=label=>phone.getByRole('button',{name:label,exact:true}).click();
  const shot=async(label)=>{await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:fileURLToPath(new URL(name+'-'+label+'.png',captures))});};
  const fresh=screen=>page.goto('http://127.0.0.1:'+server.address().port+'/?mode=app&screen='+screen);
  await fresh('compose');
  await phone.locator('[name=description]').fill('Otra perspectiva del paseo.');
  await shot('composer');
  assert.equal(await phone.getByRole('button',{name:/^Vincular a(?: |$)/}).count(),1);
  assert.equal(await phone.locator('[data-value=spontaneous]').count(),0);
  await phone.locator('[data-value=post-links]').click();await shot('choices');
  assert.equal(await phone.locator('select').count(),0);
  await phone.locator('[data-action=link-kind][data-value=post]').click();
  await phone.getByRole('button',{name:'Volver',exact:true}).click();
  assert.equal(await phone.locator('[data-action=link-kind]').count(),2);
  await phone.locator('[data-action=link-kind][data-value=post]').click();
  await phone.locator('[data-action=link-post][data-value=cafe-post]').click();
  assert.equal(await phone.locator('[name=description]').inputValue(),'Otra perspectiva del paseo.');
  await click('Publicar recuerdo');
  assert.ok(await phone.getByText('Post padre',{exact:true}).isVisible());
  await click('Editar post');
  await phone.locator('[data-value=post-links]').click();
  await phone.locator('[data-action=link-kind][data-value=activity]').click();await shot('activities');
  await phone.locator('[data-action=link-activity][data-value=paseo]').click();
  await click('Guardar cambios');
  assert.ok(await phone.getByText('Actividad vinculada',{exact:true}).isVisible());
  assert.equal(await phone.getByText('Post padre',{exact:true}).count(),0);

  await fresh('post-edit');
  const original=await phone.locator('[name=description]').inputValue();
  await phone.locator('[data-value=post-links]').click();
  await phone.locator('[data-action=link-kind][data-value=activity]').click();
  await click('Crear actividad espontánea');await shot('spontaneous');
  await phone.locator('[name=name]').fill('Café al sol');
  // Cancelling never changes the previously selected relationship.
  await phone.getByRole('button',{name:'Volver',exact:true}).click();
  await phone.getByRole('button',{name:'Volver',exact:true}).click();
  await phone.getByRole('button',{name:'Volver',exact:true}).click();
  assert.ok(await phone.getByText('Actividad · Paseo por Trastevere',{exact:true}).isVisible());
  await phone.locator('[data-value=post-links]').click();
  await phone.locator('[data-action=link-kind][data-value=activity]').click();
  await click('Crear actividad espontánea');
  assert.equal(await phone.locator('[name=name]').inputValue(),'Café al sol');
  await phone.locator('[name=date]').fill('2026-10-12');await phone.locator('[name=time]').fill('08:00');
  await click('Agregar al recuerdo');assert.ok(await phone.locator('.inline-error').isVisible());
  await phone.locator('[name=time]').fill('16:00');await click('Agregar al recuerdo');
  assert.equal(await phone.locator('[name=description]').inputValue(),original);
  assert.equal(await phone.locator('.composer-photos img').count(),3);
  await click('Guardar cambios');
  assert.ok(await phone.getByText('Café al sol',{exact:true}).isVisible());
  await phone.getByRole('tab',{name:'Comentarios · 2'}).click();
  assert.ok(await phone.getByText('La mejor forma de arrancar.',{exact:false}).isVisible());
  await phone.getByRole('tab',{name:/^Recuerdos ·/}).click();
  assert.ok(await phone.getByText('Gasto de este post',{exact:true}).isVisible());
  await phone.locator('[data-value=post-links]').click();
  await phone.locator('[data-action=link-kind][data-value=post]').click();
  assert.equal(await phone.locator('[data-action=link-post][data-value=cafe-post]').count(),0);
  await phone.locator('[data-action=link-post][data-value=museum-post]').click();
  assert.ok(await phone.getByText('Post padre',{exact:true}).isVisible());
  await phone.locator('[data-value=post-links]').click();await click('Quitar vínculo');
  assert.equal(await phone.getByText('Post padre',{exact:true}).count(),0);
  assert.ok(await phone.getByText('Gasto de este post',{exact:true}).isVisible());

  // Existing transport associations survive ordinary edits; no third picker is introduced.
  await fresh('feed');
  await phone.locator('[data-record=flight-post]').click();await click('Editar post');
  await click('Guardar cambios');
  assert.ok(await phone.getByText('Transporte vinculado',{exact:true}).isVisible());
  assert.ok(await phone.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: create/edit, two-step linking, back/cancel, spontaneous validation, comments/photos/expenses and existing transport, mobile + desktop');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
