# Enztronic Office: 3D assets and browser engineering handoff

**Status: specification and planning only.** This handoff defines proposed geometry, asset contracts and acceptance work. The supplied portraits and office images are PNG references. There is no delivered office GLB, character mesh, rig, animation set or working 3D browser scene. The 3D production and implementation stages below remain to be done before any claim of a modeled or functioning office.

The fixed fictional roster is Adrian (Project Manager), Clara (Finance & Accounting), Nadia (Administration), Leo (Sales & Client Relations), Lisa (Graphic Designer), Sam (Frontend Developer) and Theo (Backend Developer). Preserve their names, responsibilities and distinct portrait identities. These are interface personas, not proof that agents are running.

## Visual direction and technical choice

Use a warm, compact professional studio: light oak, pale warm floor, navy upholstery, restrained cobalt accents, green plants and soft daylight. Use simplified adult proportions and clean silhouettes. Distinguish the seven faces, hairstyles, skin tones and clothes from the portrait and prompt references. Reconcile the portrait set into one coherent 3D style; do not turn the headshot PNGs into face billboards or pass them off as modeled people. Keep labels in the interface rather than baked into a texture. No points, levels, coins, game controls or decorative progress simulations.

Retain the existing Enztronic Next.js/React application. Add a lazily loaded client-side scene using mutually compatible stable releases of Three.js, React Three Fiber and Drei, pinned in the existing dependency lockfile after checking the current React major and package peer dependencies. Do not upgrade the application's React/Next stack just to match a tutorial. Use stable documented APIs; do not base the first version on canary packages, WebGPU or a physics engine. The owner-facing handoff should distinguish scene data, real task state and illustrative demo data.

The Next server continues to own authentication, permissions, API credentials, task data and consequential actions. The scene is a presentation of permitted application data. Selecting a character or moving an avatar must never send a client message, start an agent run, mark a task complete or execute a business action.

## Coordinate system, camera and authored layout

`floorplan.json` is the machine-readable proposed source of truth. All coordinates are meters: origin at the front-left finished-floor corner, +X to the right, +Z toward the rear and +Y upward. Finished floor Y=0; footprint X=0–18, Z=0–13. Slab thickness is 0.25 m. Full rear wall height is 3.2 m; show a lowered 1.1 m left wall, with roof/front/right walls removed for the cutaway. These are virtual scene dimensions, not a building-code or construction design.

Default camera is orthographic, at [31, 22.8, -15.5] looking at [9, 0.8, 6.5], giving a 45-degree horizontal view and approximately 35.3-degree elevation. Begin with a 19.5 m vertical view span, then fit the projected room with 12% padding to the actual canvas aspect. Refit when the inspector opens or resizes. The fit calculation takes precedence over that initial span. Near/far planes are 0.1/100 m. Allow pan and wheel zoom at 0.8–2.5 times the fitted overview; keep the camera's yaw and tilt fixed in version one. Clamp the focus target within X=2–16 and Z=2–11. Overview must return to the fitted room. Selected-agent focus takes about 450 ms, or is immediate with reduced motion.

A 2.4 m clear entry opens at [9, 0]. The main walking loop follows X=5 and X=13, with front Z=2.7 and rear Z=9.0. Physical clear corridor boxes are:

| Corridor | X interval | Z interval | Clear width |
|---|---:|---:|---:|
| Business side | 4–6 | 1.75–9.9 | 2.0 m |
| Delivery side | 12–14 | 1.75–9.9 | 2.0 m |
| Front | 4–14 | 1.75–3.65 | 1.9 m |
| Rear | 4–14 | 8.1–9.9 | 1.8 m |
| Entry branch | 7.8–10.2 | 0–1.75 | 2.4 m |

The review table and its chairs fit entirely between these corridors. Desk chair footprints sit outside the side corridors. Keep plants, signs, chair pullout and animated limbs out of the clear corridors when authored. Geometry changes require rerunning the clearance check rather than merely retaining the same waypoint coordinates.

