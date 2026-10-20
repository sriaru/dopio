import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const {isCurrentEmailSendRequest}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(await readFile('lib/ai/chat-send-intent.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022})).toString('base64'));
test('plain send requests open confirmation for the current message',()=>{
 for(const text of ['can u send that email','Can you send it?','send this email','please send the message','yes, send it now'])assert.equal(isCurrentEmailSendRequest(text),true,text);
});
test('changes, different recipients, negations and questions do not send the old message',()=>{
 for(const text of ['do not send it','send it to bob@example.com','send that email but change the date','why can’t you send it?','send an email to Chris','please tell me how to send it'])assert.equal(isCurrentEmailSendRequest(text),false,text);
});
