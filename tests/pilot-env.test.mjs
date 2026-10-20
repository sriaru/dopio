import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePilotEnv} from '../scripts/pilot-env.mjs';
const fixture={NEXT_PUBLIC_APP_URL:'https://dopio.example.com',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',GOOGLE_GMAIL_CLIENT_ID:'fixture',GOOGLE_GMAIL_CLIENT_SECRET:'private-fixture',GOOGLE_GMAIL_REDIRECT_URI:'https://dopio.example.com/gmail/callback',GOOGLE_CALENDAR_REDIRECT_URI:'https://dopio.example.com/calendar/callback',GMAIL_TOKEN_ENCRYPTION_KEY:'ab'.repeat(32),SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key',OPENAI_API_KEY:'fixture'};
test('pilot configuration accepts shared and separate OAuth clients',()=>{
 assert.deepEqual(validatePilotEnv(fixture),[]);
 assert.deepEqual(validatePilotEnv({...fixture,GOOGLE_CALENDAR_CLIENT_ID:'calendar',GOOGLE_CALENDAR_CLIENT_SECRET:'secret'}),[]);
});
test('pilot checks reject localhost, wrong callbacks, missing keys and public secrets without printing values',()=>{
 for(const change of [{NEXT_PUBLIC_APP_URL:'http://localhost:3003'},{GOOGLE_GMAIL_REDIRECT_URI:'https://other.example.com/gmail/callback'},{GOOGLE_CALENDAR_REDIRECT_URI:'https://dopio.example.com/auth/callback'},{SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key',OPENAI_API_KEY:''},{GMAIL_TOKEN_ENCRYPTION_KEY:'bad'},{GOOGLE_CALENDAR_CLIENT_ID:'unpaired'},{NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key',OPENAI_API_KEY:'do-not-print'},{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_do-not-print'}]) {
  const errors=validatePilotEnv({...fixture,...change});assert.ok(errors.length);assert.ok(!errors.join().includes('do-not-print'));
 }
 const service=Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url');
 assert.ok(validatePilotEnv({...fixture,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:`header.${service}.signature`}).length);
});
