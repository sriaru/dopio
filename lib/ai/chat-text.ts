// Render model prose as plain text; never interpret model-supplied HTML.
export function cleanChatText(text:string){
 return text.replace(/&#(?:x20|32);|&nbsp;/gi,' ')
  .replace(/\\([*_.#>!`\[\]()-])/g,'$1')
  .replace(/\*\*([^*]+)\*\*/g,'$1')
  .replace(/^#{1,6}\s+/gm,'')
  .replace(/^[ \t]+$/gm,'').trim();
}
