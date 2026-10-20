"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Icon from "./DopioIcon";
import { saveOnboarding, signOut } from "@/app/auth/actions";
export default function OnboardingForm({
  email,
  initial,
}: {
  email: string;
  initial: {
    fullName: string;
    role: string;
    company: string;
    artistCount: string;
    workspaceName: string;
    step: number;
  };
}) {
  const router = useRouter();
  const [step, setStep] = useState(initial.step);
  const [fullName, setFullName] = useState(initial.fullName);
  const [role, setRole] = useState(initial.role);
  const [company, setCompany] = useState(initial.company);
  const [artistCount, setArtistCount] = useState(initial.artistCount);
  const [workspaceName, setWorkspaceName] = useState(initial.workspaceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await saveOnboarding({
        fullName,
        role,
        company,
        artistCount,
        workspaceName:
          workspaceName || `${fullName.trim().split(" ")[0]}’s workspace`,
        complete: step === 1,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (step === 1) {
        router.replace("/get-started");
        router.refresh();
      } else setStep(1);
    } catch {
      setError("We couldn’t save your details. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding-screen">
      <div className="onboarding-top">
        <span className="auth-wordmark">
          Dopio <span>✧</span>
        </span>
        <form action={signOut}>
          <button className="auth-inline">Sign out</button>
        </form>
      </div>
      <section className="onboarding-card">
        <div className="setup-progress">
          <span className="filled" />
          <span className={step === 1 ? "filled" : ""} />
          <small>Step {step + 1} of 2</small>
        </div>
        <span className="auth-star">
          <Icon name={step === 0 ? "users" : "home"} size={28} />
        </span>
        <h1>
          {step === 0 ? "Tell us about yourself." : "A home for your artists."}
        </h1>
        <p className="auth-description">
          {step === 0
            ? "A few details to make Dopio feel like your workspace."
            : "Give your workspace a name. You can make it your own as you go."}
        </p>
        <p className="signed-in-email">
          <Icon name="check" size={14} />
          {email}
        </p>
        {error && (
          <p className="auth-feedback error" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={save}>
          {step === 0 ? (
            <>
              <label htmlFor="full-name">Your name</label>
              <input
                id="full-name"
                autoComplete="name"
                required
                maxLength={100}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
              />
              <label htmlFor="role">Your role</label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {[
                  "Artist Manager",
                  "Publicist",
                  "Label Team",
                  "Independent Artist",
                ].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <label htmlFor="company">
                Company <span>(optional)</span>
              </label>
              <input
                id="company"
                autoComplete="organization"
                maxLength={150}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Your company"
              />
              <label htmlFor="artist-count">
                How many artists do you manage?
              </label>
              <select
                id="artist-count"
                value={artistCount}
                onChange={(e) => setArtistCount(e.target.value)}
              >
                {["1–2", "3–5", "6–10", "11+"].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label htmlFor="workspace-name">Workspace name</label>
              <input
                id="workspace-name"
                required
                maxLength={100}
                value={
                  workspaceName ||
                  `${fullName.trim().split(" ")[0]}’s workspace`
                }
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Your workspace"
              />
              <div className="onboarding-promise">
                <Icon name="shield" size={24} />
                <div>
                  <h3>Yours from the start.</h3>
                  <p>
                    Your account owns this workspace. Your profile and workspace
                    details are securely saved.
                  </p>
                </div>
              </div>
              <div className="onboarding-next">
                <h3>Next, bring your world together.</h3>
                <p>
                  Add your artists, plan a release, and track your tasks. You
                  can connect Gmail and Google Calendar after reviewing your workspace.
                </p>
              </div>
            </>
          )}
          <div className="setup-actions">
            {step === 1 && (
              <button
                type="button"
                className="auth-inline"
                disabled={busy}
                onClick={() => setStep(0)}
              >
                ← Back
              </button>
            )}
            <button className="auth-submit" disabled={busy}>
              {busy
                ? "Saving…"
                : step === 0
                  ? "Continue"
                  : "Set up your workspace"}
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </form>
      </section>
      <p className="onboarding-footnote">More time for what matters.</p>
    </main>
  );
}
