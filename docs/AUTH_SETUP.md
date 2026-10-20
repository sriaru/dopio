# Dopio account setup

## Implemented

- `/login`: Google OAuth and passwordless email sign-in/signup, pending/error states.
  Email uses one combined flow: new addresses create an account, existing addresses
  sign in after email verification. No signup toggle is required; older
  `/login?mode=signup` links still show the same form. New users proceed to onboarding.
- `/auth/callback`: PKCE code exchange with local-only return URLs.
- `/auth/confirm`: optional token-hash email confirmation flow.
- `/onboarding`: profile + workspace creation, saved between visits.
- Protected dashboard, artists, projects, and original Supabase test page.
- Cookie sessions refreshed by Next.js `proxy.ts`; server authorization and database RLS.
- Real profile save and sign out. Prototype remains public at `/demo`.
- The signed-in dashboard uses real workspace records after the second migration. See `docs/WORKSPACE_DATA.md`. Sample data is confined to `/demo`.

## One-time Supabase configuration

The existing `.env.local` contains the project URL and publishable key. These are enough for application authentication, but cannot administer the database or configure Google OAuth. No service-role key is required in the application.

1. Open your Supabase project's SQL Editor and run:
   `supabase/migrations/202609260001_workspace_auth.sql`
   Alternatively, use `supabase db push` from a linked CLI environment.
   This migration is transactional and intended to run once. Review it before applying to an existing database.
2. In Authentication → URL Configuration, set the Site URL to your application origin. For development use `http://localhost:3000`.
3. Add `http://localhost:3000/auth/callback` to allowed redirect URLs. Add your deployed HTTPS callback when deploying. If you preview on a different port, explicitly add that callback too.
4. Email authentication is already enabled in the inspected project. The normal Supabase confirmation/magic-link templates work with the PKCE callback when opened in the requesting browser. Enter either a new or existing email through **Continue with email**, then open the emailed link in the same browser.
5. Optional cross-device email links: change both the Confirm Signup and Magic Link templates to link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`. Configure this deliberately; changing templates affects all apps using this project.
6. Google: create OAuth credentials in Google Cloud, set the authorized redirect URI to `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`, then enable Google in Supabase Authentication → Sign In / Providers with the client ID and secret. The login page checks provider settings and enables its Google button automatically. This grants identity access only; Gmail authorization is a later, separate integration.
7. Configure a production SMTP provider and review Supabase's email rate limits before inviting users. The default development mail service is not a production delivery setup.

## Ownership and existing records

New users own one workspace. The onboarding RPC atomically creates their profile, workspace, and owner membership, deriving identity from `auth.uid()` rather than client input. Repeat requests update the same workspace.

Profiles are only visible to their user. Workspace/membership reads require membership. Direct membership/owner writes are not granted to browser clients. Profile updates grant only the `full_name` column. The security-definer onboarding function has an empty search path and explicit execute grants.

The migration adds a `workspace_id` boundary to the existing artists table and preserves all rows. Existing rows remain NULL/unassigned and are hidden from application users until an administrator maps them to the correct workspace. **Do not bulk-assign old records to whoever signs in first.** The restrictive policy also constrains any pre-existing permissive policies. Audit other legacy tables independently before exposing them through the new app.

## Verify before launch

- Create an account, follow the email link, finish onboarding, and reload.
- Save a profile name and verify it survives signing out/back in.
- Sign out and visit `/`, `/artists`, `/projects/example`, and `/test-supabase`; each must redirect to `/login`.
- Use two accounts: verify neither can query the other's profiles, memberships, workspace, or artists, nor insert an artist into the other workspace.
- Expired/malformed callbacks must return to a recoverable login error.
- Google sign-in requires the external provider configuration above.

Useful official references:
- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/social-login/auth-google
