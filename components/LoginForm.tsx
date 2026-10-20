"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import Icon from "./DopioIcon";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({
  configured,
  googleEnabled,
  expiredLink,
}: {
  configured: boolean;
  googleEnabled: boolean;
  expiredLink: boolean;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    expiredLink
      ? "That sign-in link has expired or was already used. Request a fresh link below."
      : "",
  );
  async function emailSignIn(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: new URL("/auth/callback", window.location.origin)
            .href,
        },
      });
      if (error) {
        setError(
          error.status === 429
            ? "Please wait a moment before requesting another link."
            : "We couldn’t send your sign-in link. Please check your email and try again.",
        );
      } else setSent(true);
    } catch {
      setError("We couldn’t reach the sign-in service. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function googleSignIn() {
    setBusy(true);
    setError("");
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: new URL("/auth/callback", window.location.origin).href,
        },
      });
      if (error) {
        setError("Google sign-in is unavailable. Please continue with email.");
        setBusy(false);
      }
    } catch {
      setError("We couldn’t connect to Google. Please try again.");
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <section className="auth-story">
        <Link href="/login" className="auth-wordmark">
          Dopio <span>✧</span>
        </Link>
        <div className="auth-story-content">
          <span className="auth-kicker">FOR THE PEOPLE BEHIND THE ARTISTS</span>
          <h1>
            More time
            <br />
            for what
            <br />
            <em>matters.</em>
          </h1>
          <p>
            The AI operating partner
            <br />
            for artist managers.
          </p>
          <div className="auth-story-rule" />
          <span>
            Less chasing details.
            <br />
            More moving music forward.
          </span>
        </div>
        <div className="auth-story-bottom">
          <span className="auth-live-dot" />
          Your artists. Your vision. A little more room.
        </div>
      </section>
      <section className="auth-content">
        <div className="auth-form-wrap">
          <div className="auth-star">
            <Icon name={sent ? "mail" : "sparkle"} size={27} />
          </div>
          <p className="auth-kicker">
            A LITTLE LESS ADMIN. A LITTLE MORE POSSIBILITY.
          </p>
          <h2>
            {sent ? "Check your inbox" : "Welcome to Dopio"}
          </h2>
          <p className="auth-description">
            {sent ? (
              <>
                We sent a secure sign-in link to <strong>{email}</strong>. Open
                it in this browser to continue.
              </>
            ) : (
              "Sign in or create an account with your email. New to Dopio? We’ll guide you through setup."
            )}
          </p>
          {!configured && (
            <p className="auth-feedback error" role="alert">
              Sign-in is being set up. You can explore the demo below in the
              meantime.
            </p>
          )}
          {error && (
            <p className="auth-feedback error" role="alert">
              {error}
            </p>
          )}
          {sent ? (
            <div className="auth-sent">
              <div>
                <Icon name="shield" size={18} />
                <p>
                  No password to remember. Just you and a secure, one-time link.
                </p>
              </div>
              <p>
                Can’t find it? Check your spam folder. Delivery may take a
                minute.
              </p>
              <button className="auth-submit" onClick={() => setSent(false)}>
                Use a different email <Icon name="arrow" size={17} />
              </button>
              <button
                className="auth-inline"
                onClick={() => {
                  setSent(false);
                  setError("You can request a new link using the form below.");
                }}
              >
                Request another link
              </button>
            </div>
          ) : (
            <>
              <button
                className="auth-google"
                onClick={googleSignIn}
                disabled={!configured || !googleEnabled || busy}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 48 48"
                  aria-hidden="true"
                >
                  <path
                    fill="#4285F4"
                    d="M43.6 24.5c0-1.4-.1-2.8-.4-4.2H24v8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.9 6.1-15Z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 44c5.5 0 10.1-1.8 13.5-4.5l-6.6-5a12.3 12.3 0 0 1-18.3-6.4H5.8v5.2A20 20 0 0 0 24 44Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M12.6 28.1a12 12 0 0 1 0-8.2v-5.2H5.8a20 20 0 0 0 0 18.6Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M24 12c3 0 5.6 1 7.7 3l5.8-5.8A19.4 19.4 0 0 0 24 4 20 20 0 0 0 5.8 14.7l6.8 5.2A12 12 0 0 1 24 12Z"
                  />
                </svg>
                Continue with Google
              </button>
              {!googleEnabled && configured && (
                <p className="auth-provider-note">
                  Google sign-in is currently unavailable. Continue with email below.
                </p>
              )}
              <div className="auth-divider">
                <span />
                or continue with email
                <span />
              </div>
              <form onSubmit={emailSignIn}>
                <label htmlFor="work-email">Work email</label>
                <input
                  id="work-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@yourcompany.com"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
                <button className="auth-submit" disabled={!configured || busy}>
                  {busy ? "Connecting…" : "Continue with email"}
                  <Icon name="arrow" size={18} />
                </button>
              </form>
              <p className="auth-password-note">
                <Icon name="shield" size={14} />
                We’ll email you a secure sign-in link. No password needed.
              </p>
            </>
          )}
          <div className="auth-demo-link">
            <Link href="/demo">
              Take a look around first <Icon name="arrow" size={15} />
            </Link>
            <span>Explore with sample data</span>
          </div>
        </div>
        <footer className="auth-footer">
          <span>Built for the people behind the music.</span>
          <span>© {new Date().getFullYear()} Dopio</span>
        </footer>
      </section>
    </main>
  );
}
