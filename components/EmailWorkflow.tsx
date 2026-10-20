"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {releaseEmailReview} from '@/lib/ai/release-email';
import CoordinationApprovals from "./CoordinationApprovals";
import ApprovalsWorkspace from "./ApprovalsWorkspace";
import ReleaseEmailApprovals from "./ReleaseEmailApprovals";
import EmailProposalHistory from "./EmailProposalHistory";
import EmailTargetReview from "./EmailTargetReview";
import Icon from "./DopioIcon";
import GmailConnection from "./GmailConnection";
import {DEFAULT_TIME_ZONE} from "@/lib/workspace/rules";
import Link from "next/link";
import {
  importSampleEmail,
  importPastedEmail,
  decideProposal,
  analyzeGmailImport,
} from "@/app/workspace/email-actions";
import type { WorkspaceData, MutationResult } from "@/lib/workspace/types";
import type {
  DeadlineProposal,
  InboxMessage,
} from "@/lib/workspace/email-types";
function date(value: string | null) {
  return value
    ? new Date(value + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "No deadline set";
}
function tone(status: string) {
  return status === "approved"
    ? "green"
    : status === "conflict"
      ? "red"
      : status === "pending"
        ? "amber"
        : "slate";
}
export default function EmailWorkflow({
  data,
  view,
  onData,
  onCreateTask,
}: {
  data: WorkspaceData;
  view: "Inbox" | "Approvals";
  onData: (data: WorkspaceData) => void;
  onCreateTask: () => void;
}) {
  const guard = useRef(false);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("All");
  const [mailFilter,setMailFilter]=useState('All');
  const [mailSearch,setMailSearch]=useState('');
  const [artistFilter,setArtistFilter]=useState('');
  const [page,setPage]=useState(0);

  useEffect(()=>{const selectHash=()=>{const email=window.location.hash.match(/^#message-([0-9a-f-]{36})$/i);if(view==='Inbox'&&email){setSelected(email[1]);setMailFilter('All');setArtistFilter('');setMailSearch('');setPage(Math.max(0,Math.floor(data.email.messages.filter(m=>m.source!=='team').findIndex(m=>m.id===email[1])/25)));}const match=window.location.hash.match(/^#proposal-([0-9a-f-]{36})$/i);if(view==='Approvals'&&match){setSelected(match[1]);setFilter('All');}};selectHash();window.addEventListener('hashchange',selectHash);return()=>window.removeEventListener('hashchange',selectHash);},[view,data.email.messages]);
  const [mode, setMode] = useState<"sample" | "paste">("sample");
  const [showImport, setShowImport] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [newDate, setNewDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { messages, proposals, available } = data.email;
  const tasks = data.tasks.filter(
    (t) => t.artist_id && t.status !== "Complete",
  );
  const selectedTask = tasks.find((t) => t.id === taskId);
  const filteredProposals = proposals.filter(
    (p) => filter === "All" || p.status === filter.toLowerCase(),
  );
  function linkedArtistIds(m:InboxMessage){
    const ids=new Set<string>();
    for(const p of proposals.filter(p=>p.message_id===m.id)){
      const task=data.tasks.find(t=>t.id===p.task_id);
      const aid=task?.artist_id??data.releases.find(r=>r.id===task?.release_id)?.artist_id;
      if(aid)ids.add(aid);
    }
    for(const p of (data.email.releaseProposals??[]).filter(p=>p.message_id===m.id)){
      const aid=data.releases.find(r=>r.id===p.release_id)?.artist_id;if(aid)ids.add(aid);
    }
    return ids;
  }
  const mailMessages=messages.filter(m=>m.source!=='team');
  const filteredMessages=mailMessages.filter(m=>
    (!artistFilter||linkedArtistIds(m).has(artistFilter))&&
    (mailFilter==='All'||(mailFilter==='Needs attention'&&m.analysis_status==='needs_context')||
    (mailFilter==='Deadlines'&&proposals.some(p=>p.message_id===m.id))||
    (mailFilter==='Releases'&&(data.email.releaseProposals??[]).some(p=>p.message_id===m.id)))&&
    [m.subject,m.sender,m.body,...data.artists.filter(a=>linkedArtistIds(m).has(a.record_id)).map(a=>a.name)].join(' ').toLowerCase().includes(mailSearch.toLowerCase()));
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filteredMessages.length/25)-1));
  const pageMessages=filteredMessages.slice(currentPage*25,(currentPage+1)*25);
  const message = view==='Inbox' ? (pageMessages.find(m=>m.id===selected)??pageMessages[0]) : messages.find(m=>m.id===(filteredProposals.find(p=>p.id===selected)??filteredProposals[0])?.message_id);
  const proposal = view==='Approvals' ? (filteredProposals.find(p=>p.id===selected)??filteredProposals[0]) : proposals.find(p=>p.message_id===message?.id);
  async function run(
    action: () => Promise<MutationResult>,
    label: string,
    importing = false,
  ) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (result.error !== null) {
        setError(result.error);
        return;
      }
      onData(result.data);
      setNotice(label);
      if (importing) {
        setShowImport(false);
        setSelected("");
      }
    } catch {
      setError("We couldn’t reach your workspace. Please try again.");
    } finally {
      setBusy(false);
      guard.current = false;
    }
  }
  function submitSample(e: FormEvent) {
    e.preventDefault();
    void run(
      () => importSampleEmail(taskId, newDate),
      "Sample imported. Review its analysis below. Identical imports are kept only once.",
      true,
    );
  }
  function submitPaste(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void run(
      () => importPastedEmail(form),
      "Email imported. Review its analysis below.",
      true,
    );
  }
  function source(m: InboxMessage) {
    return (
      <>
        <div className="email-source-heading">
          <span className="badge slate">
            {m.source === "team" ? "Team message" : m.source === "sample"
              ? "Sample email"
              : m.source === "ai"
                ? "Pasted email"
                : m.source === "gmail"
                  ? "Gmail import"
                  : "Pasted email"}
          </span>
          <small>
            {new Date(m.created_at).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: data.timeZone??DEFAULT_TIME_ZONE,
            })}{" "}
            {data.timeZone??DEFAULT_TIME_ZONE}
          </small>
        </div>
        <h2>{m.subject}</h2>
        <p className="email-source-sender">From: {m.sender}</p>
        <div className="email-original">{m.body}</div>
      </>
    );
  }
  function review(p: DeadlineProposal) {
    const message = messages.find(m=>m.id===p.message_id);
    const task = data.tasks.find((t) => t.id === p.task_id);
    const release=data.releases.find(r=>r.id===task?.release_id);
    const dateConflict=!!release&&['Single','EP','Album'].includes(release.format)&&!!release.release_date&&p.proposed_due_date>release.release_date;
    return (
      <section id={`proposal-${p.id}`} className="panel email-review">
        <div className="panel-heading">
          <h2>Proposed deadline change</h2>
          <span className={`badge ${tone(p.status)}`}>{p.status}</span>
        </div>
        <p className="eyebrow">
          {p.artist_name}
          {p.release_title ? ` / ${p.release_title}` : ""}
        </p>
        <h2>{p.task_title}</h2>
        <h3>Summary</h3>
        <p>Change the deadline for {p.task_title} from {date(p.previous_due_date)} to {date(p.proposed_due_date)}.</p>
        <EmailProposalHistory data={data} id={p.id}/>
        <div className="email-date-change">
          <div>
            <small>Deadline when analyzed</small>
            <strong>{date(p.previous_due_date)}</strong>
          </div>
          <Icon name="arrow" size={21} />
          <div>
            <small>Proposed deadline</small>
            <strong>{date(p.proposed_due_date)}</strong>
          </div>
        </div>
        <div className="info-box">
          <strong>Evidence from the source message</strong>
          <blockquote>{p.evidence}</blockquote>
          <p>
            {(message?.source === "ai" || message?.source === "gmail" || message?.source === "team")
              ? "Check the selected saved task, date, and source quote before approving."
              : "The labeled artist and task matched one saved task using rule-based analysis."}
          </p>
        </div>
        {p.status === "pending" ? (
          <>
            <p className="email-review-note">
              Only this task’s due date will change. Artist and release dates
              stay unchanged. No email will be sent.
            </p>
            {(!task ||
              task.due_date !== p.previous_due_date ||
              task.version !== p.expected_version ||
              task.status === "Complete") && (
              <p className="auth-feedback error">
                The task has changed or is no longer available. Approval will be
                blocked until you create a fresh proposal.
              </p>
            )}
            {dateConflict&&<p className="auth-feedback error">The proposed deadline is after the release date ({release?.release_date}). Approval will record a conflict without changing dates.</p>}
            <div className="approval-buttons">
              <button
                className="button approve"
                disabled={busy}
                onClick={() =>
                  // eslint-disable-next-line react-hooks/refs -- This callback runs on click, not when the proposal card is rendered.
                  void run(
                    () => decideProposal(p.id, true),
                    "Review decision recorded. Check the proposal status below.",
                  )
                }
              >
                <Icon name="check" size={17} />
                {busy ? "Saving…" : "Approve update"}
              </button>
              <button
                className="button reject"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => decideProposal(p.id, false),
                    "Review decision recorded.",
                  )
                }
              >
                <Icon name="close" size={17} />
                Reject
              </button>
            </div>
          </>
        ) : (
          <div
            className={`auth-feedback ${p.status === "conflict" ? "error" : ""}`}
            role="status"
          >
            <strong>
              {p.status === "approved"
                ? "Deadline updated"
                : p.status === "rejected"
                  ? "Proposal rejected"
                  : "Update blocked"}
            </strong>
            <p>{p.decision_note}</p>
            {p.status === "approved" && <div className="plan-actions"><Link className="button secondary" href="/?view=Calendar">Review calendar sync</Link><Link className="button secondary" href="/?view=Today">Review team follow-up</Link></div>}
            {p.decided_at && (
              <small>
                Reviewed{" "}
                {new Date(p.decided_at).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "UTC",
                })}{" "}
                UTC
              </small>
            )}
          </div>
        )}
      </section>
    );
  }
  return (
    <div className={view==='Inbox'?'inbox-page':'approvals-page'}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{view==='Approvals'?'DECISIONS KEEP THINGS MOVING':'CONVERSATIONS INTO NEXT STEPS'}</p>
          <h1>{view}</h1>
          <p className="subtitle">
            {view === "Inbox"
              ? "Your imported emails, organized by artist and next step."
              : "Review suggested date changes from emails and your team. Keep the final say."}
          </p>
        </div>
        <button
          className="button primary"
          disabled={!available || busy}
          onClick={() => setShowImport(!showImport)}
        >
          <Icon name="plus" size={17} />
          {showImport ? "Close import" : "Import email"}
        </button>
      </div>
      {view==='Inbox'&&<div className="email-mode-note">
        <Icon name="shield" size={17} />
        <span>
          Pasted emails can be analyzed with AI after setup. Gmail imports are saved without automatic analysis. Choose Analyze email to use AI. Tasks change only after
          approval.
        </span>
      </div>
      }
      {error && (
        <p className="auth-feedback error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="email-notice" role="status">
          {notice}
        </p>
      )}

      {!available ? (
        <section className="panel">
          <div className="empty-state">
            <Icon name="mail" size={36} />
            <h2>Your email workflow is ready for setup.</h2>
            <p>
              The email-workflow database migration needs to be applied before
              you can import and review emails. Your artists, releases, and
              tasks still work.
            </p>
          </div>
        </section>
      ) : (
        <>
          {showImport && (
            <section className="panel email-import">
              <div className="panel-heading">
                <h2>Bring in an email</h2>
                <span className="badge slate">No messages are sent</span>
              </div>
              <div className="tabs">
                {(["sample", "paste"] as const).map((m) => (
                  <button
                    key={m}
                    disabled={busy}
                    className={mode === m ? "selected" : ""}
                    onClick={() => setMode(m)}
                  >
                    {m === "sample" ? "Generate sample" : "Paste an email"}
                  </button>
                ))}
              </div>
              {mode === "sample" ? (
                tasks.length ? (
                  <form className="record-form" onSubmit={submitSample}>
                    <fieldset disabled={busy}>
                      <label>
                        Task to reference
                        <select
                          required
                          value={taskId}
                          onChange={(e) => setTaskId(e.target.value)}
                        >
                          <option value="">Choose an artist task</option>
                          {tasks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {
                                data.artists.find(
                                  (a) => a.record_id === t.artist_id,
                                )?.name
                              }{" "}
                              — {t.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedTask && (
                        <p className="subtitle">
                          Current deadline: {date(selectedTask.due_date)}. This
                          task will stay unchanged until you approve.
                        </p>
                      )}
                      <label>
                        New deadline mentioned in the sample
                        <input
                          type="date"
                          required
                          min="1900-01-01"
                          max="2199-12-31"
                          value={newDate}
                          onChange={(e) => setNewDate(e.target.value)}
                        />
                      </label>
                      <button className="button primary" type="submit">
                        {busy ? "Importing…" : "Import sample email"}
                        <Icon name="arrow" size={15} />
                      </button>
                    </fieldset>
                  </form>
                ) : (
                  <div className="empty-state">
                    <h2>Add an artist task first.</h2>
                    <p>
                      Create an open task, link it to Maya or another artist,
                      then come back to generate a deadline-change email.
                    </p>
                    <button className="button primary" onClick={onCreateTask}>
                      Create a task <Icon name="plus" size={15} />
                    </button>
                  </div>
                )
              ) : (
                <form className="record-form" onSubmit={submitPaste}>
                  <fieldset disabled={busy}>
                    <p className="subtitle">
                      AI reads natural email text and suggests one deadline
                      change. Include a clear date with a year. Unclear matches
                      need more context.
                    </p>
                    <pre className="email-template">
                      {
                        "Hi Jane, Maya’s final artwork for Midnight is delayed. Please move the final artwork deadline to October 15, 2026. Thanks, Alex."
                      }
                    </pre>
                    <p className="subtitle">
                      Analyzing sends this email and up to 100 open artist tasks
                      to OpenAI. Review the proposed change before approving.
                    </p>
                    <label>
                      Sender
                      <input
                        name="sender"
                        required
                        maxLength={254}
                        placeholder="Alex Rivera"
                      />
                    </label>
                    <label>
                      Subject
                      <input
                        name="subject"
                        required
                        maxLength={200}
                        placeholder="Updated artwork deadline"
                      />
                    </label>
                    <label>
                      Email body
                      <textarea
                        name="body"
                        required
                        maxLength={20000}
                        rows={9}
                        placeholder="Paste the original email text…"
                      />
                    </label>
                    <button className="button primary">
                      {busy ? "Importing…" : "Import and analyze"}
                      <Icon name="arrow" size={15} />
                    </button>
                  </fieldset>
                </form>
              )}
            </section>
          )}
          {view === "Approvals" && <><CoordinationApprovals/><ApprovalsWorkspace data={data} onData={onData} renderTask={review}/></>}
          {view === "Inbox" && <>
          {(view === "Inbox" || filteredProposals.length) ? (
            <div className={view==='Inbox'?'email-workflow-grid inbox-workbench':'email-workflow-grid'}>
              {view==='Inbox'&&<aside className="panel inbox-mailbox">
                <GmailConnection onData={onData} compact/>
                <nav aria-label="Mailbox"><button className={!artistFilter&&mailFilter==='All'?'selected':''} onClick={()=>{setArtistFilter('');setMailFilter('All');setPage(0);}}> <Icon name="mail" size={18}/> Imported inbox <span>{mailMessages.length}</span></button><Link href="/?view=Today">Follow-ups & email drafts →</Link></nav>
                <h3>ARTISTS</h3><button className={!artistFilter?'selected':''} onClick={()=>{setArtistFilter('');setPage(0);}}>All artists</button>
                {data.artists.map(a=><button key={a.record_id} className={artistFilter===a.record_id?'selected':''} onClick={()=>{setArtistFilter(a.record_id);setPage(0);}}><span className="inbox-avatar">{a.name.slice(0,1)}</span>{a.name}<small>{mailMessages.filter(m=>linkedArtistIds(m).has(a.record_id)).length}</small></button>)}
                <p className="inbox-sidebar-note">Artist filters use saved task and release proposals. Unmatched emails stay in All artists.</p>
              </aside>}

              <section className="panel email-workflow-list">
                {view==='Inbox'&&<div className="inbox-list-tools"><input aria-label="Search imported emails" placeholder="Search emails or artists…" value={mailSearch} onChange={e=>{setMailSearch(e.target.value);setPage(0);}}/><div className="tabs">{['All','Deadlines','Releases','Needs attention'].map(f=><button key={f} className={mailFilter===f?'selected':''} aria-pressed={mailFilter===f} onClick={()=>{setMailFilter(f);setPage(0);}}>{f}</button>)}</div><div className="inbox-pagination"><span>{filteredMessages.length?currentPage*25+1:0}–{Math.min((currentPage+1)*25,filteredMessages.length)} of {filteredMessages.length}</span><button aria-label="Previous emails" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>‹</button><button aria-label="Next emails" disabled={(currentPage+1)*25>=filteredMessages.length} onClick={()=>setPage(currentPage+1)}>›</button></div></div>}

                <div className="panel-heading">
                  <h2>
                    {view === "Inbox"
                      ? "Imported emails"
                      : "Deadline proposals"}
                  </h2>
                  <small>
                    {view === "Inbox"
                      ? messages.length
                      : filteredProposals.length}
                  </small>
                </div>
                {view === "Inbox"
                  ? pageMessages.map((m) => (
                      <button
                        className={`workflow-list-item ${message?.id === m.id ? "selected" : ""}`}
                        key={m.id}
                        onClick={() => {
                          setSelected(m.id);
                            setError("");
                          setNotice("");
                        }}
                      >
                        <span className="soft-icon">
                          <Icon name="mail" size={18} />
                        </span>
                        <span>
                          <small className="inbox-list-sender">{m.sender}</small><strong>{m.subject}</strong>
                          <small className="inbox-snippet">{m.body.slice(0,120)}</small>
                          <span
                            className={`badge ${m.analysis_status === "proposal" ? "amber" : "slate"}`}
                          >
                            {m.analysis_status === "proposal"
                              ? "Analyzed"
                              : m.analysis_status === "needs_context"
                                ? "Needs context"
                                : "No change"}
                          </span>
                        </span>
                      </button>
                    ))
                  : filteredProposals.map((p) => (
                      <button
                        className={`workflow-list-item ${proposal?.id === p.id ? "selected" : ""}`}
                        key={p.id}
                        onClick={() => {
                          setSelected(p.id);
                          setNotice("");
                        }}
                      >
                        <span className="soft-icon">
                          <Icon name="calendar" size={18} />
                        </span>
                        <span>
                          <strong>{p.task_title}</strong>
                          <small>
                            {p.artist_name} · {date(p.proposed_due_date)}
                          </small>
                          <span className={`badge ${tone(p.status)}`}>
                            {p.status}
                          </span>
                        </span>
                      </button>
                    ))}
              </section>
              <div className="email-workflow-detail">
                {view==='Inbox'&&!message&&<div className="empty-state"><Icon name="mail" size={36}/><h2>{mailMessages.length?"No matching emails":"Your inbox starts here"}</h2><p>{mailMessages.length?"Try another filter or search.":"Connect Gmail to import selected emails, or use Import email to paste a message."}</p></div>}
                {view==='Inbox'&&message&&<div className="inbox-detail-toolbar"><span>Message details</span><button className="button secondary" onClick={onCreateTask}><Icon name="plus" size={15}/> Create task</button><Link className="text-link" href="/?view=Approvals">Approvals →</Link></div>}

                {message && (
                  <section className="panel email-source">
                    {source(message)}
                    <div className="info-box">
                      <h3><Icon name="sparkle" size={17}/> Analysis & next steps</h3>
                      <p>{message.analysis_note}</p>
                      {message.analysis_note.includes('Release review:')&&releaseEmailReview(message.body,data.releases.map(r=>({id:r.id,title:r.title,release_date:r.release_date,artist:data.artists.find(a=>a.record_id===r.artist_id)?.name??''})),tasks)&&<Link className="button primary" href={`/?view=Dopio&emailReview=${encodeURIComponent(message.id)}`}>Review release date change</Link>}
                      {!proposals.some(p => p.message_id === message.id) && !(data.email.releaseProposals??[]).some(p=>p.message_id===message.id) && <div className="plan-actions">
                        <p>Explicit release-date requests are matched to your accessible records first. Other analysis sends this email and up to 100 open artist tasks to OpenAI and uses API credits. All changes require review. Include the full date and year.</p>
                        <button className="button primary" disabled={busy} onClick={() => void run(() => analyzeGmailImport(message.id), "Analysis saved. Review the result and any proposed change below.")}>{busy ? "Analyzing…" : "Analyze email with AI"}</button>
                        {error&&<p className="auth-feedback error" role="alert">{error}</p>}
                        {notice&&<p className="email-notice" role="status">{notice}</p>}
                        <EmailTargetReview key={message.id} data={data} message={message} onData={onData}/>
                      </div>}
                    </div>
                  </section>
                )}
                {view === "Inbox" && message && <ReleaseEmailApprovals data={data} messageId={message?.id} onData={onData}/>}
                {view === "Inbox" && proposal && review(proposal)}
              </div>
            </div>
          ) : (
            <section className="panel">
              <div className="empty-state">
                <Icon name="shield" size={36} />
                <h2>
                  {data.email.releaseProposals?.length ? "No task deadline proposals." : "No proposals in this view."}
                </h2>
                <p>
                  Import an email with a matching task and a different deadline to create a proposal.
                </p>
                <button
                  className="button primary"
                  onClick={() => setShowImport(true)}
                >
                  Import an email <Icon name="arrow" size={15} />
                </button>
              </div>
            </section>
          )}
          </>}
        </>
      )}
    </div>
  );
}
