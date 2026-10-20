'use client';
import {useEffect,useRef,useState} from 'react';
import {createClient} from '@/lib/supabase/client';
import {visibleMessageIds} from '@/lib/messages/visibility';
import {readArtistConversation} from '@/lib/messages/reads';
import {subscribeArtistMessages} from '@/lib/messages/realtime';
import Link from 'next/link';
import styles from './ArtistMessages.module.css';
import TeamMessageAI from './TeamMessageAI';
import ArtistBrief from './ArtistBrief';
import {postArtistUpdate,artistUpdatePreferences} from '@/app/workspace/artist-update-actions';
type Update={id:number;kind:string;body:string;actor_name:string;created_at:string;mentions:string[];record_id:string|null;previous_date:string|null;new_date:string|null};
type Feed={unread_ids?:number[];can_post:boolean;notifications:string;unread:number;team:{id:string;name:string}[];updates:Update[]};
export default function ArtistUpdates({artist,workspace,conversationOnly=false,onTeam}:{artist:string;workspace:string;conversationOnly?:boolean;onTeam?:(artist:string,team:{id:string;name:string}[])=>void}){
 const [tab,setTab]=useState(conversationOnly?'updates':'brief'),[feed,setFeed]=useState<Feed|null>(null),[error,setError]=useState(''),[text,setText]=useState(''),[mentions,setMentions]=useState<string[]>([]),[busy,setBusy]=useState(false),[older,setOlder]=useState<Update[]>([]),[more,setMore]=useState(true);
 useEffect(()=>{onTeam?.(artist,feed?.team??[]);},[artist,feed,onTeam]);
 const request=useRef(''),guard=useRef(false);
 const history=useRef<HTMLDivElement>(null);
 const lastMessage=useRef<number|null>(null);
 const [liveUpdates,setLiveUpdates]=useState(false),[newMessages,setNewMessages]=useState(false),[sendStatus,setSendStatus]=useState('');
 const readConfirmed=useRef(new Set<number>());
 const [readTick,setReadTick]=useState(0);
 const nearBottom=useRef(true);
 const prependHeight=useRef<number|null>(null);
 useEffect(()=>{
 let live=true,sequence=0,inFlight=false,queued=false;
 async function refresh(){if(inFlight){queued=true;return;}inFlight=true;const current=++sequence;try{const r=await readArtistConversation(createClient(),workspace,artist);if(!live||current!==sequence)return;if(r.error){setFeed(null);setOlder([]);readConfirmed.current.clear();setError(r.error);}else{setFeed(previous=>{const next=r.data as Feed;return {...next,updates:[...next.updates,...(previous?.updates??[])].filter((u,i,all)=>all.findIndex(x=>x.id===u.id)===i)};});setError('');}}catch{if(live&&current===sequence){setFeed(null);setOlder([]);setError('Could not load updates. Try Refresh.');}}finally{inFlight=false;if(live&&queued){queued=false;void refresh();}}}
 void refresh();let unsubscribe=()=>{};
 try{unsubscribe=subscribeArtistMessages(createClient(),workspace,artist,()=>void refresh(),setLiveUpdates);}catch{/* Saved-account setup may be incomplete; polling remains available. */}
 const client=createClient();const receipts=client.channel(`team-read-receipts:${workspace}:${artist}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'artist_update_reads',filter:`artist_id=eq.${artist}`},()=>void refresh()).subscribe();
 const timer=setInterval(()=>void refresh(),30000);
 return()=>{live=false;unsubscribe();void client.removeChannel(receipts);clearInterval(timer);};
 },[artist,workspace]);
 async function refresh(){const r=await readArtistConversation(createClient(),workspace,artist);if(r.error){setFeed(null);setOlder([]);throw Error(r.error);}setFeed(previous=>{const next=r.data as Feed;return {...next,updates:[...next.updates,...(previous?.updates??[])].filter((u,i,all)=>all.findIndex(x=>x.id===u.id)===i)};});}
 async function run(fn:()=>Promise<void>){if(guard.current)return;guard.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Could not confirm this action. Retry.');}finally{guard.current=false;setBusy(false);}}
 const updates=[...(feed?.updates??[]),...older].filter((u,i,all)=>all.findIndex(x=>x.id===u.id)===i).sort((a,b)=>b.id-a.id);
 const newest=updates[0]?.id;
 useEffect(()=>{const el=history.current;if(!el)return;if(prependHeight.current!==null){el.scrollTop+=el.scrollHeight-prependHeight.current;prependHeight.current=null;return;}if(lastMessage.current===null||nearBottom.current){el.scrollTop=el.scrollHeight;}else if(lastMessage.current!==newest)setNewMessages(true);lastMessage.current=newest??null;},[newest,tab,older]);
 useEffect(()=>{let active=true;async function mark(){const el=history.current;if(!el||tab!=='updates'||document.visibilityState!=='visible'||!document.hasFocus())return;const rect=el.getBoundingClientRect();const ids=visibleMessageIds(tab==='updates',document.visibilityState==='visible',document.hasFocus(),window.innerHeight,rect,Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]')).map(node=>({id:Number(node.dataset.messageId),top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom}))).filter(id=>!readConfirmed.current.has(id));if(!ids.length)return;const {error}=await createClient().rpc('mark_artist_messages_read',{w:workspace,a:artist,ids});if(!error&&active){ids.forEach(id=>readConfirmed.current.add(id));setFeed(f=>f?{...f,unread:Math.max(0,f.unread-(f.unread_ids??[]).filter(id=>ids.includes(id)).length),unread_ids:(f.unread_ids??[]).filter(id=>!ids.includes(id))}:f);window.dispatchEvent(new Event('team-messages-read'));}}
 const timer=setTimeout(()=>void mark(),1200);const visible=()=>void mark();window.addEventListener('focus',visible);window.addEventListener('scroll',visible);document.addEventListener('visibilitychange',visible);return()=>{active=false;clearTimeout(timer);window.removeEventListener('focus',visible);window.removeEventListener('scroll',visible);document.removeEventListener('visibilitychange',visible);};},[artist,workspace,tab,newest,readTick,older]);
 return <section className="artist-conversation">
 {!conversationOnly&&<div className="plan-actions" aria-label="Artist sections"><button className={`button ${tab==='brief'?'primary':'secondary'}`} onClick={()=>setTab('brief')}>Brief</button><button className={`button ${tab==='updates'?'primary':'secondary'}`} onClick={()=>setTab('updates')}>Updates{feed?.unread?` (${feed.unread} unread)`:''}</button><Link className="button secondary" href={`/?view=Messages&artist=${artist}`}>Team Chat{feed?.unread?` (${feed.unread})`:''}</Link></div>}
 {tab==='brief'?<ArtistBrief artist={artist}/>:<div className={styles.thread}>
 <div className={styles.toolbar}><span>{feed?feed.team.map(t=>t.name).join(', '):'Artist team'}</span><details><summary>Conversation settings</summary><div className={styles.settings}><p>Visible to the owner and this artist’s assigned team. New teammates can read earlier messages.</p>
 <button className="button secondary" disabled={busy} onClick={()=>void run(refresh)}>Refresh messages</button>
 {feed&&<><label>Unread notifications<select disabled={busy} value={feed.notifications} onChange={e=>{const mode=e.target.value;void run(async()=>{const r=await artistUpdatePreferences(artist,0,mode);if(r.error)throw Error(r.error);await refresh();});}}><option value="all">All team updates</option><option value="mentions">Only mentions</option><option value="muted">Muted</option></select></label></>}
 <p>{liveUpdates?'Live updates connected.':'Checking for updates every 30 seconds.'} Preferences control unread badges only.</p></div></details></div>
 {feed&&<TeamMessageAI key={`${workspace}:${artist}`} workspace={workspace} artist={artist}/>}{error&&<p className={`${styles.threadError} auth-feedback error`} role="alert">{error}</p>}
 <div ref={history} className={styles.history} aria-label="Artist message history" onScroll={()=>{setReadTick(n=>n+1);const el=history.current;if(el){nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;if(nearBottom.current)setNewMessages(false);}}}>
 {!feed&&!error&&<p role="status">Loading messages…</p>}
 {feed&&!updates.length&&<div className={styles.empty}><span className={styles.emptyIcon}>↗</span><h2>The team starts here</h2><p>Share a quick update or ask a question.<br/>Saved schedule changes will appear here too.</p></div>}
 {feed&&more&&updates.length>=50&&<button className="text-link" disabled={busy} onClick={()=>void run(async()=>{const r=await readArtistConversation(createClient(),workspace,artist,updates.at(-1)!.id);if(r.error){setFeed(null);setOlder([]);throw Error(r.error);}const batch=(r.data as Feed).updates;prependHeight.current=history.current?.scrollHeight??null;setOlder(old=>[...old,...batch]);setMore(batch.length===50);})}>Load earlier messages</button>}
 {feed&&[...updates].reverse().map(u=><article data-message-id={u.id} id={`team-message-${u.id}`} key={u.id} className={styles.message}><span className={styles.avatar}>{u.kind==='message'?u.actor_name.slice(0,2).toUpperCase():'↗'}</span><div className={styles.messageContent}><div className={styles.messageHeader}><strong>{u.actor_name}</strong><small title={new Date(u.created_at).toLocaleString()}>{new Date(u.created_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small></div>
 {u.kind==='message'?<div className={styles.bubble}>{u.body}</div>:u.kind==='assignment'||u.kind==='approval'?<div className={styles.event}>{u.body}{u.kind==='approval'&&<a href={`/?view=Approvals#proposal-${u.record_id}`}>Review approval →</a>}</div>:<div className={styles.event}><strong>{u.body}</strong><br/>{u.kind==='task'?'Deadline':'Release date'}: {u.previous_date??'No date'} → {u.new_date??'No date'}<a href={`/?view=${u.kind==='task'?'Tasks':'Releases'}${u.kind==='release'&&u.record_id?'&release='+encodeURIComponent(u.record_id):u.kind==='task'&&u.record_id?'#task-'+encodeURIComponent(u.record_id):''}`}>View {u.kind==='task'?'task':'project'} →</a></div>}
 {!!u.mentions.length&&<p className={styles.mentions}>{u.mentions.map(id=>'@'+(feed.team.find(t=>t.id===id)?.name??'Former teammate')).join(' ')}</p>}</div></article>)}
 </div>
 {newMessages&&<button className="button secondary" onClick={()=>{const el=history.current;if(el)el.scrollTop=el.scrollHeight;setNewMessages(false);setReadTick(n=>n+1);}}>New messages ↓</button>}{sendStatus&&<p role="status">{sendStatus}</p>}{feed?.can_post?<form className={styles.composer} onSubmit={e=>{e.preventDefault();void run(async()=>{if(!request.current)request.current=crypto.randomUUID();setSendStatus('Sending…');let r;try{r=await postArtistUpdate(artist,request.current,text,mentions);}catch{setSendStatus('Send not confirmed. Your message is kept below; retry sends the same request.');throw Error('Could not confirm the send. Retry.');}if(r.error){setSendStatus('Send failed. Your message is kept below; press Send to retry.');throw Error(r.error);}setSendStatus('Message saved.');request.current='';setText('');setMentions([]);await refresh();});}}>
 <textarea aria-label="Message your artist team" rows={2} maxLength={4000} value={text} disabled={busy} onChange={e=>{setText(e.target.value);request.current='';}} placeholder="Message your team…"/>
 <div className={styles.composeActions}><details><summary>@ Mention a teammate{mentions.length?` (${mentions.length})`:''}</summary>{feed.team.map(t=><label key={t.id}><input type="checkbox" checked={mentions.includes(t.id)} disabled={busy} onChange={e=>{request.current='';setMentions(m=>e.target.checked?[...m,t.id]:m.filter(id=>id!==t.id));}}/> {t.name}</label>)}</details><button className="button primary" disabled={busy||!text.trim()}>{busy?'Sending…':'Send message'}</button></div></form>:feed&&<p className={styles.readOnly}>You have read-only access to this conversation.</p>}
 </div>}
 </section>;
}
