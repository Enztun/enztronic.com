# Sam one-character technical and art proof

Status: **private, unapproved proof**. The production asset registry and canonical asset-manifest remain unchanged. This work advances the editable mesh, shared-compatible skeleton, embedded animation and export evidence; it does not accept the character's likeness, final art quality, all chair docks or GPU performance. The remaining six characters must wait for acceptance of this one-character proof.

The script `scripts/office-modeling/sam_proof.py` creates an actual editable mesh with a shaped face and nose, modeled eyes/lids/lips/ears, swept dark hair geometry, open navy overshirt, blue crewneck, trousers and shoes. It does not map Sam's portrait onto a plane. Shoulder, elbow and knee areas have deforming weights. The model is a deliberately simplified interpretation of the supplied fictional Sam reference. Its generic face, simplified hair cap, shoulder/hip transitions and cloth deformation still need an experienced art/deformation review before any production claim.

## Private proof files

All paths below are relative to `apps/backoffice/office-assets/proof`, outside public assets and outside the production runtime allowlist.

| File | Purpose |
|---|---|
| `assets/office/characters/sam.glb` | Uncompressed self-contained glTF 2.0 binary, one skin, all seven embedded clips |
| `source/office/characters/sam.blend` | Editable character mesh, colors, weights, FK skeleton, A-pose and actions |
| `source/office/common-biped-rig.blend` | Independently openable proof skeleton source with Sam mesh for deformation inspection |
| `source/office/common-animations.blend` | Independently openable seven-action library source with Sam mesh for reference |
| `source/office/common-biped-bone-map.json` | Rest bone heads/tails, names, parents, axes and retargeting instructions |
| `source/office/material-and-source-index.json` | Authored vertex colors, three portable PBR materials, no texture files |
| `source/office/sam-proof-render-stage.blend` | CPU render setup and actual mesh; stage props are proof measurements, not final furniture |
| `reports/sam-authoring-metadata.json` | Actual counts, hash, clip timing, sampled deformed bounds and explicit limits |
| `reports/*-source-reopen.json` | Fresh Blender inspection of the three independently saved native sources |
| `reports/khronos-validator.json` | Official validator output against actual exported bytes |
| `reports/runtime-technical-proof.json` | Headless Three.js loader, weights, independent skeleton clones, clips and bounds checks |
| `renders/sam-turntable-{front,left,rear,right}.png` | Actual Blender Cycles CPU renders, not application screenshots |
| `renders/sam-face-three-quarter.png` | Modeled face/hair art-review closeup |
| `renders/sam-seated-desk-proof.png` | Actual skin pose against a 0.47 m seat and 0.75 m desk |
| `renders/sam-seven-clips-contact-sheet.png` | Seven actual sampled poses in one Blender render |

Initial preview renders and their separately named native review source are retained as iteration evidence. They predate the final proof mesh and must not be used as final-byte acceptance evidence.

## Measured technical result

The authored mesh has **11,299 triangles, 5,861 vertices, three materials, 22 exported bones, one skin and at most two influences per vertex**. No bitmap textures, external model files, downloaded rig or paid asset are used. Blender is the official portable 4.5.14 LTS binary verified by the implementation owner. Its ZIP SHA-256 is `b9533d2397ac1984db4466fb23a7a4649391cca93f6e84209f9bcc60d071c8b9`.

Native Blender units are meters, Z-up and -Y forward. The GLB is right-handed, Y-up and +Z forward. `root` is fixed at the floor origin; `pelvis` lowers the body for sitting. Applied mesh/armature object scales are one. Skin weights are normalized. The native rig uses named FK pose bones as controls and retains its editable common A-pose through Armature Data → Pose Position → Rest Position. No external auto-rig add-on is required. The proof animation/rig files retain Sam's mesh to make source inspection useful; a final cross-character retargeting workflow remains pending.

| Clip | Actual duration | Policy |
|---|---:|---|
| `idle_stand` | 3 s | Loop, fixed floor root |
| `walk` | 1 s | In-place loop; 0.4 m planted stride per 0.5 s is authored for 0.8 m/s navigation |
| `seated_idle` | 4 s | Loop; measured proof seat is 0.47 m |
| `seated_work` | 4 s | Loop; modest hand motion above proof desk |
| `sit_down` | 1.25 s | Once; vertical pelvis lowering, fixed floor root |
| `stand_up` | 1.25 s | Once; reverse sit transition |
| `handoff_gesture` | 2 s | Once; restrained right-arm gesture |

Source and exported clip counts, root drift and floor bounds are checked using actual files. Validator/headless loader results are in the JSON reports. A successful parse or zero root drift is not proof of natural gait, seated balance or collision-free transitions. In particular, the sit/stand proof repositions feet as the knees bend; it needs a planted-foot docking revision and transition review before production movement can be enabled. All actual room chair anchors, chair/table collisions, hand placement, sleeve/shoulder deformation, identity and animation crossfades remain pending.

The walk-only pelvis is lowered 0.026 m so the feet can reach the planted stride without stretching straight legs. A fresh-source check samples 50 actual FK ankle positions against the authored stride and finds a maximum target error below 0.000006 m. This confirms the source ankle solve; it does not accept browser shoe-ground contact or natural gait appearance.

## Reproduction and review

From `D:\Enztronic\apps\backoffice`:

```powershell
& 'C:\Users\hoyec\.codex\tools\office-blender\blender-4.5.14-windows-x64\blender.exe' --background --factory-startup --python scripts/office-modeling/sam_proof.py
node scripts/office-proof-validation.mjs assets/office/characters/sam.glb
& 'C:\Users\hoyec\.codex\tools\office-blender\blender-4.5.14-windows-x64\blender.exe' --background office-assets/proof/source/office/characters/sam.blend --python scripts/office-modeling/inspect_sam_source.py
```

`-- --preview-only` writes initial source/standing/face review renders. `-- --skip-renders` regenerates native/export/metadata without spending CPU time on unchanged image geometry. All Blender renders use Cycles on CPU with 32 samples and denoising. No image-editing package, image generator, portrait texture or external mesh contributes to these proof images.

The contact sheet shows the same Sam mesh repeated at different clips. It is not a seven-person office or a screenshot of live work. The front row, left to right, samples `idle_stand`, `walk`, `handoff_gesture`, `sit_down`; the back row samples `seated_idle`, `seated_work`, `stand_up`.

## Gates still open

- Human acceptance of Sam's recognizable fictional identity and coherent studio art quality.
- Natural deformation, planted feet, chair/desk hand clearances and all real room docks, including clip-boundary blends.
- Owner review of source/reference rights. Geometry, rig and animation are newly authored here; no third-party commercial rights or license grant is fabricated.
- A functioning browser WebGL/GPU loader and actual hardware-specific measurements. The available in-app browser cannot create a WebGL context; headless Three.js skin evaluation and CPU Blender renders do not establish draw calls, frame timing, transfer timing or GPU reliability.
- Final common-rig acceptance before authoring the other six characters, followed by the complete environment and production asset pipeline.

No runtime approval JSON, generated allowlist entry, canonical production Sam path or production manifest status is granted by this proof.
