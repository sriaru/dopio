# Email analysis and approvals

Apply `supabase/migrations/202609260003_email_approvals.sql` in the Supabase SQL editor after migrations 001 and 002. Run only the new migration. Reload Dopio afterward. Until it is applied, the core workspace remains available and Inbox displays setup instructions.

## Try it

1. Create an open task linked to Maya (or another saved artist), with a due date.
2. Open Inbox, choose Import email, select the task, and choose a different deadline.
3. Import the sample. Inspect the source email and proposed change; the task is unchanged.
4. Approve the update in Inbox or Approvals.
5. Check the new deadline in Tasks and the import, decision, and task update in Activity.

Rejecting a proposal leaves the task unchanged. Editing or deleting the task before approval makes the old proposal conflict, preserving the newer data. Import a fresh sample after an edit to create a proposal against the latest task revision.

## Sample and legacy labeled imports

Generated samples use deterministic analysis and do not call an AI model. Older manual imports used these exact labeled lines:

```text
Artist: Maya
Release: Midnight
Task: Final artwork
New deadline: 2026-10-02
```

Release is optional. Artist and task names must match saved records (case-insensitive), and the result must identify exactly one task. Dates must be valid ISO dates. Ambiguous, missing, or invalid fields require context and produce no proposal. Completed tasks and unchanged deadlines produce no proposed change.

## Data and authorization

Imports preserve the source text and proposals preserve the task snapshot and supporting deadline line. Identical imports are deduplicated. Workspace membership is checked inside database functions; clients cannot directly write source messages or proposals. Approval locks the task and checks its version and original due date before changing it. Decisions and their audit records commit together, and repeated decisions are idempotent.

Run `npm run test:email` for isolated PostgreSQL-compatible tests covering approvals, rejection, stale data, duplicate imports, ambiguous matching, malformed input, task deletion, and workspace isolation.

## Enable AI for pasted emails

1. Apply `supabase/migrations/202609260004_ai_email_analysis.sql` in Supabase after 003.
2. Add `OPENAI_API_KEY=your-key` to `.env.local` on the server. Never use a `NEXT_PUBLIC_` prefix for this key, commit it, or paste it into chat.
3. Optionally set `OPENAI_EMAIL_MODEL=gpt-4o-mini` (the default). The configured model must support Responses structured outputs and be available to your API project.
4. Restart the app. For a production preview, rebuild with `npm run build -- --webpack` then restart `npm run start -- --port 3003`.
5. Open Inbox → Import email → Paste an email. Use an existing artist/task and a natural request such as: “Please move Maya’s final artwork deadline to October 15, 2026.”
6. Review the source, AI explanation, matching task, and quoted evidence. Approve or reject the proposal.

Pasted-email analysis sends the sender, subject, body, and up to 100 open tasks for artists explicitly mentioned in that email (names, release titles, dates, IDs and task versions) to OpenAI. It uses the Responses API with `store: false`, a strict output schema, no tools, and a 45-second request timeout. This is not a claim of zero data retention. API usage is billed through your API project.

The model is instructed to leave ambiguous matches, multiple changes, relative dates, and dates without a year unresolved. Application validation rejects unknown task IDs, invalid calendar dates, and quotes absent from the body. Structured output does not guarantee a correct interpretation; human approval remains required. A task edit during analysis prevents proposal creation; an edit after analysis blocks approval through the existing version check.

Database-backed admission allows ten attempts per workspace per minute and, after migration 021, an owner-configurable monthly request cap. Duplicate saved AI emails are deduplicated, though retrying can make another API request. Failed or refused model responses create no email or proposal and the form remains open for retry. There is no automatic fallback to simulated AI. Without the key or new migration, setup errors are shown and generated samples still work.

Manual Gmail connection and import are available after migration 008; see GMAIL_SETUP.md. Background sync and automatic email sending remain unimplemented. Local tests use a mocked OpenAI response, not a live paid request. API reference: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).


After migrations 020–024, changing a task, its owner, artist or project invalidates old email draft snapshots. Prepare a fresh draft; editing an old draft does not refresh its source snapshot. Only owners and managers may approve sends. Punctuation-only duplicates are blocked across draft IDs.

Uncertain-send reconciliation searches Gmail Sent using the unique RFC Message-ID, then verifies the returned message header and SENT label before recording a positive result. Zero/multiple matches keep the draft locked; no retry is sent. The search follows Google's [messages.list reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list). Provider behavior still requires a live account acceptance test.
