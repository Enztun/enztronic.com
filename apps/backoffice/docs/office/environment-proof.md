# Office shell and furniture production proof

This is an original, editable environment proof created locally on 22 October 2026. It is separate from the approved production bundle. The runtime allowlist, handoff manifest and floorplan have not been changed, and these proof GLBs are not approved or automatically served to the Office UI.

The shell contains the exact `FloorSlab`, `WallRear` and `WallLeftCutaway` nodes: an 18 × 13 m floor with its finished surface at Y=0, slab bottom at -0.25 m, 3.2 m rear wall and 1.1 m lowered left wall. The roof, front and right walls are absent. The furniture library contains all 16 independently reusable contract names, with floor-center pivots and applied transforms. Desk tops and chair seats are at 0.75 m and 0.47 m. Monitors/keyboard sets use the desk surface as their mounting origin; wall components use their bottom-center wall mounting origin. The shell retains the floorplan corner origin.

The style uses original softened oak tables and storage, navy and cobalt upholstery, powder-coated chair bases, ceramic pots and solid modeled foliage. The ENZTRONIC plaque uses manually authored geometric letter strokes; no external font or logo file was loaded. Review/project displays intentionally contain no invented business activity. No characters are included; Sam remains the separate first-character gate.

## Files and regeneration

All paths below are relative to `apps/backoffice/office-assets/proof`:

- `assets/office/office-shell.glb` and `assets/office/studio-furniture.glb`: self-contained, uncompressed glTF 2.0 binaries with portable constant PBR materials and no external texture references.
- `source/office/office-shell.blend` and `source/office/studio-furniture.blend`: editable mesh/native material sources. The furniture library places independent reusable components at their common local origin; isolate a named component in the Outliner to edit it.
- `source/office/office-shell.blend1` and `source/office/studio-furniture.blend1`: retained Blender-generated backups of earlier local proof iterations, authored by the same generator. They are historical backups; the current `.blend` files and their hashes in the report define the delivered source. Future generator runs disable version backups.
- `renders/environment-overview.png` and `renders/environment-desk-detail.png`: actual Cycles CPU renders of the exported GLBs imported back into Blender, with no substituted furniture.
- `reports/environment-production-proof.json`: native-source re-open checks, actual hashes, dimensions, per-node geometry counts, assembled floorplan bounds and render settings.
- `reports/environment-office-shell-khronos.json` and `reports/environment-studio-furniture-khronos.json`: official Khronos validator output, bound to each GLB hash.
- `reports/environment-three-loader.json`: actual headless Three.js GLTFLoader parsing, per-node bounds and primitive counts.

The editable generator is `apps/backoffice/scripts/office-modeling/build_office_environment.py`. Run from `apps/backoffice` with the verified portable Blender executable:

```powershell
& 'C:\Users\hoyec\.codex\tools\office-blender\blender-4.5.14-windows-x64\blender.exe' --background --factory-startup --threads 4 --python scripts/office-modeling/build_office_environment.py
```

It reads the existing floorplan/asset specification and writes only its own private environment proof assets, source files, renders and reports. It does not read database configuration, change registry approval, install services, download assets or publish anything. Blender uses the authoring conversion `(x, y, z) → (x, -z, y)` and its standard Y-up glTF export to produce the handoff's meters / +Y up / +Z rear coordinates. Export and source checks apply object transforms; scene placement uses floorplan yaw values.

The generator reopens both saved native files, checks bounds against the pre-save values, reimports the actual GLBs for the renders and places all 51 furniture/detail instances from the floorplan. It checks the actual obstacle mesh bounds against their authored envelopes within 0.02 m. These static box checks do not validate animated limbs, chair docking, simultaneous agents or a navigation capsule sweep.

## Evidence and remaining gates

The reports contain measured file sizes/counts rather than estimates. The official Khronos module and the application's installed Three loader run locally; successful headless parsing is not a working WebGL browser result. CPU render times, Cycles samples or desktop screenshots cannot establish the target browser frame-time, draw-call, transfer or memory results.

The completed generation run passed all specified component dimensions within 0.02 m, both native-file re-open/bounds checks and all assembled static obstacle envelope checks. Both GLBs have zero Khronos errors and warnings and parse through the installed Three loader. The shell is 4,684 bytes and the reusable library 577,312 bytes (581,996 bytes combined); the fully placed static room contains 71,372 triangles before characters. The two actual renders were visually inspected for layout, furniture orientation, clear floor space and sign/board facing.

No third-party meshes, textures, fonts or downloaded assets were used. Geometry, material constants and lettering are reproducible from the original generator. This provenance is recorded as implementation authorship; owner rights review and visual approval remain pending. No invented license document or commercial-use approval is asserted.

The unbatched source baseline is 127 static material primitives over 51 placed furniture/detail instances and three shell nodes, before characters. This counts exported geometry/material groups and is not a GPU draw-call measurement. Scene batching is being checked separately against these real files; its report must distinguish the resulting batch count from browser frame times and actual renderer statistics.

Production acceptance still requires owner visual/source review, real browser/GPU testing on recorded hardware, performance measurement with all seven accepted characters, and animation/docking/collision checks. No precise browser performance result is claimed.
