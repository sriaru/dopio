import Link from "next/link";
export default function GmailSetup() {
  return (
    <main className="onboarding-screen">
      <section className="onboarding-card workspace-setup">
        <span className="auth-wordmark">Dopio ✧</span>
        <h1>Set up Gmail for your local demo</h1>
        <p>
          This one-time developer setup lets managers connect through Google’s
          consent screen. It is separate from signing in to Dopio.
        </p>
        <ol className="gmail-setup-steps">
          <li>
            Run <strong>202609300008_gmail_connection.sql</strong> in Supabase’s
            SQL Editor.
          </li>
          <li>
            In{" "}
            <a
              href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
              target="_blank"
              rel="noreferrer"
            >
              Google Cloud
            </a>
            , create or select a project and enable the Gmail API.
          </li>
          <li>
            Configure Google Auth Platform: add app branding, choose External
            testing for a personal Gmail account, and add your Gmail address as
            a test user. Request the Gmail read-only scope under Data Access.
          </li>
          <li>
            Create an OAuth client with type <strong>Web application</strong>.
            Add this exact authorized redirect URI:{" "}
            <code>http://localhost:3003/gmail/callback</code>.
          </li>
          <li>
            Add the client ID and secret to <code>.env.local</code> as{" "}
            <code>GOOGLE_GMAIL_CLIENT_ID</code> and{" "}
            <code>GOOGLE_GMAIL_CLIENT_SECRET</code>. Set{" "}
            <code>
              GOOGLE_GMAIL_REDIRECT_URI=http://localhost:3003/gmail/callback
            </code>
            . Keep these values private.
          </li>
          <li>
            Keep the server’s <code>GMAIL_TOKEN_ENCRYPTION_KEY</code> stable;
            changing it requires reconnecting Gmail. See{" "}
            <code>docs/GMAIL_SETUP.md</code> for key generation.
          </li>
          <li>
            Restart Dopio, return to Inbox, and click Connect Gmail. Allow read
            access. Load recent emails and import one that you are comfortable
            sharing with workspace members.
          </li>
        </ol>
        <p>
          No AI credits are needed for this import flow. It does not send email
          or automatically analyze messages.
        </p>
        <Link className="auth-submit" href="/?view=Inbox">
          Back to Inbox →
        </Link>
      </section>
    </main>
  );
}
