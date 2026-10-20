import {NextResponse,type NextRequest} from 'next/server';
import {cookies} from 'next/headers';
import {randomUUID} from 'node:crypto';
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import {calendarConfig,CALENDAR_SCOPES} from '@/lib/calendar/config';
import {unseal,seal,validPendingOAuth,type PendingOAuth} from '@/lib/gmail/security';
import {tokenRequest} from '@/lib/gmail/api';
export const runtime='nodejs';
export async function GET(request:NextRequest){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();const jar=await cookies();const cookie=jar.get('aura-calendar-oauth')?.value;
 jar.set('aura-calendar-oauth','',{httpOnly:true,sameSite:'lax',path:'/calendar',maxAge:0});let outcome='failed';let setup=false;let stage='configuration';
 try{
 const c=calendarConfig();if(request.nextUrl.origin!==c.origin)throw new Error();
 stage='session';
 const p=JSON.parse(unseal(cookie??'','calendar-oauth',c.key)) as PendingOAuth;
 if(!validPendingOAuth(p,request.nextUrl.searchParams.get('state')??'',user.id,workspace.id))throw new Error();
 setup=p.returnTo==='/get-started';
 if(request.nextUrl.searchParams.has('error'))outcome='cancelled';
 else{
 const code=request.nextUrl.searchParams.get('code');if(!code)throw new Error();
 stage='token';
 const t=await tokenRequest({client_id:c.clientId,client_secret:c.clientSecret,redirect_uri:c.redirectUri,grant_type:'authorization_code',code,code_verifier:p.verifier});
 if(!t.refresh_token || !CALENDAR_SCOPES.every(s=>t.scope?.split(' ').includes(s)))outcome='permission';
 else{
 stage='profile';
 const response=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{headers:{Authorization:`Bearer ${t.access_token}`},cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error();const profile=await response.json();
 if(typeof profile.email!=='string' || !profile.verified_email || profile.email.length>254)throw new Error();
 const email=profile.email.toLowerCase();
 stage='database';
 const {data:old,error:readError}=await supabase.from('calendar_connections').select('email,connection_id,lease_until').eq('workspace_id',workspace.id).eq('user_id',user.id).maybeSingle();
 if(readError)throw new Error();
 if(old && old.email!==email)outcome='account';
 else if(old?.lease_until && Date.parse(old.lease_until)>Date.now())outcome='busy';
 else{
 const id=randomUUID();const values={connection_id:id,email,encrypted_refresh_token:seal(t.refresh_token,`calendar:${workspace.id}:${user.id}:${id}:${email}`,c.key)};
 const result=old?await supabase.from('calendar_connections').update(values).eq('workspace_id',workspace.id).eq('user_id',user.id).eq('connection_id',old.connection_id).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).select('connection_id'):await supabase.from('calendar_connections').insert({...values,workspace_id:workspace.id,user_id:user.id}).select('connection_id');
 if(result.error || !result.data?.length)throw new Error();outcome='connected';
 }
 }
 }
 }catch{outcome=stage;/* Only fixed stage labels; never expose credentials or provider responses. */}
 const response=NextResponse.redirect(new URL(setup?`/get-started?calendar=${outcome}`:`/?view=Calendar&calendar=${outcome}`,request.url));response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');return response;
}
