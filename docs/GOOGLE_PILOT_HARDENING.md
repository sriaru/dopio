# Google integrations: pilot setup and verification

## Deployment prerequisites

Apply `202610140034_google_receipts.sql` **after 033** to the intended Supabase project. This revokes browser access to the old email finalizers, creates private provider receipts and Calendar run records, scopes shared-mailbox deduplication to each importing member, and blocks identical task/chat sends across composers. No existing deadlines or task assignments change.

Set `SUPABASE_SERVICE_ROLE_KEY` in the **server environment only**, using the same Supabase project as `NEXT_PUBLIC_SUPABASE_URL`. Never use a `NEXT_PUBLIC_` name or send the key to a browser. Restart the app. `.env.example` and the pilot environment check include this prerequisite. Sending checks receipt storage before claiming or contacting Gmail. Calendar must persist a claimed run before writing to Google.

`lib/gmail/receipts.ts` is server-only. User-scoped clients still read content, enforce workspace/artist access, and claim sends; the privileged client only calls receipt RPCs. Receipt functions match the workspace, actor, and exact attempt. They reject missing or already confirmed attempts instead of silently reporting success.

## OAuth configuration outside the repository

In the Google Cloud project used by the configured OAuth client:

1. Enable Gmail API and Google Calendar API. Configure Google Auth Platform branding, audience, and a Web application OAuth client.
2. Register the exact callback URLs: `<app-origin>/gmail/callback` and `<app-origin>/calendar/callback`. For local testing these are `http://localhost:3003/gmail/callback` and `http://localhost:3003/calendar/callback`. Production uses HTTPS. These integration callbacks are separate from Supabase sign-in callbacks.
3. While the consent app is in Testing, add each pilot's Google account under Audience / Test users. A Workspace domain administrator may also need to permit the app. Test-account admission is not public app verification.
4. Request only the scopes below. Verify the scopes displayed on consent and actually granted; cancel/deny once to exercise the error path.
5. Check Google's current verification requirements for the intended audience and data handling. Gmail readonly is a restricted scope; sending is a sensitive scope. Google's guidance discusses verification and security assessments for restricted data stored/transmitted on servers. Publishing/verification cannot be completed by changing repository code. See [Gmail scope and verification guidance](https://developers.google.com/workspace/gmail/api/auth/scopes).

| Flow | Scopes | Reason |
| --- | --- | --- |
| Gmail import | `gmail.readonly` | Read manually selected message bodies and reconcile uncertain task sends |
| Enable Gmail sending | `gmail.readonly`, `gmail.send` | Separate opt-in send permission; no modify/delete permission |
| Calendar | `calendar.app.created`, `calendar.calendarlist.readonly`, `userinfo.email` | Manage the dedicated app calendar, recover its identity after uncertain creation, identify the connected account |

The current Calendar connection does not request access to read primary-calendar event contents. Do not add broad calendar permissions just to enable the legacy setup-source helper. Onboarding uses documents. See [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).

OAuth uses state bound to the signed-in user/workspace, PKCE, expiring HTTP-only cookies, and offline refresh tokens. Tokens are AES-GCM encrypted with account/workspace/user/connection context. Keep `GMAIL_TOKEN_ENCRYPTION_KEY` stable and private; changing it makes saved connections unreadable and requires reconnecting. Refresh happens before provider operations. Stored connection status is labeled as saved account information, not a live health guarantee. See [Google's web-server OAuth guidance](https://developers.google.com/identity/protocols/oauth2/web-server).

## Behavior and recovery

- Imports remain manual and deduplicate by workspace, importing member, mailbox, and provider message ID. Reconnecting the same mailbox preserves deduplication. Two managers can privately import the same shared-mailbox message.
- An AI proposal never calls Gmail send or Calendar sync. Local approval saves local data only.
- Task email sending retains its signed, expiring review ticket. Chat displays the editable recipient, subject, and body, with a separate explicit Confirm and send button; editing cancels confirmation. Neither path retries Gmail send automatically.
- Both composers record a durable attempt before Gmail is called. `google_send_results` records acceptance/provider ID, rejection, or an unknown outcome, with actor/time. Browser RPC calls cannot forge provider receipts. Identical cross-composer content is blocked.
- `sent` is a legacy database status meaning Google accepted the send or a matching Sent message was verified. It does **not** mean delivered/read. UI confirmation says this explicitly.
- After timeout or ambiguous response, the attempt stays locked. Task emails can use the existing Check Gmail confirmation action, which verifies Message-ID and the SENT label. Chat messages currently require manual Gmail Sent inspection; they cannot be resent through the locked draft. Do not promise exactly-once delivery across Google and Supabase.
- If Google accepts a message but receipt storage fails, the UI reports that discrepancy. It does not claim a confirmed local result or retry sending.
- Calendar previews show current Google title/date and proposed title/date. The sealed review includes Google etags, local snapshot, user/workspace/connection, and expiry. Google edits since preview stop sync. Each write also uses If-Match, stable event IDs, and validates returned event contents.
- Calendar operations are not one atomic Google transaction. `google_calendar_runs` persists running/confirmed/partial outcomes and confirmed counts. A process crash may leave `running`; preview again to reconcile. Stable IDs prevent another event from being inserted for the same record.
- Cleanup only removes explicitly reviewed events for accessible records that are completed, archived, or undated. Deleted records and records hidden by permission changes are deliberately not inferred from missing query results; their old events require manual Google review. No guests or invitations are added.
- Existing Calendar events are retained on disconnect. Reconnect the same Google account to preserve the managed calendar. Revoking Google app authorization may affect Gmail and Calendar if they share one OAuth client.

## Live pilot checklist (not covered by mocked tests)

Use two separate browser profiles, an owner and an assigned manager. Use test recipients and a dedicated calendar.

1. Connect Gmail read-only. Import one selected email twice; confirm one persisted private copy. Disconnect/reconnect the same mailbox and repeat. Verify another manager cannot read private imported content unless they are the owner.
2. Cancel consent, deny a scope, and revoke app access in Google account settings. Retry loading messages; verify an actionable reconnect/error message and no fake success. Repeat with a Google Workspace account subject to admin controls.
3. Prepare an email. Confirm recipient, subject, body, and sender account. Save without sending and verify Gmail Sent remains unchanged. Enable sending, review, explicitly confirm once; verify one Sent message, provider ID, and receipt. Double-submit must not send again. Changing drafts must invalidate review.
4. Rehearse timeout, provider rejection, and receipt-storage failure in a test environment. Verify locked attempts, persisted available outcomes, no automatic resend, and truthful errors. Confirm task reconciliation only accepts a unique matching Sent message.
5. Preview Calendar. Compare exact titles/dates against Google. Edit one Google event after preview; sync must stop. Preview again and explicitly approve. Verify all-day dates in America/Chicago and refresh Dopio; local dates stay unchanged by sync.
6. Sync the same project again; confirm unchanged events and no duplicates. Test a partial failure after one event: a new preview/retry must reuse IDs and finish only remaining changes. Confirm last sync outcome persists after refresh.
7. Complete or clear a task date; review the explicit removal list before cleanup. Remove the manager's artist access; old Google event details must not appear in cleanup and must not be automatically deleted.
8. Check receipt and Calendar-run RLS with a different workspace and another non-owner member. The owner may see workspace history; other managers see only their own provider runs/results.

Automated tests exercise in-memory PostgreSQL migrations/RLS and mocked Google responses. They do not validate real OAuth credentials, Google verification approval, production grants, mailbox delivery, or live Calendar behavior. Complete this checklist before onboarding a pilot.
