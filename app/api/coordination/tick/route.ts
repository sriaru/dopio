import {timingSafeEqual} from 'node:crypto';
import {tickCoordination} from '@/lib/coordination/worker';
export const runtime='nodejs';
export const maxDuration=240;
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;
 const actual=Buffer.from(request.headers.get('authorization')??''),expected=Buffer.from('Bearer '+(secret??''));
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return Response.json({error:'Unauthorized'},{status:401});
 try{return Response.json(await tickCoordination(),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Coordination worker unavailable. Check migration and server configuration.'},{status:503});}
}
