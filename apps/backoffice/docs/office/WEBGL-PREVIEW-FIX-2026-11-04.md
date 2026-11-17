# Office preview: false WebGL failure corrected

4 November 2026, Asia/Jakarta. Local fixture preview: <http://127.0.0.1:3118/team>. This is a correction to the earlier browser capability diagnosis, not production activation or final modeled-asset acceptance.

## Cause and change

The installed React Three Fiber 9.8.2 renders its `Canvas` fallback as ordinary React children inside the canvas element, including when WebGL works. The previous `WebGLUnavailable` fallback component called the parent's failure callback from an effect. That effect ran in a working browser and caused the application to remove the scene and show “WebGL is unavailable.” The old fallback screenshot therefore did not establish missing browser graphics support.

`OfficeScene.tsx` now supplies inert accessible fallback text. Real renderer initialization errors still propagate through Fiber to the scene error boundary. Known Three.js WebGL initialization errors receive specific WebGL 2 guidance; other scene errors retain the general accessible fallback. The parent retry now explicitly selects low quality before remounting. Normal-quality shadows explicitly use supported `PCFShadowMap`, avoiding Three r186's deprecated soft-shadow setting.

Installed-source references used to establish behavior: `node_modules/@react-three/fiber/dist/react-three-fiber.esm.js` (Canvas fallback and renderer configure error handling), `node_modules/three/src/renderers/WebGLRenderer.js` (initialization error messages), and `node_modules/@react-three/drei/web/Html.js` (remaining development diagnostics). No installed dependency was edited.

## Verification on the restored local preview

The same ChatGPT in-app browser that previously showed the failure now displays the genuine measured Three.js graybox. This is rendered geometry, not a screenshot used as the scene.

- Clean page reload produced one `canvas`, with `data-engine="three.js r186"` and a 794 × 480 drawing surface in the observed viewport. The graphics-unavailable message was absent.
- Normal and low quality both rendered. Switching quality remounted the renderer successfully.
- Selecting Sam's label inside the scene selected Sam's roster entry and profile inspector.
- Overview returned the camera to the room view. Tasks → Office remounted the scene successfully, and Sam selection worked again after the remount.
- Focused ESLint and full TypeScript checks passed. The two scene-layout/static-batching suites passed **17/17 tests**. These checks do not exercise a GPU by themselves; the browser checks above provide the visual evidence.
- An isolated optimized production build passed with `OFFICE_BUILD_DIR=.next-office-check npm run build -- --webpack`, including TypeScript, static generation and tracing. The first default-builder attempt could not fetch existing Google Fonts within restricted network access. A subsequent Turbopack attempt failed when its CSS-transform subprocess exited before connection. The supported Webpack build succeeded; no builder setting or dependency was changed in source.

Before: [false failure screenshot](screenshots/webgl-before-20261104.png).

After: [rendered normal-quality room with Sam selected](screenshots/webgl-after-20261104.png).

## Remaining limits

Development console output is not clean. On a fresh render, eight React warnings report synchronous nested-root unmounts, corresponding to the seven profile labels and plaque rendered with Drei `Html`. Its cleanup calls a nested ReactDOM root's `unmount()` during development StrictMode effect replay. React logs this warning and continues cleanup; the observed scene and label interactions worked. A possible transient label cleanup race has not been ruled out. There is also an upstream `THREE.Clock` deprecation warning. StrictMode and diagnostics remain enabled; dependency code was not patched or suppressed.

The runtime model registry remains empty. This proof covers the measured graybox and geometric identity markers. Seven final rigged characters, approved furniture/room models, deformation/docking, context-loss recovery on a working GPU, mobile/device coverage, frame timings and target hardware performance remain pending. Separate native/GLB technical proofs have not been promoted by this change.

The restored services use only the preserved loopback fixture database and limited deterministic demo worker. No fixture reset, migration, new task submission, production database write, owner-access change, business-record change, paid provider call, production restart, push or deployment was performed for this fix. Existing `.next` production output was preserved; verification and preview outputs use their separate directories. The preview requires this PC and its local processes to remain available.
