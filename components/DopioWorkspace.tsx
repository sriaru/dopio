"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Icon from "./DopioIcon";
import Link from "next/link";
import { signOut, saveProfile } from "@/app/auth/actions";

type View =
  | "Today"
  | "Inbox"
  | "Artists"
  | "Releases"
  | "Calendar"
  | "Approvals"
  | "Activity"
  | "Dopio"
  | "Settings";
type Artist = { name: string; genre: string; releases: number; image: string };
const roster: Artist[] = [
  {
    name: "Maya",
    genre: "Pop / Alternative",
    releases: 2,
    image: "photo-1534528741775-53994a69daeb",
  },
  {
    name: "River",
    genre: "Indie Rock",
    releases: 1,
    image: "photo-1506794778202-cad84cf45f1d",
  },
  {
    name: "Noah",
    genre: "Singer-Songwriter",
    releases: 1,
    image: "photo-1500648767791-00dcc994a43e",
  },
  {
    name: "Luna",
    genre: "Electronic / Pop",
    releases: 2,
    image: "photo-1524504388940-b1c1722653e1",
  },
];
const priorities = [
  {
    artist: 0,
    title: "Artwork delayed",
    desc: "Final artwork needed before distributor upload.",
    tag: "Artwork",
    status: "High impact",
    due: "Due today",
    color: "red",
  },
  {
    artist: 2,
    title: "Metadata missing",
    desc: "Distributor requires ISRC and metadata by Oct 3.",
    tag: "Metadata",
    status: "At risk",
    due: "Due Oct 3",
    color: "amber",
  },
  {
    artist: 1,
    title: "Press outreach",
    desc: "3 outlet drafts ready for your review.",
    tag: "Press",
    status: "Needs review",
    due: "Due tomorrow",
    color: "blue",
  },
  {
    artist: 3,
    title: "Confirm tour hold",
    desc: "Venue awaiting confirmation.",
    tag: "Tour",
    status: "Needs review",
    due: "Due Sep 18",
    color: "purple",
  },
];
type Release = [string, string, string, string, number];
const initialReleases: Release[] = [
  ["Midnight", "Maya", "Oct 13, 2026", "At risk", 0],
  ["Falling Apart", "River", "Sep 29, 2026", "Launching soon", 1],
  ["Higher", "Luna", "Nov 5, 2026", "On track", 3],
  ["Echoes", "Noah", "Aug 22, 2026", "Released", 2],
  ["Parallel", "Maya", "Jan 14, 2027", "Planning", 0],
  ["Daylight", "Luna", "Oct 2, 2026", "On track", 3],
  ["Motion", "River", "Nov 19, 2026", "Planning", 1],
  ["Stars Aligned", "Noah", "Dec 3, 2026", "On track", 2],
];
const emails = [
  [
    "Alex Rivera",
    "Re: Artwork timeline",
    "We’re running a few days behind on the final…",
    "9:14 AM",
    0,
    "Artwork",
  ],
  [
    "Lydia Chen (SPIKE Records)",
    "Metadata requirements",
    "Quick reminder on metadata fields for Midnight…",
    "8:31 AM",
    0,
    "Metadata",
  ],
  [
    "Sam Torres (Publicist)",
    "Press rollout plan",
    "Here’s the draft press calendar for your review.",
    "Yesterday",
    1,
    "Press",
  ],
  [
    "Jordan Lee (Creative Director)",
    "Tour merch concepts",
    "Attaching initial merch concepts for the spring…",
    "Yesterday",
    3,
    "Tour",
  ],
  [
    "Grace Kim (Agent)",
    "Re: Routing for Austin show",
    "Confirming routing details and hotel blocks.",
    "Sep 14",
    1,
    "Tour",
  ],
  [
    "Spotify for Artists",
    "Playlist pitch opportunity",
    "We’d like to feature Midnight in an upcoming…",
    "Sep 14",
    0,
    "Opportunity",
  ],
] as const;
const initialApprovals = [
  "Update artwork date for Maya / Midnight",
  "Confirm metadata owner for Noah",
  "Update ISRC for Luna / Higher",
  "Draft reply to Alex about artwork delay",
  "Approve 3 press outreach drafts for River",
  "Add streaming stores for Noah / Echoes",
  "Update tracklist for Luna / Higher",
  "Share analytics report with collaborator",
];
const initialActivity = [
  "Dopio matched Alex’s email to Maya → Midnight → Artwork",
  "Updated artwork due date: Sep 22 → Sep 25",
  "Flagged release as At risk",
  "Drafted reply for review",
  "Jane approved an internal update",
  "River press list updated",
  "Noah contract added to Drive",
  "Set reminder for team",
];
function Avatar({
  index = 0,
  large = false,
}: {
  index?: number;
  large?: boolean;
}) {
  return (
    <span
      className={`artist-photo ${large ? "large" : ""}`}
      style={{
        backgroundImage: `url(https://images.unsplash.com/${roster[index % 4].image}?auto=format&fit=crop&w=180&q=80)`,
      }}
      role="img"
      aria-label={roster[index % 4].name}
    />
  );
}
function Badge({
  children,
  tone = "purple",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
function ArrowLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <Icon name="arrow" size={15} />
    </button>
  );
}
function Stat({
  value,
  label,
  sub,
  icon,
  tone,
  onClick,
}: {
  value: string;
  label: string;
  sub?: string;
  icon: string;
  tone: string;
  onClick?: () => void;
}) {
  const Element = onClick ? "button" : "div";
  return (
    <Element className={`stat ${tone}`} onClick={onClick}>
      <span className="stat-icon">
        <Icon name={icon} size={23} />
      </span>
      <span>
        <strong>{value}</strong>
        <span className="stat-label">{label}</span>
        {sub && <small>{sub}</small>}
      </span>
      {onClick && <Icon name="chevron" size={16} />}
    </Element>
  );
}

