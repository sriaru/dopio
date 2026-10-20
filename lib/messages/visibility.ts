// Only acknowledge received message elements that intersect both the conversation
// viewport and the actual browser viewport, in a focused, visible tab.
export function visibleMessageIds(active:boolean,visible:boolean,focused:boolean,viewportHeight:number,container:{top:number;bottom:number},messages:{id:number;top:number;bottom:number}[]):number[]{
 if(!active||!visible||!focused)return [];
 const top=Math.max(0,container.top),bottom=Math.min(viewportHeight,container.bottom);
 if(bottom<=top)return [];
 return messages.filter(m=>m.bottom>top&&m.top<bottom).map(m=>m.id);
}
