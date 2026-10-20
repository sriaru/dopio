# Sample release planning

Apply `supabase/migrations/202609300005_release_plans.sql` once after migrations 001–004.

Open Dopio in the sidebar. Choose a saved artist, title, and release date, then preview the sample request. Review and edit the three proposed task titles and deadlines before approving. The fixed template suggests artwork 21 days before release, mastering 14 days before, and distributor upload 7 days before. These are editable demo defaults, not distributor requirements.

Approval creates a Single in Planning status and linked Pending tasks together. View release opens the saved record; dated tasks and the release also appear in Calendar. Existing audit triggers record each creation. Discarding the draft writes nothing. Drafts are local component state and are lost on navigation or refresh. This is a sample request builder, not natural-language AI chat, and makes no paid API calls.

The database function checks workspace membership and artist ownership, validates dates, and rolls back the entire plan if a task fails. A request identifier prevents duplicate creation on retries. A deleted saved release cannot be recreated by replaying the same request. Saving a new draft creates a new request; separate drafts can intentionally have identical titles.

Local PGlite coverage in `npm run test:email` verifies plan rollback, cross-workspace denial, task creation, idempotency, and replay after deletion. No hosted migration is applied by these tests.

## Flexible plans (migration 006)

Run `202609300006_flexible_release_plans.sql` once after 005. Plans now support Single, EP, and Album and 1–20 editable tasks. Approval remains atomic and retry-safe.

Save draft stores one draft per workspace/account in this browser’s local storage, including its request ID. Load saved draft restores it explicitly. Save again after editing; drafts do not sync between browsers or devices. Clearing browser data removes drafts. Discard removes the saved draft; successful approval clears it. Browser storage is not an access-control boundary on shared computers. Original sample summary text is replaced by a live summary of the current fields and task list.

## AI chat planner

Run `supabase/migrations/202610060010_chat_release_plans.sql` after 009.
The Dopio view now offers AI drafting with clarification questions and an editable review.
Try: “Create a new pop artist Daniel and plan his album Daybreak for November 5, 2026.”
The existing manual template remains available below the chat.

Drafting sends the conversation and up to 100 artists to the configured OpenAI model
(`OPENAI_EMAIL_MODEL`, default `gpt-4o-mini`), with storage disabled. It shares the
workspace's ten-per-minute analysis limiter. Drafting creates no database records.
Approval saves an optional new artist, release and 1–20 tasks in one transaction.
Existing artist profiles are not edited. Duplicate new artist names must be resolved
using the artist selector. Retrying the same save uses a stable request ID.
Chat drafts live only in the open page. No calendar events or team messages are sent.
Suggested task dates require review, especially for short lead times.

Checks: `node --test tests/chat-plan.test.mjs` covers incomplete drafts, date
validation, atomic rollback, existing artists, workspace access and repeated saves.
Live AI and browser testing still need to be completed against your account.

## Guided release workflow

Each selected release now includes Assign owners → Sync calendar → Prepare team
updates. These reuse the existing approval and sending controls, scoped to the
selected release. The chat planner already navigates to the newly saved release.
No new migration is required beyond 014.

Owner, draft and sent counts cover open tasks. Sent and drafted counts are
historical records, not proof of current deadline communication. Calendar success
is only shown for a confirmed sync during the current visit; preview again after
changing dates. Switching steps preserves mounted forms, but save draft edits
before navigating away or connecting Google. OAuth returns to Inbox/Calendar;
return to Releases and select the release to resume.

Manual check: open Daybreak, assign an owner in step 1, preview the same release
in step 2, then prepare/save a task draft in step 3. Move between steps and confirm
edits remain. Refresh and confirm owner/draft counts reflect saved records.
Sending still requires the explicit final confirmation for each email.

## Setup, artist context, and reviewed revisions (migration 016)

Apply `202610060016_release_revisions.sql` once after 015. No new environment
variables or Google scopes are needed. Migration 015 remains required to block
identical messages prepared as separate drafts.

Settings → Open workspace setup returns to `/get-started`. Setup checks the current
account's saved Gmail and Calendar connections, links to their existing connection
screens, and offers an artist brief alongside the artist/release/task steps.
A saved connection is not a live token-health test. Optional connections do not
block creating workspace records. OAuth still returns to Inbox or Calendar.