type Account = {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  workspaceId: string;
  workspaceName: string;
};
export default function DopioWorkspace({ account }: { account?: Account }) {
  const storageKey = account
    ? `aura-sample:${account.userId}:${account.workspaceId}`
    : "aura-demo-v1";
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [releaseData, setReleases] = useState<Release[]>(initialReleases);
  const [view, setView] = useState<View>("Today");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<string | null>(null);
  const [newMenu, setNewMenu] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [toast, setToast] = useState("");
  const [approvals, setApprovals] = useState(initialApprovals);
  const [activity, setActivity] = useState(initialActivity);
  const [selectedApproval, setSelectedApproval] = useState(0);
  const [selectedMail, setSelectedMail] = useState(0);
  const [selectedRelease, setSelectedRelease] = useState(0);
  const [filter, setFilter] = useState("All");
  const [tab, setTab] = useState("Overview");
  const [artists, setArtists] = useState(roster);
  const [tasks, setTasks] = useState([
    "Maya — Photoshoot",
    "River — Finalize tracklist",
    "Luna — Master delivery",
    "Team sync",
  ]);
  const [completed, setCompleted] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<
    { question: string; answer: string }[]
  >([]);
  const [day, setDay] = useState(16);
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState(account?.fullName ?? "Jane Smith");
  const [loaded, setLoaded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const elements = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, [tabindex="0"]',
        ) ?? [],
      );
    const focusTimer = setTimeout(() => elements()[0]?.focus(), 0);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = elements();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", trap);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", trap);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [modal]);
  // Restore browser-only demo state after hydration.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const data = JSON.parse(saved);
        setReleases(data.releases ?? initialReleases);
        setApprovals(data.approvals ?? initialApprovals);
        setActivity(data.activity ?? initialActivity);
        setCompleted(data.completed ?? []);
        setArtists(data.artists ?? roster);
        setTasks(data.tasks ?? tasks);
        if (!account) setProfile(data.profile ?? "Jane Smith");
      }
    } catch {
      /* Continue with demo data when browser storage is unavailable. */
    }
    const hashView = window.location.hash.slice(1);
    const page = hashView === "AURA" ? "Dopio" : hashView;
    if (
      [
        "Today",
        "Inbox",
        "Artists",
        "Releases",
        "Calendar",
        "Approvals",
        "Activity",
        "Dopio",
        "Settings",
      ].includes(page)
    )
      setView(page as View);
    setLoaded(true);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setModal(null);
        setNewMenu(false);
        setNotifications(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            releases: releaseData,
            approvals,
            activity,
            completed,
            artists,
            tasks,
            profile,
          }),
        );
      } catch {
        /* Storage may be disabled by the browser. */
      }
  }, [
    storageKey,
    releaseData,
    approvals,
    activity,
    completed,
    artists,
    tasks,
    profile,
    loaded,
  ]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  function go(next: View) {
    setView(next);
    setFilter("All");
    setSearch("");
    window.history.replaceState(null, "", `#${next}`);
  }
  function record(message: string) {
    setActivity((a) => [message, ...a]);
    setToast(message);
  }
  function decide(approved: boolean) {
    const item = approvals[selectedApproval];
    record(`${approved ? "Approved" : "Rejected"}: ${item}`);
    setApprovals((a) => a.filter((_, i) => i !== selectedApproval));
    setSelectedApproval(0);
  }
  function ask(text: string) {
    if (!text.trim()) return;
    go("Dopio");
    setMessages((m) => [
      ...m,
      {
        question: text,
        answer: text.toLowerCase().includes("risk")
          ? "Maya’s Midnight release needs attention: final artwork is delayed, leaving one working day before distributor upload. Noah’s metadata is also outstanding. Review the recommended updates in Approvals."
          : text.toLowerCase().includes("river")
            ? "River has one upcoming release, Falling Apart, scheduled for September 29. Three press outreach drafts are ready for review. The next milestone is finalizing the tracklist on September 19."
            : `Here’s the latest from this demo workspace: ${approvals.length} items await your approval, ${tasks.length - completed.filter((t) => tasks.includes(t)).length} upcoming tasks remain, and Maya’s artwork needs attention. Start with Approvals to review the proposed changes.`,
      },
    ]);
    setPrompt("");
  }
  function toggleTask(task: string) {
    setCompleted((c) =>
      c.includes(task) ? c.filter((t) => t !== task) : [...c, task],
    );
  }
  const selected = releaseData[selectedRelease];
  const nav: [View, string][] = [
    ["Today", "home"],
    ["Inbox", "mail"],
    ["Artists", "users"],
    ["Releases", "file"],
    ["Calendar", "calendar"],
    ["Approvals", "check"],
    ["Activity", "activity"],
    ["Dopio", "sparkle"],
  ];
  const actionLink = (label: string, next: View) => (
    <ArrowLink onClick={() => go(next)}>{label}</ArrowLink>
  );
  const schedule = (
    <>
      {[
        "Internal team sync",
        "Maya — Artwork check-in",
        "Lunch",
        "River — Press review",
        "Luna — Tour call",
      ].map((event, i) => (
        <button
          className="schedule-row"
          key={event}
          onClick={() => setModal(event)}
        >
          <time>
            {
              [
                "9:00 – 9:30 AM",
                "10:00 – 10:30 AM",
                "12:00 – 1:00 PM",
                "2:00 – 2:30 PM",
                "4:00 – 4:30 PM",
              ][i]
            }
          </time>
          <i
            style={{
              background: [
                "#969db4",
                "#fb516b",
                "#969db4",
                "#6854f5",
                "#ac72ec",
              ][i],
            }}
          />
          <span>{event}</span>
        </button>
      ))}
    </>
  );
  const upcoming = (
    <div className="upcoming-table">
      {tasks.map((task, i) => (
        <label className={completed.includes(task) ? "done" : ""} key={task}>
          <input
            type="checkbox"
            checked={completed.includes(task)}
            onChange={() => toggleTask(task)}
          />
          <span>
            {
              ["Thu, Sep 18", "Fri, Sep 19", "Mon, Sep 22", "Wed, Sep 24"][
                i % 4
              ]
            }
          </span>
          <strong>{task}</strong>
          <Badge>{task.includes("—") ? task.split(" — ")[0] : "All"}</Badge>
          <small>
            {["Photoshoot", "Release prep", "Production", "Meeting"][i % 4]}
          </small>
        </label>
      ))}
    </div>
  );
  return (
    <div className="dopio-app">
      <aside className="sidebar">
        <a href="#Today" className="wordmark" onClick={() => go("Today")}>
          Dopio<span>✧</span>
        </a>
        <div className="workspace-label" title={account?.workspaceName}>
          {account?.workspaceName ?? "DEMO WORKSPACE"}
        </div>
        <nav>
          {nav.map(([name, icon]) => (
            <button
              key={name}
              aria-label={name}
              className={view === name ? "active" : ""}
              onClick={() => go(name)}
            >
              <Icon name={icon} />
              <span>{name}</span>
              {name === "Inbox" && <b>5</b>}
              {name === "Approvals" && approvals.length > 0 && (
                <i className="nav-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-orbit" />
        <div className="sidebar-bottom">
          {account ? (
            <form action={signOut}>
              <button aria-label="Sign out">
                <Icon name="arrow" />
                <span>Sign out</span>
              </button>
            </form>
          ) : (
            <Link href="/login" className="sidebar-signin">
              Sign in <Icon name="arrow" size={14} />
            </Link>
          )}
          <div className="sidebar-caption">
            More time
            <br />
            for what matters.
          </div>
          <button
            aria-label="Settings"
            className={view === "Settings" ? "active" : ""}
            onClick={() => go("Settings")}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
          <button className="profile" onClick={() => go("Settings")}>
            <span className="initials">
              {profile
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)}
            </span>
            <span>
              {profile}
              <small>{account?.role ?? "Artist Manager"}</small>
            </span>
            <Icon name="down" size={14} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="global-search">
            <Icon name="search" size={19} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search artists, releases, emails, or ask Dopio…"
              aria-label="Search workspace"
            />
            <kbd>⌘ K</kbd>
            {search && (
              <div className="search-results">
                {[
                  ...artists.map((a) => ({
                    title: a.name,
                    kind: "Artists" as View,
                  })),
                  ...releaseData.map((r) => ({
                    title: r[0],
                    kind: "Releases" as View,
                  })),
                  ...emails.map((e) => ({
                    title: e[1],
                    kind: "Inbox" as View,
                  })),
                ]
                  .filter((r) =>
                    r.title.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((r) => (
                    <button
                      key={r.title}
                      onClick={() => {
                        if (r.kind === "Releases")
                          setSelectedRelease(
                            releaseData.findIndex((x) => x[0] === r.title),
                          );
                        if (r.kind === "Inbox")
                          setSelectedMail(
                            emails.findIndex((x) => x[1] === r.title),
                          );
                        go(r.kind);
                      }}
                    >
                      <Icon
                        name={r.kind === "Inbox" ? "mail" : "search"}
                        size={16}
                      />
                      {r.title}
                      <small>{r.kind}</small>
                    </button>
                  ))}
                <button onClick={() => ask(search)}>
                  <Icon name="sparkle" size={16} />
                  Ask Dopio about “{search}”<Icon name="arrow" size={16} />
                </button>
              </div>
            )}
          </div>
          <div className="topbar-right">
            <span className="demo-label">
              <i />
              {account
                ? "Sample data · " + account.workspaceName
                : "Demo workspace"}
            </span>
            <div className="dropdown-anchor">
              <button
                className="button new-button"
                onClick={() => setNewMenu(!newMenu)}
              >
                <Icon name="plus" size={18} />
                New
                <Icon name="down" size={15} />
              </button>
              {newMenu && (
                <div className="dropdown">
                  {[
                    "Add artist",
                    "New release",
                    "Create task",
                    "Draft email",
                  ].map((item) => (
                    <button
                      key={item}
                      onClick={() => {
                        setModal(item);
                        setNewMenu(false);
                      }}
                    >
                      {item}
                      <Icon name="plus" size={14} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="header-divider" />
            <div className="dropdown-anchor">
              <button
                className="icon-button notification-button"
                aria-label="Notifications"
                onClick={() => setNotifications(!notifications)}
              >
                <Icon name="bell" size={23} />
                <i />
              </button>
              {notifications && (
                <div className="dropdown notification-menu">
                  <strong>You’re up to date</strong>
                  <p>Maya’s artwork needs your attention.</p>
                  <button
                    onClick={() => {
                      go("Approvals");
                      setNotifications(false);
                    }}
                  >
                    Review pending approvals <Icon name="arrow" size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className={`workspace view-${view.toLowerCase()}`}>
          {view === "Today" && (
            <div className="dashboard">
              <div className="dashboard-main">
                <section className="welcome">
                  <div className="welcome-ribbon" />
                  <div className="welcome-copy">
                    <p>Tuesday, September 16, 2026</p>
                    <h1>
                      Good morning, {profile.split(" ")[0]}{" "}
                      <Icon name="sun" size={32} />
                    </h1>
                    <p>Here’s what needs your attention today.</p>
                  </div>
                  <span className="welcome-quote">
                    Brighter artists.
                    <br />A calmer tomorrow.
                  </span>
                  <div className="stats-grid">
                    <Stat
                      value="2"
                      label="At risk"
                      sub="Needs your attention"
                      icon="alert"
                      tone="red"
                      onClick={() => {
                        go("Releases");
                        setFilter("At risk");
                      }}
                    />
                    <Stat
                      value={String(approvals.length)}
                      label="Need your review"
                      sub="Awaiting input"
                      icon="clock"
                      tone="purple"
                      onClick={() => go("Approvals")}
                    />
                    <Stat
                      value="12"
                      label="Handled by Dopio"
                      sub="Completed this week"
                      icon="check"
                      tone="green"
                      onClick={() => go("Activity")}
                    />
                    <Stat
                      value={String(tasks.length)}
                      label="Upcoming this week"
                      sub="On your calendar"
                      icon="calendar"
                      tone="slate"
                      onClick={() => go("Calendar")}
                    />
                  </div>
                </section>
                <div className="dashboard-columns">
                  <div className="priority-column">
                    <Panel
                      title="Top priorities"
                      action={
                        <span className="heading-actions">
                          <span className="count-pill">4</span>
                          {actionLink("See all", "Approvals")}
                        </span>
                      }
                    >
                      <div className="priority-list">
                        {priorities.map((p) => (
                          <article
                            className={`priority-item ${p.color}`}
                            key={p.title}
                          >
                            <Avatar index={p.artist} />
                            <div className="priority-info">
                              <h3>
                                {roster[p.artist].name} <span>—</span> {p.title}
                              </h3>
                              <p>{p.desc}</p>
                              <div className="tags">
                                <Badge tone={p.color}>{p.tag}</Badge>
                                <Badge>{roster[p.artist].name}</Badge>
                                <Badge tone="slate">{p.status}</Badge>
                              </div>
                            </div>
                            <div className="priority-action">
                              <small
                                className={
                                  p.due === "Due today" ? "urgent" : ""
                                }
                              >
                                <Icon name="calendar" size={13} />
                                {p.due}
                              </small>
                              <button
                                className="button dark small"
                                onClick={() => {
                                  go("Approvals");
                                  setSelectedApproval(
                                    Math.min(
                                      Math.max(approvals.length - 1, 0),
                                      p.artist === 0
                                        ? 0
                                        : p.artist === 2
                                          ? 1
                                          : p.artist === 1
                                            ? 4
                                            : 2,
                                    ),
                                  );
                                }}
                              >
                                Review
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </Panel>
                    <Panel
                      title="Upcoming this week"
                      action={actionLink("View calendar", "Calendar")}
                    >
                      {upcoming}
                    </Panel>
                  </div>
                  <div className="updates-column">
                    <Panel
                      className="dopio-update"
                      title="Dopio’s update"
                      action={
                        <span className="sparkle-icon">
                          <Icon name="sparkle" />
                        </span>
                      }
                    >
                      <p className="eyebrow">A LITTLE LESS ON YOUR PLATE</p>
                      {[
                        "Scanned 48 new emails overnight",
                        "Identified 1 potential risk (Maya artwork)",
                        "Drafted 3 press outreach emails (River)",
                        "Updated tour timeline for Luna",
                      ].map((t) => (
                        <div className="update-line" key={t}>
                          <Icon name="check" size={16} />
                          <span>{t}</span>
                        </div>
                      ))}
                      {actionLink("View all activity", "Activity")}
                    </Panel>
                    <div className="quote-card">
                      <span>“</span>
                      <p>
                        Dopio saved me hours this week.
                        <br />I actually get to focus on my artists now.
                      </p>
                      <small>— Alex R., Artist Manager</small>
                    </div>
                    <Panel title="Quick actions">
                      <div className="quick-actions">
                        {[
                          ["mail", "Draft an email", "Draft email"],
                          ["music", "Add a release", "New release"],
                          ["check", "Create a task", "Create task"],
                          ["sparkle", "Ask Dopio", "Dopio"],
                        ].map(([icon, label, target]) => (
                          <button
                            key={label}
                            onClick={() =>
                              target === "Dopio" ? go("Dopio") : setModal(target)
                            }
                          >
                            <Icon name={icon} />
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    </Panel>
                    <Panel
                      title="Recently resolved"
                      action={actionLink("View all", "Activity")}
                    >
                      {[
                        "Sam — Label meeting scheduled",
                        "River — Press list updated",
                        "Noah — Contract added to Drive",
                      ].map((t, i) => (
                        <div className="resolved-row" key={t}>
                          <Icon name="check" size={19} />
                          <div>
                            {t}
                            <small>{2 + i * 2} hours ago</small>
                          </div>
                        </div>
                      ))}
                    </Panel>
                  </div>
                </div>
              </div>
              <aside className="dashboard-right">
                <Panel
                  title="Today"
                  action={
                    <div className="date-arrows">
                      <button
                        aria-label="Previous day"
                        onClick={() => setDay((d) => Math.max(1, d - 1))}
                      >
                        ‹
                      </button>
                      <button
                        aria-label="Next day"
                        onClick={() => setDay((d) => Math.min(30, d + 1))}
                      >
                        ›
                      </button>
                    </div>
                  }
                >
                  <p className="calendar-date">
                    {day === 16 ? "Tue, " : ""}Sep {day}, 2026
                  </p>
                  {day === 16 ? (
                    schedule
                  ) : (
                    <div className="empty-schedule">
                      <Icon name="calendar" size={28} />
                      <p>No events scheduled for this day.</p>
                      <button
                        className="text-link"
                        onClick={() => setModal("Create task")}
                      >
                        Plan something <Icon name="plus" size={14} />
                      </button>
                    </div>
                  )}
                  <div className="panel-footer">
                    {actionLink("View full calendar", "Calendar")}
                  </div>
                </Panel>
                <Panel
                  title="Artists"
                  action={actionLink("View all", "Artists")}
                >
                  {artists.slice(0, 4).map((a, i) => (
                    <button
                      className="roster-row"
                      key={a.name}
                      onClick={() => {
                        go("Artists");
                        setSearch(a.name);
                      }}
                    >
                      <Avatar index={i} />
                      <span>
                        <strong>{a.name}</strong>
                        <small>{a.genre}</small>
                      </span>
                      <small>
                        {a.releases} upcoming{" "}
                        {a.releases === 1 ? "release" : "releases"}
                      </small>
                    </button>
                  ))}
                </Panel>
                <section className="ask-card">
                  <div className="ask-glow" />
                  <Icon name="sparkle" size={24} />
                  <h2>Need anything?</h2>
                  <p>
                    Ask Dopio to find something, draft a message,
                    <br />
                    or give you an update.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      ask(prompt);
                    }}
                  >
                    <input
                      aria-label="Ask Dopio"
                      placeholder="Ask Dopio anything…"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                    <button aria-label="Send to Dopio">
                      <Icon name="arrow" size={18} />
                    </button>
                  </form>
                  <div className="prompt-chips">
                    {[
                      "Summarize my week",
                      "Draft a press email",
                      "Show release status",
                      "What’s at risk?",
                    ].map((t) => (
                      <button onClick={() => ask(t)} key={t}>
                        <Icon name="sparkle" size={12} />
                        {t}
                      </button>
                    ))}
                  </div>
                </section>
                <div className="quiet-note">
                  <span className="online-dot" />
                  Everything in sync. Take a breath.
                </div>
              </aside>
            </div>
          )}
          {view === "Inbox" && (
            <div className="inbox-layout">
              <Panel className="mail-list">
                <h1>Inbox</h1>
                <p className="subtitle">
                  AI that understands the bigger picture.
                </p>
                <div className="tabs">
                  {["All", "Needs you", "Dopio changed"].map((t) => (
                    <button
                      className={filter === t ? "selected" : ""}
                      onClick={() => setFilter(t)}
                      key={t}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {emails
                  .filter(
                    (_, i) =>
                      filter === "All" ||
                      (filter === "Needs you" ? i < 4 : i >= 4),
                  )
                  .map((e) => {
                    const index = emails.indexOf(e);
                    return (
                      <button
                        className={`mail-row ${selectedMail === index ? "selected" : ""}`}
                        onClick={() => {
                          setSelectedMail(index);
                          setDraft("");
                        }}
                        key={e[0]}
                      >
                        <Avatar index={Number(e[4])} />
                        <div>
                          <strong>{e[0]}</strong>
                          <span>{e[1]}</span>
                          <p>{e[2]}</p>
                          <div className="tags">
                            <Badge>{roster[e[4]].name}</Badge>
                            <Badge tone={index === 0 ? "red" : "purple"}>
                              {e[5]}
                            </Badge>
                          </div>
                        </div>
                        <small>{e[3]}</small>
                      </button>
                    );
                  })}
              </Panel>
              <Panel className="email-detail">
                <span className="eyebrow">YOUR INBOX, CONNECTED</span>
                <h1>{emails[selectedMail][1]}</h1>
                <div className="email-sender">
                  <Avatar index={emails[selectedMail][4]} />
                  <div>
                    <strong>{emails[selectedMail][0]}</strong>
                    <p>
                      {emails[selectedMail][0].split(" ")[0].toLowerCase()}
                      @studio.com
                    </p>
                  </div>
                  <small>{emails[selectedMail][3]}</small>
                </div>
                <p className="email-to">
                  To: <strong>{profile}</strong>　 Cc:{" "}
                  {roster[emails[selectedMail][4]].name}
                </p>
                <div className="email-body">
                  <p>Hi {profile.split(" ")[0]},</p>
                  {selectedMail === 0 ? (
                    <>
                      <p>
                        We’re running a few days behind on the final artwork for
                        Midnight. The new target is to have everything to you by{" "}
                        <strong>Friday, Sep 25.</strong>
                        <br />
                        I’ll send over the files as soon as they’re ready.
                      </p>
                      <p>
                        Thanks for your patience!
                        <br />
                        Alex
                      </p>
                    </>
                  ) : (
                    <>
                      <p>
                        {emails[selectedMail][2].replace("…", ".")} Please take
                        a look and let me know your thoughts so we can keep
                        everything moving.
                      </p>
                      <p>
                        Thanks,
                        <br />
                        {emails[selectedMail][0].split(" ")[0]}
                      </p>
                    </>
                  )}
                </div>
                <div className="attachment">
                  <Icon name="file" size={30} />
                  <span>
                    {selectedMail === 0
                      ? "midnight_assets.zip"
                      : "project_brief.pdf"}
                  </span>
                  <small>Demo attachment · Preview unavailable</small>
                </div>
                <div className="reply-area">
                  <button
                    className="button primary"
                    onClick={() =>
                      setDraft(
                        `Hi ${emails[selectedMail][0].split(" ")[0]},\n\nThanks for the update. `,
                      )
                    }
                  >
                    <Icon name="mail" size={15} />
                    Reply
                  </button>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Write a reply…"
                    aria-label="Email reply"
                  />
                  <button
                    className="button dark"
                    disabled={!draft.trim()}
                    onClick={() => {
                      record(`Saved reply draft to ${emails[selectedMail][0]}`);
                      setDraft("");
                    }}
                  >
                    Save draft <Icon name="arrow" size={15} />
                  </button>
                </div>
              </Panel>
              <div className="analysis-column">
                <div className="analysis-title">
                  <Icon name="sparkle" size={27} />
                  <div>
                    <h2>Dopio’s analysis</h2>
                    <p>Connecting the dots across your workspace.</p>
                  </div>
                </div>
                <Panel title="Matched to">
                  <div className="match">
                    <Avatar index={emails[selectedMail][4]} />
                    <strong>
                      {roster[emails[selectedMail][4]].name} <span>›</span>{" "}
                      {selectedMail === 0
                        ? "Midnight"
                        : emails[selectedMail][5]}
                    </strong>
                  </div>
                  <div className="info-box">
                    This conversation is linked to the artist’s active project
                    and related contacts.
                  </div>
                </Panel>
                <Panel title="What changed">
                  <p>
                    {selectedMail === 0
                      ? "Artwork delivery date"
                      : "New project information"}
                  </p>
                  <h3 className="date-change">
                    {selectedMail === 0 ? (
                      <>
                        Sep 22 <Icon name="arrow" size={17} />
                        <Badge tone="red">Sep 25</Badge>
                      </>
                    ) : (
                      emails[selectedMail][1]
                    )}
                  </h3>
                  <small>
                    From {emails[selectedMail][0].split(" ")[0]}’s email ·{" "}
                    {emails[selectedMail][3]}
                  </small>
                </Panel>
                <Panel title="Why this matters" className="risk-panel">
                  <p>
                    {selectedMail === 0
                      ? "This puts Midnight at risk."
                      : "Your input keeps this project moving."}
                  </p>
                  <div className="risk-timeline">
                    <strong>
                      {emails[selectedMail][5]} due{" "}
                      <Badge tone="red">Sep 25</Badge>
                    </strong>
                    <span>1 full working day of slack</span>
                    <p>
                      Distributor upload deadline <strong>Sep 29</strong>
                    </p>
                  </div>
                </Panel>
                <Panel title="Recommended actions">
                  <p className="green-text">Dopio can update internally</p>
                  <p>Review the proposed changes before they’re applied.</p>
                  <button
                    className="button primary"
                    onClick={() => go("Approvals")}
                  >
                    Review approval <Icon name="arrow" size={15} />
                  </button>
                  <hr />
                  <p>Dopio can prepare for your review</p>
                  <button
                    className="button"
                    onClick={() =>
                      setDraft(
                        "Hi Alex,\n\nThanks for the heads-up. Please send the final artwork by September 25 so we can meet our distributor deadline. Let me know if you need anything.\n\nJane",
                      )
                    }
                  >
                    Prepare reply draft
                  </button>
                </Panel>
              </div>
            </div>
          )}
          {view === "Artists" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">THE PEOPLE BEHIND THE MUSIC</p>
                  <h1>Your artists</h1>
                  <p className="subtitle">
                    Big ambitions. One place to keep them moving.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setModal("Add artist")}
                >
                  <Icon name="plus" size={17} />
                  Add artist
                </button>
              </div>
              <div className="artist-grid">
                {artists
                  .filter((a) =>
                    a.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((a, i) => (
                    <Panel key={a.name} className="artist-card">
                      <div className={`artist-banner artist-banner-${i % 4}`}>
                        <Avatar index={i} large />
                        <Badge tone="green">Active</Badge>
                      </div>
                      <h2>{a.name}</h2>
                      <p>{a.genre}</p>
                      <div className="artist-card-bottom">
                        <span>
                          <strong>{a.releases}</strong> upcoming releases
                        </span>
                        <button
                          className="text-link"
                          onClick={() => {
                            setSelectedRelease(
                              Math.max(
                                0,
                                releaseData.findIndex((r) => r[1] === a.name),
                              ),
                            );
                            go("Releases");
                          }}
                        >
                          View releases <Icon name="arrow" size={17} />
                        </button>
                      </div>
                    </Panel>
                  ))}
              </div>
              <Panel
                title="Your roster, at a glance"
                className="roster-overview"
              >
                <div className="stats-grid">
                  <Stat
                    value={String(artists.length)}
                    label="Artists in your roster"
                    icon="users"
                    tone="purple"
                  />
                  <Stat
                    value={String(releaseData.length)}
                    label="Active releases"
                    icon="music"
                    tone="slate"
                  />
                  <Stat
                    value="2"
                    label="Need attention"
                    icon="alert"
                    tone="red"
                  />
                  <Stat
                    value="12"
                    label="Tasks handled this week"
                    icon="check"
                    tone="green"
                  />
                </div>
                <p>
                  Looking for your connected artist records?{" "}
                  <Link
                    className="text-link"
                    href={account ? "/artists" : "/login"}
                  >
                    Open database roster <Icon name="arrow" size={15} />
                  </Link>
                </p>
              </Panel>
            </>
          )}
          {view === "Releases" && (
            <div className="release-layout">
              <div className="release-list">
                <div className="panel-heading">
                  <h2>Releases</h2>
                  <button
                    className="button primary small"
                    onClick={() => setModal("New release")}
                  >
                    <Icon name="plus" size={15} />
                    New release
                  </button>
                </div>
                <p className="subtitle">
                  Manage and track all upcoming releases.
                </p>
                <div className="tabs">
                  {["All", "On track", "At risk", "Launching soon"].map((t) => (
                    <button
                      key={t}
                      className={filter === t ? "selected" : ""}
                      onClick={() => setFilter(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {releaseData
                  .filter((r) => filter === "All" || r[3] === filter)
                  .map((r) => (
                    <button
                      key={r[0]}
                      className={`release-row ${selected === r ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedRelease(releaseData.indexOf(r));
                        setTab("Overview");
                      }}
                    >
                      <div className={`cover cover-${r[4]}`}>
                        <Avatar index={r[4]} />
                        <span>{r[0]}</span>
                      </div>
                      <div>
                        <strong>
                          {r[0]}{" "}
                          <span>({r[0] === "Higher" ? "EP" : "Single"})</span>
                        </strong>
                        <p>{r[1]}</p>
                        <small>{r[2]}</small>
                      </div>
                      <Badge
                        tone={
                          r[3] === "At risk"
                            ? "red"
                            : r[3] === "On track"
                              ? "green"
                              : "purple"
                        }
                      >
                        {r[3]}
                      </Badge>
                    </button>
                  ))}
              </div>
              <div className="release-detail">
                <div className="release-hero">
                  <div className={`cover cover-${selected[4]} large-cover`}>
                    <Avatar index={selected[4]} large />
                    <span>{selected[0]}</span>
                  </div>
                  <div>
                    <span className="eyebrow">SINGLE</span>
                    <h1>{selected[0]} (Single)</h1>
                    <h3>{selected[1]}</h3>
                    <p>{roster[selected[4]].genre} · 1 track · 3:24</p>
                    <p>
                      A new chapter from {selected[1]}. An intimate look at
                      self-discovery,
                      <br />
                      blending dreamy production with raw lyricism.
                    </p>
                  </div>
                  <div className="release-date">
                    <Badge tone={selected[3] === "At risk" ? "red" : "green"}>
                      {selected[3]}
                    </Badge>
                    <p>Release date</p>
                    <strong>
                      <Icon name="calendar" size={16} />
                      {selected[2]}
                    </strong>
                  </div>
                </div>
                <div className="tabs release-tabs">
                  {[
                    "Overview",
                    "Tasks",
                    "Timeline",
                    "Files",
                    "Collaborators",
                    "Notes",
                  ].map((t) => (
                    <button
                      key={t}
                      className={tab === t ? "selected" : ""}
                      onClick={() => setTab(t)}
                    >
                      {t}
                      {t === "Tasks" ? " (8)" : ""}
                    </button>
                  ))}
                </div>
                {tab === "Overview" ? (
                  <>
                    <div className="release-summary">
                      <Panel className="completion-card">
                        <div className="progress-ring">
                          <strong>
                            68%<small>Complete</small>
                          </strong>
                        </div>
                        <div>
                          <p>
                            <i className="dot green" />6 completed
                          </p>
                          <p>
                            <i className="dot purple" />4 in progress
                          </p>
                          <p>
                            <i className="dot slate" />2 not started
                          </p>
                          <p>
                            <i className="dot red" />1 blocked
                          </p>
                        </div>
                      </Panel>
                      <Panel className="risk-panel">
                        <h2>
                          <Icon name="alert" /> {selected[3]}
                        </h2>
                        <p>
                          {selected[3] === "At risk"
                            ? "Artwork is overdue, reducing slack for distributor upload."
                            : "The next milestones are on your radar. Keep your team moving together."}
                        </p>
                        <ArrowLink onClick={() => go("Approvals")}>
                          View details
                        </ArrowLink>
                      </Panel>
                      <Panel className="lavender">
                        <Icon name="music" size={26} />
                        <h2>Coming to life</h2>
                        <p>Release day</p>
                        <strong>{selected[2]}</strong>
                      </Panel>
                    </div>
                    <div className="release-lower">
                      <Panel
                        title="Key milestones"
                        action={
                          <ArrowLink onClick={() => setTab("Timeline")}>
                            View timeline
                          </ArrowLink>
                        }
                      >
                        {[
                          "Artwork final",
                          "Metadata complete",
                          "Master delivery",
                          "Distributor upload",
                          "DSP pitching",
                          "Press assets ready",
                          "Release date",
                        ].map((m, i) => (
                          <div className="milestone" key={m}>
                            <Icon
                              name={
                                i < 2 ? "check" : i === 2 ? "alert" : "clock"
                              }
                              size={18}
                            />
                            <span>{m}</span>
                            <small>
                              {
                                [
                                  "Aug 28",
                                  "Sep 2",
                                  "Sep 8",
                                  "Sep 12",
                                  "Sep 15",
                                  "Sep 18",
                                  "Oct 13",
                                ][i]
                              }
                            </small>
                          </div>
                        ))}
                      </Panel>
                      <Panel
                        title="Deliverables"
                        action={
                          <ArrowLink onClick={() => setTab("Tasks")}>
                            View all
                          </ArrowLink>
                        }
                      >
                        {[
                          "Artwork (cover + assets)",
                          "Metadata (titles, credits, ISRC)",
                          "Master delivery (WAV)",
                          "Distributor upload",
                          "DSP pitching (Spotify, Apple, etc.)",
                          "Press assets (bio, EPK, photos)",
                          "Release live",
                        ].map((t, i) => (
                          <div className="deliverable" key={t}>
                            <Icon name="file" size={15} />
                            <span>{t}</span>
                            <small>{i % 2 === 0 ? selected[1] : "Jane"}</small>
                            <Badge
                              tone={
                                i === 0 || i === 3
                                  ? "red"
                                  : i === 1
                                    ? "green"
                                    : "purple"
                              }
                            >
                              {
                                [
                                  "Overdue",
                                  "Complete",
                                  "In progress",
                                  "Blocked",
                                  "Not started",
                                  "Not started",
                                  "Pending",
                                ][i]
                              }
                            </Badge>
                          </div>
                        ))}
                      </Panel>
                      <Panel title="Recent activity">
                        {activity.slice(0, 3).map((a, i) => (
                          <div className="resolved-row" key={`${a}${i}`}>
                            <Avatar index={i} />
                            <div>
                              {a}
                              <small>{i + 1} hours ago</small>
                            </div>
                          </div>
                        ))}
                      </Panel>
                      <Panel title="Risk & dependencies">
                        <h3 className="urgent">Artwork delay</h3>
                        <p>
                          Final artwork is needed before distributor upload and
                          DSP pitching can begin.
                        </p>
                        <div className="tags">
                          <Badge tone="red">Artwork</Badge>
                          <Icon name="arrow" size={15} />
                          <Badge tone="slate">Distributor upload</Badge>
                          <Icon name="arrow" size={15} />
                          <Badge tone="slate">DSP pitching</Badge>
                        </div>
                        <hr />
                        <h3>Tight promo window</h3>
                        <p>
                          Consider pulling press assets forward to give the
                          campaign room to breathe.
                        </p>
                      </Panel>
                    </div>
                  </>
                ) : (
                  <Panel
                    title={`${selected[0]} · ${tab}`}
                    className="tab-content"
                  >
                    {tab === "Tasks" ? (
                      <>
                        {upcoming}
                        <button
                          className="button primary"
                          onClick={() => setModal("Create task")}
                        >
                          Add task
                        </button>
                      </>
                    ) : tab === "Timeline" ? (
                      [
                        "Artwork final · August 28",
                        "Metadata complete · September 2",
                        "Master delivery · September 8",
                        "Distributor upload · September 12",
                        `Release date · ${selected[2]}`,
                      ].map((t) => (
                        <div className="timeline-entry" key={t}>
                          <Icon name="calendar" />
                          {t}
                        </div>
                      ))
                    ) : tab === "Collaborators" ? (
                      [
                        "Jane Smith · Artist Manager",
                        `${selected[1]} · Artist`,
                        "Alex Rivera · Creative Director",
                        "Taylor · Publicist",
                      ].map((t, i) => (
                        <div className="roster-row" key={t}>
                          <Avatar index={i} />
                          {t}
                        </div>
                      ))
                    ) : tab === "Notes" ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const form = new FormData(e.currentTarget);
                          record(
                            `Note added to ${selected[0]}: ${form.get("note")}`,
                          );
                          e.currentTarget.reset();
                        }}
                      >
                        <textarea
                          name="note"
                          required
                          placeholder="Add a note for your team…"
                        />
                        <button className="button primary">Save note</button>
                      </form>
                    ) : (
                      <div className="empty-state">
                        <Icon name="file" size={40} />
                        <h2>No files uploaded yet</h2>
                        <p>
                          Demo attachments appear in your inbox. File storage
                          will be connected in the next phase.
                        </p>
                      </div>
                    )}
                  </Panel>
                )}
              </div>
            </div>
          )}
          {view === "Approvals" && (
            <div className="approvals-layout">
              <div>
                <p className="eyebrow">APPROVALS</p>
                <h1>Your approvals keep Dopio in sync</h1>
                <p className="subtitle">
                  Review what Dopio wants to do. You’re always in control.
                </p>
                <div className="tabs">
                  {["All", "Internal updates", "Drafts", "Release changes"].map(
                    (t) => (
                      <button
                        key={t}
                        onClick={() => setFilter(t)}
                        className={filter === t ? "selected" : ""}
                      >
                        {t}
                        {t === "All" ? ` (${approvals.length})` : ""}
                      </button>
                    ),
                  )}
                </div>
                <div className="approval-list">
                  {approvals
                    .map((a, i) => ({ a, i }))
                    .filter(
                      ({ a }) =>
                        filter === "All" ||
                        (filter === "Drafts"
                          ? /draft|reply/i.test(a)
                          : filter === "Release changes"
                            ? /streaming|tracklist/.test(a)
                            : !/draft|reply|streaming|tracklist/i.test(a)),
                    )
                    .map(({ a, i }) => (
                      <button
                        className={`approval-row ${selectedApproval === i ? "selected" : ""}`}
                        key={a}
                        onClick={() => setSelectedApproval(i)}
                      >
                        <Avatar index={i % 4} />
                        <div>
                          <strong>{a}</strong>
                          <p>
                            {/draft|reply/i.test(a)
                              ? "Draft content prepared for your review."
                              : "A suggested update to keep your records in sync."}
                          </p>
                          <div className="tags">
                            <Badge>
                              {a.includes("Maya")
                                ? "Maya"
                                : a.includes("River")
                                  ? "River"
                                  : a.includes("Noah")
                                    ? "Noah"
                                    : "Luna"}
                            </Badge>
                            <Badge
                              tone={/draft|reply/i.test(a) ? "red" : "green"}
                            >
                              {/draft|reply/i.test(a)
                                ? "External draft"
                                : "Internal update"}
                            </Badge>
                          </div>
                        </div>
                        <Icon name="chevron" size={17} />
                      </button>
                    ))}
                </div>
                {approvals.length === 0 && (
                  <div className="empty-state">
                    <Icon name="check" size={48} />
                    <h2>You’re all caught up.</h2>
                    <p>Your next proposed updates will appear here.</p>
                  </div>
                )}
              </div>
              {approvals.length > 0 && (
                <Panel className="approval-detail">
                  <div className="panel-heading">
                    <Badge tone="green">
                      <Icon name="shield" size={15} />
                      Internal review
                    </Badge>
                    <small>#AP-{1042 + selectedApproval}</small>
                  </div>
                  <h1>{approvals[selectedApproval]}</h1>
                  <p className="subtitle">
                    Review the proposed change and its source before approving.
                  </p>
                  <div className="approval-preview">
                    <Avatar index={selectedApproval % 4} large />
                    <div>
                      <small>
                        {approvals[selectedApproval].includes("Maya")
                          ? "Maya"
                          : "Artist workspace"}
                      </small>
                      <h2>
                        {approvals[selectedApproval].includes("Midnight")
                          ? "Midnight"
                          : "Project update"}
                      </h2>
                      <Badge>Upcoming release</Badge>
                    </div>
                    {selectedApproval === 0 && (
                      <div>
                        <small>Current date</small>
                        <p>Sep 22, 2026</p>
                        <small>New date</small>
                        <h3>Sep 29, 2026</h3>
                      </div>
                    )}
                  </div>
                  {[
                    [
                      "settings",
                      "What Dopio wants to do",
                      approvals[selectedApproval] +
                        ". This update will be recorded in your workspace activity.",
                    ],
                    [
                      "sparkle",
                      "Why",
                      "New information was found in a recent conversation. Keeping your internal records up to date helps the whole team work from the same timeline.",
                    ],
                    [
                      "link",
                      "Source / provenance",
                      "Distributor update · Received Sep 16, 2026 at 9:14 AM. “Artwork delivery expected Sep 29, 2026 due to production delay.”",
                    ],
                  ].map(([icon, title, body]) => (
                    <div className="approval-section" key={title}>
                      <span className="soft-icon">
                        <Icon name={icon} size={18} />
                      </span>
                      <div>
                        <h3>{title}</h3>
                        <p>{body}</p>
                        {title === "Source / provenance" && (
                          <ArrowLink onClick={() => go("Inbox")}>
                            View source
                          </ArrowLink>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="policy">
                    <Icon name="shield" size={26} />
                    <div>
                      <h3>You’re always in control</h3>
                      <p>
                        Approvals update this demo workspace. External
                        communications are never sent without review.
                      </p>
                    </div>
                  </div>
                  <div className="approval-buttons">
                    <button
                      className="button approve"
                      onClick={() => decide(true)}
                    >
                      <Icon name="check" size={18} />
                      Approve
                    </button>
                    <button
                      className="button"
                      onClick={() => setModal("Edit approval")}
                    >
                      <Icon name="edit" size={18} />
                      Edit
                    </button>
                    <button
                      className="button reject"
                      onClick={() => decide(false)}
                    >
                      <Icon name="close" size={18} />
                      Reject
                    </button>
                  </div>
                </Panel>
              )}
            </div>
          )}
          {view === "Activity" && (
            <div className="activity-layout">
              <div>
                <p className="eyebrow">ACTIVITY</p>
                <h1>Full transparency, always.</h1>
                <p className="subtitle">
                  A complete record of everything Dopio and your team have done.
                </p>
                <div className="stats-grid activity-stats">
                  <Stat
                    value={String(activity.length)}
                    label="Actions in workspace"
                    icon="bolt"
                    tone="blue"
                  />
                  <Stat
                    value="3"
                    label="Risks surfaced"
                    icon="alert"
                    tone="red"
                  />
                  <Stat
                    value="7"
                    label="Corrections made"
                    icon="check"
                    tone="green"
                  />
                  <Stat
                    value="2h 18m"
                    label="Average response time"
                    icon="clock"
                    tone="purple"
                  />
                </div>
                <div className="tabs">
                  {["All", "Dopio actions", "Team actions"].map((t) => (
                    <button
                      key={t}
                      className={filter === t ? "selected" : ""}
                      onClick={() => setFilter(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="activity-table">
                  <div className="activity-table-head">
                    <span>Time ↓</span>
                    <span>Action</span>
                    <span>Performed by</span>
                    <span>Artist / Release</span>
                    <span>Status</span>
                  </div>
                  {activity
                    .filter(
                      (a) =>
                        filter === "All" ||
                        (filter === "Dopio actions"
                          ? a.includes("Dopio")
                          : !a.includes("Dopio")),
                    )
                    .map((a, i) => (
                      <div className="activity-table-row" key={`${a}${i}`}>
                        <small>
                          {i < 4 ? "Today" : "Yesterday"}
                          <br />
                          {10 - (i % 6)}:24 AM
                        </small>
                        <div>
                          <span className="soft-icon">
                            <Icon
                              name={i % 3 === 0 ? "sparkle" : "file"}
                              size={20}
                            />
                          </span>
                          <strong>{a}</strong>
                        </div>
                        <span>
                          {a.includes("Dopio") ? (
                            <span className="soft-icon">
                              <Icon name="sparkle" size={17} />
                            </span>
                          ) : (
                            <span className="mini-initials">JS</span>
                          )}
                          {a.includes("Dopio") ? "Dopio" : profile}
                        </span>
                        <span>
                          <Avatar index={i % 4} />
                          {roster[i % 4].name}
                        </span>
                        <Badge tone={a.includes("risk") ? "red" : "green"}>
                          {a.includes("risk") ? "At risk" : "Completed"}
                        </Badge>
                      </div>
                    ))}
                </div>
              </div>
              <aside>
                <Panel title="Activity insights">
                  <p className="subtitle">Your workspace at a glance</p>
                  {[
                    [
                      "sparkle",
                      "Dopio actions",
                      activity.filter((a) => a.includes("Dopio")).length,
                    ],
                    [
                      "users",
                      "Team actions",
                      activity.filter((a) => !a.includes("Dopio")).length,
                    ],
                    ["alert", "Pending approvals", approvals.length],
                    ["check", "Completed tasks", completed.length],
                  ].map(([icon, label, count]) => (
                    <div className="insight-row" key={label}>
                      <Icon name={String(icon)} />
                      <span>{label}</span>
                      <strong>{count}</strong>
                    </div>
                  ))}
                </Panel>
                <div className="quote-card">
                  <span>“</span>
                  <p>
                    Transparency builds trust. You can always see what Dopio did
                    and dig into the details.
                  </p>
                  <small>— Dopio</small>
                </div>
                <Panel title="Recent activity by">
                  {[
                    "Jane Smith",
                    "Dopio",
                    "Mike Chen",
                    "Sarah Kim",
                    "Tom Rivera",
                  ].map((n, i) => (
                    <div className="roster-row" key={n}>
                      <Avatar index={i} />
                      <div>
                        <strong>{n}</strong>
                        <small>
                          {
                            [
                              "Artist Manager",
                              "AI Assistant",
                              "Publicist",
                              "Tour Manager",
                              "Label Relations",
                            ][i]
                          }
                        </small>
                      </div>
                    </div>
                  ))}
                </Panel>
              </aside>
            </div>
          )}
          {view === "Calendar" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">MAKE ROOM FOR WHAT MATTERS</p>
                  <h1>Your calendar</h1>
                  <p className="subtitle">
                    Sessions, milestones, and a little breathing room.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setModal("Create task")}
                >
                  <Icon name="plus" size={16} />
                  Create task
                </button>
              </div>
              <div className="calendar-layout">
                <Panel
                  title="September 2026"
                  action={<Badge>Demo calendar</Badge>}
                >
                  <div className="month-grid">
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                      (d) => (
                        <strong key={d}>{d}</strong>
                      ),
                    )}
                    <span />
                    {Array.from({ length: 30 }, (_, i) => (
                      <button
                        key={i}
                        className={day === i + 1 ? "selected" : ""}
                        onClick={() => setDay(i + 1)}
                      >
                        <span>{i + 1}</span>
                        {[16, 18, 19, 22, 24].includes(i + 1) && (
                          <small>
                            {i === 15
                              ? "5 events"
                              : i === 17
                                ? "Maya · Photoshoot"
                                : i === 18
                                  ? "River · Tracklist"
                                  : i === 21
                                    ? "Luna · Master"
                                    : "Team sync"}
                          </small>
                        )}
                      </button>
                    ))}
                  </div>
                </Panel>
                <Panel title={`September ${day}`}>
                  {day === 16 ? (
                    schedule
                  ) : (
                    <div className="empty-state">
                      <Icon name="calendar" size={32} />
                      <p>
                        {[18, 19, 22, 24].includes(day)
                          ? tasks[[18, 19, 22, 24].indexOf(day)]
                          : "A little breathing room. No events today."}
                      </p>
                    </div>
                  )}
                </Panel>
              </div>
              <Panel title="Upcoming milestones">{upcoming}</Panel>
            </>
          )}
          {view === "Dopio" && (
            <div className="assistant-layout">
              <div className="assistant-main">
                <div className="page-heading">
                  <div>
                    <h1>
                      Dopio{" "}
                      <span className="sparkle-icon">
                        <Icon name="sparkle" size={28} />
                      </span>
                    </h1>
                    <p className="subtitle">
                      Your AI command center for artist management.
                    </p>
                  </div>
                  <Badge tone="green">Demo assistant</Badge>
                </div>
                <div className="assistant-capabilities">
                  {[
                    ["mail", "Get answers", "Across your workspace"],
                    ["bolt", "Take action", "Tasks, drafts, updates"],
                    ["alert", "Stay ahead", "Risks and opportunities"],
                    ["sparkle", "Work your way", "Your artists, your rhythm"],
                  ].map(([icon, title, desc]) => (
                    <div key={title}>
                      <span className="soft-icon">
                        <Icon name={icon} />
                      </span>
                      <span>
                        <strong>{title}</strong>
                        <small>{desc}</small>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="conversation">
                  <div className="assistant-intro">
                    <span className="soft-icon">
                      <Icon name="sparkle" size={24} />
                    </span>
                    <div>
                      <strong>
                        Dopio <small>9:14 AM</small>
                      </strong>
                      <p>
                        Here’s what changed today, {profile.split(" ")[0]}. A
                        little clarity for your day.
                      </p>
                    </div>
                  </div>
                  <Panel
                    title="Your day, at a glance"
                    className="assistant-summary"
                  >
                    <p>
                      Key updates across your artists. One thing needs your
                      attention.
                    </p>
                    <div className="stats-grid">
                      <Stat
                        value="12"
                        label="New emails"
                        icon="mail"
                        tone="blue"
                      />
                      <Stat
                        value="3"
                        label="Tasks completed"
                        icon="check"
                        tone="green"
                      />
                      <Stat
                        value="2"
                        label="Artist updates"
                        icon="users"
                        tone="purple"
                      />
                      <Stat
                        value={String(approvals.length)}
                        label="Need approval"
                        icon="alert"
                        tone="red"
                      />
                    </div>
                    <h3>
                      <Icon name="bolt" size={19} />
                      Recommended actions
                    </h3>
                    {[
                      "Approve Maya’s artwork for the upcoming single",
                      "Respond to River’s label about tracklist changes",
                      "Plan Maya’s release timeline",
                      "Review tour assets from Luna",
                    ].map((t, i) => (
                      <div className="recommendation" key={t}>
                        <span>{i + 1}</span>
                        <p>{t}</p>
                        <button
                          className="button small"
                          onClick={() =>
                            go(
                              i === 1
                                ? "Inbox"
                                : i === 2
                                  ? "Calendar"
                                  : "Approvals",
                            )
                          }
                        >
                          {
                            [
                              "Review",
                              "Open email",
                              "View calendar",
                              "Review assets",
                            ][i]
                          }
                        </button>
                      </div>
                    ))}
                    <hr />
                    <h3>
                      <Icon name="file" size={19} />
                      Created internal updates
                    </h3>
                    {[
                      "Maya — Noted label feedback on final artwork",
                      "River — Logged press outreach results",
                      "Luna — Added new venue option to tour pipeline",
                    ].map((t) => (
                      <div className="recommendation" key={t}>
                        <Icon name="check" size={17} />
                        <p>{t}</p>
                        <button
                          className="text-link"
                          onClick={() => go("Activity")}
                        >
                          View update
                        </button>
                      </div>
                    ))}
                    <div className="info-box">
                      This is a demo assistant using sample workspace data. Live
                      AI and connected email are not enabled yet.
                    </div>
                  </Panel>
                  {messages.map((m, i) => (
                    <div className="chat-exchange" key={i}>
                      <div className="user-message">{m.question}</div>
                      <div className="assistant-message">
                        <span className="soft-icon">
                          <Icon name="sparkle" />
                        </span>
                        <p>{m.answer}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <form
                  className="chat-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    ask(prompt);
                  }}
                >
                  <Icon name="sparkle" size={21} />
                  <input
                    placeholder="Ask Dopio anything about your artists, releases, or inbox…"
                    aria-label="Message Dopio"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <button
                    className="button dark"
                    disabled={!prompt.trim()}
                    aria-label="Send message"
                  >
                    <Icon name="send" size={18} />
                  </button>
                </form>
              </div>
              <aside>
                <Panel
                  title="Suggested prompts"
                  action={<Icon name="sparkle" size={20} />}
                >
                  {[
                    "What changed today?",
                    "Show me what needs approval this week.",
                    "Plan Maya’s release.",
                    "Summarize River’s press coverage.",
                    "What are the risks for Luna’s tour?",
                    "Show me my top priorities this week.",
                  ].map((t) => (
                    <button
                      className="suggestion"
                      key={t}
                      onClick={() => ask(t)}
                    >
                      {t}
                      <Icon name="chevron" size={16} />
                    </button>
                  ))}
                </Panel>
                <Panel title="What Dopio knows">
                  <div className="knowledge-grid">
                    {[
                      ["users", String(artists.length), "Artists"],
                      ["music", String(releaseData.length), "Releases"],
                      ["mail", "248", "Sample emails"],
                      [
                        "check",
                        String(tasks.length + approvals.length),
                        "Tasks & approvals",
                      ],
                    ].map(([icon, count, label]) => (
                      <div key={label}>
                        <Icon name={icon} />
                        <span>
                          <strong>{count}</strong>
                          <small>{label}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel title="Recent tasks">
                  {tasks.map((t) => (
                    <label className="task-check" key={t}>
                      <input
                        type="checkbox"
                        checked={completed.includes(t)}
                        onChange={() => toggleTask(t)}
                      />
                      {t}
                    </label>
                  ))}
                </Panel>
                <Panel title="Your working preferences">
                  <div className="resolved-row">
                    <Icon name="check" />
                    <p>Review external communications before sending.</p>
                  </div>
                  <div className="resolved-row">
                    <Icon name="check" />
                    <p>Keep release updates connected to their sources.</p>
                  </div>
                </Panel>
              </aside>
            </div>
          )}
          {view === "Settings" && (
            <div className="settings-page">
              <Panel
                title={account ? "Your account" : "You’re exploring a demo"}
              >
                <p>
                  {account
                    ? `${account.email} · ${account.workspaceName}`
                    : "Sign in to create your own workspace."}
                </p>
                {account ? (
                  <form action={signOut}>
                    <button className="button dark">Sign out</button>
                  </form>
                ) : (
                  <Link className="button primary" href="/login">
                    Sign in to Dopio
                  </Link>
                )}
              </Panel>
              <h1>Make Dopio yours</h1>
              <p className="subtitle">
                Your profile, connections, and workspace.
              </p>
              <Panel title="Your profile">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setProfileError("");
                    setProfileSaving(true);
                    try {
                      if (account) {
                        const result = await saveProfile(profile);
                        if (result.error) {
                          setProfileError(result.error);
                          return;
                        }
                      }
                      record("Profile updated");
                    } catch {
                      setProfileError(
                        "Your profile could not be saved. Please try again.",
                      );
                    } finally {
                      setProfileSaving(false);
                    }
                  }}
                >
                  <label>
                    Your name
                    <input
                      value={profile}
                      required
                      onChange={(e) => setProfile(e.target.value)}
                    />
                  </label>
                  <label>
                    Your role
                    <select
                      defaultValue={account?.role ?? "Artist Manager"}
                      disabled={Boolean(account)}
                    >
                      <option>Artist Manager</option>
                      <option>Publicist</option>
                      <option>Label Team</option>
                      <option>Independent Artist</option>
                    </select>
                  </label>
                  <button className="button primary" disabled={profileSaving}>
                    {profileSaving ? "Saving…" : "Save profile"}
                  </button>
                  {profileError && (
                    <p role="alert" className="auth-feedback error">
                      {profileError}
                    </p>
                  )}
                </form>
              </Panel>
              <Panel title="Connections">
                <div className="connection-row">
                  <Icon name="mail" />
                  <div>
                    <h3>Gmail</h3>
                    <p>
                      Connect emails to your artists, releases, and
                      relationships.
                    </p>
                  </div>
                  <Badge tone="slate">Not connected</Badge>
                </div>
                <div className="connection-row">
                  <Icon name="calendar" />
                  <div>
                    <h3>Google Calendar</h3>
                    <p>Bring sessions and deadlines into one place.</p>
                  </div>
                  <Badge tone="slate">Not connected</Badge>
                </div>
                <p className="info-box">
                  Google account connections require OAuth setup. This workspace
                  currently uses demo data.
                </p>
              </Panel>
              <Panel title="Welcome to Dopio">
                <p>Explore the guided onboarding experience.</p>
                <button
                  className="button"
                  onClick={() => {
                    setStep(0);
                    setModal("Onboarding");
                  }}
                >
                  Preview onboarding <Icon name="arrow" size={16} />
                </button>
              </Panel>
            </div>
          )}
        </main>
        <footer className="workspace-footer">
          <span>Dopio</span> A little less admin. A little more possibility.
          <span>Made for the people behind the artists.</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={19} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className={`modal ${modal === "Onboarding" ? "onboarding-modal" : ""}`}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={modal}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <Icon name="close" />
            </button>
            {modal === "Onboarding" ? (
              <>
                <div className="onboarding-brand">
                  Dopio <span>Step {step + 1} of 8</span>
                </div>
                <div className="onboarding-progress">
                  {Array.from({ length: 8 }, (_, i) => (
                    <i className={i <= step ? "filled" : ""} key={i} />
                  ))}
                </div>
                <span className="onboarding-symbol">
                  <Icon
                    name={
                      [
                        "users",
                        "mail",
                        "calendar",
                        "sparkle",
                        "users",
                        "music",
                        "alert",
                        "check",
                      ][step]
                    }
                    size={38}
                  />
                </span>
                <h1>
                  {
                    [
                      "Tell us about yourself",
                      "Connect your Gmail",
                      "Connect your Calendar",
                      "Dopio is learning your world",
                      "Confirm your artists",
                      "Confirm releases & key dates",
                      "A little input goes a long way",
                      "You’re all set!",
                    ][step]
                  }
                </h1>
                <p className="subtitle">
                  {
                    [
                      "Let’s make more room for what matters.",
                      "Turn conversations into a clearer picture.",
                      "Keep meetings, sessions, and show dates in sync.",
                      "A preview of how Dopio connects your world.",
                      "Meet your demo roster.",
                      "Your next releases, all in one place.",
                      "Help Dopio understand how you work.",
                      "Your artists. Your plans. A little more breathing room.",
                    ][step]
                  }
                </p>
                {step === 0 ? (
                  <label>
                    Your name
                    <input
                      value={profile}
                      onChange={(e) => setProfile(e.target.value)}
                    />
                  </label>
                ) : step === 1 || step === 2 ? (
                  <div className="info-box">
                    <Icon name="shield" size={25} />
                    <p>
                      Your data stays yours. Google connections will be
                      available after OAuth is configured. Continue to explore
                      with demo data.
                    </p>
                  </div>
                ) : step === 3 ? (
                  <div className="learning-list">
                    {[
                      "Finding artists and contacts",
                      "Connecting releases and key dates",
                      "Organizing your deliverables",
                      "Building your timeline",
                    ].map((t) => (
                      <p key={t}>
                        <Icon name="check" />
                        {t}
                        <Badge tone="green">Demo ready</Badge>
                      </p>
                    ))}
                  </div>
                ) : step === 4 ? (
                  artists.map((a, i) => (
                    <div className="roster-row" key={a.name}>
                      <Avatar index={i} />
                      <strong>{a.name}</strong>
                      <small>{a.genre}</small>
                    </div>
                  ))
                ) : step === 5 ? (
                  releaseData.slice(0, 3).map((r) => (
                    <div className="roster-row" key={r[0]}>
                      <Avatar index={r[4]} />
                      <strong>
                        {r[1]} — {r[0]}
                      </strong>
                      <small>{r[2]}</small>
                    </div>
                  ))
                ) : step === 6 ? (
                  <label>
                    How should Dopio handle external messages?
                    <select>
                      <option>Always prepare a draft for my review</option>
                      <option>Only draft when I ask</option>
                    </select>
                  </label>
                ) : (
                  <div className="info-box">
                    Your demo workspace is ready to explore. You can change your
                    profile and connections in Settings.
                  </div>
                )}
                <div className="onboarding-actions">
                  <button
                    className="text-link"
                    disabled={step === 0}
                    onClick={() => setStep((s) => s - 1)}
                  >
                    ← Back
                  </button>
                  <button
                    className="button dark"
                    onClick={() =>
                      step === 7
                        ? (setModal(null), go("Today"))
                        : setStep((s) => s + 1)
                    }
                  >
                    {step === 7 ? "Go to your dashboard" : "Continue"}
                    <Icon name="arrow" size={17} />
                  </button>
                </div>
              </>
            ) : [
                "Add artist",
                "New release",
                "Create task",
                "Draft email",
                "Edit approval",
              ].includes(modal) ? (
              <>
                <span className="soft-icon">
                  <Icon
                    name={
                      modal === "Add artist"
                        ? "users"
                        : modal === "Draft email"
                          ? "mail"
                          : "plus"
                    }
                    size={25}
                  />
                </span>
                <h1>{modal}</h1>
                <p className="subtitle">
                  A small step toward keeping everything in sync.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    const title = String(data.get("title") || "");
                    if (modal === "Add artist") {
                      setArtists((a) => [
                        ...a,
                        {
                          name: title,
                          genre: String(data.get("detail") || "Independent"),
                          releases: 0,
                          image: roster[0].image,
                        },
                      ]);
                      record(`${title} added to your demo roster`);
                    } else if (modal === "Create task") {
                      setTasks((t) => [...t, title]);
                      record(`Task created: ${title}`);
                    } else if (modal === "Edit approval") {
                      setApprovals((a) =>
                        a.map((v, i) => (i === selectedApproval ? title : v)),
                      );
                      record("Approval updated for review");
                    } else if (modal === "New release") {
                      const name = String(data.get("artist"));
                      const index = Math.max(
                        0,
                        roster.findIndex((a) => a.name === name),
                      );
                      const date = String(data.get("date"));
                      setReleases((r) => [
                        ...r,
                        [
                          title,
                          name,
                          new Date(date + "T12:00:00").toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric", year: "numeric" },
                          ),
                          "Planning",
                          index,
                        ],
                      ]);
                      setArtists((a) =>
                        a.map((x) =>
                          x.name === name
                            ? { ...x, releases: x.releases + 1 }
                            : x,
                        ),
                      );
                      setSelectedRelease(releaseData.length);
                      go("Releases");
                      record(`Release created: ${title}`);
                    } else
                      record(
                        `Email draft saved: ${title} — ${String(data.get("detail") || "")}`,
                      );
                    setModal(null);
                  }}
                >
                  <label>
                    {modal === "Add artist"
                      ? "Artist name"
                      : modal === "Draft email"
                        ? "Subject"
                        : modal === "Edit approval"
                          ? "Proposed update"
                          : "Title"}
                    <input
                      autoFocus
                      name="title"
                      defaultValue={
                        modal === "Edit approval"
                          ? approvals[selectedApproval]
                          : ""
                      }
                      placeholder={
                        modal === "Add artist" ? "e.g. Maya" : "Give it a name"
                      }
                      required
                    />
                  </label>
                  {modal === "Add artist" ? (
                    <label>
                      Genre
                      <input
                        name="detail"
                        placeholder="e.g. Pop / Alternative"
                      />
                    </label>
                  ) : modal === "Draft email" ? (
                    <label>
                      Message
                      <textarea
                        name="detail"
                        required
                        placeholder="Write your draft…"
                      />
                    </label>
                  ) : modal === "New release" ? (
                    <>
                      <label>
                        Artist
                        <select name="artist">
                          {artists.map((a) => (
                            <option key={a.name}>{a.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Release date
                        <input type="date" name="date" required />
                      </label>
                    </>
                  ) : null}
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="button"
                      onClick={() => setModal(null)}
                    >
                      Cancel
                    </button>
                    <button className="button primary">
                      {modal === "Edit approval"
                        ? "Save changes"
                        : modal === "Draft email"
                          ? "Save draft"
                          : "Create"}
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <span className="soft-icon">
                  <Icon name="calendar" size={26} />
                </span>
                <h1>{modal}</h1>
                <p className="subtitle">Tuesday, September 16, 2026</p>
                <div className="info-box">
                  A moment to connect, review progress, and keep your artists
                  moving forward.
                </div>
                <button
                  className="button primary"
                  onClick={() => {
                    setModal(null);
                    go("Calendar");
                  }}
                >
                  View calendar <Icon name="arrow" size={16} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