| Character | Desk center X,Z | Seated floor root X,Z | Standing approach X,Z | Faces when seated |
|---|---|---|---|---|
| Clara | 1.8, 10.3 | 2.85, 10.3 | 3.7, 10.3 | -X |
| Nadia | 1.8, 7.1 | 2.85, 7.1 | 3.7, 7.1 | -X |
| Leo | 1.8, 3.9 | 2.85, 3.9 | 3.7, 3.9 | -X |
| Adrian | 7.4, 11.3 | 7.4, 10.35 | 7.4, 9.45 | +Z |
| Lisa | 16.2, 10.3 | 15.15, 10.3 | 14.3, 10.3 | +X |
| Sam | 16.2, 7.1 | 15.15, 7.1 | 14.3, 7.1 | +X |
| Theo | 16.2, 3.9 | 15.15, 3.9 | 14.3, 3.9 | +X |

Six side desks have 1.6 × 0.8 m tops; Adrian's desk is 1.8 × 0.8 m. Desk surface Y=0.75 m and chair seat Y=0.47 m. Desk positions and yaw are represented by axis-aligned physical footprint boxes in the JSON. Character default forward is local +Z; yaw 0 faces rear, PI/2 right, PI front and -PI/2 left. Do not assume a mesh exported facing -Z can use these headings without correction.

The 3.6 × 1.4 m central review table is centered at [9,6]. There are eight review seats: Adrian [7.8,4.8], Clara [9,4.8], Nadia [10.2,4.8], Leo [6.7,6], Lisa [7.8,7.2], Sam [9,7.2], Theo [10.2,7.2] and owner [11.3,6]. The owner seat is normally empty; there is no eighth avatar. Seats along the front face +Z, rear seats -Z, left end +X and right end -X. Each has a distinct external approach in the JSON. Routes stop at the approach, followed by a reserved sit-down transition.

A client nook occupies the front-left, with two armchairs and one side table. A two-seat sofa and coffee cabinet occupy the front-right. Add two rear low shelves, four plants, seven desk monitors and keyboard/mouse sets, one shared wall-mounted review display, one project board and one ENZTRONIC sign. The total is seven individual desks, seven desk chairs, eight review chairs, two armchairs and one sofa object. Sofa capacity is two; it does not imply two additional agent identities. Version one permits standing at the nook and coffee point, with no automatic armchair/sofa seating.

## Purposeful movement, docking and collision

Use the authored bidirectional waypoint graph from `floorplan.json`, not random roaming or straight-line interpolation between arbitrary destinations. Its corner and branch nodes connect every desk, the review seats, project wall, coffee point, client nook and entry. A typical Sam-to-Lisa handoff is approach_sam → right_2 → right_3 → right_4 → approach_lisa; an allowed shortest path may omit unnecessary intermediate nodes. A Sam-to-review path is approach_sam → right_2 → right_3 → rear_center → branch_review_sam → approach_review_sam. These names refer to graph nodes, not real task automation.

Treat each person as a 0.25 m radius, approximately 1.8 m high navigation capsule. Inflate static footprint boxes by the radius when checking segment clearance; the visual mesh's adult height can vary without changing collision policy. Target walk speed is 0.8 m/s. Turn before starting a tight branch and blend idle/walk rather than snapping. Reserve destinations and narrow branches, keep centers at least 0.65 m apart and queue at a safe node when necessary. Never teleport through another avatar to keep an animation schedule. A dedicated physics engine is unnecessary for this constrained first scene.

Desk and table chairs are blockers for normal walking. A reserved docking state may temporarily exempt only that destination's own chair while moving between its approach and seated root. The desk, table and all other chairs remain solid. Sequence stand_up → clear own chair → approach → graph walk → approach → turn → dock → sit_down. Restrict the initial system to the tested docks; do not run a generic path through all seat roots.

