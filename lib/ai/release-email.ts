import {artistMention,evidenceDates,type Candidate} from './email-analysis';
export function releaseEmailReview(body:string,projects:{id:string;title:string;artist:string;release_date?:string|null}[],tasks:Pick<Candidate,'title'>[]){
 if(tasks.some(t=>artistMention(body,t.title)))return null;
 if(!/\b(move|shift|postpone|reschedule|push|change|adjust)\b/i.test(body)||!/\b(album|release|EP|single)\b/i.test(body))return null;
 const matches=projects.filter(p=>artistMention(body,p.artist)&&artistMention(body,p.title));
 if(/\b(?:do not|don't|not to|cancel|cancelled|canceled|ignore|maybe|possibly)\b/i.test(body))return null;
 const dates=evidenceDates(body);
 const targets=body.split(/\bto\s+/i).slice(1).flatMap(part=>evidenceDates(part.split(/\binstead of\b|[!?\n]/i)[0]));
 if(matches.length!==1||targets.length!==1||dates.length<1||dates.length>2)return null;
 const date=targets[0];
 if(dates.length===2 && dates.find(d=>d!==date)!==matches[0].release_date)return null;
 return {releaseId:matches[0].id,date,evidence:body,explanation:`Release review: this email appears to request a date change for ${matches[0].artist}’s “${matches[0].title}” to ${date}. It does not identify an individual task. Review the release plan before applying any change. No dates have changed.`};
}
