# Enztronic AI Office — Product, Workflow, and Response Handoff

Status: planning and configuration handoff. No application implementation, connected execution, external communication, financial transaction, or deployment is authorized by this document.

The companion `response-presets.json` contains declarative configuration and explicitly simulated example events. It is not an application, automation, executable workflow, or proof that an integration exists.

## 1. Product purpose and scope

Create a professional office view for Enztronic's seven fictional AI team members. The office helps the owner understand responsibility, active work, handoffs, evidence, and decisions. A conventional task board and inspectable task records remain available for efficient work.

Gamification is outside scope: no experience points, scores, coins, achievements, fictional productivity metrics, or reward mechanics. Decorative animation must never imply that work happened. Movement, bubbles, and status indicators reflect recorded events or an unmistakably labelled demonstration.

The visual prototype and a live workflow are separate deliverables:

| Mode | What it demonstrates | What it may claim |
| --- | --- | --- |
| Visual prototype | Office layout, portraits, labels, camera, panels, example interactions | An example of the intended experience; every example task and event is simulated |
| Connected internal workflow | Authorized agents operating on selected internal records and producing draft artifacts | Only actions and results confirmed by execution records and evidence |
| External or production operation | Client communication, published content, payments, filing, deployment, production changes | Requires separately configured integrations, role permissions, and appropriate owner authorization |

This handoff specifies the first two modes; live execution is disabled in the supplied configuration. Credentials, account connections, running agents, and persistent storage have not been assumed or verified. The integration handoff's routing contract is to retain the existing protected `/team` URL while labelling navigation and the page Office. Any `/office` URL shown in a concept image is illustrative; an alias is unnecessary for version 1.

## 2. Fixed roster and distinct responsibilities

These names describe fictional AI personas, not human employees, qualifications, or personal histories. Show a persistent AI disclosure in the office and profile panel.

| Person | Role and personality | Responsibilities | Communication | Working rule |
| --- | --- | --- | --- | --- |
| Adrian | Project Manager; calm, structured, outcome focused | Clarify scope, define acceptance criteria, assign tasks, coordinate handoffs, maintain delivery status | Completed / next / blocked / decision needed | Obtain owner approval before changing agreed scope, budget, or client commitments |
| Clara | Finance & Accounting; methodical, careful, transparent | Organize financial inputs, prepare estimate and invoice drafts, flag missing rates and discrepancies, summarize costs | Exact amounts, currency, date, source, and confirmed-versus-estimated labels | Prepare financial actions for review; do not submit payments, filings, or definitive tax classifications without the required facts and authorization |
| Nadia | Administration; orderly, dependable, detail attentive | Organize source documents, maintain records, capture decisions, identify missing information, prepare meeting notes | Practical checklist with responsible person and due date where known | Check existing records before creating new ones; preserve source and revision history |
| Leo | Sales & Client Relations; approachable, curious, commercially practical | Capture client needs, qualify opportunities, prepare briefs, proposals, and follow-up drafts | Client goal / recommended next step / commitment needing approval | Use approved commercial terms; do not invent discounts, prices, deadlines, or client consent |
| Lisa | Graphic Designer; visually curious, thoughtful, precise | Develop visual concepts, design proposals, reference boards, brand guidance, and export specifications | Recommended direction / rationale / artifacts / specific feedback requested | Check the approved brief, available brand assets, and required formats before handoff |
| Sam | Frontend Developer; practical, collaborative, user attentive | Plan responsive and accessible interfaces, map user journeys, propose components and API needs; implement only under separate authorization | Journey / proposed interface / evidence or checks / remaining questions | Evaluate the complete agreed user journey and screen sizes before claiming implementation acceptance |
| Theo | Backend Developer; methodical, calm, reliability focused | Plan APIs, data structures, authentication, and integrations; identify dependencies and verification needs; implement only under separate authorization | Capability / inputs and outputs / checks / risks and dependencies | Obtain owner approval before production changes affecting stored data or access permissions |

Adrian coordinates; he is not automatically the approver of every technical or financial claim. A review must be assigned to someone other than the artifact's author. Reviewers check the work against explicit criteria; the owner makes the final acceptance decision in the initial workflow.

## 3. Initial end-to-end workflow

The first workflow starts with one minimal website request and ends with a brief, scoped plan, draft recommendation/proposal, independent review, and owner acceptance. It does not build a website or send anything to a client.

