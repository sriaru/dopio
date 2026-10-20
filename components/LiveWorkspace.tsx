"use client";
import {taskStatusLabel,taskStatusTone} from '@/lib/workspace/task-status';
import { useEffect, useRef, useState, type ReactNode } from "react";
import {DEFAULT_TIME_ZONE,workspaceDay,withinNextSevenDays,isOverdueTask,isMissingManager,matchesTaskFilter} from '@/lib/workspace/rules';
import {useRouter} from "next/navigation";
import Link from "next/link";
import styles from "./LiveWorkspace.module.css";
import Icon from "./DopioIcon";
import RecordForm from "./WorkspaceRecordForm";
import EmailWorkflow from "./EmailWorkflow";
import DopioPlannerWorkspace from "./DopioPlannerWorkspace";
import CalendarWorkspace from "./CalendarWorkspace";
import WorkspaceContacts from "./WorkspaceContacts";
import TodayWorkspace from "./TodayWorkspace";
import ActivityWorkspace from "./ActivityWorkspace";
import ArtistRoster from "./ArtistRoster";
import ArtistMessages from "./ArtistMessages";
import ArtistUpdates from "./ArtistUpdates";
import ProjectsWorkspace from "./ProjectsWorkspace";
import {
  saveRecord,
  deleteRecord,
  setTaskComplete,
} from "@/app/workspace/actions";
import { signOut, saveProfile } from "@/app/auth/actions";
import type {
  Account,
  WorkspaceData,
  Entity,
  MutationResult,
  TaskRecord,
} from "@/lib/workspace/types";

const navigation = [
  ["Today", "home"],
  ["Inbox", "mail"],
  ["Messages", "chat"],
  ["Artists", "users"],
  ["Releases", "music"],
  ["Tasks", "check"],
  ["Calendar", "calendar"],
  ["Approvals", "shield"],
  ["Activity", "activity"],
  ["Dopio", "sparkle"],
] as const;
type View = (typeof navigation)[number][0] | "Settings" | "Owners";
const validView = (s: string | null): View =>
  s === "Follow-ups" || s === "Alerts" ? "Today" :
  s === "AURA" ? "Dopio" :
  [...navigation.map((n) => n[0]), "Settings", "Owners"].includes(s ?? "")
    ? (s as View)
    : "Today";
