'use server';
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import {uuidPattern} from '@/lib/workspace/validation';
export async function artistConversation(artist:string,before?:number){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(artist)||before!==undefined&&(!Number.isSafeInteger(before)||before<1))return {error:'Choose an artist.',data:null};
 const {data,error}=await supabase.rpc('artist_conversation',{w:workspace.id,a:artist,before_id:before??null});
 return {data:error?null:data,error:error?'Could not load artist updates. Check your assignment and that migration 035 has been applied.':null};
}
export async function postArtistUpdate(artist:string,request:string,message:string,mentions:string[]){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(artist)||!uuidPattern.test(request)||typeof message!=='string'||!message.trim()||message.length>4000||!Array.isArray(mentions)||mentions.length>50||mentions.some(id=>!uuidPattern.test(id)))return {error:'Enter a message and mention only this artist’s team.'};
 const {error}=await supabase.rpc('post_artist_update',{w:workspace.id,a:artist,request,message,mentioned:mentions});
 return {error:error?'Message was not confirmed. Check your artist access, then retry the same message.':null};
}
export async function artistUpdatePreferences(artist:string,seen:number,mode:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(artist)||!Number.isSafeInteger(seen)||seen<0||!['all','mentions','muted'].includes(mode))return {error:'Invalid update preference.'};
 const {error}=await supabase.rpc('set_artist_update_preferences',{w:workspace.id,a:artist,seen,mode});
 return {error:error?'Could not save your notification preference.':null};
}

export async function listArtistTeams(){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const artists:{record_id:string;name:string}[]=[];
 for(let offset=0;;offset+=1000){
 const {data,error}=await supabase.from('artists').select('record_id,name').eq('workspace_id',workspace.id).is('archived_at',null).order('name').order('record_id').range(offset,offset+999);
 if(error)return {error:'Could not refresh the artist teams. Check your workspace access and try again.',artists:[],workspace:workspace.id};
 artists.push(...data);if(data.length<1000)break;
 }
 return {error:null,artists,workspace:workspace.id};
}
