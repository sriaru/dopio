import 'server-only';
import {encryptionKey} from '@/lib/gmail/security';
export const CALENDAR_SCOPES = [
 'https://www.googleapis.com/auth/calendar.app.created',
 'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
 'https://www.googleapis.com/auth/userinfo.email',
];
export function calendarConfig() {
 const clientId=process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_GMAIL_CLIENT_ID;
 const clientSecret=process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_GMAIL_CLIENT_SECRET;
 const redirectUri=process.env.GOOGLE_CALENDAR_REDIRECT_URI;
 if(!clientId || !clientSecret || !redirectUri) throw new Error('Calendar setup is incomplete. See docs/CALENDAR_SETUP.md.');
 const url=new URL(redirectUri);
 if(url.pathname!=='/calendar/callback' || url.search || url.hash || url.username || url.password || (url.protocol!=='https:' && !(url.protocol==='http:' && url.hostname==='localhost'))) throw new Error('Invalid Calendar callback URL.');
 return {clientId,clientSecret,redirectUri,origin:url.origin,key:encryptionKey(process.env.GMAIL_TOKEN_ENCRYPTION_KEY)};
}