function dateLabel(value: string | null) {
  return value
    ? new Date(value + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "No date set";
}
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
function Initials({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span className={`live-avatar ${large ? "large" : ""}`}>
      {initials(name) || "♪"}
    </span>
  );
}
function Tag({
  children,
  tone = "purple",
}: {
  children: ReactNode;
  tone?: string;
}) {
  if(children === "Active")return null;
  return <span className={`badge ${tone}`}>{children}</span>;
}
function statusTone(status: string) {
  return status === "At risk"
    ? "red"
    : ["Complete", "Released", "Active", "On track"].includes(status)
      ? "green"
      : "amber";
}
function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
function Empty({
  icon = "sparkle",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state live-empty">
      <span className="soft-icon">
        <Icon name={icon} size={25} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export default function LiveWorkspace({
  account,
  initialData,
  loadError,
  initialView,
  initialArtist,
  initialRelease,
  today: initialToday,
}: {
  account: Account;
  initialData: WorkspaceData;
  loadError: string | null;
  initialView?: string;
  initialArtist?: string;
  initialRelease?: string;
  today: string;
}) {
  const router=useRouter();
  const [data, setWorkspaceData] = useState(initialData);
  function setData(next:WorkspaceData) {
    if(next.workspaceId !== account.workspaceId) {
      window.location.reload();
      throw new Error("Workspace changed in another tab. Reloading the selected workspace.");
    }
    setWorkspaceData(next);
  }
  const timeZone=data.timeZone??DEFAULT_TIME_ZONE;
  const [today,setToday]=useState(initialToday);
  useEffect(()=>{const tick=()=>setToday(workspaceDay(new Date(),timeZone));tick();const timer=setInterval(tick,30000);return()=>clearInterval(timer);},[timeZone]);
  const [view, setView] = useState<View>(validView(initialView ?? null));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [artistId, setArtistId] = useState(initialArtist ?? "");
  const [releaseId, setReleaseId] = useState(initialRelease ?? "");
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<{
    entity: Entity;
    id?: string;
    remove?: boolean;
    artist?: string;
    release?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState(account.fullName);
  const [profileName, setProfileName] = useState(account.fullName);
  const modalRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function pop() {
      const q = new URLSearchParams(location.search);
      setView(validView(q.get("view")));
      setArtistId(q.get("artist") ?? "");
      setReleaseId(q.get("release") ?? "");
      setFilter("All");
      setSearch("");
    }
    function keyboard(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setMenu(false);
      }
    }
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", keyboard);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("keydown", keyboard);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = modalRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(
      () => dialog?.querySelector<HTMLElement>("input, button")?.focus(),
      0,
    );
    function key(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        setModal(null);
        setError("");
      }
      if (e.key === "Tab") {
        const controls = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
          ) ?? [],
        );
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [modal, busy]);
  const artistName = (id: string | null) =>
    data.artists.find((a) => a.record_id === id)?.name ?? "General";
  const releaseName = (id: string | null) =>
    data.releases.find((r) => r.id === id)?.title;
  const selectedArtist = data.artists.find((a) => a.record_id === artistId);
  const matches = (...values: (string | null | undefined)[]) =>
    values.join(" ").toLowerCase().includes(search.toLowerCase());
  function go(next: View, artist = "", release = "") {
    setView(next);
    setArtistId(artist);
    setReleaseId(release);
    setSearch("");
    setFilter("All");
    setMenu(false);
    const q = new URLSearchParams({ view: next });
    if (artist) q.set("artist", artist);
    if (release) q.set("release", release);
    window.history.pushState(null, "", `/?${q}`);
  }
  function edit(
    entity: Entity,
    id?: string,
    defaults?: { artist?: string; release?: string },
  ) {
    setError("");
    setModal({ entity, id, ...defaults });
    setMenu(false);
  }
  function remove(entity: Entity, id: string) {
    setError("");
    setModal({ entity, id, remove: true });
  }
  async function run(
    action: () => Promise<MutationResult>,
    message: string,
    close = false,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (result.error !== null) {
        setError(result.error);
        return;
      }
      setData(result.data);
      setNotice(message);
      if (close) setModal(null);
    } catch {
      setError(
        "We couldn’t reach your workspace. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const createButton = (entity: Entity, label?: string) => (
    <button
      className="button primary"
      disabled={
        Boolean(loadError) || (entity === "release" && !data.artists.length)
      }
      onClick={() => edit(entity)}
    >
      <Icon name="plus" size={16} />
      {label ?? `Add ${entity}`}
    </button>
  );
  const taskMatches=(t:TaskRecord,f:string)=>f==='Next 7 days'?withinNextSevenDays(t,today):matchesTaskFilter(t,f,today);
  const taskGroup=(t:TaskRecord)=>isOverdueTask(t,today)?'Overdue':withinNextSevenDays(t,today)?'Next 7 days':t.status;
  const allTaskGroups=[{key:'Overdue',label:'Overdue',tone:'red',icon:'alert'},{key:'Next 7 days',label:'Next 7 days',tone:'amber',icon:'calendar'},{key:'In progress',label:'In progress',tone:'blue',icon:'activity'},{key:'Pending',label:'Pending',tone:'amber',icon:'calendar'},{key:'Complete',label:'Completed',tone:'green',icon:'check'}];
  const taskGroups=filter==='All'?allTaskGroups:[allTaskGroups.find(g=>g.key===filter)??{key:filter,label:filter,tone:'slate',icon:'users'}];
  function taskRows(tasks: TaskRecord[]) {
    return (
      <div className="live-task-list">
        {tasks.map((t) => (
          <div
            className={`live-task-row ${t.status === "Complete" ? "is-complete" : ""}`}
            key={t.id} id={`task-${t.id}`}
          >
            <input
              type="checkbox"
              aria-label={`Complete ${t.title}`}
              checked={t.status === "Complete"}
              disabled={busy}
              onChange={(e) => {
                const complete = e.target.checked;
                void run(
                  () => setTaskComplete(t.id, complete,t.version??0),
                  complete ? "Task completed" : "Task reopened",
                );
              }}
            />
            {view==='Tasks'&&<span className="task-artist-avatar" aria-hidden="true">{artistName(t.artist_id).slice(0,1)}</span>}
            <button
              className="live-task-title"
              onClick={() => edit("task", t.id)}
            >
              <strong>{t.title}</strong>
              <small>
                {artistName(t.artist_id)}
                {t.release_id ? ` · ${releaseName(t.release_id)}` : ""}
                {view!=='Tasks'&&` · Manager: ${t.manager_names?.join(", ") || "No manager assigned"}`}
              </small>
            </button>
            <span
              className={
                isOverdueTask(t,today)
                  ? "urgent"
                  : ""
              }
            >
              {dateLabel(t.due_date)}{t.timing_notes&&<small className="tentative-timing">Unconfirmed: {t.timing_notes}</small>}
            </span>
            {view==='Tasks'&&<span className="task-manager-name">{t.manager_names?.join(', ')||'No manager assigned'}</span>}
            {isMissingManager(t)&&<Link className="text-link" href={t.artist_id?"/company":"/?view=Tasks"}>{!t.artist_id?"Link an artist to assign a manager":account.workspaceRole==='owner'?'Assign manager':'Ask owner to assign manager'}</Link>}
            {t.priority === "High" && <Tag tone="amber">High</Tag>}
            <Tag tone={taskStatusTone(isOverdueTask(t,today)?'Overdue':t.status)}>{isOverdueTask(t,today)?'Overdue':taskStatusLabel(t.status)}</Tag>
            <button
              className="icon-button"
              aria-label={`Archive task ${t.title}`}
              onClick={() => remove("task", t.id)}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`dopio-app live-workspace ${styles.workspace}`}>
      <aside className="sidebar">
        <Link href="/" className="wordmark">
          Dopio<span>✧</span>
        </Link>
        <div className="workspace-label" title={account.workspaceName}>
          {account.workspaceName}
        </div>
        <nav>
          {navigation.filter(([item])=>item!=='Activity'||account.workspaceRole==='owner').map(([item, icon]) => (
            <button
              aria-label={item === "Releases" ? "Projects" : item}
              aria-current={view === item ? "page" : undefined}
              key={item}
              className={view === item ? "active" : ""}
              onClick={() => go(item)}
            >
              <Icon name={icon} />
              <span>{item==="Releases"?"Projects":item}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-orbit" />
        <div className="sidebar-bottom">
          <Link href="/company" className="company-nav" aria-label="Company settings">
            <Icon name="users" />
            <span>Company</span>
          </Link>
          <form action={signOut}>
            <button aria-label="Sign out">
              <Icon name="arrow" />
              <span>Sign out</span>
            </button>
          </form>
          <button
            aria-label="Settings"
            className={view === "Settings" ? "active" : ""}
            onClick={() => go("Settings")}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
          <button
            className="profile"
            onClick={() => go("Settings")}
            aria-label="Your profile"
          >
            <span className="initials">{initials(profileName)}</span>
            <span>
              {profileName}
              <small>{account.role}</small>
            </span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="global-search">
            <Icon name="search" size={19} />
            <input
              ref={searchRef}
              aria-label="Search workspace"
              placeholder="Search artists, projects, and tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>⌘ K</kbd>
            {search && (
              <div className="search-results">
                {data.artists
                  .filter((a) => matches(a.name, a.genre))
                  .slice(0, 5)
                  .map((a) => (
                    <button
                      key={a.record_id}
                      onClick={() => go("Artists", a.record_id)}
                    >
                      {a.name}
                      <small>Artist</small>
                    </button>
                  ))}
                {data.releases
                  .filter((r) => matches(r.title, artistName(r.artist_id)))
                  .slice(0, 5)
                  .map((r) => (
                    <button key={r.id} onClick={() => go("Releases", "", r.id)}>
                      {r.title}
                      <small>Release</small>
                    </button>
                  ))}
                {data.tasks
                  .filter((t) => matches(t.title))
                  .slice(0, 5)
                  .map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setSearch("");
                        edit("task", t.id);
                      }}
                    >
                      {t.title}
                      <small>Task</small>
                    </button>
                  ))}
                {!data.artists.some((a) => matches(a.name, a.genre)) &&
                  !data.releases.some((r) =>
                    matches(r.title, artistName(r.artist_id)),
                  ) &&
                  !data.tasks.some((t) => matches(t.title)) && (
                    <p className="search-empty">No matching records yet.</p>
                  )}
              </div>
            )}
          </div>
          <div className="topbar-right">
            <span className="demo-label">
              <i />
              {account.workspaceName}
            </span>
            <div className="dropdown-anchor">
              <button
                className="button new-button"
                aria-expanded={menu}
                disabled={Boolean(loadError)}
                onClick={() => setMenu(!menu)}
              >
                <Icon name="plus" size={17} />
                New
                <Icon name="down" size={15} />
              </button>
              {menu && (
                <div className="dropdown">
                  {(["artist", "release", "task"] as const).map((e) => (
                    <button
                      key={e}
                      disabled={e === "release" && !data.artists.length}
                      onClick={() => edit(e)}
                    >
                      Add {e==="release"?"project":e}
                      <Icon name="plus" size={14} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="workspace">
          {loadError ? (
            <Panel title="Your workspace couldn’t load">
              <div className="auth-feedback error" role="alert">
                {loadError}
              </div>
              <p>Your records have not been replaced with sample data.</p>
              <button
                onClick={() => window.location.reload()}
                className="button primary"
              >
                Try again
              </button>
            </Panel>
          ) : (
            <>
              {error && !modal && (
                <div className="auth-feedback error" role="alert">
                  {error}
                  <button className="text-link" onClick={() => setError("")}>
                    Dismiss
                  </button>
                </div>
              )}
              {view === "Today" && <TodayWorkspace data={data} today={today} name={profileName} user={account.userId} onOwners={()=>go("Owners")} onManagers={()=>router.push("/company")} />}
              {view === "Artists" && (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">THE PEOPLE BEHIND THE MUSIC</p>
                      <h1>Your artists</h1>
                      <p className="subtitle">
                        Your roster, releases, and next steps, together.
                      </p>
                    </div>
                    {createButton("artist")}
                  </div>
                  {selectedArtist ? (
                    <Panel
                      title={selectedArtist.name}
                      action={
                        <button
                          className="text-link"
                          onClick={() => go("Artists")}
                        >
                          ← All artists
                        </button>
                      }
                    >
                      <div className="live-detail-hero">
                        <Initials name={selectedArtist.name} large />
                        <div>
                          <h1>{selectedArtist.name}</h1>
                          <p>{selectedArtist.genre || "Genre not set"}</p>
                          <Tag tone={statusTone(selectedArtist.status)}>
                            {selectedArtist.status}
                          </Tag>
                        </div>
                        <div className="live-detail-actions">
                          <button
                            className="button"
                            onClick={() =>
                              edit("artist", selectedArtist.record_id)
                            }
                          >
                            <Icon name="edit" size={15} />
                            Edit artist
                          </button>
                          <button
                            className="button reject"
                            onClick={() =>
                              remove("artist", selectedArtist.record_id)
                            }
                          >
                            Archive artist
                          </button>
                        </div>
                      </div>
                      <ArtistUpdates
                        key={selectedArtist.record_id}
                        artist={selectedArtist.record_id}
                        workspace={account.workspaceId}
                      />
                      <div className="live-section-heading">
                        <h2>Releases & projects</h2>
                        <button
                          className="text-link"
                          onClick={() =>
                            edit("release", undefined, {
                              artist: selectedArtist.record_id,
                            })
                          }
                        >
                          Add release <Icon name="plus" size={15} />
                        </button>
                      </div>
                      {data.releases
                        .filter((r) => r.artist_id === artistId)
                        .map((r) => (
                          <button
                            className="roster-row"
                            key={r.id}
                            onClick={() => go("Releases", "", r.id)}
                          >
                            <span className="soft-icon">
                              <Icon name="music" />
                            </span>
                            <span>
                              <strong>{r.title}</strong>
                              <small>
                                {r.format} · {dateLabel(r.release_date)}
                              </small>
                            </span>
                            <Tag tone={statusTone(r.status)}>{r.status}</Tag>
                          </button>
                        ))}
                      {!data.releases.some((r) => r.artist_id === artistId) && (
                        <p className="live-no-records">
                          No releases for this artist yet.
                        </p>
                      )}
                      <div className="live-section-heading">
                        <h2>Tasks</h2>
                        <button
                          className="text-link"
                          onClick={() =>
                            edit("task", undefined, { artist: artistId })
                          }
                        >
                          Add task <Icon name="plus" size={15} />
                        </button>
                      </div>
                      {taskRows(
                        data.tasks.filter((t) => t.artist_id === artistId),
                      )}
                      {!data.tasks.some((t) => t.artist_id === artistId) && (
                        <p className="live-no-records">
                          No tasks for this artist yet.
                        </p>
                      )}
                    </Panel>
                  ) : data.artists.length ? (
                    <ArtistRoster data={data} today={today} user={account.userId} search={search} onSearch={setSearch} onEdit={id=>edit('artist',id)} onArchive={id=>remove('artist',id)}/>
                  ) : (
                    <Panel title="Your roster">
                      <Empty
                        icon="users"
                        title="Every great release starts with an artist."
                        description="Add your first artist to start building their world in Dopio."
                        action={createButton("artist")}
                      />
                    </Panel>
                  )}
                </>
              )}
              {view === "Releases" && <ProjectsWorkspace data={data} today={today} selectedId={releaseId} onSelect={id=>go('Releases','',id)} onNew={()=>edit('release')} onEdit={id=>edit('release',id)} onArchive={id=>remove('release',id)} onAddTask={(artist,release)=>edit('task',undefined,{artist,release})} onLinkTask={(id,artist,release)=>edit('task',id,{artist,release})} renderTasks={taskRows}/>}
              {view === "Messages" && <ArtistMessages data={data} workspace={account.workspaceId} artist={artistId} onSelect={id=>go("Messages",id)}/>}
              {view === "Owners" && <><button className="button secondary" onClick={()=>go("Today")}>← Back to Today</button><WorkspaceContacts data={data}/></>}
              {view === "Tasks" && (
                <div className="tasks-workspace">
                  <div className="page-heading"><div><p className="eyebrow">KEEP THINGS MOVING</p><h1>Your tasks</h1><p className="subtitle">Track and manage work across your artists, projects, and team.</p></div><div className="plan-actions"><button className="button secondary" onClick={()=>go('Calendar')}><Icon name="calendar" size={17}/> View calendar</button>{createButton('task')}</div></div>
                  <div className="today-stats tasks-stats">{[{key:'Overdue',label:'Overdue',icon:'alert',tone:'red'},{key:'Next 7 days',label:'Next 7 days',icon:'calendar',tone:'amber'},{key:'In progress',label:'In progress',icon:'activity',tone:'blue'},{key:'Complete',label:'Completed',icon:'check',tone:'green'}].map(card=><button key={card.key} className={`today-stat ${card.tone}`} aria-pressed={filter===card.key} onClick={()=>setFilter(card.key)}><span className="stat-icon"><Icon name={card.icon}/></span><span><strong>{data.tasks.filter(t=>taskMatches(t,card.key)).length}</strong><span>{card.label}</span></span><span aria-hidden="true">›</span></button>)}</div>
                  <div className="today-toolbar"><div className="tabs" role="group" aria-label="Filter tasks">{['All','Overdue','Next 7 days','In progress','Complete','Pending','Missing managers'].map(f=><button key={f} className={filter===f?'selected':''} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f==='All'?'All tasks':taskStatusLabel(f)} ({data.tasks.filter(t=>taskMatches(t,f)).length})</button>)}</div><input aria-label="Search tasks" placeholder="Search tasks, artists, projects, managers…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
                  <p className="today-timezone">Dates use {timeZone}. Next 7 days includes today and the following six days. Overdue and upcoming tasks appear first; each task appears once in All tasks.</p>
                  {taskGroups.map(group=>{const rows=data.tasks.filter(t=>taskMatches(t,filter)&&matches(t.title,artistName(t.artist_id),releaseName(t.release_id),...(t.manager_names??[]))&&(filter!=='All'||taskGroup(t)===group.key)).sort((a,b)=>(a.due_date??'9999').localeCompare(b.due_date??'9999'));return rows.length?<section key={group.key} className={`panel task-group ${group.tone}`}><header><h2><Icon name={group.icon} size={20}/>{filter==='All'?group.label:taskStatusLabel(filter)} <span>{rows.length}</span></h2>{filter==='All'&&<button className="text-link" onClick={()=>setFilter(group.key)}>View all →</button>}</header>{taskRows(rows)}</section>:null;})}
                  {!data.tasks.some(t=>taskMatches(t,filter)&&matches(t.title,artistName(t.artist_id),releaseName(t.release_id),...(t.manager_names??[])))&&<Panel title="Tasks"><Empty icon="check" title={data.tasks.length?'No tasks match this view.':'A clear place for your next steps.'} description="Try another filter or add your first task." action={data.tasks.length?<button className="button secondary" onClick={()=>{setFilter('All');setSearch('');}}>Show all tasks</button>:createButton('task')}/></Panel>}
                  <div className="plan-actions"><button className="button secondary" onClick={()=>go('Owners')}>Manage follow-up recipients</button><button className="button secondary" onClick={()=>go('Today')}>Review Today & email drafts</button></div>
                </div>
              )}
              {view === "Calendar" && <CalendarWorkspace data={data} today={today} onTask={id=>edit('task',id)} onProject={id=>go('Releases','',id)} onAdd={()=>setModal({entity:'task'})}/>}
              {view === "Activity" && <ActivityWorkspace data={data} user={account.userId} today={today}/>}
              {(view === "Inbox" || view === "Approvals") && (
                <EmailWorkflow
                  key={view}
                  data={data}
                  view={view}
                  onData={setData}
                  onCreateTask={() => {
                    go("Tasks");
                    edit("task");
                  }}
                />
              )}
              {view === "Dopio" && (
                <DopioPlannerWorkspace data={data} workspace={account.workspaceId} name={profileName} />
              )}
              {view === "Settings" && (
                <div className="settings-page">
                  <h1>Your workspace</h1>
                  <p className="subtitle">The details that make it yours.</p>
                  <Link href="/get-started" className="button secondary">Open workspace setup</Link>
                  <Panel title="Your profile">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setBusy(true);
                        setError("");
                        try {
                          const result = await saveProfile(name);
                          if (result.error) setError(result.error);
                          else {
                            setProfileName(name.trim());
                            setNotice("Profile saved");
                          }
                        } catch {
                          setError(
                            "Your profile couldn’t be saved. Please try again.",
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <label>
                        Your name
                        <input
                          name="name"
                          value={name}
                          maxLength={100}
                          required
                          onChange={(e) => setName(e.target.value)}
                        />
                      </label>
                      <label>
                        Email
                        <input value={account.email} readOnly />
                      </label>
                      <label>
                        Role
                        <input value={account.role} readOnly />
                      </label>
                      <button className="button primary" disabled={busy}>
                        {busy ? "Saving…" : "Save profile"}
                      </button>
                    </form>
                  </Panel>
                  <Panel title={account.workspaceName}>
                    <p>You are signed in as {account.email}.</p>
                    <details className="live-workspace-details">
                      <summary>Workspace details</summary>
                      <p>Workspace ID</p>
                      <code>{account.workspaceId}</code>
                      <button
                        className="text-link"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              account.workspaceId,
                            );
                            setNotice("Workspace ID copied");
                          } catch {
                            setError(
                              "Copy is unavailable. You can select the workspace ID above.",
                            );
                          }
                        }}
                      >
                        Copy workspace ID
                      </button>
                    </details>
                    <form action={signOut}>
                      <button className="button dark">Sign out</button>
                    </form>
                  </Panel>
                  <Panel title="Connections">
                    <div className="connection-row">
                      <Icon name="mail" />
                      <div>
                        <h3>Gmail</h3>
                        <p>Connect and import selected emails from Inbox.</p>
                      </div>
                      <button className="text-link" onClick={() => go("Inbox")}>
                        Manage Gmail →
                      </button>
                    </div>
                    <div className="connection-row">
                      <Icon name="calendar" />
                      <div>
                        <h3>Google Calendar</h3>
                        <p>
                          Preview and sync release dates and task deadlines
                          from the Calendar page.
                        </p>
                      </div>
                      <Link className="button secondary" href="/?view=Calendar">Manage Calendar</Link>
                    </div>
                  </Panel>
                  <Panel title="Explore the product demo">
                    <p>
                      Explore a separate workspace with sample data. Changes there do not affect your saved work.
                    </p>
                    <Link className="button" href="/demo">
                      Open demo <Icon name="arrow" size={15} />
                    </Link>
                  </Panel>
                </div>
              )}
            </>
          )}
        </main>
        <footer className="workspace-footer">
          <span>Dopio</span>More time for what matters.
          <span>Your workspace. Your artists.</span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!busy) {
              setModal(null);
              setError("");
            }
          }}
        >
          <section
            ref={modalRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="record-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              disabled={busy}
              onClick={() => {
                setModal(null);
                setError("");
              }}
            >
              <Icon name="close" />
            </button>
            <span className="soft-icon">
              <Icon
                name={
                  modal.entity === "artist"
                    ? "users"
                    : modal.entity === "release"
                      ? "music"
                      : "check"
                }
                size={24}
              />
            </span>
            <h1 id="record-dialog-title">
              {modal.remove ? "Archive" : modal.id ? "Edit" : "New"}{" "}
              {modal.entity}
            </h1>
            {error && (
              <p className="auth-feedback error" role="alert">
                {error}
              </p>
            )}
            {modal.remove ? (
              <>
                <p className="subtitle">
                  Archive “
                  {modal.entity === "artist"
                    ? data.artists.find((a) => a.record_id === modal.id)?.name
                    : modal.entity === "release"
                      ? data.releases.find((r) => r.id === modal.id)?.title
                      : data.tasks.find((t) => t.id === modal.id)?.title}
                  ”? It will be hidden from active work. History stays saved and you can restore it in Company controls. Archiving an artist or project also hides its linked work. Review Calendar cleanup afterward.
                </p>
                <div className="modal-actions">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="button reject"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => deleteRecord(modal.entity, modal.id!, (modal.entity==="artist"?data.artists.find(a=>a.record_id===modal.id):modal.entity==="release"?data.releases.find(r=>r.id===modal.id):data.tasks.find(t=>t.id===modal.id))?.version??0),
                        `${modal.entity} archived`,
                        true,
                      )
                    }
                  >
                    {busy ? "Archiving…" : "Archive " + modal.entity}
                  </button>
                </div>
              </>
            ) : (
              <RecordForm
                key={modal.entity + modal.id}
                entity={modal.entity}
                id={modal.id}
                data={data}
                busy={busy}
                defaultArtist={modal.artist}
                defaultRelease={modal.release}
                onSave={(form) =>
                  void run(
                    () => saveRecord(modal.entity, modal.id ?? null, form),
                    `${modal.entity} ${modal.id ? "updated" : "created"}`,
                    true,
                  )
                }
                onCancel={() => {
                  setModal(null);
                  setError("");
                }}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
