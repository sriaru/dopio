"use client";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main className="live-loading">
      <h1>Your workspace couldn’t load.</h1>
      <p>Your records are safe. Please try again.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
