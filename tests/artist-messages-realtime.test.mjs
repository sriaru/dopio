import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=ts.transpile(await readFile('lib/messages/realtime.ts','utf8'),{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022});
const {subscribeArtistMessages}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('realtime scopes insert subscriptions, reloads on reconnect, ignores foreign events and cleans up',()=>{
 let handler,state,removed=0,refreshes=0,filter;const statuses=[];
 const channel={on(type,options,callback){assert.equal(type,'postgres_changes');filter=options;handler=callback;return this;},subscribe(callback){state=callback;return this;}};
 const client={channel(name){assert.equal(name,'artist-messages:w:a');return channel;},removeChannel(c){assert.equal(c,channel);removed++;return Promise.resolve();}};
 const stop=subscribeArtistMessages(client,'w','a',()=>refreshes++,s=>statuses.push(s));
 assert.deepEqual(filter,{event:'INSERT',schema:'public',table:'artist_updates',filter:'artist_id=eq.a'});
 state('SUBSCRIBED');assert.equal(refreshes,1);
 handler({new:{workspace_id:'other',artist_id:'a'}});handler({new:{workspace_id:'w',artist_id:'other'}});assert.equal(refreshes,1);
 handler({new:{workspace_id:'w',artist_id:'a'}});assert.equal(refreshes,2);
 state('CHANNEL_ERROR');state('SUBSCRIBED');assert.deepEqual(statuses,[true,false,true]);assert.equal(refreshes,3);
 stop();handler({new:{workspace_id:'w',artist_id:'a'}});state('SUBSCRIBED');assert.equal(refreshes,3);assert.equal(removed,1);
});
