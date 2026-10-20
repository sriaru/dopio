# Gmail connection for the local Dopio demo

The Inbox now has a Gmail panel. It connects a member’s Gmail account, lists up to ten inbox messages from the last 30 days, and imports selected emails into the workspace. Importing makes no OpenAI calls and does not change tasks or artist briefs. There is no background sync or outgoing email feature.

## One-time setup

1. Run `supabase/migrations/202609300008_gmail_connection.sql` once in Supabase SQL Editor after migrations 001–007.
2. Open [Google Cloud](https://console.cloud.google.com/) and create/select a project. Enable **Gmail API** in the API Library.
3. Configure **Google Auth Platform**: supply Branding details; for a personal Gmail account choose External under Audience, keep Testing, and add your Gmail address as a test user. Under Data Access, select `https://www.googleapis.com/auth/gmail.readonly`.
4. Under Clients, create a **Web application** OAuth client. Add the exact authorized redirect URI `http://localhost:3003/gmail/callback`. This is a dedicated Gmail callback, not the Supabase authentication callback.
5. Add these server-only values to `.env.local`:

```dotenv
GOOGLE_GMAIL_CLIENT_ID=your-google-client-id
GOOGLE_GMAIL_CLIENT_SECRET=your-google-client-secret
GOOGLE_GMAIL_REDIRECT_URI=http://localhost:3003/gmail/callback
```

A `GMAIL_TOKEN_ENCRYPTION_KEY` has been generated in the current local environment without displaying it. Keep it stable and private. For a fresh installation, generate a 32-byte key locally with `openssl rand -hex 32` and save it as `GMAIL_TOKEN_ENCRYPTION_KEY`. Do not use a `NEXT_PUBLIC_` prefix for these secrets or paste them into chat. Losing or rotating the key requires reconnecting accounts.

6. Restart Dopio. For a production preview: `npm run build -- --webpack`, then `npm run start -- --port 3003`. Browse using **localhost**, not the machine’s LAN IP.
7. Open Inbox → Connect Gmail. Choose the test Gmail account and allow read access. Then load recent emails and import a non-sensitive test email that you are comfortable making visible to workspace members.

Google documents the [web-server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server) and [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes). Gmail read access is a restricted scope; before a public launch, review Google’s verification and security-assessment requirements. This implementation is a development/test-account integration, not evidence that a public app has completed those processes.

## Behavior and security

- Dopio login and Gmail connection are separate. Every action requires a signed-in workspace member.
- A connection belongs to one member in one workspace. Other members cannot read or use its credentials. Imported emails, however, belong to the workspace and are visible to its members.
- Only read-only Gmail scope is requested. The OAuth state is encrypted, expires after ten minutes, and is bound to the Dopio user and workspace. Authorization uses PKCE. Callback handling clears the temporary HttpOnly cookie.
- The refresh token is encrypted with AES-256-GCM and bound to the workspace, user, connection identifier, and mailbox. It is never sent to the client. Access tokens are obtained on the server and not persisted. Supabase may return ciphertext only to the connection owner; it cannot be decrypted without the server key.
- List operations fetch headers, not message bodies. Import fetches the selected body and stores its Gmail account, message ID, received time, and original text. Sender and subject display fields are limited to 254 and 200 characters.
- Plain text is preferred; HTML-only messages are converted to plain text. HTML and remote images are never rendered. Attachments and attachment-backed bodies are not downloaded. Messages with no inline text or over 20,000 characters are rejected rather than silently truncated.
- Imports are deduplicated by workspace, Gmail mailbox, and Gmail message ID. Reconnecting the same mailbox does not duplicate previously imported messages. An import checks that the connection has not been removed or replaced before saving.
- Disconnect removes local credentials first, then attempts Google revocation. If revocation fails, the UI points to Google Account permissions. Already imported emails stay in the workspace.
- Emails remain untrusted source data. Import does not execute instructions, infer deadlines, update briefs, or send data to an AI provider.

## Troubleshooting

- **Setup incomplete:** check the four environment variable names and restart. No service-role Supabase key is required.
- **Migration needed:** run 008, then reload status.
- **redirect_uri_mismatch:** match the Google client URI and local variable exactly, including port and path.
- **Access blocked:** ensure the chosen Gmail account is a test user and that your Google Workspace administrator permits the app if applicable.
- **Permission/offline access missing:** connect again and allow Gmail read access.
- **Expired/revoked authorization:** disconnect and reconnect. Google testing grants can expire; the integration does not silently retry authorization.
- **No recent emails:** the picker is limited to the latest ten inbox emails from 30 days; it does not paginate the full mailbox yet.
- **Email saved but refresh failed:** refresh Dopio. Re-importing the same Gmail message is idempotent.

## Verification

`npm run test:gmail` covers token encryption and ownership binding, OAuth state/PKCE, MIME handling, redacted provider errors, database isolation (including different members of one workspace), deduplication, and disconnect/reconnect behavior. Tests use fake messages and local PostgreSQL-compatible fixtures, not a live Gmail account. Full Google consent/token exchange still requires the project credentials and a user’s Google consent.

## Analyze an imported email (migration 009)

Apply `supabase/migrations/202610050009_gmail_analysis.sql` after 008. Open an imported Gmail email in Inbox and click **Analyze email with AI**. This explicitly sends the saved email and up to 100 open artist tasks to OpenAI and requires API credits. Import itself still makes no AI calls.

Results are saved on the original Gmail import, preserving the source, body, account, and message ID. A supported deadline change creates one linked proposal for human approval. Missing context or an already-current deadline creates no proposal. The current analyzer requires an explicit date including a year. The task deadline changes only after approval; stale task versions are blocked.

A Gmail import with any existing proposal cannot be analyzed again, including after approval, rejection, or conflict. For a conflicting proposal, review the updated task manually or import a new corrected email. Messages with no proposal may be analyzed again. Concurrent analyses cannot overwrite each other; duplicate API calls can still incur charges up to the workspace rate limit.

Provider errors (including exhausted credits) leave the email and tasks unchanged. Local tests cover original-source preservation, invalid evidence, stale analysis results, deduplication, and approval. No live paid request is made by the test suite.

## Pilot hardening (migration 034)

See [Google pilot hardening](GOOGLE_PILOT_HARDENING.md) for the required server receipt key, migration order, current OAuth scopes, result semantics, and live verification checklist.
