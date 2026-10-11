import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),captures=new URL('./review/post-submit/',import.meta.url);
const types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await mkdir(captures,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
try{
 for(const [name,width,height] of [['mobile',390,844],['desktop',1280,844]]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(3000);page.on('pageerror',e=>errors.push(e.message));
  const phone=page.locator('.phone'),click=label=>phone.getByRole('button',{name:label,exact:true}).click();
  const fresh=screen=>page.goto('http://127.0.0.1:'+server.address().port+'/?mode=app&screen='+screen);
  const scenario=value=>page.locator('#scenario-select').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},value);
  const shot=async(label)=>{await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:fileURLToPath(new URL(name+'-'+label+'.png',captures))});};
  await fresh('compose');await phone.locator('#post-design button[type=submit]').scrollIntoViewIfNeeded();await shot('new');
  await click('Publicar recuerdo');
  assert.equal(await phone.getAttribute('data-screen'),'compose');assert.ok(await phone.locator('.inline-error').isVisible());
  await phone.locator('[name=description]').fill('Un café antes de seguir.');
  await scenario('error');await click('Publicar recuerdo');
  assert.equal(await phone.getAttribute('data-screen'),'compose');assert.equal(await phone.locator('[name=description]').inputValue(),'Un café antes de seguir.');
  assert.ok(await phone.locator('.inline-error').isVisible());
  await click('Publicar recuerdo');assert.equal(await phone.getAttribute('data-screen'),'post');
  await click('Editar post');await phone.locator('[name=description]').fill('Un café y una larga sobremesa.');
  await shot('edit');await click('Guardar cambios');assert.equal(await phone.getAttribute('data-screen'),'post');
  assert.ok(await phone.getByText('Un café y una larga sobremesa.',{exact:true}).isVisible());
  await fresh('compose');await phone.locator('[name=description]').fill('Todavía escribiendo.');
  await scenario('loading');assert.ok(await phone.getByRole('button',{name:'Publicando…',exact:true}).isDisabled());
  assert.equal(await phone.getAttribute('data-screen'),'compose');
  assert.equal(await phone.getByRole('button',{name:'Revisar publicación',exact:true}).count(),0);
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: direct create/edit confirmation, validation and failed submission retain draft, retry + disabled loading; desktop/mobile');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