The authored proposal was checked for main-corridor/static-box overlap and graph-edge intersection with obstacles expanded by 0.25 m. No conflict was found in this 2D planning check. This does not validate real GLB bounds, chair motion, route smoothing or animated limbs. Future validation must compare exported mesh bounds with the proposed boxes, sweep the collision capsule along every route and inspect all dock transitions in the real browser scene.

Movement is an optional spatial cue for handoff, review, meeting or a change of work location. It is never evidence of work progress. Keep task state and motion state separate. If no legitimate destination change exists, remain at the current seat. Avoid endless coffee loops. Pause hidden/offscreen work and resume without pretending that movement continued to accomplish tasks.

## Rendered scene and DOM boundary

The canvas renders the room, furniture, skinned characters, understated floor selection marker, lighting and camera. Use shared geometries/materials and instancing for repeated static furniture and plants. Per-character skinned meshes need independent skeleton instances and animation mixers; do not mutate a cached shared skeleton when cloning.

The DOM owns the page navigation, seven-person roster, all names and status text, task inspector, permission-sensitive controls, real activity log, errors, loading feedback, scene controls and fallback. Use the existing application's component system and keyboard/focus patterns. The inspector's contents must come from authorized task state, with explicit empty/loading/error states. The reference screenshot's activity examples are illustrative text, not historical records.

Pointer raycasting may select a character or workstation, but an equivalent named DOM button must exist. Clicking a character selects its record; it does not activate its tools. Keep a single selected ID shared by scene/list/inspector. Name labels may be projected DOM overlays, capped at seven with overlap handling; they must not be canvas-only accessible text. Decorative meshes should not intercept selection events. Hover alone must not carry essential information.

Keep animation/camera updates in the renderer's frame loop; do not trigger React state updates every frame or refetch tasks from each mesh. Send small state changes from React into the scene. Prefer event-driven invalidation when every avatar is still; run continuous frames only while animation/camera motion needs them, then stop. Properly dispose only owned resources and remove observers/listeners on route changes. Preserve standard HTML navigation and authentication outside the canvas.

The first scene can use one soft key light, ambient/hemisphere fill, simple standard materials and modest contact/baked shading. Avoid real-time mirrors, heavy glass, bloom, high-resolution shadow maps and multiple shadow-casting lights. A fallback screenshot is a preview image, not an interactive renderer.

## Modeling, GLB and editable source contract

Every required runtime model must be delivered with its editable source, textures, provenance/license information, export settings and validation report. The proposed package paths in `asset-manifest.json` are requirements, not files that currently exist. Keep source .blend files outside public web assets. If a different DCC is used, preserve its native source plus an exchange file and record the replacement before acceptance.

Deliver one office-shell GLB, one reusable furniture GLB and seven individual character GLBs. The shell contains the cutaway floor/rear/left walls. The furniture GLB contains reusable named components; runtime placement follows the floorplan rather than a single baked monolithic office mesh. Seven character GLBs must retain different recognizable identities. Provide one shared editable humanoid rig and animation library; animations are baked/retargeted into each exported character GLB with identical semantic clip names. A seven-character screenshot is not a substitute for seven rigged models.

Use glTF 2.0 binary GLB, meters, right-handed Y-up coordinates, applied object transforms, deterministic node names and feet-on-floor origins. Bake skinning and material inputs into portable glTF constructs. No required external texture URL may silently point to a missing file. Prefer embedded or explicitly packaged textures. Base-color/emissive color-space and non-color normal/roughness inputs must be set correctly. Use PBR materials without Blender-only procedural nodes at runtime. Record texture dimensions, UV usage and triangle/material counts in the report.

Use named exports from the furniture contract: Desk_160x080, Desk_180x080, DeskChair, ReviewTable_360x140, ReviewChair, ClientArmchair, ClientSideTable, Sofa2, CoffeeCabinet, LowShelf_200x040, Plant, Monitor, KeyboardMouse, ProjectBoard, SharedDisplay and BrandPlaque. Provide bounding boxes and pivot definitions for each. Feet/base sit at local Y=0; furniture pivots are floor-plan centers. The model's measured dimensions must match the floorplan within 0.02 m or trigger an explicit layout revision.