1. **Draft client brief — Leo, supported by Nadia.** Capture the business objective, audience, intended pages/features, existing references, known constraints, timing preference, budget if supplied, and missing facts. Attach source references. Unknown values remain unknown. Nadia checks record completeness and duplicates.
2. **Scoped plan — Adrian.** Convert the brief into in-scope and out-of-scope items, deliverables, assumptions, dependencies, milestones, named responsibilities, and acceptance criteria. Milestones are proposed until approved. Block only dependent work when a critical fact is missing.
3. **Design and build proposal — Lisa, Sam, Theo, and Clara.** Lisa proposes visual direction and required assets. Sam proposes user journeys, interface structure, responsive behavior, accessibility considerations, and frontend dependencies. Theo proposes data/API/authentication/integration requirements and risks. Clara compiles costs using supplied rates and terms; absent inputs are flagged rather than guessed. These are proposals, not claims of implemented or tested software.
4. **Independent review.** Adrian checks brief coverage and consistency without reviewing his own scoped plan as its sole reviewer. Nadia checks document completeness and source references. Sam and Theo review the interface/API boundary from their respective sides. Lisa and Sam cross-check the design and interface specification. Clara checks financial consistency. Any section requiring expertise unavailable within the team is explicitly marked for owner or external specialist review.
5. **Owner decision.** Present the versioned brief, scoped plan, design/build proposal, estimate with uncertainty labels, review findings, and unresolved decisions in one review package. The owner can accept, request changes, or reject. Acceptance records this package revision; it does not authorize external sending, implementation, payment, tax filing, or deployment.

The acceptance checklist for the package is: source-linked brief; explicit scope; feasible proposal with named uncertainties; no invented pricing or integrations; role-owned outputs; non-author review of each material section; resolved findings or owner-accepted limitations; and recorded owner acceptance of the current revision.

## 4. Canonical records and isolation

Plan for these records even if the prototype initially uses labelled examples: Client, Project, Task, Run, ArtifactRevision, Evidence, Review, Approval, Handoff, and Event. The owner remains a human actor distinct from the seven personas.

Every task, artifact, review, approval, handoff, and event carries a `clientId` and `projectId` transport scope. Use a registered internal workspace/project scope for company-internal work; a database nullable client foreign key must map to that explicit internal scope, never an accidental shared/global client context. Runs also carry `taskId` and `agentId`. Evidence links to the artifact revision or claim it supports. Store timestamps and actor identity for actual state changes.

Keep client workspaces, source documents, retrieved context, queues, and conversation history separated. A task for client A must not receive client B's documents merely because the same persona performs both jobs. Shared material must be explicitly classified as approved reusable company material. Test isolation at the data-access boundary, not just through visible UI filters.

A task record owns the conversation and decision history; an agent profile is a view into assigned tasks. This avoids seven incompatible copies of the same project context. A handoff references the existing task and artifacts rather than copying an uncontrolled summary into a new conversation.

Client documents, webpages, messages, and tool outputs are source data. Embedded instructions in them do not acquire the authority to change role permissions, reveal other clients' data, or approve actions.

## 5. Task states and transitions

Only the application workflow controller changes canonical state after validating the event and actor permission. Agent prose may propose a state change; a message saying "done" cannot complete a task.

| State | Meaning | Normal next states |
| --- | --- | --- |
| `draft` | Intake is being prepared; no work assigned | `queued`, `cancel_requested`, `cancelled` |
| `queued` | Ready to schedule within the correct client/project queue | `assigned`, `paused`, `cancel_requested`, `cancelled` |
| `assigned` | One accountable owner selected; execution has not started | `in_progress`, `queued`, `paused`, `blocked`, `cancel_requested`, `cancelled` |
| `in_progress` | A confirmed run or authorized human action is under way | `waiting_for_input`, `waiting_for_review`, `pause_requested`, `blocked`, `failed`, `cancel_requested` |
| `waiting_for_input` | A specific answer or source is required | `in_progress`, `queued`, `blocked`, `pause_requested`, `paused`, `cancel_requested`, `cancelled` |
| `waiting_for_review` | A specific artifact revision awaits a named reviewer | `changes_requested`, `review_passed`, `pause_requested`, `paused`, `blocked`, `cancel_requested`, `cancelled` |
| `changes_requested` | Review lists concrete issues to resolve | `queued`, `in_progress`, `pause_requested`, `paused`, `cancel_requested`, `cancelled` |
| `review_passed` | Required reviewers passed the current revision, with evidence | `waiting_for_owner_approval`, `changes_requested`, `pause_requested`, `paused`, `cancel_requested`, `cancelled`; covered children may become `completed` through parent acceptance only |
| `waiting_for_owner_approval` | Current package awaits a scoped owner decision | `completed`, `changes_requested`, `pause_requested`, `paused`, `cancel_requested`, `cancelled` |
| `completed` | Owner accepted the specific final package revision | New work uses a linked follow-up task; preserve the accepted record |
| `pause_requested` | Owner requested suspension; one or more active runs have not confirmed a stop point | `paused`, `blocked`, `failed`, `cancel_requested` |
| `paused` | Future scheduling is suspended and active runs reached a confirmed stop point | `queued`, `cancel_requested`, `cancelled` |
| `blocked` | A named dependency or permission prevents progress | `queued`, `pause_requested`, `paused`, `cancel_requested`, `cancelled` |
| `failed` | Required execution cannot continue under the current run; output may be partial and unverified | `queued` after explicit retry/recovery decision, `cancel_requested`, or `cancelled` |
| `cancel_requested` | Owner requested cancellation; outstanding execution/effects still require reconciliation | `cancelled` |
| `cancelled` | Work was stopped and retained for audit | Terminal; use a linked replacement task if needed |

