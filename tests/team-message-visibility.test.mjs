import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpile(readFileSync('lib/messages/visibility.ts','utf8'),{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022});
const {visibleMessageIds}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('read receipts include only displayed messages, never background or offscreen arrivals',()=>{
 const messages=[{id:1,top:0,bottom:70},{id:2,top:120,bottom:190},{id:3,top:550,bottom:650},{id:4,top:850,bottom:950}];
 const args=[600,{top:100,bottom:900},messages];
 assert.deepEqual(visibleMessageIds(true,true,true,...args),[2,3]);
 for(const flags of [[false,true,true],[true,false,true],[true,true,false]])assert.deepEqual(visibleMessageIds(...flags,...args),[]);
 assert.deepEqual(visibleMessageIds(true,true,true,600,{top:700,bottom:1000},messages),[]);
});
