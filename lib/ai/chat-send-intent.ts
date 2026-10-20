// Only a plain request to send the displayed message. Edits and new recipients
// must go through drafting so they cannot silently send the previous wording.
export function isCurrentEmailSendRequest(text:string){
 const normalized=text.trim().toLowerCase().replace(/[?!.,]+$/,'').trim();
 return /^(?:(?:ok|okay|yes)[, ]+)?(?:(?:can|could|would|will) (?:you|u) |please )?send (?:it|(?:this|that|the) (?:email|message|draft))(?: (?:please|now))?$/.test(normalized);
}