For work that has not actually started, show Queued or Assigned, not Working. Where no runtime is connected, show Not connected. Do not invent percent complete; use a verified acceptance checklist when useful. Stale telemetry appears as Status unavailable with the last confirmed update, not as a fabricated success or failure.

Pause and cancellation requests are distinct from effective stops. Stop future scheduling promptly; if a tool cannot be interrupted, retain `pause_requested` or `cancel_requested` until execution is reconciled. Direct transition to `paused` or `cancelled` is allowed only when no outstanding run/effect needs reconciliation. Cancelling work does not silently undo external effects or delete artifacts. Persist a state-change audit event and its supporting evidence before showing the effective state.

### Separate run/job state

A task is the business unit of work; a run/job is one attempt to execute a step. Use canonical run states `queued`, `starting`, `running`, `waiting_for_tool`, `pause_requested`, `paused`, `cancel_requested`, `cancelled`, `succeeded`, `failed`, and `interrupted`. Terminal runs are `cancelled`, `succeeded`, `failed`, and `interrupted`; retry creates a new linked run. A lost or interrupted run is not a successful task. Stale telemetry is a freshness flag and must not silently rewrite the last confirmed run state.

Normal progression is `queued` → `starting` → `running`; a run can enter `waiting_for_tool` and return to `running`. Pause/cancel requests can be issued while starting, running, or awaiting a tool, and become effective only on a confirmed safe stop. A paused run may resume after scope and permission rechecks. A run succeeds only after the expected result is confirmed; its task can still await further work, review, or owner acceptance. A failed run does not immediately fail the whole task if an authorized recovery is available. The companion JSON defines the allowed run transitions and guards separately from task transitions.

## 6. Reviews, approvals, and handoffs

**Review:** record reviewer identity, artifact revision and digest, criteria, evidence inspected, findings with severity, and outcome (`pending`, `in_review`, `changes_requested`, `passed`, `superseded`). An unavailable check is Unverified, not Passed. A fresh reviewer context includes the request, sources, standards, and artifact rather than the author's unsupported self-assessment.

**Approval:** states are `proposed`, `pending`, `approved`, `rejected`, `expired`, `superseded`, or `cancelled`. Bind each approval to client, project, task, action, artifact revision, SHA-256 content digest, scope, and relevant amount/currency or destination where applicable. For a multi-artifact package, the accepted immutable manifest lists each component revision and digest plus the acceptance criteria; digest that saved manifest as well. Verify the current digest at decision time. A changed revision or digest supersedes prior approval and requires a new decision, even if the displayed title or URL is unchanged. Approval is an authenticated owner action. Do not infer approval from silence, elapsed time, agent agreement, or a clicked decorative object.

The canonical configuration field is `artifactHash`, with `hashAlgorithm` set to `SHA-256`. A real hash is computed from the exact saved content, never invented by an agent or copied from sample data.

In this first workflow the only final approval scope is `accept_internal_proposal_package`. Its label must explain that it accepts an internal draft package. Completion requires persisted acceptance evidence linking the authenticated owner, timestamp, approval scope, package revision/digest, component manifest, and passed review records. A generic Approve output action cannot authorize external sending, invoice issuance, payments, filings, production changes, or deployment; those are distinct future action scopes and remain unavailable here.

