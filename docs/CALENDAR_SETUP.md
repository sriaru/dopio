# Google Calendar setup

This version manually exports one release date and up to 20 open task deadlines
as all-day events into a dedicated Dopio secondary calendar. Preview and approval
are required. No AI calls are made by Calendar sync.

## Setup

1. Run `supabase/migrations/202610060011_google_calendar.sql` after 010 in Supabase SQL Editor.
2. In the Google Cloud project used for Gmail, enable **Google Calendar API**.
3. In **Google Auth Platform → Clients**, edit the existing web OAuth client.
   Add `http://localhost:3003/calendar/callback` as an authorized redirect URI.
   Keep the Gmail callback too.
4. In **Data Access**, add these scopes:
   - `https://www.googleapis.com/auth/calendar.app.created`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   Keep your Google account in the test-user list while the app is in testing.
5. Add this to `.env.local`:
   ```dotenv
   GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3003/calendar/callback
   ```
   Existing `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`, and
   `GMAIL_TOKEN_ENCRYPTION_KEY` are reused. Optional separate credentials are
   `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`.
   Never change the encryption key to set up Calendar.
6. Restart the local server. Open **Calendar → Connect Google Calendar**.
7. Choose Daybreak, click **Preview calendar sync**, review the events and account,
   then **Approve and sync to Google Calendar**.

Only app-created calendars can be written with this scope. Calendar-list metadata
is read to recover the dedicated calendar if its creation response is interrupted.
The connection requests the Google account email to bind credentials and calendar
identity to the same account. It does not read unrelated calendar event contents.

## Verification

- The first approval creates the Dopio calendar and events with the reviewed dates.
- Sync again: expect “already current,” without duplicates.
- Change one task date in Dopio, preview again, then approve: the same Google event moves.
- Change an Dopio record after preview: approval must request a new preview.
- Disconnect: new syncs stop; existing Google calendar/events remain.
- Reconnect with the same Google account: the previous dedicated calendar is reused.

## Current limits and recovery

- No background or two-way syncing, guest invitations, or added reminders.
- Completed/deleted/undated tasks are skipped, but previously exported events are
  not deleted. Remove obsolete events manually in Google Calendar.
- A sync overwrites an Dopio event's title, description and dates using the preview.
  An event changed concurrently in Google causes a conflict rather than a blind overwrite.
- Partial failures report confirmed events; retrying uses deterministic event IDs.
- Deleted Google events stop syncing that item rather than creating replacements.
- Interrupted calendar creation is recovered from the calendar list. If no calendar
  can be found after an uncertain creation, Dopio stops rather than risking duplicates.
  Inspect the Google account before resetting `creation_started` administratively.
- A stuck operation lease expires after 30 minutes. Do not reconnect during a sync.
- Local disconnect forgets the token but retains the calendar/account association.
  To revoke Google's grant, use Google Account permissions; revoking a shared OAuth
  app may also disconnect Gmail. Changing Google accounts is not supported by this first version.
- External writes and Supabase state cannot share a transaction; source records may
  change during a sync. Preview and sync again to apply newer Dopio data.

Tests: `npm run test:calendar`. No real Google account is used by automated tests.

References: [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth),
[Calendar creation](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert),
[event IDs and retries](https://developers.google.com/workspace/calendar/api/guides/create-events).


Onboarding now starts from an artist brief and does not read existing calendar
events. Connecting from setup uses the same scopes as ordinary release sync.
You do not need to add calendar.events.readonly for onboarding.

## Pilot hardening (migration 034)

See [Google pilot hardening](GOOGLE_PILOT_HARDENING.md) for the required server receipt key, migration order, current OAuth scopes, result semantics, and live verification checklist.
