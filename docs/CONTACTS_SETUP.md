# Contacts and task owners

Run `supabase/migrations/202610060012_contacts_task_owners.sql` once after 011.
Refresh Dopio and open Tasks. The Team contacts & task owners panel lets workspace
members add/edit/delete contacts and assign one owner to each task.

Contacts have a name, optional email, and role. A contact is not an invited user;
no login access or notification is sent. Email addresses are unique within the
workspace, ignoring case. Several contacts may have no email.

Verify with Daniel's tasks:
1. Add Alex, role Artwork designer, optionally with a test email.
2. Choose Alex as the owner of a Daybreak task.
3. Reload the panel or refresh the page; the owner should persist.
4. Change to Unassigned; a now-unused contact can be deleted.

Contacts and assignments are shared only with workspace members. Assignment
checks the task version to avoid overwriting changes from another tab. An owner
change increments that version, so an older pending email deadline proposal may
need a fresh review. Deadlines and statuses are not changed by assigning an owner.
The existing Activity page logs contact changes and task assignment updates.

This first panel supports up to 1,000 contacts and tasks. Assignments do not yet
appear in email drafts or automatically invite people to calendar events.

Run `npm run test:contacts` for isolation, assignment, stale-version, duplicate
email, delete protection and audit tests.

## Task email drafts

Run migration 013 after 012. Open Tasks → Email drafts for task owners.
Choose a task with an owner whose contact has an email, then Prepare new draft.
Edit To, Subject and Message; Save draft in Dopio. Refresh and select the draft
from Saved drafts to verify persistence. Copy draft copies the current edited
text to the clipboard for manual use in an email app.

This is a deterministic template, not AI generation. It does not create Gmail
drafts or send email. Existing Gmail read-only authorization is unchanged.
Drafts are shared with workspace members and deleted when their task is deleted.
They are snapshots: owner or deadline changes do not rewrite existing drafts.
The latest 100 saved drafts are listed. Unsaved edits do not survive page refresh.
Version checks reject stale edits; retrying the same save does not create duplicates.

## Reviewed Gmail sending

Run migration 014 after 013. In Google Auth Platform → Data Access, add
`https://www.googleapis.com/auth/gmail.send` alongside the existing read-only scope.
In Tasks → Email drafts, choose Enable Gmail sending. Consent on Google, then
return from Inbox to Tasks. Existing connections are read-only until reconnected.

Save the draft, choose Review saved draft for sending, verify the sender account,
recipient, subject and body, then Confirm and send email. Test with your own email
address first. Nothing is sent during development or merely by saving a draft.

Each draft permits one sending attempt and is then immutable. Concurrent clicks
cannot claim it twice. A timeout or unconfirmed response locks the draft with an
uncertain result: check Gmail Sent; never automatically retry. A definitive send
failure also requires checking Sent before deliberately preparing a new draft.
Sent/attempted drafts prevent deleting their underlying task to preserve the record.
Dopio does not yet reconcile uncertain sends automatically or offer background sends.

Run `node --test tests/outgoing.test.mjs tests/contacts.test.mjs` for MIME and
send-claim checks. Live Gmail sending requires a user-reviewed test in the app.
