import { requireWorkspace } from "@/lib/auth/session";
import { loadWorkspace } from "@/lib/workspace/data";
import WorkspaceSetup from "@/components/WorkspaceSetup";
export default async function GetStarted() {
  const { workspace } = await requireWorkspace();
  let data;
  try {
    data = await loadWorkspace(workspace.id);
  } catch {
    return (
      <main className="onboarding-screen">
        <section className="onboarding-card">
          <h1>We couldn’t load your setup.</h1>
          <p>Your saved records are still there. Reload to continue.</p>
          <a href="/get-started">Try again</a>
        </section>
      </main>
    );
  }
  return <WorkspaceSetup initialData={data} name={workspace.name} />;
}
