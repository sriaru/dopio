# AI release coordination

This workflow uses the existing workspace, tasks, Gmail OAuth, encrypted refresh tokens, and email MIME infrastructure. It adds durable email observations, deliverables, blockers, reviewed actions and an audit timeline. Production code calls OpenAI and Gmail; local integration tests replace only external transports with fixtures.

**Deployment and live verification are outstanding.** Migration 039 has been tested locally, but has not been applied to the hosted database. No demonstration email has been sent externally. Passing the fixture-based scenario is not proof that the live OAuth account, model, scheduler and deployment work together.

## Setup

1. Apply `supabase/migrations/202610200039_release_coordination.sql` after migration 038, following the project's normal database approval procedure. Do not rerun an already applied migration. Back up the hosted database before deploying schema changes.
2. Configure existing server variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`, `GOOGLE_GMAIL_REDIRECT_URI`, and `GMAIL_TOKEN_ENCRYPTION_KEY`. Preserve the existing encryption key; replacing it makes stored connections unreadable.
3. Set a random server-only `CRON_SECRET`. Set `COORDINATION_DEMO_EMAILS` to comma-separated controlled email addresses, including both the connected manager mailbox and every demo stakeholder. Never use `NEXT_PUBLIC_` for either secret or the service-role key. Optionally set `OPENAI_COORDINATION_MODEL`; the default is `gpt-4.1-mini` unless `OPENAI_MODEL` is set.
4. Connect Gmail through the existing integration and explicitly enable sending. Required Gmail scopes are `gmail.readonly` and `gmail.send`. Readonly permits analysis but cannot execute approved sends.
5. Deploy the cron configuration in `vercel.json`. It invokes `/api/coordination/tick` once per minute with the bearer cron secret. Use a hosting plan that supports this frequency and the route's 240-second maximum duration. An alternative scheduler must send the same authorization header. The development server does not run Vercel cron automatically.
6. Open a project → **Coordination**, specify approved stakeholder addresses, choose the follow-up window, and enable monitoring. This is explicit consent to send those emails to AI for analysis. Set accepted file extensions on each tracked deliverable before processing attachment replies.

The worker runs with the browser closed. The panel polls persisted state every eight seconds; the Approvals queue polls every fifteen seconds. The existing task list remains the source of task dates and project membership.

For a local tick, start the app and use a trusted terminal with `CRON_SECRET` already loaded:

```sh
node --input-type=module -e 'if (!process.env.CRON_SECRET) throw Error("Load CRON_SECRET first"); const r = await fetch("http://localhost:3003/api/coordination/tick", {headers: {Authorization: "Bearer " + process.env.CRON_SECRET}}); console.log(r.status, await r.text());'
```

This command invokes the production worker and can send an already-approved email. Do not publish the secret or put its literal value into shell history. A run is only claimable when its persisted next-run time is due; calling the endpoint early can return zero processed.

## Repeatable controlled demo

Use two Gmail accounts you control. Add both accounts to `COORDINATION_DEMO_EMAILS`; Google OAuth test users must also have access to the OAuth application.

1. Use the existing **Maya Chen / After Hours** project if present. Otherwise create **Maya Chen [DEMO] / After Hours [DEMO]** through the normal workspace UI. Do not modify a real release for the demonstration.
2. Set the release date to **November 20, 2026** and create an outstanding **Final master** task due **November 13, 2026**. These explicit dates demonstrate the requested scenario; for a future demonstration, move all dates together.
3. Connect the controlled manager's Gmail, including sending permission. Enable project coordination with only the controlled producer's address and **Controlled demo** checked. Set the Final master accepted extension to `wav`.
4. From the controlled producer mailbox, send a new email with subject **Maya Chen / After Hours — final master [DEMO]**, using the exact project name if it includes `[DEMO]`. Body: “The final master for Maya Chen's After Hours will arrive November 23, 2026. I cannot meet the November 13 deadline. Can we agree on a revised delivery plan?”
5. Wait for a scheduled tick. Confirm the project shows a high-confidence association, quoted evidence, a deadline blocker, proposed resolution steps and a draft to the producer. No send should occur.
6. Review and edit the draft. Click **Approve email for sending** and confirm the exact recipient and body. After the next eligible tick, confirm the `sent` receipt and inspect the actual manager's Gmail Sent folder and producer's inbox. The email should be in the original thread.
7. From the producer account, reply in that same thread: “Here is the final master for Maya Chen's After Hours.” Attach a small valid WAV test file named `AfterHours_final.wav`. Do not attach confidential or third-party assets.
8. Wait for processing. Confirm the action becomes `responded`, the deliverable becomes **Received — awaiting verification**, and the blocker becomes `awaiting_review`. It must not claim the audio is production-ready.
9. Download the file through the authenticated link and verify it manually. Click **I verified this deliverable** only after inspection. Confirm the deliverable is `verified`, the blocker is `resolved`, and the timeline records the decision. The original task is not silently marked complete.
10. Pause coordination after the demo. Retain the audit trail and receipts for review.

For a second run, create a fresh clearly labeled demo project/task and a new email thread; do not delete receipts or reset a sent action to manufacture a replay. To demonstrate follow-up, choose a one-hour window and leave the sent email unanswered. A follow-up draft requires its own approval. An unanswered approved follow-up escalates to the manager rather than generating an unlimited email chain.

## Architecture and security

| Layer | Implementation |
| --- | --- |
| Structured extraction and confidence validation | `lib/coordination/analysis.ts`, `model.ts` |
| Gmail evidence, attachment metadata and threaded MIME | `lib/coordination/gmail.ts` |
| Durable background processing and reconciliation | `lib/coordination/worker.ts`, `app/api/coordination/tick/route.ts` |
| Tables, RLS, lease fencing and state transitions | `supabase/migrations/202610200039_release_coordination.sql` |
| Authenticated configuration, approvals and verification | `app/workspace/coordination-actions.ts` |
| Project panel and existing Approvals integration | `components/ReleaseCoordination.tsx`, `CoordinationApprovals.tsx`, `ProjectsWorkspace.tsx`, `EmailWorkflow.tsx` |
| Authorized attachment retrieval | `app/api/coordination/attachment/[id]/route.ts` |
| Local tests | `tests/coordination.test.mjs`, `coordination-worker.test.mjs` |

Each mailbox's evidence is private to its original manager, subject to current workspace role and artist access. RLS prevents direct client writes. Worker transitions are service-only and check the active lease, original connection and current access. Project/task version changes invalidate stale proposals. Approvals expire after 24 hours.

Ingestion deduplicates Gmail IDs within each run. Sending claims an action atomically before making one Gmail request. Ambiguous provider outcomes remain locked; reconciliation searches for the unique RFC Message-ID in Sent. An absent result never authorizes a retry. A failure after Google accepted a send cannot lead to automatic duplicate sending.

The model receives bounded email text, attachment metadata, accessible project names/dates, relevant deliverables and up to three earlier thread excerpts. It does not receive OAuth tokens or attachment bytes. Email content is explicitly treated as untrusted evidence, never authorization. Structured output is runtime-validated, citations must match the source body, IDs must belong to the supplied context, and confidence below 0.85 produces manager review without an action.

Attachment bytes remain in Gmail until an authenticated download. Metadata matching checks filename, MIME, configured extension and a 25 MiB ceiling. Downloads recheck access and the original connection, enforce size, and use an attachment response with `nosniff` and no caching. This is not malware scanning, audio decoding, quality approval or rights verification.

## Scope and operational limits

- Monitoring is opt-in per project and stakeholder allowlist, not automatic unrestricted analysis of every connected mailbox.
- Open tasks are seeded as deliverables when monitoring is enabled. Pause and re-enable to include tasks added later. Current task dates/titles are used for subsequent analysis.
- The initial scan covers the last 30 days. Tracked threads are checked before sends. Each lease analyzes at most two new messages and attempts at most one approved email, resuming via persisted deduplication and pagination.
- One worker invocation claims one due project run. Larger installations require scheduler capacity planning. Leases expire after four minutes; errors retry after five minutes. Model and Gmail calls have timeouts.
- Context is bounded to 50 accessible projects, 100 deliverables and 30 outstanding/tracked actions. Exceeding these limits produces a visible processing error rather than silently losing state. UI sections show the latest 100 records.
- Classification selects one most urgent deliverable per email. Ambiguous messages remain reviewable evidence; request a clarified stakeholder reply. There is no manual reassignment UI.
- Plans explain evidence-backed consequences; there is no inferred executable dependency graph. Only reviewed email steps execute. Calendar changes, task creation and other proposed plan steps remain manual existing workflows.
- File verification currently resolves attachment-based deliverables. Text-only rights confirmations and other non-file deliverables are recorded as evidence/commitments but require existing manual project decisions.
- Changing file requirements does not reprocess old messages. Ask for a new attachment reply after correcting requirements. Stale project/task proposals are cancelled; new stakeholder evidence creates a fresh proposal.
- Demo mode uses the real production Gmail send path and enforces server-allowlisted accounts. It is not a sandbox inbox or animated simulation.
- Reconnect expired Gmail credentials through the existing integration. Re-enable monitoring after a new connection; the original connection's approvals cannot carry over. Check AI quota, scheduler logs and the visible workflow error on persistent failures. Never log tokens or full mailbox contents.

## Validation and live acceptance

```sh
npm run lint
npm test
npm run build -- --webpack
```

The tests exercise structured validation, deadline conflict detection, ambiguity, database isolation, approval enforcement, duplicate prevention, uncertain sends, replies, attachment requirements, human verification and lease recovery. The worker integration test uses the production worker and real migrations in PGlite, with external Gmail/OpenAI transports replaced by controlled responses.

Before presenting the workflow as live-verified, run the controlled demo against the deployed scheduler and real provider accounts. Verify the actual sent thread and attachment, stop the browser during processing, and confirm a repeated scheduler invocation does not duplicate the send. Hosted migration application, deployment, OAuth consent and this live acceptance run are still required.
