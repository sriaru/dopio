import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpile(readFileSync('lib/messages/reads.ts','utf8'),{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022});
const {readArtistConversation,readArtistTeams}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('conversation reads use explicit workspace and artist, paginate and discard denied results',async()=>{
 const calls=[];let denied=false;
 const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:{updates:[]},error:denied?{code:'42501'}:null};}};
 assert.equal((await readArtistConversation(client,'company','artist')).error,null);
 await readArtistConversation(client,'company','artist',42);
 assert.deepEqual(calls,[['artist_conversation',{w:'company',a:'artist',before_id:null}],['artist_conversation',{w:'company',a:'artist',before_id:42}]]);
 denied=true;const result=await readArtistConversation(client,'company','artist');assert.equal(result.data,null);assert.ok(result.error);
});
test('roster overview uses the explicit workspace on every page and fails closed',async()=>{
 let fail=false;const calls=[];
 const client={async rpc(name,args){assert.equal(name,'artist_team_overview');calls.push(args);return {data:args.skip===0?Array.from({length:1000},(_,i)=>({record_id:String(i),name:'Artist'})):[{record_id:'last',name:'Last'}],error:fail?{}:null};}};
 assert.equal((await readArtistTeams(client,'company')).artists.length,1001);
 assert.deepEqual(calls,[{w:'company',skip:0},{w:'company',skip:1000}]);
 fail=true;const result=await readArtistTeams(client,'company');assert.deepEqual(result.artists,[]);assert.ok(result.error);
});
