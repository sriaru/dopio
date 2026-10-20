import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={}){const m={exports:{}};vm.runInNewContext(ts.transpile(readFileSync(file,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),{module:m,exports:m.exports,require:n=>deps[n]});return m.exports;}
const {releaseEmailReview}=load('lib/ai/release-email.ts',{'./email-analysis':load('lib/ai/email-analysis.ts')});
const projects=[{id:'daybreak',title:'Daybreak',artist:'Daniel'}];
const body=`Hi Alex, I wanted to inform you that we need to move the deadline for Daniel's album, "Daybreak," to November 17th, 2026. Please let me know if you have any questions or need further details. Thanks, Srinithi`;
test('album deadline email routes to release review even without open tasks',()=>{
 const r=releaseEmailReview(body,projects,[]);assert.equal(r.releaseId,'daybreak');assert.equal(r.date,'2026-11-17');assert.match(r.explanation,/No dates have changed/);
});
test('task-specific, ambiguous or inaccessible records do not produce a release shortcut',()=>{
 assert.equal(releaseEmailReview(body,[],[]),null);
 assert.equal(releaseEmailReview(body,[...projects,{...projects[0],id:'duplicate'}],[]),null);
 assert.equal(releaseEmailReview(body+' Or November 18, 2026.',projects,[]),null);
 assert.equal(releaseEmailReview(body+' Move Final artwork.',projects,[{title:'Final artwork'}]),null);
});

test('directional changes distinguish old/new dates, with no year guessing',()=>{
 const saved=[{...projects[0],release_date:'2026-11-17'}];
 for(const text of [
 'Move Daniel’s Daybreak album from November 17, 2026 to November 24, 2026.',
 'Move Daniel’s Daybreak release to November 24, 2026 instead of November 17, 2026.'
 ])assert.equal(releaseEmailReview(text,saved,[]).date,'2026-11-24');
 for(const text of [
 'Do not move Daniel’s Daybreak release to November 24, 2026.',
 'Move Daniel’s Daybreak release to November 24 instead of November 17, 2026.',
 'Move Daniel’s Daybreak release to November 24, 2026 or November 25, 2026.',
 'Move Daniel’s Daybreak release from November 16, 2026 to November 24, 2026.'
 ])assert.equal(releaseEmailReview(text,saved,[]),null);
});
