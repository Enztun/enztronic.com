"use client";

import { ArrowUpRight, FilePlus2, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SNAPSHOT_STALE_AFTER_MS, type OfficeRoleActivity } from "@/lib/office-activity";
import type { OfficeEvent, OfficeMode, OfficeTask } from "@/lib/office-contracts";

import { EventList, OfficeButton, Portrait, Time } from "./office-ui";
import type { RoleStatus, WorkerIndicator } from "./office-status";
import { profileStatusDisplay } from "./office-profile-status";
import { stateLabel, type OfficeProfile } from "./profiles";
import { roleIdentityStyle } from "./role-identity";
import styles from "./office-profile.module.css";

type ProfilePanelProps = {
  profile: OfficeProfile;
  status: RoleStatus;
  roleEvidence?: OfficeRoleActivity;
  evidenceGeneratedAt?: string | null;
  /** Monotonic time when the status request was sent, as used throughout Office. */
  observedAt: number;
  assignedTasks: OfficeTask[];
  events: OfficeEvent[];
  mode: OfficeMode;
  worker: WorkerIndicator;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onTask: (id: string) => void;
  onStatus: () => void;
  onNew: () => void;
};

/** Only this leaf updates each second; the scene and task editors are not re-rendered by its clock. */
function ProfileStatusLine({ status, roleEvidence, evidenceGeneratedAt, observedAt }: Pick<ProfilePanelProps, "status" | "roleEvidence" | "evidenceGeneratedAt" | "observedAt">) {
  const [monoNow, setMonoNow] = useState<number | null>(null);
  const age = monoNow === null ? 0 : Math.max(0, monoNow - observedAt);
  const run = roleEvidence?.leasedRuns.find((entry) => entry.id === status.runId) ?? (roleEvidence?.activeRun?.id === status.runId ? roleEvidence.activeRun : undefined);
  const display = profileStatusDisplay(status, run, evidenceGeneratedAt, age);

  useEffect(() => {
    if (!display.ticking) return;
    const update = () => setMonoNow(performance.now());
    const remaining = (run?.leaseRemainingMs ?? 0) - age;
    // The first client render re-ages immediately. Afterwards stop at the lease/staleness boundary,
    // even between second ticks; delayed responses and returning from a hidden tab count too.
    const wait = monoNow === null ? 0 : Math.max(1, Math.min(1000, remaining, SNAPSHOT_STALE_AFTER_MS - age));
    const timer = setTimeout(update, wait);
    const visible = () => { if (!document.hidden) update(); };
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); window.removeEventListener("pageshow", update); document.removeEventListener("visibilitychange", visible); };
  }, [display.ticking, run?.leaseRemainingMs, age, monoNow]);

  return <div className={styles.status} data-tone={display.tone} data-indicator={display.indicator} title={status.detail}>
    <span className={styles.dot} aria-hidden="true" />
    <span>{display.label}</span>
    {display.elapsed ? <span className={styles.elapsed} aria-label={`Elapsed work time ${display.elapsed}`}>{display.elapsed}</span> : null}
  </div>;
}