**Handoff:** states are `prepared`, `awaiting_acceptance`, `accepted`, `declined`, `superseded`, or `cancelled`. The payload includes task identity, sending/receiving roles, required artifact revisions and digests, completed criteria, open questions, expected output, permissions, and dependencies. Acceptance means the recipient has the necessary context and capacity; it does not mean the work is complete. Decline requires a reason and returns the decision to Adrian or the owner. Revised source artifacts supersede stale handoffs.

The next role can continue independent work while another branch waits. Keep one accountable owner per task; use child tasks for concurrent specialist work. A parent reaches review only after its required children and evidence are ready.

## 7. Responses: event text versus generated work

### A. Deterministic status and activity messages

Fixed templates are populated only from validated event fields. Examples: Task assigned; Draft artifact saved; Review requested; Changes requested; Owner accepted this revision. Each event displays actor, time, client/project/task context, and relevant artifact or evidence link.

An LLM cannot mint a trusted event by outputting JSON or describing an action. The controller records events from permitted application actions and confirmed tool results. Office animation subscribes to those events; it is never the source of truth.

### B. Role-specific generated responses

Use a common envelope: concise summary; outputs with revision links; evidence and limitations; decisions needed; next step. Role presets add the fields listed in the roster and companion configuration. Omit empty sections instead of printing artificial filler. Use familiar language and explicit uncertainty; do not invent personal anecdotes or claim human employment.

A response can say "I propose..." or "The draft recommends...". It can say "I updated..." only when a saved revision or confirmed action supports that statement. Design concepts and estimates must be labelled as proposals and estimates. Proposed tests are not test results.

### C. Office bubbles and interaction summaries

Keep bubbles brief, temporary, and optional. Useful examples are "Shared the design proposal with Sam" after a confirmed handoff, or "Waiting for the owner's scope decision" after an actual approval request. The full task record contains the detail. Group repeated events to avoid noise.

Do not generate fake colleague conversations, repeated idle chatter, invisible thinking transcripts, or random movement presented as productivity. Show short decision summaries and execution evidence rather than private chain-of-thought.

## 8. Panels and owner actions

| Surface | Required information and actions |
| --- | --- |
| Office overview | Seven labelled people; AI and mode disclosure; visible status; unobstructed navigation; select a person; switch to task list/board |
| Agent side panel | Role, responsibility, connected/disconnected runtime, assigned tasks, current task, recent confirmed actions; ask about or assign a task within permitted scope |
| Task panel | Client/project, brief, scope, acceptance checklist, accountable owner, dependencies, state, conversation, evidence, artifact revisions, review and handoff history |
| Owner inbox | Pending decisions grouped by client/project; exact action and revision; impact, uncertainty, and supporting evidence; accept, request changes, reject |
| Artifact viewer | Revision, author, created time, draft/review/acceptance status, sources, review findings; compare revisions; open/download the artifact |
| Activity log | Filter by client, project, task, person, event type, mode, and date; concise facts with links; no secrets or raw hidden reasoning |
| Queue/board | Priority, age, dependencies, capacity, and paused/blocked items; owner can reprioritize, reassign, or cancel within scope |

Use separate, precise controls: View work, Request changes, Accept this internal package, Pause, Resume, Cancel task, Retry failed step, and Reassign. Disable unavailable actions with a readable reason. A selected avatar or chat acknowledgement is not acceptance. Scope-changing actions explain their concrete impact before commitment.

Queue edits, draft edits, review requests, and internal assignments should be straightforward and reversible. Do not add repeated approval prompts for already authorized internal drafting. External sending, financial execution, filing, deployment, production data changes, and new integrations are separately gated and disabled in the supplied starting configuration.

## 9. Empty, error, recovery, and accessibility behavior

- **No tasks:** say No tasks assigned and offer the permitted draft-brief entry point. Do not populate fictional work.
- **No runtime/integration:** say Not connected or Integration not configured; describe what is required without claiming setup is complete. Never ask the owner to paste secrets into a conversation or activity log.
- **No sources or pricing:** identify the specific missing input. Continue independent drafting with visible assumptions; block only the dependent claim or action.
- **Tool/run failure:** show the failed step, plain-language cause when known, last confirmed action, saved partial artifacts, and safe recovery options. Do not label partial results complete.
- **Retry:** use idempotency and verify whether a previous action succeeded before repeating it. Preserve the failed run and retry link. Do not automatically retry external or irreversible actions.
- **Revision conflict:** keep both revisions, show the difference, and request a merge/selection decision. Never silently overwrite another person's work.
- **Lost connection/stale state:** preserve the last confirmed state, show freshness, and reconcile after reconnecting before issuing new dependent actions.
- **Budget/time/review-loop limit:** pause further scheduling, retain artifacts, and escalate with options. Default to at most two revision cycles per task before owner review; this is adjustable configuration, not a quality guarantee.
- **Cross-client access denied:** stop the affected access, do not reveal the other client's metadata or contents, and show a scoped error in the current task.
- **Accessibility:** every office action must be available through a keyboard-operable list/panel interface. Provide visible focus, readable labels, screen-reader status text, and large usable click targets. Do not rely on color, audio, animation, hover, or the 3D canvas alone. Respect reduced motion; allow pausing movement and hiding bubbles. Keep text out of occlusion and provide stable camera/reset controls.