Each character has one common-compatible humanoid skeleton, deterministic bone paths, a root at floor level, one skin binding, no more than four influences per vertex and a provisional ceiling of 65 deforming bones. Preserve a source T-pose or A-pose and rig controls in the editable file; exclude unnecessary controls from the runtime export. Finger animation is optional. Rig and clip contract acceptance depends on Sam's proof before producing all seven.

Required clips per character:

| Exact clip name | Intended duration | Loop / root policy |
|---|---:|---|
| idle_stand | about 3 s | Loop; feet stable, root does not translate |
| walk | about 1 s | Loop; in-place; calibrated to 0.8 m/s scene motion |
| seated_idle | about 4 s | Loop at a 0.47 m chair seat |
| seated_work | about 4 s | Loop; subtle hand/upper-body work, no floating props |
| sit_down | about 1.2 s | Once, standing to seated dock |
| stand_up | about 1.2 s | Once, seated to standing dock |
| handoff_gesture | about 2 s | Once; restrained conversational gesture |

Durations are authoring targets; record actual durations and tune the scene to those values. Root horizontal motion remains zero; navigation owns displacement. Pelvis and limb movement provide sit/stand motion while the floor-root anchor stays fixed. Crossfade generally 0.15–0.25 s. Check feet, chair penetration, hand/desk height, clothing deformation and glasses/hair attachments at every clip boundary. No foot sliding, skating, sudden scale changes or undeclared root-motion drift is acceptable.

Any mesh compression or KTX2 texture pipeline must be supported by the chosen production loader and tested with deployed decoder paths. Begin with a correct uncompressed proof; compress only after visual and animation validation, then compare appearance and timings again. Do not claim an optimization completed because a file extension or export setting exists.

## Provisional budgets and measured browser acceptance

The figures below are planning goals, not achieved measurements or a performance guarantee. Confirm the owner's actual Windows desktop/laptop hardware, display, Chrome version and hardware acceleration before adopting the final acceptance profile. A provisional reference profile is a 16 GB Windows laptop with a contemporary Intel Iris Xe-class integrated GPU, stable Chrome, 1920×1080 display, browser zoom 100%, with the in-page inspector open. Record the actual CPU/GPU/driver, viewport and device pixel ratio with every result; lower-end machines need the reduced-quality mode or list fallback.

| Measure | Initial goal | Required evidence |
|---|---|---|
| Full scene visible geometry | ≤250,000 rendered triangles | Renderer statistics with seven characters |
| Draw calls | ≤120 in overview | Renderer statistics in normal and selected views |
| Character geometry/materials | Aim ≤12,000 triangles and ≤3 materials each | Export report plus runtime counts |
| Runtime model transfer | Aim ≤18 MB total; first shell/furniture stage ≤5 MB | Actual transfer sizes and cold-cache network capture |
| Textures | Mostly 1K, limited 2K; no 4K default | Manifest dimensions and measured GPU allocation estimate |
| Device pixel ratio | Cap at 1.5 initially; reduce to 1.0 in low mode | Actual drawing-buffer size |
| Normal desktop animation | Aim median frame time ≤16.7 ms, 95th percentile ≤25 ms | 60 s steady overview and moving/focus samples |
| Reduced-quality mode | Aim median ≤33.3 ms, 95th percentile ≤50 ms | Same profile and scenario |
| DOM task/list usability | Functional before 3D is ready; aim ≤2 s route usability | Timed cold-cache browser trace |
| First useful 3D view | Aim ≤5 s at 20 Mbps / 50 ms RTT; all seven ≤10 s | Cold-cache capture, no pre-warmed assets |

These targets may require revision after the one-character proof. Do not report passing from an FPS badge alone. Measure at least three runs of each agreed scenario: cold load, warm revisit, 60 seconds idle, a seven-person meeting transition, repeated selection/focus and inspector resizing. Report median/p95 frame times, long stalls, shader/decoder initialization, transfer and memory observations. Repeat a 15-minute session and route-away/return cycle to find resource growth. Do not invent a precise GPU-memory number when the browser cannot expose one; state the estimation method and its limit.