export function OfficeProfilePanel({ profile, status, roleEvidence, evidenceGeneratedAt, observedAt, assignedTasks, events, mode, worker, open, onOpen, onClose, onTask, onStatus, onNew }: ProfilePanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);
  const closeProfile = () => { dialog.current?.close(); onClose(); };
  const recent = events.filter((event) => event.actorId === profile.id).slice(0, 3);
  const goToTask = (id: string) => { closeProfile(); onTask(id); };

  return <>
    <aside className={styles.card} style={roleIdentityStyle(profile.id)} aria-label={`${profile.name} profile`}>
      <div className={styles.hero}>
        <Portrait key={profile.id} id={profile.id} />
        <div><h2>{profile.name}</h2><p>{profile.role}</p></div>
      </div>
      <ProfileStatusLine key={`${profile.id}-${mode}-${observedAt}`} status={status} roleEvidence={roleEvidence} evidenceGeneratedAt={evidenceGeneratedAt} observedAt={observedAt} />
      {status.activeTaskId ? <button className={styles.current} type="button" onClick={() => onTask(status.activeTaskId!)}>Open current task <ArrowUpRight size={14} aria-hidden="true" /></button> : null}
      <div className={styles.tasks}>
        <div className={styles.sectionHeading}><h3>Open tasks</h3><span>{assignedTasks.length}</span></div>
        {assignedTasks.length ? assignedTasks.slice(0, 2).map((task) => <button key={task.id} type="button" className={styles.task} onClick={() => onTask(task.id)}><span>{task.goal}</span><small>{stateLabel(task.state)}</small></button>) : <p className={styles.empty}>No open tasks. Ready for the next brief.</p>}
        {assignedTasks.length > 2 ? <button className={styles.textButton} type="button" onClick={onOpen}>View all {assignedTasks.length} tasks</button> : null}
      </div>
      <div className={styles.actions}>
        <OfficeButton onClick={onOpen} aria-haspopup="dialog"><UserRound size={14} aria-hidden="true" />Profile</OfficeButton>
        <OfficeButton onClick={onNew} primary><FilePlus2 size={14} aria-hidden="true" />New brief</OfficeButton>
      </div>
    </aside>

    <dialog ref={dialog} className={styles.dialog} style={roleIdentityStyle(profile.id)} aria-labelledby={`office-profile-${profile.id}`} onClose={onClose} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) closeProfile(); }}>
        <header className={styles.dialogHeader}>
          <div className={styles.hero}><Portrait key={profile.id} id={profile.id} /><div><h2 id={`office-profile-${profile.id}`}>{profile.name}</h2><p>{profile.role}</p></div></div>
          <button type="button" onClick={closeProfile} className={styles.close} aria-label="Close profile"><X size={18} aria-hidden="true" /></button>
        </header>
      <div className={styles.dialogBody}>
        <p className={styles.tagline}>{profile.line}</p>
        <section className={styles.section}><h3>Responsibility</h3><p>{profile.responsibility}</p></section>
        <section className={styles.section}><h3>Working rule</h3><p>{profile.rule}</p></section>
        <section className={styles.section}><h3>Communication &amp; handoff</h3><p>{profile.personality}</p><p>{profile.communication}</p><p>{profile.handoff}</p></section>
        <section className={styles.section}>
          <h3>Work status</h3>
          <ProfileStatusLine key={`${profile.id}-${mode}-${observedAt}`} status={status} roleEvidence={roleEvidence} evidenceGeneratedAt={evidenceGeneratedAt} observedAt={observedAt} />
          <p>{status.detail}</p>
          <p>{worker.label}. {worker.detail}</p>
          <p>{mode === "demo" ? "Tasks in this workspace use simulated outputs; no AI model is called here." : "Live drafts and reviews need a connected provider, the live switch and spending limits. External actions remain unavailable."}</p>
          {roleEvidence?.latestRun ? <p>Latest recorded step: {stateLabel(roleEvidence.latestRun.step)} · {stateLabel(roleEvidence.latestRun.state)} · <Time value={roleEvidence.latestRun.finishedAt ?? roleEvidence.latestRun.startedAt} /></p> : null}
          <button type="button" className={styles.textButton} onClick={() => { closeProfile(); onStatus(); }}>View detailed role evidence <ArrowUpRight size={13} aria-hidden="true" /></button>
        </section>
        {assignedTasks.length ? <section className={styles.section}><h3>Open tasks · {assignedTasks.length}</h3>{assignedTasks.map((task) => <button key={task.id} type="button" className={styles.task} onClick={() => goToTask(task.id)}><span>{task.goal}</span><small>{stateLabel(task.state)}</small></button>)}</section> : null}
        <section className={styles.section}><h3>Recent actions</h3><EventList compact events={recent} onTask={goToTask} /></section>
      </div>
    </dialog>
  </>;
}
