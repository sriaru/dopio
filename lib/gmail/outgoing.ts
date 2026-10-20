export function encodeOutgoing(from:string,to:string,subject:string,body:string,messageId:string){
 for(const email of [from,to])if(!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email) || email.length>254)throw new Error('Use a single valid email address.');
 if(!subject.trim() || subject.length>200 || /[\r\n]/.test(subject) || !body.trim() || body.length>20000 || !/^[a-f0-9-]+$/.test(messageId))throw new Error('Invalid email details.');
 const encodedSubject=Array.from(subject).reduce<string[]>((chunks,char)=>{const last=chunks.length-1;if(last<0 || Buffer.byteLength(chunks[last]+char)>42)chunks.push(char);else chunks[last]+=char;return chunks;},[]).map(s=>`=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`).join('\r\n ');
 const encodedBody=Buffer.from(body.replace(/\r?\n/g,'\r\n')).toString('base64').match(/.{1,76}/g)?.join('\r\n')??'';
 return Buffer.from(`From: ${from}\r\nTo: ${to}\r\nSubject: ${encodedSubject}\r\nMessage-ID: <${messageId}@dopio.local>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}\r\n`).toString('base64url');
}
