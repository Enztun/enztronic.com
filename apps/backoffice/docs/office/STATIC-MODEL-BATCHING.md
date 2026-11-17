# Static imported model batching

Verified locally on 22 October 2026 (Asia/Jakarta). Static shell/furniture loading now bakes the authored subtree transforms and measured floorplan placements into shared-material geometry batches. Rigged characters retain their independent skeleton/animation/selection path. No private proof model was promoted and the generated production registry remains empty.

## Evidence

The optional private environment proof was parsed with the installed Three.js GLTFLoader and placed through the same 51 furniture/detail placements plus one shell root used by the scene:

| Measure | Before | Batched |
|---|---:|---:|
| Static material primitives/meshes | 127 | 13 |
| Triangles | 71,372 | 71,372 |
| Authored placements | 52 | 52 |

Placed minimum/maximum bounds match the previous subtree-clone implementation within 0.00001 m. This is offline source geometry/count evidence. It is **not** a measured GPU draw-call, frame-rate, complete-scene budget or browser acceptance result.

The measured private candidates, unchanged by batching, are:

| File under `office-assets/proof/assets/office/` | SHA-256 |
|---|---|
| `office-shell.glb` | `0920c07285a0165b3a23f409187d98c87a7e8bcc4f8d390528ed41e182ff51e6` |
| `studio-furniture.glb` | `c4683fdf8d17f726c9fb3180c2121811c989fc62864fb52df568a8d46e67c353` |

## Validation and ownership

`npx vitest run src/components/office/scene-static-batch.test.ts src/components/office/scene-layout.test.ts --reporter=verbose` passed **17 tests**: ten synthetic batching cases, one optional actual-candidate case and six existing layout cases. The private-candidate case skips when the GLBs are absent; the synthetic checks run in a clean source checkout. Focused ESLint and backoffice `npm run typecheck` passed after the final change.

Tests cover indexed expansion, nested/nonuniform transforms, inverse-transpose normals, mirrored winding/tangent handedness, normalized attributes, named-subtree semantics, material groups/draw ranges, render-property partitions, transparent/transmissive sorting, unsupported input rejection and generated-only buffer disposal. They also compare the actual proof triangle count and placed bounds against the previous clone arrangement.

React StrictMode layout-effect setup creates and attaches a fresh batch, then removes/disposes that exact batch on cleanup. Cached GLTF geometry/materials/textures are retained. Character clones dispose only their owned skeleton/bone textures; `Skeleton.dispose()` clears its texture so cleanup replay can safely precede a later upload.

## Limits

- Batching expands indexed geometry into static buffers, trading additional buffer memory and coarser material-batch culling for fewer static submissions. Browser memory, complete-scene render passes, shadows and GPU performance still require measurement.
- Transparent and physical-transmission primitives stay separate. Each retains its original transformed whole-mesh sort-sphere center, including asymmetric, nonuniformly scaled multi-material meshes.
- Skinned, instanced, morph-target, custom-shader and unsupported scene nodes fail through the existing useful renderer/List fallback rather than being silently flattened. Character assets never enter this static helper.
- Production approval, visual/model review and functioning browser/GPU verification remain separate gates. The graybox remains active while no runtime models are approved.
