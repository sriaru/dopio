import type {SupabaseClient} from '@supabase/supabase-js';
// Treat realtime as invalidation, never as an authorization or rendering source.
export function subscribeArtistMessages(client:SupabaseClient,workspace:string,artist:string,refresh:()=>void,status:(live:boolean)=>void){
 let active=true;
 const channel=client.channel(`artist-messages:${workspace}:${artist}`)
 .on('postgres_changes',{event:'INSERT',schema:'public',table:'artist_updates',filter:`artist_id=eq.${artist}`},payload=>{
 if(active&&payload.new.workspace_id===workspace&&payload.new.artist_id===artist)refresh();
 }).subscribe(state=>{if(!active)return;status(state==='SUBSCRIBED');if(state==='SUBSCRIBED')refresh();});
 return ()=>{active=false;void client.removeChannel(channel);};
}
