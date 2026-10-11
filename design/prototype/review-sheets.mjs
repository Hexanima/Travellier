import {createRequire} from 'node:module';
import {readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire('C:/Users/nicol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const sharp=require('sharp');
const folder=path.resolve(process.argv[2]||'review/v1'),out=path.join(folder,'sheets');await mkdir(out,{recursive:true});
const files=(await readdir(folder)).filter(x=>x.endsWith('.png')&&!x.startsWith('foundations')&&!['desktop.png','mobile.png'].includes(x)).sort();
const manifest=[];
for(let batch=0;batch<files.length;batch+=6){const group=files.slice(batch,batch+6);const overlays=[];for(let i=0;i<group.length;i++){const img=sharp(path.join(folder,group[i]));const meta=await img.metadata();const stats=await img.stats();if(stats.channels.every(c=>c.stdev<1))throw Error('Blank capture '+group[i]);const x=(i%3)*400,y=Math.floor(i/3)*880;const data=await img.resize({width:390,height:844,fit:'inside',withoutEnlargement:true}).png().toBuffer();overlays.push({input:Buffer.from('<svg width="400" height="30"><text x="8" y="20" fill="#16324f" font-size="14">'+group[i]+'</text></svg>'),left:x,top:y});overlays.push({input:data,left:x,top:y+30});manifest.push({file:group[i],width:meta.width,height:meta.height,sheet:'sheet-'+(batch/6+1)+'.png'});}await sharp({create:{width:1200,height:1760,channels:3,background:'#f0f1f1'}}).composite(overlays).png().toFile(path.join(out,'sheet-'+(batch/6+1)+'.png'));}
await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(files.length+' captures opened, decoded and checked for nonblank pixels; '+Math.ceil(files.length/6)+' review sheets.');
