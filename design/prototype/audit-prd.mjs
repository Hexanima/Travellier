// Read-only audit of the prototype: fixtures live in isolated memory, never in a user's browser.
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {catalog} from './public/catalog.mjs';
import {createState} from './public/state.mjs';
import {createSimulation,currentTrip,localDate,localTime,localInstant,command} from './public/simulation.mjs';
import {renderScreen} from './public/playable-screens.mjs';
const {chromium}=createRequire(import.meta.url)('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('./public/',import.meta.url),types={html:'text/html',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml',jpg:'image/jpeg',woff2:'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=new URL(path==='/'?'index.html':'.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const results={generatedAt:new Date().toISOString(),scope:'HTML prototype, not native or production validation',views:[],errors:[],diagnostics:{}},shots=[];
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();page.on('pageerror',error=>results.errors.push(error.message));
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});
  for(const {id} of catalog){
   if(id==='foundations')continue;
   await page.goto('http://127.0.0.1:'+server.address().port+'/?mode=app&screen='+id);await page.evaluate(()=>document.fonts.ready);
   results.views.push(await page.locator('.phone').evaluate((phone,{id,width})=>{
    const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden';};
    const targets=[...phone.querySelectorAll('button,a,input:not([type=hidden]),select,textarea')].filter(visible);
    return {screen:id,width,overflow:phone.querySelector('.phone-body').scrollWidth>phone.querySelector('.phone-body').clientWidth,
     smallTargets:targets.map(el=>({name:el.getAttribute('aria-label')||el.textContent.trim()||el.name,width:Math.round(el.getBoundingClientRect().width),height:Math.round(el.getBoundingClientRect().height)})).filter(r=>r.width<44||r.height<44),
     unlabeledFields:[...phone.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(visible).filter(el=>!el.labels?.length&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')).map(el=>el.name),
     brokenImages:[...phone.querySelectorAll('img')].filter(el=>el.complete&&!el.naturalWidth).length};
   },{id,width}));
   if([390,1280].includes(width)&&['itinerary','participation','feed','gallery','expense-edit','balance'].includes(id))shots.push([width+'-'+id+'.png',await page.screenshot()]);
  }
  console.log('Read-only audit: '+(catalog.length-1)+' phone views at '+width+'px');
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const sim=createSimulation(),trip=currentTrip(sim),activity=trip.activities[0];
activity.scheduledAt=localInstant('2026-10-12','23:30');activity.durationMinutes=90;
const state={...createState(),sim,date:'2026-10-12',destinationId:'roma',activityId:activity.id};
results.diagnostics.overnightFacts=renderScreen({...state,view:'participation'}).match(/<section class="detail-facts">[\s\S]*?<\/section>/)?.[0];
const late={...trip.posts[0],id:'late-prd-audit',title:'Recuerdo publicado después',activityId:'museos',parentPostId:null,transportId:null,createdAt:localInstant('2026-10-16','12:00'),day:'2026-10-16'};
trip.posts.push(late);
results.diagnostics.linkedMemoryOnPublicationDay=renderScreen({...state,view:'itinerary',date:'2026-10-16'}).includes(late.id);
results.diagnostics.linkedMemoryOnActivityDay=renderScreen({...state,view:'itinerary',date:'2026-10-13'}).includes(late.id);
const fresh=createSimulation(),plan=currentTrip(fresh).activities[0],before=fresh.notifications.length;
const edited=command(fresh,{type:'save-activity',id:plan.id,data:{name:plan.title+' actualizado',description:'Nueva descripción',destination:plan.destinationId,date:localDate(plan.scheduledAt),time:localTime(plan.scheduledAt),durationMinutes:plan.durationMinutes,mapsUrl:plan.mapsUrl}});
results.diagnostics.contentEditError=edited.error||null;
results.diagnostics.contentEditNotifications=(edited.state?.notifications.length??before)-before;
const out=new URL('./review/prd-audit/',import.meta.url);await mkdir(out,{recursive:true});
for(const [name,buffer]of shots)await writeFile(new URL(name,out),buffer);
await writeFile(new URL('evidence.json',out),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({views:results.views.length,errors:results.errors,overflow:results.views.filter(x=>x.overflow),smallTargets:results.views.filter(x=>x.smallTargets.length),unlabeledFields:results.views.filter(x=>x.unlabeledFields.length),diagnostics:results.diagnostics},null,2));
