import test from 'node:test';
import assert from 'node:assert/strict';
import {foundations} from './public/exported-screens.mjs';
const html=()=>foundations({asset:()=>'<span></span>',stitch:()=>'<span class="source-stitch"></span>'});
test('foundations exposes supplied control states without a real loading request',()=>{
 const source=html();assert.match(source,/aria-busy="true"/);assert.match(source,/sample-pressed/);assert.match(source,/aria-invalid="true"/);assert.match(source,/input[^>]*disabled/);
});
test('foundation card specimens retain route marks, members and participation',()=>{
 const source=html();assert.equal((source.match(/source-stitch/g)||[]).length,2);assert.match(source,/NC · AL · \+2/);assert.match(source,/Vas a participar · 3 del grupo/);
});
