# Office scene and asset status

The `/team` Office now has a real, lazily imported React Three Fiber / Three.js WebGL blockout. It uses the handoff's meter-based `office-spec/data/floorplan.json` directly. The supplied PNGs remain references; no raster office image or portrait billboard substitutes for the scene. `office-overview.png` was visually reviewed for the warm oak, navy, cobalt, plants and cutaway direction. Geometry follows the measured JSON when the picture differs.

The application remains at the measured graybox milestone, **not the final modeled office or production-approved Sam milestone**. Seven named geometric markers identify workstation records. The UI labels them as provisional and keeps the ordinary roster/task interface usable while 3D loads or fails. No scene selection, camera movement or location cue executes a task. No movement or fabricated work is used to imply progress.

## New private editable proofs

Actual Sam, room-shell and furniture GLBs and editable Blender sources now exist under `office-assets/proof`, separate from the canonical approved production paths. They are not served by the private runtime allowlist. Sam has a real modeled face/hair/clothes mesh, weighted 22-bone skeleton and all seven embedded clips; this is not a portrait billboard. Three independently saved rig/character/animation sources were reopened in fresh Blender. Official Khronos validation has zero errors/warnings; headless Three parsing, normalized weights, independent skeleton cloning, actual clip deformation, floor bounds and horizontal root drift checks pass. Art/identity, planted-foot sit/stand, cloth deformation, all chair docks and real GPU acceptance remain pending. See `office/sam-proof.md` and the hash-bound reports for exact evidence.

The separate environment proof contains all three required shell nodes and 16 reusable furniture component names, actual 0.75 m desktops and 0.47 m seats, native sources, exported-GLB CPU renders and measured static bounds. The measured floorplan is unchanged. Both environment GLBs pass official validator and actual headless-loader checks. See `office/environment-proof.md`. Static bounds and CPU renders do not establish animated clearance or target GPU draw calls.

An official portable **Blender 4.5.14 LTS** ZIP was downloaded, matched against its published SHA-256, extracted under the task tool directory on C: and successfully run. No paid software, system-wide installation, PATH change, purchased model or downloaded mesh/texture was used. Source/checksum evidence is in `office/MODELING-TOOL-PROVENANCE.json`. Sam's remaining identity/deformation/browser gate precedes authoring the other six final characters. Development proofs do not complete the 15 production-manifest requirements.

## Implemented scene

- 18 × 13 m floor; 0.25 m slab, 3.2 m rear wall, 1.1 m left wall; front/right/roof cut away.
- Seven measured desks, seven desk chairs, seven monitor/keyboard/mouse sets; 3.6 × 1.4 m review table with eight separately placed chairs. The owner seat is empty.
- Two client armchairs, side table, two-seat sofa, coffee cabinet, two low shelves, four plants, project board, shared display and ENZTRONIC plaque.
- Instanced static box geometry grouped by material; a single shadow-casting light, demand rendering and DPR capped at 1.5 (1.0 in low quality).
- Fixed-yaw/tilt orthographic camera; projected-room fit plus 12% padding on canvas/inspector resize; target clamped to X=2–16, Z=2–11. Overview, selection focus, 0.8–2.5× zoom, pan controls, pointer pan/wheel zoom and optional route overlay.
- Approximately 450 ms camera focus, immediate under reduced motion. System reduced-motion preference is honored. Explicit motion, pause and quality controls remain ordinary HTML. Hidden/offscreen model animation is paused.
- Seven DOM selection buttons, matching the parent selected profile ID. Canvas loading has a 15-second failure limit. WebGL unavailable, renderer/model error and context loss display a useful fallback with low-quality retry while list/tasks remain available.

The graph helper finds routes only through the authored bidirectional waypoint graph. Automatic travel is deliberately absent from this blockout because there are no accepted rigs or tested docking transitions. A future movement integration must add destination/segment reservations, 0.65 m center separation, stand/clear/approach/walk/dock sequencing, valid event-driven destination changes and real GLB sweep/animation tests before enabling travel. The static-marker implementation does not claim those final movement checks passed.

## Repeatable geometry and inventory check