The initial target is Chrome on Windows desktop. Responsive panel behavior, browser zoom, keyboard use, reduced-motion settings, and a graphics-unavailable fallback belong in acceptance checks. A visually attractive screenshot is insufficient evidence that these behaviors work.

## 10. Multi-client queues and concurrency

Use client/project queues with a global owner overview that exposes only authorized summaries. Dependency order wins over visual desk movement. Prioritize explicitly; surface aging tasks so a busy client does not silently starve another client's work.

Default the first live pilot to one active end-to-end workflow. Later, allow parallel child tasks where their inputs are ready and independent. The persona remains one identity across queues, but every run receives scoped client/project context. Do not let an agent edit the same artifact revision concurrently from two runs.

Configure per-task iteration, runtime, and spend limits before connecting a runtime. Display actual usage when metered; otherwise show Unavailable. Model/provider identity, costs, rate limits, and connectors are unresolved implementation choices, not presumed capabilities.

## 11. Staged delivery and acceptance

1. **Visual handoff:** roster, portraits, office plan, style, labels, panel mockups, and this contract. All interaction examples are labelled simulated. No app changes.
2. **Authorized visual prototype:** selectable desks, panels, board, example handoff, example review, and keyboard/list fallback using sample data. Persistent prototype disclosure; no live tools. Test graphics and readability before expanding scene detail.
3. **Authorized internal pilot:** configure identity, storage, permissions, runtime, and selected sources; run one draft-brief-to-reviewed-package workflow. Verify state transitions, revision-bound approval, independent review, recovery, and isolation.
4. **Controlled expansion:** add real integrations and concurrent work individually after their authorization and validation. External operations require explicit action policies and appropriately scoped approval.

The delivered package is ready for implementation planning when its assumptions and open decisions are clear. It does not certify any existing app, connection, security boundary, performance target, or business/tax treatment.

## 12. Implementation decisions to settle in Codex

- Confirm the existing Team dashboard's repository, current behavior, data contracts, and records to preserve before replacement work.
- Choose the approved office assets and source-of-truth asset manifest; verify usage rights, licensing, and formats for any third-party 3D assets.
- Follow the inspected persistence/authentication/worker/event architecture in `specs/integration-and-execution.md`. Recheck current source rather than reselecting an unrelated application stack. The model/provider connection, exact compatible dependencies and live spend limits remain activation inputs.
- Confirm source locations, approved templates/rates, client/project access rules, and the initial real example brief.
- Confirm owner identity and the action matrix; configure scheduling and cost limits before live runs.
- Translate the acceptance criteria into meaningful integration and browser checks once implementation is authorized. Do not mistake the JSON sample's simulated events for execution evidence.


## Implementation versus agent-pilot authorization

The configuration field `implementationAuthorized: false` and the pilot action `implement_application_code` restriction describe this static data file and the first agents' proposal-only workflow. They do not override a later direct owner instruction asking Codex to implement the office. Submitting CODEX-KICKOFF.md is that build instruction. Later Sam/Theo coding workflows need their own scoped executor capability; accepting a proposal is not automatically a request to execute it.


## Parent package and child-task completion

A required specialist child at review_passed is dependency-ready, so the parent can enter review without asking the owner to approve each child. The final immutable parent manifest lists each covered child task, artifact revision, SHA-256 digest, required review records and acceptance criteria. One authenticated owner acceptance validates the current parent manifest and every covered child revision/review atomically, then completes the parent and those review_passed children with the same inherited acceptance evidence. Any mismatch aborts acceptance and refreshes/supersedes the package. Uncovered or changed work remains unaccepted. This inherited completion is the only direct review_passed-to-completed transition and never authorizes external effects.

Rejection records the owner, decision, time and reason. It does not create acceptance evidence. Current-digest verification and acceptance evidence are required when approving the internal package, as defined in the JSON contract.
