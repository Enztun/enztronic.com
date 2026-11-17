# Acceptance and evidence matrix

This is an implementation checklist. None of these product checks is marked passed merely because this planning pack exists.

## A. Source and owner preservation

- Capture baseline and preserve unrelated changes and employee/ originals.
- Verify owner login, active human identity and transactional last-admin protection where retained human-management controls require it.
- Verify denied/expired authentication on page, APIs, mutations, event replay and artifact delivery.
- Verify client ownership, invoice access/numbering/snapshots, commissions and historical financial audit behavior are preserved.
- Confirm public website build/deployment boundary and shared tunnel/database listeners are unchanged.

## B. Ordinary UI before visual polish

- /team remains authenticated and is labelled Office.
- All seven distinct profiles have correct names/roles/portraits.
- Agent panel, task detail, project filter, owner inbox and ordinary list mode work.
- Loading, empty, demo, unconfigured, offline, denied, error, cancelled and stale-data states are intentional.
- Keyboard users can accomplish every essential task without selecting a mesh; visible focus and textual status labels are present.
- Reduced motion suppresses roaming/camera tween effects; mute/bubble/quality settings do not alter execution.

## C. Real 3D assets and scene

- Load actual geometry, not a PNG on a plane, for the real 3D milestone.
- Validate GLB paths, geometry scale/pivots/naming, licenses, source files and material/texture dependencies.
- Verify seven named desk/seat/approach anchors and eight meeting seats against data/floorplan.json.
- Validate routes against inflated obstacles and verify seat docking exceptions are destination-scoped.
- Check all required clips, feet/seat alignment, visible identities, labels and camera fit with the inspector open.
- Verify WebGL/model-load/context-loss fallback keeps tasks usable.
- Record measured performance under the defined viewport/hardware/network conditions; proposed budgets are targets until measured.

## D. State, review and approval correctness

- Adopt one canonical task/run state contract from data/response-presets.json.
- Status and events commit atomically with the relevant durable change; generated prose cannot directly declare success.
- Pause/cancel requested is distinct from effective paused/cancelled.
- Preserve one accountable task owner plus explicit child tasks and handoffs.
- Review records identify reviewer, artifact version/digest, scope, evidence, findings and unresolved limitations.
- An author cannot be sole approver of their work; owner acceptance has the exact current internal scope.
- Changed payloads/artifacts invalidate prior approval. Generic acceptance cannot authorize sending/payment/deployment.

## E. Worker, queue and recovery

- Task submission is idempotent; concurrent workers cannot own one valid lease simultaneously.
- Heartbeats, lease expiry/fencing, retries/backoff/checkpoints and exhausted retries are testable.
- Crash before/after a step does not silently lose the task or repeat a known external effect.
- Unknown external outcome is reconciled or escalated, not blindly retried.
- Pending input/approval releases execution capacity and resumes correctly.
- Budget reservations and cancellation are rechecked immediately before effect execution.
- Missing provider/setup produces an honest configuration state; fake adapters are isolated and disclosed.

## F. Multi-client boundaries and observation

- Cross-project task, memory, file, artifact, source and tool access is denied by default.
- Registered workspace roots survive canonical path/symlink/junction boundary checks.
- Untrusted client install/build scripts run without owner machine secrets or other client access.
- Event replay is scoped, ordered, bounded and deduplicated; reconnect can refresh a missing snapshot.
- Browser closed does not terminate server work; unavailable PC/worker is reported accurately.

## G. Release readiness

- Run relevant current repository lint/typecheck/test/build commands locally and targeted database/worker/browser checks.
- Do not add GitHub Actions or billed CI without separate authorization.
- Prepare additive migration, actual backup/recovery evidence, worker startup, health/log rotation and rollback before activation.
- Activate only under the owner's authority, then verify real signed-in and denied paths and one harmless workflow.
- Report implementation, modeled assets, live pilot and production activation separately.

## Evidence report format

For each category: status (pass/fail/pending), exact revision/environment, check performed, observed result, artifact/log reference and remaining limitations. Do not infer real email delivery, API access, financial posting, model success or 3D animation from mocks or screenshots. A package can be handoff-complete while implementation checks remain pending.

