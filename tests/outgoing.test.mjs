import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=ts.transpile(readFileSync('lib/gmail/outgoing.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const {encodeOutgoing}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('outgoing MIME preserves Unicode and rejects header injection or multiple recipients',()=>{
 const raw=encodeOutgoing('me@example.com','you@example.com','Daniel — update','Hello 🌟\nNext line','abc123');
 const mime=Buffer.from(raw,'base64url').toString();assert.match(mime,/To: you@example.com\r\n/);assert.match(mime,/Content-Transfer-Encoding: base64/);
 assert.equal(Buffer.from(mime.split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString(),'Hello 🌟\r\nNext line');
 for(const recipient of ['a@example.com\r\nBcc: b@example.com','a@example.com,b@example.com','bad'])assert.throws(()=>encodeOutgoing('me@example.com',recipient,'Hello','Body','abc123'));
 assert.throws(()=>encodeOutgoing('me@example.com','you@example.com','Hello\nBcc: evil','Body','abc123'));
});