When performance is insufficient, first reduce DPR, shadow resolution, texture sizes and visible animation detail, then simplify meshes/materials. Preserve identities and task accessibility. Always allow a persistent “List view” switch. WebGL unavailable/context-lost or a failed model load must keep the task application usable and provide retry/fallback, never an endless spinner.

## Motion, accessibility and ordinary task view

Honor prefers-reduced-motion and the explicit scene setting. In reduced motion, keep a stable overview, disable automatic travel and camera tweening, stop ambient idle movement and show a static seated/standing pose. User selection remains available via the list and inspector; focus changes can be immediate. Reduced motion must not hide task updates or change underlying task execution.

Provide Pause movement, Overview, Zoom in/out and List view as labeled DOM controls. The canvas has a short descriptive accessible label, but the full seven-person/task interface must be operable without entering a 3D interaction. Retain readable names, role/status text, focus indicators, keyboard selection, sufficient contrast and a conventional activity log. Keep the roster and selected inspector present if the canvas is loading, unsupported, paused or absent. On narrow layouts, favor the ordinary list/task view instead of squeezing the entire desktop office into a tiny canvas.

A static overview PNG can accompany fallback with an explicit “Concept preview” label until genuine rendered imagery exists. Status must be textual and source-backed; selection color and avatar motion alone cannot communicate it.

## Staged production and acceptance

1. **One-character production proof.** Model Sam, one desk/chair and a simple floor segment. Deliver Sam's GLB, native source, shared rig source, all seven animation clips and validation report. Show that likeness, scale, materials, bone binding, footprints, sit/stand/walk blending and loader support work in the intended browser on the actual reference hardware. This is the first true 3D asset acceptance gate.
2. **Exact office blockout.** Author shell, graybox furniture, all seven seats, eight review seats, the corridors and graph. Verify the 18 × 13 m plan against exported bounds, collision sweeps, all docks and the overview camera. Reconcile the concept artwork to this authoritative geometry; record any agreed layout change in both JSON and sources.
3. **Complete seven-character asset set.** After the proof's rig/export contract is accepted, produce Adrian, Clara, Nadia, Leo, Lisa and Theo, unify style and test each clip and dock. Author final oak/navy furniture, materials and daylight. Check all seven are recognizable and visible in the default overview; no extra person or mislabeled identity.
4. **Browser scene integration.** Add the lazy client renderer, controls, selection/list/inspector synchronization, purposeful movement and failure handling using explicitly labeled demonstration state first. Connect authorized real task data separately; remove fabricated activity from real-data mode.
5. **Measured acceptance.** Deliver validator output, actual asset counts/sizes/bounds, license/source inventory, browser screenshots/video, route/collision results, animation review and hardware-specific performance/accessibility results. Record remaining failures honestly.

The present handoff completes none of the modeled stages. A modeling/export-capable production workflow remains necessary. A read-only PATH check did not find a Blender command; that is not an exhaustive installation inventory. Do not install tools, commission assets or start modeling as an implied consequence of this planning package. The final modeled acceptance cannot be signed off until the required runtime files, editable sources and measured checks exist.

## Handoff package and evidence limits

Read `asset-manifest.json` for delivered_reference versus required_not_produced records. Delivered references have file/PNG-header checks only; they have not been turned into models, rigged or performance-tested. Each required file needs source ownership/license evidence, geometry/rig/animation checks and runtime validation before status changes. Do not mark a requirement complete merely because a placeholder with the same filename is created.

Read `floorplan.json` for dimensions, camera, footprint boxes, clear corridors, exact workstations, all review seats/approaches, graph nodes/edges, destination positions and counts. Its automated 2D planning checks are limited to proposed rectangles and straight segments. The original conceptual PNG remains a mood reference if it conflicts with these newly authored dimensions.

