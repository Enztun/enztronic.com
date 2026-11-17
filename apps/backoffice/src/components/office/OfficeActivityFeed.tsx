"use client";

import { ArrowRight, ChevronDown, History, Info } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { OfficeEvent, OfficeTask } from "@/lib/office-contracts";

import { OfficeAgentBadge } from "./OfficeAgentBadge";
import { activitySummary, activityTaskHref, groupOfficeActivity, type OfficeActivityGroup } from "./office-activity-groups";
import { EmptyState, EventList, Time } from "./office-ui";
import { OFFICE_PROFILES } from "./profiles";
import styles from "./office-activity-feed.module.css";

const INITIAL_GROUPS = 6;
const EVENT_PAGE = 8;

function ActivityHistory({ group, onTask }: { group: OfficeActivityGroup; onTask: (id: string) => void }) {
  const [eventLimit, setEventLimit] = useState(EVENT_PAGE);
  const agentIds = [...new Set(group.events.filter((event) => event.actorType === "agent" && event.runId && OFFICE_PROFILES.some((profile) => profile.id === event.actorId)).map((event) => event.actorId))];
  const ownerRecorded = group.events.some((event) => event.actorType === "agent" && !event.runId && event.source === "authenticated_owner_action");
  const hasOwner = ownerRecorded || group.events.some((event) => event.actorType === "owner");
  const hasRecordedUpdate = group.events.some((event) => event.actorType === "agent" && ((!event.runId && event.source !== "authenticated_owner_action") || (event.runId && !OFFICE_PROFILES.some((profile) => profile.id === event.actorId))));
  const hasScheduler = group.events.some((event) => event.actorId === "scheduler");
  const hasController = group.events.some((event) => event.actorType !== "owner" && event.actorType !== "agent" && event.actorId !== "scheduler");
  const visibleEvents = group.events.slice(0, eventLimit);
  const taskHref = activityTaskHref(group);

  return <li className={styles.history} data-activity-group={group.kind}>
    <article>
      <div className={styles.cardHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{group.kind === "workspace" ? "Workspace activity" : group.familyIncomplete ? "Task history" : "Task & related work"}</span>
          <h3>{group.title}</h3>
        </div>
        <span className={styles.eventCount}>{group.events.length} {group.events.length === 1 ? "event" : "events"}</span>
      </div>
      <p className={styles.summary}>{activitySummary(group.latestEvent)}</p>
      <div className={styles.cardMeta}>
        <span>Latest recorded · <Time value={group.latestEvent.occurredAt} /></span>
        <span className={styles.mode}>{group.simulated ? "Simulated records" : "Internal records"}</span>
      </div>
      <div className={styles.participants} aria-label="Recorded participants">
        {agentIds.map((id) => <OfficeAgentBadge key={id} agentId={id} compact showRole />)}
        {hasOwner ? <span className={styles.actor}>Owner{ownerRecorded ? " / owner-recorded" : ""}</span> : null}
        {hasRecordedUpdate ? <span className={styles.actor}>Recorded update</span> : null}
        {hasScheduler ? <span className={styles.actor}>Scheduler</span> : null}
        {hasController ? <span className={styles.actor}>Workflow controller</span> : null}
      </div>
      <ul className={styles.milestones} aria-label="Recorded milestones, not current task states">
        {group.milestones.map((milestone) => <li key={milestone.kind} data-kind={milestone.kind}><strong>{milestone.count}</strong> {milestone.label}</li>)}
      </ul>
      <div className={styles.cardActions}>
        {group.taskId && group.task ? <button type="button" className={styles.taskButton} onClick={() => onTask(group.taskId!)}>Open task <ArrowRight size={13} aria-hidden="true" /></button> : taskHref ? <Link href={taskHref} className={styles.taskButton}>Open task <ArrowRight size={13} aria-hidden="true" /></Link> : null}
        {group.familyIncomplete ? <span className={styles.scopeNote}>Related package information is outside the loaded task list.</span> : null}
      </div>
      <details className={styles.timeline}>
        <summary><ChevronDown size={14} aria-hidden="true" /> View timeline <span>{group.events.length} recorded {group.events.length === 1 ? "event" : "events"}</span></summary>
        <div className={styles.timelineBody}>
          <p className={styles.timelineHint}>Newest first. Counts include repeated attempts and past issues. Expand an event’s details for its technical record.</p>
          <EventList events={visibleEvents} onTask={group.task ? onTask : undefined} />
          {eventLimit < group.events.length ? <button type="button" className={styles.moreButton} onClick={() => setEventLimit((limit) => limit + EVENT_PAGE)}>Show {Math.min(EVENT_PAGE, group.events.length - eventLimit)} earlier events <span>({group.events.length - eventLimit} remaining)</span></button> : null}
          <p className={styles.timelineCount}>{visibleEvents.length} of {group.events.length} events shown in this history</p>
        </div>
      </details>
    </article>
  </li>;
}

export function OfficeActivityFeed({ events, tasks, onTask, loadedLimit }: { events: OfficeEvent[]; tasks: OfficeTask[]; onTask: (id: string) => void; loadedLimit?: number }) {
  const groups = useMemo(() => groupOfficeActivity(events, tasks), [events, tasks]);
  const [groupLimit, setGroupLimit] = useState(INITIAL_GROUPS);
  const visibleGroups = groups.slice(0, groupLimit);
  return <section className={styles.feed} aria-labelledby="office-activity-title">
    <div className={styles.feedHeader}>
      <div>
        <h2 id="office-activity-title"><History size={17} aria-hidden="true" /> Activity</h2>
        <p>{events.length} recorded {events.length === 1 ? "event" : "events"} in this view · {groups.length} {groups.length === 1 ? "history" : "histories"}</p>
      </div>
      <details className={styles.info}>
        <summary><Info size={14} aria-hidden="true" /> About this history</summary>
        <p>Related tasks are grouped into one readable history. All loaded events matching your filters remain available in the timelines.{loadedLimit ? ` The application loads up to ${loadedLimit} recent events per snapshot; this is not the complete history.` : " This is a loaded window, not the complete history."} Milestones describe recorded actions, not current execution. Times use Asia/Jakarta.</p>
      </details>
    </div>
    {events.length ? <>
      <ol className={styles.histories} aria-label="Task and workspace histories">{visibleGroups.map((group) => <ActivityHistory key={group.key} group={group} onTask={onTask} />)}</ol>
      <div className={styles.feedFooter}>
        <span>{visibleGroups.length} of {groups.length} histories shown</span>
        {groupLimit < groups.length ? <button type="button" className={styles.moreButton} onClick={() => setGroupLimit((limit) => limit + INITIAL_GROUPS)}>Show {Math.min(INITIAL_GROUPS, groups.length - groupLimit)} more histories</button> : null}
      </div>
    </> : <EmptyState title="No activity in this view">Recorded actions matching your filters will appear here.</EmptyState>}
  </section>;
}
