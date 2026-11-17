import { Box3, BufferAttribute, BufferGeometry, Group, Material, Matrix4, Mesh, Object3D, Quaternion, Sphere, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type StaticPlacement = { id: string; source: Object3D; position?: readonly [number, number, number]; yaw?: number };
type Primitive = { geometry: BufferGeometry; material: Material; source: Mesh; placementId: string };
type Batch = { primitives: Primitive[]; material: Material; source: Mesh; sortOrigin?: Vector3; sortCenter?: Vector3 };

function sourceSphereCenter(geometry: BufferGeometry) {
  if (geometry.boundingSphere) return geometry.boundingSphere.center.clone();
  const bounds = new Box3(), point = new Vector3(), position = geometry.getAttribute('position');
  for (let vertex = 0; vertex < position.count; vertex++) bounds.expandByPoint(point.fromBufferAttribute(position, vertex));
  return bounds.getCenter(new Vector3());
}

/** Bake only static model copies. Cached GLTF geometry/materials and characters remain untouched. */
export function batchOfficeStaticModels(placements: readonly StaticPlacement[]) {
  const group = new Group();
  group.name = 'OfficeStaticMaterialBatches';
  const batches = new Map<string, Batch>();
  const ownedGeometries: BufferGeometry[] = [];
  let primitiveCount = 0;
  let triangleCount = 0;

  function addMesh(source: Mesh, matrix: Matrix4, placementId: string) {
    if ('isSkinnedMesh' in source || 'isInstancedMesh' in source || Object.keys(source.geometry.morphAttributes).length
      || source.customDepthMaterial || source.customDistanceMaterial) {
      throw new Error('Office static batching requires unskinned, non-instanced geometry without morph targets.');
    }
    const geometry = source.geometry;
    const position = geometry.getAttribute('position');
    if (!position || position.itemSize !== 3) throw new Error('Office static model is missing triangle positions.');
    const count = geometry.index?.count ?? position.count;
    const drawStart = Math.max(0, geometry.drawRange.start);
    const drawEnd = Math.min(count, drawStart + geometry.drawRange.count);
    const materials = source.material;
    const sections = Array.isArray(materials)
      ? geometry.groups.map(section => ({ start: section.start, end: section.start + section.count, material: materials[section.materialIndex ?? 0] }))
      : [{ start: 0, end: count, material: materials }];
    for (const section of sections) {
      const start = Math.max(drawStart, section.start);
      const end = Math.min(drawEnd, section.end);
      const vertices = Math.floor((end - start) / 3) * 3;
      if (vertices <= 0) continue;
      if (!section.material) throw new Error('Office static geometry references a missing material.');
      if (!section.material.visible) continue;
      if ('isShaderMaterial' in section.material || section.material.onBeforeCompile !== Material.prototype.onBeforeCompile) throw new Error('Office static batching does not support custom material shaders.');
      const depthSorted = section.material.transparent || ('transmission' in section.material && typeof section.material.transmission === 'number' && section.material.transmission > 0);
      const baked = new BufferGeometry();
      try {
        for (const [name, attribute] of Object.entries(geometry.attributes)) {
          // Expand indexed/interleaved attributes without mutating the cache. Float positions,
          // normals and tangents retain correct world values even for quantized source GLTFs.
          const transformed = ['position', 'normal', 'tangent'].includes(name);
          const ArrayType = attribute.array.constructor as { new(length: number): typeof attribute.array };
          const data = transformed ? new Float32Array(vertices * attribute.itemSize) : new ArrayType(vertices * attribute.itemSize);
          const copy = new BufferAttribute(data, attribute.itemSize, transformed ? false : attribute.normalized);
          if ('gpuType' in attribute) copy.gpuType = attribute.gpuType;
          for (let vertex = 0; vertex < vertices; vertex++) {
            const sourceVertex = geometry.index ? geometry.index.getX(start + vertex) : start + vertex;
            if (sourceVertex < 0 || sourceVertex >= attribute.count) throw new Error('Office static geometry contains an invalid attribute index.');
            for (let component = 0; component < attribute.itemSize; component++) {
              const value = attribute.getComponent(sourceVertex, component);
              if (!Number.isFinite(value)) throw new Error('Office static geometry contains a nonfinite attribute.');
              copy.setComponent(vertex, component, value);
            }
          }
          baked.setAttribute(name, copy);
        }
        baked.applyMatrix4(matrix);
        // A reflected Object3D normally changes GL front-face state. Baked geometry has an
        // identity transform, so reverse each triangle and preserve tangent handedness instead.
        if (matrix.determinant() < 0) {
          for (const attribute of Object.values(baked.attributes)) {
            for (let vertex = 0; vertex < vertices; vertex += 3) {
              for (let component = 0; component < attribute.itemSize; component++) {
                const value = attribute.getComponent(vertex + 1, component);
                attribute.setComponent(vertex + 1, component, attribute.getComponent(vertex + 2, component));
                attribute.setComponent(vertex + 2, component, value);
              }
            }
          }
          const tangent = baked.getAttribute('tangent');
          if (tangent?.itemSize === 4) for (let vertex = 0; vertex < vertices; vertex++) tangent.setW(vertex, -tangent.getW(vertex));
        }
        const signature = Object.entries(baked.attributes).sort(([a], [b]) => a.localeCompare(b)).map(([name, attribute]) =>
          `${name}:${attribute.itemSize}:${attribute.array.constructor.name}:${attribute.normalized}:${'gpuType' in attribute ? attribute.gpuType : ''}`).join('|');
        // Transparent and physical-transmission objects have separate depth-sorted render lists.
        const key = `${section.material.uuid}|${signature}|${source.castShadow}|${source.receiveShadow}|${source.renderOrder}|${source.layers.mask}${depthSorted ? `|depth-sorted:${primitiveCount}` : ''}`;
        let batch = batches.get(key);
        if (!batch) {
          const sortOrigin = depthSorted ? new Vector3().setFromMatrixPosition(matrix) : undefined;
          // Three sorts meshes by their transformed geometry-sphere center. Keep the ORIGINAL
          // whole-mesh center for every material section, even with rotation/nonuniform scale.
          const sortCenter = sortOrigin ? sourceSphereCenter(geometry).applyMatrix4(matrix).sub(sortOrigin) : undefined;
          batch = { primitives: [], material: section.material, source, sortOrigin, sortCenter };
          batches.set(key, batch);
        }
        batch.primitives.push({ geometry: baked, material: section.material, source, placementId });
        ownedGeometries.push(baked);
        primitiveCount++;
        triangleCount += vertices / 3;
      } catch (error) { baked.dispose(); throw error; }
    }
  }

  function visit(source: Object3D, parent: Matrix4, placementId: string) {
    if (!source.visible) return;
    if ('isLine' in source || 'isPoints' in source || 'isSprite' in source || 'isLight' in source || 'isCamera' in source || 'isBone' in source) throw new Error('Office static batching does not support this model node type.');
    // Match cloning a selected named subtree: include its own local transform and children,
    // excluding ancestors in the reusable furniture library.
    const local = source.matrixAutoUpdate ? new Matrix4().compose(source.position, source.quaternion, source.scale) : source.matrix;
    const matrix = new Matrix4().multiplyMatrices(parent, local);
    if (!matrix.elements.every(Number.isFinite) || matrix.determinant() === 0) throw new Error('Office static model contains an invalid transform.');
    if (source instanceof Group && source.renderOrder !== 0) throw new Error('Office static batching does not support custom group render order.');
    if (source instanceof Mesh) addMesh(source, matrix, placementId);
    for (const child of source.children) visit(child, matrix, placementId);
  }

  try {
    for (const placement of placements) {
      const transform = new Matrix4().compose(new Vector3(...(placement.position ?? [0, 0, 0])), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), placement.yaw ?? 0), new Vector3(1, 1, 1));
      visit(placement.source, transform, placement.id);
    }
    for (const batch of batches.values()) {
      const geometry = mergeGeometries(batch.primitives.map(primitive => primitive.geometry), false);
      if (!geometry) throw new Error('Office static geometry attributes could not be merged safely.');
      ownedGeometries.push(geometry);
      if (batch.sortOrigin) geometry.translate(-batch.sortOrigin.x, -batch.sortOrigin.y, -batch.sortOrigin.z);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      if (batch.sortCenter) {
        let radiusSquared = 0;
        const point = new Vector3(), position = geometry.getAttribute('position');
        for (let vertex = 0; vertex < position.count; vertex++) radiusSquared = Math.max(radiusSquared, point.fromBufferAttribute(position, vertex).distanceToSquared(batch.sortCenter));
        geometry.boundingSphere = new Sphere(batch.sortCenter, Math.sqrt(radiusSquared));
      }
      const mesh = new Mesh(geometry, batch.material);
      mesh.name = `OfficeStaticBatch_${group.children.length}`;
      mesh.castShadow = batch.source.castShadow; mesh.receiveShadow = batch.source.receiveShadow;
      mesh.renderOrder = batch.source.renderOrder; mesh.layers.mask = batch.source.layers.mask;
      if (batch.sortOrigin) mesh.position.copy(batch.sortOrigin);
      let firstVertex = 0;
      mesh.userData.officeStaticSources = batch.primitives.map(primitive => {
        const count = primitive.geometry.getAttribute('position').count;
        const range = { placementId: primitive.placementId, firstVertex, count };
        firstVertex += count;
        return range;
      });
      group.add(mesh);
    }
    // Temporary expanded primitives were never uploaded; retain only final merged geometry.
    const finalGeometry = new Set(group.children.map(child => (child as Mesh).geometry));
    for (const geometry of ownedGeometries) if (!finalGeometry.has(geometry)) geometry.dispose();
    return {
      group,
      stats: { placements: placements.length, sourcePrimitives: primitiveCount, materialBatches: group.children.length, triangles: triangleCount },
      dispose() { for (const geometry of finalGeometry) geometry.dispose(); },
    };
  } catch (error) { for (const geometry of ownedGeometries) geometry.dispose(); throw error; }
}
