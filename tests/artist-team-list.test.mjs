import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
test('Messages refreshes its roster from the active workspace rather than the dashboard snapshot',async()=>{
 let artists=[{record_id:'one',name:'Daniel'}];const filters=[];
 const supabase={from(table){assert.equal(table,'artists');const q={select(){return q;},eq(key,value){filters.push([key,value]);return q;},is(key,value){assert.equal(key,'archived_at');assert.equal(value,null);return q;},order(){return q;},range:async()=>({data:artists,error:null})};return q;}};
 const mod={exports:{}};
 vm.runInNewContext(ts.transpile(readFileSync('app/workspace/artist-update-actions.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),{module:mod,exports:mod.exports,require(name){return name.includes('session')?{requireWorkspace:async()=>({workspace:{id:'company'}}),requireUser:async()=>({supabase})}:{uuidPattern:/./};}});
 assert.equal((await mod.exports.listArtistTeams()).artists.length,1);
 artists=[...artists,{record_id:'two',name:'New artist from another manager'}];assert.equal((await mod.exports.listArtistTeams()).artists.length,2);
 assert.deepEqual(filters,[['workspace_id','company'],['workspace_id','company']]);
});
