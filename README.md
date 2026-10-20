# Dopio

Artist management workspace built with Next.js, React, TypeScript and Supabase.

## Local development

Run `npm ci`, configure `.env.local`, then `npm run dev -- --port 3003`.
Never commit credentials. `.env.example` documents variable names without secrets. Its URLs are hosting placeholders, not local development values.

## Hosted pilot on Vercel

Current status: project prepared locally; no Vercel account/project is linked and no hosted pilot has been verified.

1. Create a Vercel account. In this project directory run `npx vercel@latest login`, then `npx vercel@latest link`. Use the browser login; never paste tokens into chat. Linking can create a project without publishing. A Git remote is not required for CLI deployment.
2. Choose the stable production domain in the project settings. Use this same origin for the app URL and both Google callbacks, not a disposable preview URL.
3. Add the variables in `.env.example` to Vercel's **Production** environment. Copy secret values directly from local configuration/provider dashboards. Do not upload `.env.local`; `.vercelignore` excludes environment files from CLI uploads.
4. If retaining the existing Supabase database, preserve `GMAIL_TOKEN_ENCRYPTION_KEY` exactly so saved connections remain readable. Confirm migrations through **038** succeeded in order. Do not rerun successful migrations. A separate pilot database needs the complete migration history and its own authentication configuration.
5. Configure callbacks below. Run `npm test` and `npm run lint`, then publish with `npx vercel@latest --prod`. Vercel uses `npm run build:pilot`: configuration validation followed by the production build. Missing configuration or localhost callbacks fail the build without exposing values. Redeploy after changing environment variables.
6. Run `npm run smoke:pilot -- https://YOUR-PROJECT.vercel.app`. If Vercel deployment protection intercepts requests, review who can access the pilot URL; that is not an app-login result.
7. Complete the [signed-in acceptance checks](docs/WORKSPACE_DATA.md#pilot-acceptance-checks) with a fresh account and a second account before inviting managers. Send only an explicitly approved test email to an address you control, and verify one reviewed Calendar sync.

### Environment

`NEXT_PUBLIC_APP_URL` is the production HTTPS origin without a path. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` identify the selected database. Use the publishable or legacy anon key, never the service-role key. Public variables are embedded at build time.

Server variables: `SUPABASE_SERVICE_ROLE_KEY` (server-only, required for Google operation receipts; never prefix with `NEXT_PUBLIC_`), `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`, `GOOGLE_GMAIL_REDIRECT_URI`, `GOOGLE_CALENDAR_REDIRECT_URI`, `GMAIL_TOKEN_ENCRYPTION_KEY`, `OPENAI_API_KEY`. Optional Calendar client ID/secret overrides must be supplied together; otherwise Gmail credentials are reused. `OPENAI_EMAIL_MODEL` is optional.

The checker validates configuration shape, not credentials, provider settings, migrations or backups. To inspect local configuration without printing values: `node --env-file=.env.local scripts/check-pilot-env.mjs`. Localhost is expected to fail this hosted check. Do not replace working local callbacks just to make it pass.

### Callback settings

For `https://YOUR-PROJECT.vercel.app`:

| Where | Value |
| --- | --- |
| Supabase Authentication Site URL | `https://YOUR-PROJECT.vercel.app` |
| Supabase allowed redirect URLs | `https://YOUR-PROJECT.vercel.app/auth/callback` |
| Google web client redirect URI for sign-in | Supabase's Google provider callback, typically `https://YOUR-REF.supabase.co/auth/v1/callback` |
| Google web client redirect URI for Gmail | `https://YOUR-PROJECT.vercel.app/gmail/callback` |
| Google web client redirect URI for Calendar | `https://YOUR-PROJECT.vercel.app/calendar/callback` |

Keep localhost callbacks as separate entries for development. Supabase Google sign-in, Gmail and Calendar are separate flows; test all three. Google OAuth testing access must include pilot participants. Confirm consent-screen restrictions and reconnect behavior for the chosen publishing status. Configure Supabase email delivery if using email sign-in.

Do not assign production database credentials/secrets to preview deployments by default; use a separate test environment for previews.

### Operations before invitations

- Verify a database backup and restoration with its administrator. A JSON export is not a transactional backup.
- Confirm access to Vercel runtime logs and assign someone to monitor pilot failures. Do not log document contents, imported emails, tokens or API keys. Automatic alerting is not configured by this repository.
- Record the last working deployment for code rollback. A code rollback does not roll back migrations; database changes need their own recovery plan.
- Hosted two-account and Google tests are outstanding until run against the actual deployment. Local tests use synthetic records and mocked provider calls.
- Protected routes declare a 300-second function limit for AI and reviewed Google sync. This is not a background queue; large Calendar batches require separate performance testing.

## Verification commands

- `npm test`: all local tests, including PGlite migration tests.
- `npm run lint`: lint checks.
- `npm run build`: ordinary production build.
- `npm run build:pilot`: hosted configuration validation and production build.
- `npm run smoke:pilot -- <origin>`: read-only anonymous redirects and private-response checks.

Official references: [Vercel CLI deployment](https://vercel.com/docs/cli/deploying-from-cli), [function duration](https://vercel.com/docs/functions/configuring-functions/duration).

## Workspace assistant

For the opt-in background Gmail release workflow, see [release coordination setup, migration 039, controlled demo and limitations](docs/RELEASE_COORDINATION.md). Hosted migration application and real-account acceptance testing remain required.

See [assistant capabilities, migration 038, limits and demo checks](docs/WORKSPACE_DATA.md#workspace-assistant-migration-038). The assistant supports private saved conversations, source-linked retrieval and reviewed commands using existing workspace and Google execution flows. Follow-ups is now **Alerts**; existing Follow-ups URLs remain compatible.
