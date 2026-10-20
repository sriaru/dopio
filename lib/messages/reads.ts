import type {SupabaseClient} from '@supabase/supabase-js';
// Use the signed-in browser session. RLS and artist_conversation enforce access
// in Postgres; these reads never use a service key or bypass assignments.
export async function readArtistConversation(client:SupabaseClient,workspace:string,artist:string,before?:number){
 const {data,error}=await client.rpc('artist_conversation',{w:workspace,a:artist,before_id:before??null});
 return {data:error?null:data,error:error?'Could not load messages. Check your connection and artist access, then refresh.':null};
}
export async function readArtistTeams(client:SupabaseClient,workspace:string){
 const artists:{record_id:string;name:string;unread?:number;preview?:string|null;latest_at?:string|null}[]=[];
 for(let offset=0;;offset+=1000){
 const {data,error}=await client.rpc('artist_team_overview',{w:workspace,skip:offset});
 if(error)return {artists:[],workspace,error:'Could not refresh artist teams. Apply migration 037 and check workspace access.'};
 artists.push(...data);if(data.length<1000)break;
 }
 return {artists,workspace,error:null};
}