In Dopio → Create a release, optionally choose an artist brief before drafting.
Only its release context and preferences are sent with the request and roster;
the contacts field is not included. For Dopio → Update an existing plan, select a
release and describe the changes. Its artist's brief context/preferences and up
to 20 open tasks are used automatically. Briefs are team-entered background, not
training or automatic email/calendar ingestion.

Revisions support release title, format and date, and existing open task titles
and dates. They do not add/delete tasks, change owners, edit completed tasks, or
send messages. Review the current/proposed comparison before approving. Task IDs,
owners and history stay intact. A task version or release-detail conflict requires
a fresh draft; all changes roll back together. Repeating the same approval is
idempotent, including after a lost response. Calendar sync and new team messages
are reviewed separately after saving. The revision review cannot be edited inline;
start over to change the request. Drafts are lost on refresh/navigation.

Run `npm run test:plans`. The fresh-workspace integration test creates a new user
fixture, runs onboarding, saves a plan and brief, assigns an owner, imports a Gmail
fixture, approves a deadline proposal, claims a Calendar sync lease, revises the
plan and records a send fixture. It checks rollback, stale revisions, preserved
owners/IDs, workspace isolation and duplicate-send blocking. Google authorization,
actual model output, Google Calendar writes and email delivery are not simulated
as successful external operations: those still require browser tests with connected
accounts. No tests send email or spend API credits.

Browser check after applying 016:

1. Open Settings → Open workspace setup; confirm the two connection statuses and
   save a working preference in Daniel's brief.
2. Open Dopio → Update an existing plan and select Daybreak. Ask: “Move the release
   to November 12, 2026 and move each open task deadline seven days later.”
3. Check every current/proposed row. Approve, then refresh the release and verify
   dates changed and owners stayed attached.
4. Open Sync calendar, inspect the preview and approve only the desired updates.
5. Prepare a new team draft, review the date and recipient, and send to your own
   test email only when ready. A previous sent draft should remain locked.
6. In a separate fresh test account, finish onboarding and create a first release.
   Confirm existing users' artists, emails and connections are absent. Connect that
   test account's Google services separately to test real OAuth consent and delivery.


## Setup discovery (migration 017)

Apply `202610070017_setup_artist_proposals.sql` after 016. Setup now leads with
Google connections, source selection and a reviewed roster scan; manual creation
is available in a collapsed section. Inbox deadline analysis is unchanged.

Gmail selection lists 10 recent inbox messages from the last 30 days. Calendar
selection reads up to 30 primary-calendar events from 30 days ago through 180
days ahead. Existing calendar authorization needs optional
`https://www.googleapis.com/auth/calendar.events.readonly` consent: add it to
Google Auth Platform → Data Access, then reconnect from setup. The ordinary
calendar-sync connection still uses its original scopes. Setup OAuth returns to
`/get-started`; account binding and PKCE remain in place.

Upload a UTF-8 `.txt` or `.md` file up to 100 KB / 30,000 characters, or paste
text from another document. PDF and Word files are not parsed in this version.
The file is read into the editable text box; no original file is stored. Selected
email/event text is limited to 12,000 characters each, with a 60,000-character
combined scan limit. Only selected sources go to AI on Scan; no background scans.

A scan proposes up to 10 new artists and brief context, with source quotes and
questions. Existing roster names are excluded. Review names, genre and context;
uncheck unwanted artists. Approval atomically saves selected artist profiles and
briefs containing the source ID and original quote. It can also create one optional release per new artist and up to 20 explicitly
sourced tasks when full titles, format and dates are available. Uncheck the release
to create just the profile and brief. Missing release details become questions.
It does not send emails or write calendars. Other contacts must not be mistaken for artists.
The model can still misinterpret text: review the evidence before approving.

Reviews are encrypted, bound to the signed-in user/workspace and expire after an
hour. They are not persisted across refreshes. Repeated approval requests reuse
one request ID; duplicate artist names reject the entire batch. Run
`node --test tests/setup-scan.test.mjs` for grounding, no-task prerequisites,
multiple-artist approval, atomic rollback, retry and access-control checks.

Manual test: in a fresh workspace paste “I manage Daniel, a pop artist, and Maya,
an R&B artist.” Scan, inspect both source quotes, exclude or edit as desired, then
approve. Refresh Artists and confirm each profile and brief exists once. Test
Gmail and Calendar source selection separately after connecting those accounts.
