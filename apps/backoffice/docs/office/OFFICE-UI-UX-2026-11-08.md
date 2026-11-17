# Office UI/UX update — 8 November 2026

**First UI release — deployed, verified and owner-accepted:** build `lLqX-hgihnGlb_e0a6-8g` was promoted on 8 November 2026 at 14:08 Jakarta time. The owner confirmed the new layout and figures after the requested signed-in browser check. A later [profile/Activity refinement](OFFICE-UI-UX-SECOND-PASS-2026-11-08.md) now serves `7VQBHlMCw4uRSPfvo5f5T`, retaining this build for rollback. The original release evidence below is preserved as history.

## Changes

| Request | Implementation |
| --- | --- |
| Compact profile sidebar | Portrait, name, role, colored status, up to two open tasks and primary actions remain in the card. Responsibilities, working rules, communication, detailed work evidence and recent actions move into an individual Profile dialog. |
| Remove persona label | The visible “Fictional AI persona” label is removed. |
| Working timer | The profile shows a colored dot and plain status. Elapsed work time ticks only for a matching live recorded run and lease. It ages using monotonic time and stops at lease expiry or stale evidence. Idle profiles have no invented work timer. |
| Welcome text | The introduction reads “Welcome to the office!” |
| Remove large demonstration box | The expanded disclosure is removed. A small Simulation badge keeps the current mode clear, with details behind Office information. |
| Simplify diagnostics | Connection and freshness use short labels. Worker details, simulation meaning and unavailable provider/cost information are available by hover, keyboard focus or touch. |
| Reduce controls height | Tabs and context share one toolbar. Filters stay collapsed until requested; an active-filter count and workspace name remain visible. |
| Dismiss finished notices | Save/action confirmations, completed-task messages and other transient notices have labeled close controls. Dismissal never clears record state, save guards or uncertain-submission locks. |
| Scene above controls | The 3D canvas precedes Overview, zoom and View options. Long scene explanations move into an information disclosure. |
| Persona figures | Seven distinct static code-native preview figures replace the geometric markers. They remain selectable. Final approved rigged models are a separate asset milestone. |
| Less technical task view | Record IDs, revision hashes and detailed run/lease evidence remain available in collapsible Record details, Revision details and Work details. Review findings, current revision selection and explicit owner decisions remain available. |

The profile dialog uses native modal focus containment and Escape/return behavior. Information controls and filters retain accessible names and keyboard access. No external model downloads, provider calls, new credentials, migration, seeding or financial action are part of this update.

## Verification and release

Source lint and type checks passed. An independent React/accessibility review confirmed the selection and safety boundaries; a completed-task wording issue was corrected so completion never implies that a displayed historical revision was accepted. Production-mode browser testing also identified an existing theme initialization script missing its CSP nonce. RootLayout now passes the proxy-generated per-request nonce into ThemeScript. The strict security policy is unchanged, and the final browser run confirmed theme initialization without CSP or hydration errors.

The isolated, secret-free C: workstream passed the full fixture suite (19 suites / 181 tests, zero skipped). Later label, theme-nonce and mobile-info presentation corrections were checked by fresh lint, typecheck and `npm run build -- --webpack`; the core fixture suite was not redundantly rerun. The final build is `lLqX-hgihnGlb_e0a6-8g`. Against that exact build, the combined production-mode browser workflow passed **38/38** checks, with zero console errors, using signed synthetic-owner authentication, bypass disabled and a fixture-only HTTPS issuer. A separate compact-controls flow passed **21/21**. No production session or credential was used in those fixtures.

The browser checks covered compact layout, profile focus/Escape, hover/focus/touch information, mobile panel bounds, active filters, notification dismissal, real leased-run timer ticking and expiry, seven role outputs plus the final package, eight independent reviews, owner acceptance, exact Dashboard revision navigation/reload, and emulated mobile layout. A paused Playwright clock initially affected a later page; the final run closes that browser context before resuming ordinary browser checks. All six fixture ports are closed and owned-resource cleanup passed.

The UI-only release controller passed 17 bounded path/manifest/transaction-failure checks. A live preflight additionally caught PowerShell's automatic JSON DateTime conversion losing its zone when reparsed; the UTC-preserving cast passed four fresh/string/stale/future timestamp checks before any service stop. The manifest reader was also corrected to use the snapshot's entries collection before staging. Both early refusals left the original service running.

Promotion verified all217 complete build files, then restarted through the existing owner-interactive backoffice task. It made no environment, worker configuration, schema, task-definition or migration change. The previous working build `H2wsHC_p8niGqIW1qcF_K` is retained in `apps/backoffice/.runtime/releases/ui-ux-20261108-4d142ecadb/working-build-before-ui`. The dedicated worker task remained enabled; its existing supervisor recovered after the brief dedicated-database restart. A new real worker identity produced an advancing heartbeat.

A fresh pre-update recovery set on C: and E: passed a full isolated restore of all32 tables, catalog, roles and accepted task evidence. Its private directory is `post-acceptance-20261108-bb37ac9d-bf89-4332-ad53-bf073c3f8fcf` beneath each disk's `Enztronic-Recovery` base; archive SHA-256 `210219c5f0a60493a130f7a3377c7e4c373d448ec43fd494b0fcf532577c4f5e`. Temporary restore port55489 is closed.

Post-promotion checks passed all31 non-heartbeat table digests, full catalog/role metadata, original migration ledger, audit sequence and owner-access counts. Only the transient worker-heartbeat table was excluded. Application environment and worker configuration hashes are unchanged; Office remains enabled, authentication bypass remains false, and live provider/command execution remain unconfigured. Local health and unsigned/spoofed/invalid authentication checks passed, the public admin URL still redirects to the configured Cloudflare Access issuer, and the public website returned200.

Evidence is recorded under [ui-ux-evidence-20261108](ui-ux-evidence-20261108/), including [validation details](ui-ux-evidence-20261108/VALIDATION.md), [desktop overview](ui-ux-evidence-20261108/screenshots/05-desktop-ready.png) and [mobile information panel](ui-ux-evidence-20261108/screenshots/07-mobile-office-information.png). Private release/configuration and invariant evidence is under `C:\Users\hoyec\Enztronic-Recovery\ui-ux-release-20261108-4d142ecadb`; credentials and full records remain outside the curated evidence.

## Owner-browser acceptance

The owner completed the requested existing-browser check and replied **“New layout and figures look right.”** The request covered refreshing Office, the compact sidebar, Profile dialog and seven 3D preview figures. This closes the owner-reported visual acceptance for this UI release. See [owner confirmation](ui-ux-evidence-20261108/owner-browser-acceptance.json).

The signed-in session was not connected to the operator tools; this confirmation is owner testimony, distinct from the automated fixture checks. It does not claim a GPU benchmark, physical mobile-device test or final rigged-character approval. The existing host-awake/owner-Windows-sign-in startup constraint remains unchanged.

## Asset limits

The runtime asset registry still contains no approved model collection. The new figures are original static previews, batched into four instanced geometry groups. They do not approve the existing private character proof or claim final identity, rigging, animation, deformation, docking or hardware-GPU validation. The existing approved-model gate remains unchanged.
