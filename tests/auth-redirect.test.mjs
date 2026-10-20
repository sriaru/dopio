import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=ts.transpile(readFileSync(new URL('../lib/auth/redirect.ts',import.meta.url),'utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const {safeReturnPath}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('return paths reject external URLs, slash tricks, and auth loops',()=>{
 for(const value of [undefined,null,'','https://evil.example','//evil.example','/\\evil.example','/\r\nevil.example','/login','/auth/callback','/x/../auth/callback','/onboarding'])assert.equal(safeReturnPath(value),'/',String(value));
 assert.equal(safeReturnPath('/artists?sort=name#roster'),'/artists?sort=name#roster');
 assert.equal(safeReturnPath('/projects/123'),'/projects/123');
});