From `apps/backoffice`:

```powershell
node scripts/office-assets.mjs
node --test scripts/office-assets.test.mjs
```

The first command writes `docs/office/asset-status.json` and the generated runtime allowlist `src/components/office/scene-assets.generated.json`. It reads the private asset bundle and never installs software, exports models, changes the source handoff manifest or marks missing files as produced.

Current planning-box result: **41/41 nodes reachable**, 43 bidirectional edges, 36 obstacle boxes, five clear corridors and 15 desk/review anchors. Corridor/static-box overlaps, graph-segment/0.25 m-inflated-obstacle intersections, approach overlaps and reserved dock sweeps (excluding only the destination's chair) are all zero. One authored zero-length connection joins coincident `front_center` / `branch_review_clara` nodes; retained and reported as an observation. These are 2D authored-envelope checks, not real mesh, simultaneous-agent or animated limb acceptance.

Six Node tests cover the measured layout, deliberately moved obstacles, disconnected/mismatched anchors, segment/tangency behavior and incoming-bundle path containment, including a real Windows junction escape. Six offline scene-layout tests cover generated geometry staying within its obstacle envelopes, floor/desk heights, static instancing batch bound, model-class replacement, furniture counts and authored routes. Five Vitest route tests cover authorization-before-file-access, traversal/native-source denial, changed hashes, symlink escape and private approved-byte delivery. Targeted ESLint checks pass for the scene, layout, checker, asset route and tests. These tests do not establish the final performance targets.

**Browser verification update — 4 November 2026, Asia/Jakarta:** the measured graybox now renders in the same in-app browser in normal and low quality. Selecting Sam's scene label selects his profile. The earlier claim that this browser could not create a WebGL context was unsupported: the application's canvas fallback mounted an effect that reported failure even when canvas/WebGL was available. That effect was removed; genuine renderer failures still reach the error boundary, and retry now actually uses low quality. See [the preview fix and evidence](office/WEBGL-PREVIEW-FIX-2026-11-04.md), including remaining nonblocking development diagnostics.

This verifies the rendered graybox and the stated interactions. It does not approve any modeled asset or establish actual animated chair/desk clearance, context-loss recovery, hardware frame timing or final-model performance. Those target-device/model acceptance checks remain **pending**. No production model was promoted by this correction.

## Missing production deliverables

The inventory still finds **zero approved runtime models and all 15 required deliverables unmet at their canonical production paths** in the default private `office-assets` bundle. Newly authored unapproved files remain separately under `proof/`:

1. `assets/office/office-shell.glb` and editable shell source.
2. `assets/office/studio-furniture.glb` and editable reusable furniture source.
3. Seven separate rigged GLBs and native character sources: Adrian, Clara, Nadia, Leo, Lisa, Sam and Theo.
4. `source/office/common-biped-rig.blend`.
5. `source/office/common-animations.blend` with all seven semantic clips.
6. `source/office/textures-source.zip` and a texture/source index.
7. `assets/office/office-layout.runtime.json`, derived after actual mesh-bound acceptance.
8. `source/office/provenance-and-licenses.json` plus retained license documents.
9. `reports/office-asset-validation.json`, containing actual validator/model/browser/performance evidence.

The shell/furniture and seven characters each require approved native source; the numbered list groups the inventory's 15 entries. Required semantic clips are `idle_stand`, `walk`, `seated_idle`, `seated_work`, `sit_down`, `stand_up`, and `handoff_gesture`; all seven exist in the unapproved Sam proof. Technical rig/weight/timing/root checks are recorded for that proof, while final likeness, all-character shared-rig compatibility, natural deformation and actual chair/desk clearances remain pending. License/source rights are not invented.

Initial targeted checks found no preinstalled Blender in PATH or standard locations. The subsequent verified portable tool resolved that authoring limitation and produced the private proofs above. Set `OFFICE_BLENDER_EXECUTABLE` to its recorded absolute path when rerunning `npm run office:assets` to include that configured-tool check in the inventory. The owner files under `D:\Enztronic\employee` remain preserved.

## Adding actual assets later

Keep native sources and production bundles outside `public`. The runtime bundle root is fixed to `apps/backoffice/office-assets` so deployment file tracing stays within the private asset boundary. Preserve manifest-relative `assets/`, `source/` and `reports/` paths. The offline checker accepts `OFFICE_ASSET_ROOT` for inspecting an incoming bundle; approved runtime files must then be copied into the fixed private boundary and revalidated there before shipping a registry.

The checker inspects GLB 2.0 headers and JSON metadata, required named furniture/shell nodes, character skins/joint ceiling/extra weight sets, semantic clip names/durations, triangle/material metadata, external resource references and compression requirements. It does **not** replace the Khronos validator, DCC source review or browser acceptance. The initial loader accepts uncompressed, self-contained GLBs; Draco/KTX2/meshopt are blocked from approval until their decoders and existing CSP are separately tested. No CSP relaxation is included.

To generate a runtime allowlist entry, supply all missing requirements plus `reports/runtime-approval.json` with one entry per approved asset:

```json
{
  "assets": {
    "character_sam": {
      "sha256": "actual lowercase 64-character GLB SHA-256",
      "approved_for_runtime": true,
      "khronos_validator_report": "reports/sam-gltf-validator.json",
      "checks": {
        "geometry": true,
        "dimensions": true,
        "loader": true,
        "source_opened": true,
        "provenance_reviewed": true,
        "private_asset_route": true,
        "rig": true,
        "animations": true,
        "identity": true,
        "docks": true,
        "root_motion": true
      }
    }
  }
}
```

These booleans record completed review evidence; they must never be set merely to make the checker pass. The referenced Khronos report must exist and have `issues.numErrors: 0`. The exact bytes/hash, required native sources (including the shared rig/animation sources for characters), metadata checks and provenance must pass. The private provenance file uses `assets.<asset_id>` entries with `creator`, `license_name`, `license_document_filename`, `commercial_use_approved: true` and `edit_and_redistribute_approved: true`. Retain the license document under the bundle root and verify those rights with the owner.

Only generated allowlist entries can be served by `/api/office/assets?file=...`. This route reuses the existing administrator session authorization, verifies the canonical path stays inside the private root, rejects native sources and oversized/non-file responses, recomputes SHA-256, and responds `private, no-store`. Changing a GLB after approval yields an error until revalidation. No model fetch is attempted for a missing/unapproved model.

The optional loader clones character skeletons independently, supports the named reusable furniture nodes, preserves floorplan placement and can play `seated_idle` while unpaused. Each accepted character loads at its existing desk anchor. Static shell/furniture imports are now batched by material, geometry attributes and render properties, while sorted transparent/transmissive parts remain separate. Against the actual private environment proofs, 127 source material primitives become 13 batch meshes with unchanged 71,372 triangles and placed bounds. Fresh effect-owned buffers handle React StrictMode cleanup, and independently cloned skeleton textures are disposed without destroying shared GLTF resources. See `office/STATIC-MODEL-BATCHING.md` for focused transform, normal, winding, sorting and cleanup evidence. Counts are not GPU draw calls or hardware timing.

Since no model is production-approved, the intended browser's final-model loading, deformation and actual-device acceptance remain pending. The generated inventory report is an implementation status report and does not masquerade as the manifest's missing final asset-validation evidence.

## Final acceptance still required

Sam's native/rigged seven-clip proof precedes producing the remaining six characters. Actual mesh bounds must be within 0.02 m of the accepted envelopes, with explicit layout revisions when necessary. Test every chair and animation transition using the real models, then check identity and all seven independent skeletons in the intended browser.

Record actual hardware/GPU/driver, Chrome version, viewport and DPR; three cold/warm runs, 60-second idle/moving scenarios, repeated selection/focus and inspector resize, 15-minute resource observation and route-away/return cycles. Measure median/p95 frame time, draw calls, triangles, cold transfer and stalls. The final ≤250k triangles, ≤120 calls and ≤18 MB runtime targets are provisional and **unmeasured for final models**. No final rig, GLB, license/source or real-device performance milestone is marked complete.
