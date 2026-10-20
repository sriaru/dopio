import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const {cleanChatText}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(await readFile('lib/ai/chat-text.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022})).toString('base64'));
test('chat prose removes escaped formatting and space entities without interpreting HTML',()=>{
 assert.equal(cleanChatText('\\*\\*Artist:\\*\\* Daniel &#x20;\n1\\. \\*\\*Finalize tracklist\\*\\*'),'Artist: Daniel  \n1. Finalize tracklist');
 assert.equal(cleanChatText('<script>alert(1)</script>'),'<script>alert(1)</script>');
});
