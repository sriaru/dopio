export function signMessage(body:string,name:string){
 const clean=body.replace(/\[\s*(?:your\s*name|name|sender(?:.?s)?\s*name)\s*\]/gi,'').trim().replace(/\n(?:Thanks|Thank you|Best|Regards|Best regards)[,!]?\s*$/i,'').trim();
 return `${clean}\n\nThanks,\n${name.trim()}`;
}
