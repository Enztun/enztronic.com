# Office UI refinements — 8 November 2026

**Deployed, verified and owner-accepted:** production serves build `7VQBHlMCw4uRSPfvo5f5T`, promoted at 15:30 Jakarta time. The prior complete UI build is retained for rollback. The owner confirmed that the profiles and grouped views look right after the requested signed-in browser check.

The owner reported a misplaced Profile popup, a Status button that only selected the sidebar person, an overwhelming flat Activity list, missing agent identity on task cards, and missing PC pan guidance.

## Changes

- **One Profile dialog:** sidebar Profile and Status “Show … profile” now open the same controlled dialog for the correct person. Explicit fixed positioning, insets and auto margins override the application's reset of browser dialog margins. The header and close control stay outside the scrolling body. Escape and focus return remain native dialog behavior.
- **Grouped Activity:** related task-family events share a history card with participant portraits, a concise recorded outcome and clearly labelled update counts. Six histories appear initially. Individual timelines start collapsed, reveal eight events at a time and retain technical details on demand. All matching events remain available, including failures, retries, owner actions and unknown updates. Missing-task links carry their recorded workspace/mode/task scope.
- **Consistent identity:** task cards, Current work, task details, Status and event logs share portrait/name/category badges. Finance is gold, Design blue, Administration amber, Sales green, Frontend teal, Backend violet and Project management rose. Labels carry the meaning alongside color. Owner and scheduler records remain distinct from agent runs; unknown-source role bookkeeping receives neutral attribution.
- **PC navigation:** the scene hint and information disclosure explain **Ctrl + click and hold to pan**. Existing OrbitControls bindings already support it; bindings and task execution behavior are unchanged.

## Validation

The secret-free C: candidate `7VQBHlMCw4uRSPfvo5f5T` passed fresh lint, typecheck, the full disposable-database suite (21 files / 197 tests, zero skipped), and a complete Webpack build.

Targeted production-mode browser checks confirmed actual horizontal and vertical centering at 1890×936, 1512×982 and 390×844; the close header remains reachable after scrolling. Status entry points for Clara, Theo and Adrian open the correct profile and return keyboard focus on close. Task identity and category colors match the Activity and Current work presentations. The Activity fixture retains all85 scoped events exactly once, isolates another workspace, preserves failures/retries and exposes source/run evidence. Ctrl-left-drag moved the scene rather than merely displaying a hint.

The focused UI flow passed **48/48** checks with zero browser errors, including actual authenticated portrait loading for all seven profiles. The same candidate also passed the complete **38/38** signed synthetic-owner workflow: save/reload, live-lease timer/expiry, seven specialist outputs and independent reviews, exact-package acceptance, Dashboard revision link/reload, mobile layout and information controls. These are isolated fixture checks with development bypass disabled, not use of the owner's production session. Fixture ports55439/55519/3158/9458 are closed and cleanup passed.

Evidence: [ui-ux-v2-evidence-20261108](ui-ux-v2-evidence-20261108/), including [validation details](ui-ux-v2-evidence-20261108/VALIDATION.md) and current screenshots. All124 application/configuration files matched the frozen candidate, and both browser reports carry the exact build identity and component hashes.

## Preservation

A fresh private recovery set on C: and E: passed an exact isolated restore of all32 production tables, catalog, four roles/grantors and accepted work. It is `post-acceptance-20261108-18cca1b3-b59c-4fd3-8adc-8cd995ba27a4`; archive SHA-256 `727554f84c1d2c4f38efcc99b3f3c1b80bf77bf25eb5aefff6dc4be8f696e949`. Its temporary cluster is stopped and port55489 is closed. Credentials and full snapshots remain private.

Promotion verified all217 build files and used the existing startup arrangement. The previous working `lLqX-hgihnGlb_e0a6-8g` build is retained at `apps/backoffice/.runtime/releases/ui-ux-20261108-86357a902c/working-build-before-ui`. Private release, task-definition/configuration snapshots and invariant evidence are at `C:\Users\hoyec\Enztronic-Recovery\ui-ux-release-20261108-86357a902c`.

Post-promotion verification passed all31 non-heartbeat table digests, full catalog/role metadata, migration ledger, audit sequence and owner-access counts. Environment and worker configuration hashes and startup definitions are unchanged. The worker's existing supervisor recovered after the dedicated-database restart; its new identity produced an advancing heartbeat. Local responses and unsigned/spoofed/invalid authentication denials passed, the public admin endpoint still redirects to the configured Cloudflare Access issuer, and the public website returned200. The only omitted table comparison is transient worker-heartbeat data.

This is a UI change. Office runtime, contracts, migrations, provider configuration, worker authority, financial records, human access and public-site configuration are unchanged. Office remains enabled, development bypass remains false and live-provider/command execution remain unconfigured.

## Owner-browser acceptance

The owner completed the requested refresh/check and replied **“Profiles and grouped views look right.”** The request covered Profile from both the sidebar and Status, grouped Activity and colored task portraits. This closes owner-reported visual acceptance for this pass; see [owner confirmation](ui-ux-v2-evidence-20261108/owner-browser-acceptance.json).

That signed-in session was not connected to the operator tools, so owner testimony remains separate from the signed fixture tests. No real production owner task or approval was created for this release. This visual confirmation does not claim a GPU benchmark or final rigged-character approval. The existing host-awake/owner-Windows-sign-in startup constraint remains unchanged.
