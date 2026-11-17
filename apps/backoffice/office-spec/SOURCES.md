# Sources and planning evidence

Prepared 21 October 2026. This file distinguishes current local inspection from references and proposals.

## Local source inspection

Repository D:\Enztronic, inspected read-only at HEAD cf2f976. Relevant private app apps/backoffice has Next.js 16.2.10 and React 19.2.7 in its current package metadata; the public root site uses Next 16.4.2/React 19.2.7. Recheck installed versions and Git state at implementation time.

Source paths and documented local Windows hosting boundaries are recorded in specs/integration-and-execution.md. No environment-file contents, credentials, live database state, browser account, production process or DNS state were used as evidence. employee/ was inventoried by filename/type/size only and left untouched.

## Existing delivered reference pack

outputs/enztronic-office-concept-v2 supplied seven portraits, two office/UI concept PNGs, personas and image prompts. They are copied here for self-contained review. These are generated raster references, not source 3D models or running software.

The newly proposed floorplan data, UI contracts and output presets are design decisions, not observations of an implemented system.

## Official technical references checked

- React Three Fiber introduction and React major compatibility: https://r3f.docs.pmnd.rs/getting-started/introduction
- React Three Fiber performance guidance: https://r3f.docs.pmnd.rs/advanced/scaling-performance
- Drei camera/control behavior: https://drei.docs.pmnd.rs/controls/introduction
- Three.js recommended model-loading workflow: https://threejs.org/manual/pages/loading-3d-models.html
- PostgreSQL 17 SELECT and row locking: https://www.postgresql.org/docs/17/sql-select.html

These establish library concepts and compatibility guidance, not measured performance of this office or correctness of an unwritten queue.

## Blender documentation boundary

The official Blender glTF manual URL was identified, but a fetch did not succeed during this handoff preparation: https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html

Use the documentation for the installed Blender exporter when assets are authored. Blender was not found on PATH in a lightweight availability check; this does not prove it is absent elsewhere on the machine. No installation, modeling or export was performed.

## Remaining evidence to gather during implementation

Actual model/texture/animation files and licenses; current package lock compatibility; exact target GPU/Chrome behavior; real worker startup/recovery; authorized database migration evidence; configured provider/tool availability and price metadata; real pilot output and production activation.

