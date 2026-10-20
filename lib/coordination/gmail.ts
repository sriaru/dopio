import {gmailGet,messageText,summarizeMessage,type GmailMessage,type GmailPart} from '@/lib/gmail/api';
import {encodeOutgoing} from '@/lib/gmail/outgoing';
import {normalizeAddress,type Source,type Attachment} from './model';
type FullMessage=GmailMessage&{threadId:string;labelIds?:string[]};
export function coordinationSource(m:FullMessage):Source {
 const summary=summarizeMessage(m),headers=m.payload?.headers??[];
 const messageId=headers.find(h=>h.name.toLowerCase()==='message-id')?.value.trim()??'';
 const attachments:Attachment[]=[];
 function visit(p:GmailPart,depth=0){if(depth>20)return;if(p.filename&&p.body?.attachmentId)attachments.push({id:p.body.attachmentId,filename:p.filename.slice(0,254),mime:p.mimeType??'',size:Number((p.body as {size?:number}).size??0)});for(const c of p.parts??[])visit(c,depth+1);}
 if(m.payload)visit(m.payload);
 let body='';try{body=messageText(m);}catch(e){if(!attachments.length)throw e;body='[Attachment-only message; human review required.]';}
 if(!/^[a-zA-Z0-9_-]+$/.test(m.id)||!/^[a-zA-Z0-9_-]+$/.test(m.threadId))throw new Error('Invalid Gmail identifiers');
 return {id:m.id,thread:m.threadId,messageId:/^<[^\s<>]+@[^\s<>]+>$/.test(messageId)?messageId:'',sender:normalizeAddress(summary.sender),subject:summary.subject.replace(/[\r\n]/g,' '),received:summary.received,body,attachments:attachments.slice(0,20)};
}
export function encodeReply(from:string,to:string,subject:string,body:string,attempt:string,messageId:string){
 const raw=Buffer.from(encodeOutgoing(from,to,subject,body,attempt),'base64url').toString();
 if(!/^<[^\s<>]+@[^\s<>]+>$/.test(messageId))throw new Error('Source thread has no safe Message-ID');
 return Buffer.from(raw.replace('MIME-Version:',`In-Reply-To: ${messageId}\r\nReferences: ${messageId}\r\nMIME-Version:`)).toString('base64url');
}
export async function readSource(id:string,token:string){return coordinationSource(await gmailGet('messages/'+encodeURIComponent(id)+'?format=full',token));}
