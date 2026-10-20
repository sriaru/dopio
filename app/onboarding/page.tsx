import { redirect } from "next/navigation";
import { getAccount } from "@/lib/auth/session";
import OnboardingForm from "@/components/OnboardingForm";
import { signOut } from "@/app/auth/actions";
export default async function OnboardingPage() {
  const { user, profile, workspace, setupError } = await getAccount();
  if (profile?.onboarding_completed_at && workspace && !setupError)
    redirect("/");
  if (setupError)
    return (
      <main className="onboarding-screen">
        <section className="onboarding-card">
          <span className="auth-wordmark">Dopio ✧</span>
          <h1>Your account is ready.</h1>
          <p className="auth-description">
            We’re finishing the workspace setup. Your sign-in succeeded, but we
            couldn’t load the workspace database yet. Please try again shortly.
          </p>
          <a href="/onboarding" className="auth-submit">
            Try again →
          </a>
          <form action={signOut}>
            <button className="auth-inline">Sign out</button>
          </form>
        </section>
      </main>
    );
  return (
    <OnboardingForm
      email={user.email ?? ""}
      initial={{
        fullName: profile?.full_name ?? user.user_metadata?.full_name ?? "",
        role: profile?.role ?? "Artist Manager",
        company: profile?.company ?? "",
        artistCount: profile?.artist_count ?? "1–2",
        workspaceName: workspace?.name ?? "",
        step: profile?.onboarding_step ?? 0,
      }}
    />
  );
}
