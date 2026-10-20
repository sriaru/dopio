import {gmailGet} from './api';
// Positive evidence only: absence from search is never permission to resend.
export async function findSentAttempt(token:string,attempt:string,fetcher:typeof fetch=fetch):Promise<string|null>{
 if(!/^[0-9a-f-]{36}$/i.test(attempt))throw new Error('Invalid attempt');
 const messageIds=[`<${attempt}@dopio.local>`,`<${attempt}@aura.local>`];
 const query=new URLSearchParams({q:`in:sent { ${messageIds.map(id=>`rfc822msgid:${id}`).join(" ")} }`,maxResults:'2'});
 const list=await gmailGet('messages?'+query,token,fetcher);
 if(list.nextPageToken||(list.messages?.length??0)!==1)return null;
 const id=list.messages[0].id;
 const message=await gmailGet('messages/'+encodeURIComponent(id)+'?format=metadata&metadataHeaders=Message-ID',token,fetcher);
 const actual=message.payload?.headers?.find((h:{name:string;value:string})=>h.name.toLowerCase()==='message-id')?.value.trim();
 return message.labelIds?.includes('SENT')&&messageIds.includes(actual??"")?id:null;
}
