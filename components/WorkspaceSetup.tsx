"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RecordForm from "./WorkspaceRecordForm";
import SetupDiscovery from "./SetupDiscovery";
import SetupConnections from "./SetupConnections";
import ArtistBrief from "./ArtistBrief";
import { saveRecord } from "@/app/workspace/actions";
import type { Entity, WorkspaceData } from "@/lib/workspace/types";

export default function WorkspaceSetup({
  initialData,
  name,
}: {
  initialData: WorkspaceData;
  name: string;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [artistId, setArtistId] = useState(
    initialData.releases[0]?.artist_id ??
      initialData.artists[0]?.record_id ??
      "",
  );
  const [releaseId, setReleaseId] = useState(initialData.releases[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const artist = data.artists.find((a) => a.record_id === artistId);
  const releases = data.releases.filter((r) => r.artist_id === artistId);
  const release = releases.find((r) => r.id === releaseId) ?? releases[0];
  const ready =
    !!release && data.tasks.some((t) => t.release_id === release.id);
  const entity: Entity = !artist ? "artist" : !release ? "release" : "task";
  const step = !artist ? 0 : !release ? 1 : ready ? 3 : 2;
  async function save(form: FormData) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await saveRecord(entity, null, form);
      if (result.error !== null) {
        setError(result.error);
        return;
      }
      const next = result.data;
      if (entity === "artist")
        setArtistId(
          next.artists.find(
            (a) => !data.artists.some((old) => old.record_id === a.record_id),
          )?.record_id ?? "",
        );
      if (entity === "release") {
        const added = next.releases.find(
          (r) => !data.releases.some((old) => old.id === r.id),
        );
        if (added) {
          setReleaseId(added.id);
          setArtistId(added.artist_id);
        }
      }
      setData(next);
    } catch {
      setError("We couldn’t save this step. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding-screen">
      <section className="onboarding-card workspace-setup">
        <span className="auth-wordmark">Dopio ✧</span>
        <p className="eyebrow setup-workspace-name">{name}</p>
        <h1>
          {ready
            ? "Your workspace is ready."
            : "Let’s set up your workspace."}
        </h1>
        <p className="auth-description">
          Start with your artist brief, approve your workspace, then connect your tools when you’re ready.
        </p>
        <ol className="onboarding-journey" aria-label="Setup process"><li><span>01</span>Your brief</li><li><span>02</span>Review your workspace</li><li><span>03</span>Connect your tools</li></ol><SetupDiscovery onSaved={next=>{setData(next);setArtistId(next.artists[0]?.record_id||'');}} />
        <details className="setup-manual"><summary>Or set up artists and releases manually</summary>
        <div className="setup-section-heading"><div><p className="eyebrow">YOUR FIRST PLAN</p><h2>Build your workspace</h2></div><Link href="/?view=Dopio" className="text-link">Plan with Dopio →</Link></div>
        <ol className="setup-checklist">
          {["Add an artist", "Create a release", "Link a first task"].map(
            (label, i) => (
              <li key={label} aria-current={i === step ? "step" : undefined}>
                <span>{i < step ? "✓" : i + 1}</span>
                {label}
              </li>
            ),
          )}
        </ol>
        {error && (
          <p className="auth-feedback error" role="alert">
            {error}
          </p>
        )}
        {data.artists.length > 0 && (
          <div className="release-link-task">
            <label htmlFor="setup-artist">Artist</label>
            <select
              id="setup-artist"
              value={artistId}
              disabled={busy}
              onChange={(e) => {
                setArtistId(e.target.value);
                setReleaseId("");
              }}
            >
              <option value="">Add a new artist</option>
              {data.artists.map((a) => (
                <option key={a.record_id} value={a.record_id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {releases.length > 1 && (
          <div className="release-link-task">
            <label htmlFor="setup-release">Release</label>
            <select
              id="setup-release"
              disabled={busy}
              value={release?.id ?? ""}
              onChange={(e) => setReleaseId(e.target.value)}
            >
              {releases.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {ready ? (
          <div className="onboarding-next">
            <h2>
              {artist?.name} · {release.title}
            </h2>
            <p>
              Your artist, release, and linked task are saved. Your dashboard
              shows upcoming work and deadlines.
            </p>
            <Link className="auth-submit" href="/">
              Go to your dashboard →
            </Link>
            <Link
              className="text-link"
              href={`/?view=Releases&release=${release.id}`}
            >
              View your release
            </Link>
          </div>
        ) : (
          <>
            <h2>
              {entity === "artist"
                ? "Who do you manage?"
                : entity === "release"
                  ? `Plan a release for ${artist?.name}`
                  : `Add a task for ${release?.title}`}
            </h2>
            <RecordForm
              key={`${entity}:${artistId}:${release?.id ?? ""}`}
              entity={entity}
              data={data}
              busy={busy}
              onSave={save}
              onCancel={() => router.push("/")}
              defaultArtist={artistId}
              defaultRelease={release?.id}
            />
          </>
        )}
        {artist && <details className="setup-brief"><summary>Add context for {artist.name}</summary><ArtistBrief key={artist.record_id} artist={artist.record_id}/></details>}
        </details>
        <SetupConnections />
        {!busy && (
          <Link href="/" className="auth-inline">
            Finish later — open dashboard
          </Link>
        )}
      </section>
    </main>
  );
}
