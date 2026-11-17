import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix3, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, ShaderMaterial, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { batchOfficeStaticModels, type StaticPlacement } from './scene-static-batch';
import { makeFurnitureInstances } from './scene-layout';

function triangle() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  return geometry;
}
function local(object: Group | Mesh) { return new Matrix4().compose(object.position, object.quaternion, object.scale); }
function closeVector(actual: Vector3, expected: Vector3) {
  expect(actual.x).toBeCloseTo(expected.x, 5); expect(actual.y).toBeCloseTo(expected.y, 5); expect(actual.z).toBeCloseTo(expected.z, 5);
}
function batchBounds(object: Group) { return new Box3().setFromObject(object); }

describe('static imported office material batching without WebGL', () => {
  it('reduces repeated indexed geometry to one shared-material mesh without losing vertices or source ranges', () => {
    const geometry = new BoxGeometry(1, 1, 1), material = new MeshStandardMaterial();
    const source = new Mesh(geometry, material);
    const placements: StaticPlacement[] = [0, 2, 4].map(x => ({ id: `desk-${x}`, source, position: [x, 0, 0] }));
    const batch = batchOfficeStaticModels(placements);
    expect(batch.stats).toEqual({ placements: 3, sourcePrimitives: 3, materialBatches: 1, triangles: 36 });
    const merged = batch.group.children[0] as Mesh;
    expect(merged.geometry.getAttribute('position').count).toBe(108);
    expect(merged.geometry.getAttribute('uv').count).toBe(108);
    expect(merged.material).toBe(material);
    expect(merged.userData.officeStaticSources).toEqual([
      { placementId: 'desk-0', firstVertex: 0, count: 36 }, { placementId: 'desk-2', firstVertex: 36, count: 36 }, { placementId: 'desk-4', firstVertex: 72, count: 36 },
    ]);
    closeVector(batchBounds(batch.group).min, new Vector3(-0.5, -0.5, -0.5));
    closeVector(batchBounds(batch.group).max, new Vector3(4.5, 0.5, 0.5));
    expect(geometry.index?.count).toBe(36); expect(geometry.getAttribute('position').count).toBe(24);
    batch.dispose(); geometry.dispose(); material.dispose();
  });

  it('bakes nested local transforms and floorplan yaw while preserving inverse-transpose normals and source buffers', () => {
    const root = new Group(), child = new Group();
    root.position.set(1, 2, 3); root.rotation.set(0.2, 0.4, 0.1); root.scale.set(2, 1, 0.5);
    child.position.set(0.2, 0.1, 0.3); child.rotation.z = 0.4;
    const geometry = triangle(), material = new MeshStandardMaterial();
    geometry.setAttribute('color', new BufferAttribute(new Uint8Array([255, 0, 128, 0, 255, 0, 0, 0, 255]), 3, true));
    const mesh = new Mesh(geometry, material); mesh.position.set(0, 0.5, 0); child.add(mesh); root.add(child);
    const original = Array.from(geometry.getAttribute('position').array);
    const expected = new Matrix4().compose(new Vector3(8, 0, 4), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), new Vector3(1, 1, 1)).multiply(local(root)).multiply(local(child)).multiply(local(mesh));
    const batch = batchOfficeStaticModels([{ id: 'nested', source: root, position: [8, 0, 4], yaw: Math.PI / 2 }]);
    const baked = (batch.group.children[0] as Mesh).geometry;
    for (let vertex = 0; vertex < 3; vertex++) {
      closeVector(new Vector3().fromBufferAttribute(baked.getAttribute('position'), vertex), new Vector3().fromBufferAttribute(geometry.getAttribute('position'), vertex).applyMatrix4(expected));
      closeVector(new Vector3().fromBufferAttribute(baked.getAttribute('normal'), vertex), new Vector3(0, 0, 1).applyMatrix3(new Matrix3().getNormalMatrix(expected)).normalize());
    }
    expect(Array.from(baked.getAttribute('color').array)).toEqual(Array.from(geometry.getAttribute('color').array));
    expect(Array.from(baked.getAttribute('uv').array)).toEqual(Array.from(geometry.getAttribute('uv').array));
    expect(Array.from(geometry.getAttribute('position').array)).toEqual(original);
    expect(root.parent).toBeNull(); expect(mesh.parent).toBe(child); expect(root.matrix.elements).toEqual(new Matrix4().elements);
    batch.dispose(); geometry.dispose(); material.dispose();
  });

  it('matches named-subtree cloning instead of applying unused furniture-library ancestors', () => {
    const library = new Group(), template = new Group(); library.position.set(100, 100, 100); template.position.set(0, 1, 0);
    const geometry = triangle(), material = new MeshStandardMaterial(); template.add(new Mesh(geometry, material)); library.add(template);
    const batch = batchOfficeStaticModels([{ id: 'chair', source: template, position: [4, 0, 2], yaw: Math.PI }]);
    closeVector(batchBounds(batch.group).min, new Vector3(3, 1, 2));
    closeVector(batchBounds(batch.group).max, new Vector3(4, 2, 2));
    batch.dispose(); geometry.dispose(); material.dispose();
  });

  it('keeps mirrored front faces and tangent handedness consistent with transformed normals', () => {
    const geometry = triangle(), material = new MeshStandardMaterial();
    geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
    const source = new Mesh(geometry, material); source.scale.x = -1;
    const batch = batchOfficeStaticModels([{ id: 'mirrored', source }]);
    const baked = (batch.group.children[0] as Mesh).geometry;
    const vertices = [0, 1, 2].map(index => new Vector3().fromBufferAttribute(baked.getAttribute('position'), index));
    const cross = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize();
    closeVector(cross, new Vector3().fromBufferAttribute(baked.getAttribute('normal'), 0));
    expect(baked.getAttribute('tangent').getW(0)).toBe(-1);
    expect(geometry.getAttribute('tangent').getW(0)).toBe(1);
    batch.dispose(); geometry.dispose(); material.dispose();
  });

  it('preserves multi-material sections and draw ranges instead of merging their colors together', () => {
    const geometry = new BoxGeometry(), red = new MeshStandardMaterial({ color: 'red' }), blue = new MeshStandardMaterial({ color: 'blue' });
    const source = new Mesh(geometry, [red, blue, red, blue, red, blue]);
    const complete = batchOfficeStaticModels([{ id: 'cabinet', source }]);
    expect(complete.stats.sourcePrimitives).toBe(6); expect(complete.stats.materialBatches).toBe(2); expect(complete.stats.triangles).toBe(12);
    expect(complete.group.children.map(child => (child as Mesh).material)).toEqual([red, blue]);
    geometry.setDrawRange(6, 6);
    const range = batchOfficeStaticModels([{ id: 'cabinet-face', source }]);
    expect(range.stats).toMatchObject({ sourcePrimitives: 1, materialBatches: 1, triangles: 2 });
    expect((range.group.children[0] as Mesh).material).toBe(blue);
    complete.dispose(); range.dispose(); geometry.dispose(); red.dispose(); blue.dispose();
  });

  it('keeps incompatible attributes and render properties separate, and preserves transparent sort origins', () => {
    const geometry = triangle(), plain = triangle(), material = new MeshStandardMaterial(); plain.deleteAttribute('uv');
    const a = new Mesh(geometry, material), b = new Mesh(plain, material), c = new Mesh(geometry, material); c.castShadow = true; c.renderOrder = 2; c.layers.set(1);
    const batch = batchOfficeStaticModels([{ id: 'a', source: a }, { id: 'b', source: b }, { id: 'c', source: c }]);
    expect(batch.stats.materialBatches).toBe(3);
    const last = batch.group.children[2] as Mesh; expect(last.castShadow).toBe(true); expect(last.renderOrder).toBe(2); expect(last.layers.mask).toBe(2);
    const glass = new MeshStandardMaterial({ transparent: true, opacity: 0.5 });
    const transparent = new Mesh(geometry, glass);
    const separate = batchOfficeStaticModels([{ id: 'front', source: transparent, position: [1, 0, 2] }, { id: 'rear', source: transparent, position: [1, 0, 5] }]);
    expect(separate.stats.materialBatches).toBe(2);
    expect(separate.group.children.map(mesh => mesh.position.z)).toEqual([2, 5]);
    closeVector(batchBounds(separate.group).min, new Vector3(1, 0, 2)); closeVector(batchBounds(separate.group).max, new Vector3(2, 1, 5));
    batch.dispose(); separate.dispose(); geometry.dispose(); plain.dispose(); material.dispose(); glass.dispose();
  });

  it('skips hidden trees and rejects skinned, instanced, morph or custom-shader inputs for useful fallback', () => {
    const geometry = triangle(), material = new MeshStandardMaterial(), shader = new ShaderMaterial();
    const hidden = new Group(); hidden.visible = false; hidden.add(new Mesh(geometry, material));
    const empty = batchOfficeStaticModels([{ id: 'hidden', source: hidden }]); expect(empty.stats.sourcePrimitives).toBe(0); empty.dispose();
    for (const source of [new SkinnedMesh(geometry, material), new InstancedMesh(geometry, material, 1), new Mesh(geometry, shader)]) {
      expect(() => batchOfficeStaticModels([{ id: 'unsupported', source }])).toThrow(/static batching/);
    }
    const morph = geometry.clone(); morph.morphAttributes.position = [geometry.getAttribute('position').clone()];
    expect(() => batchOfficeStaticModels([{ id: 'morph', source: new Mesh(morph, material) }])).toThrow(/static batching/);
    const invalid = new Mesh(geometry, material); invalid.position.x = Infinity;
    expect(() => batchOfficeStaticModels([{ id: 'invalid', source: invalid }])).toThrow(/invalid transform/);
    geometry.dispose(); morph.dispose(); material.dispose(); shader.dispose();
  });

  it('retains separate sort origins for physical transmission even when transparent is false', () => {
    const geometry = triangle(), material = new MeshPhysicalMaterial({ transmission: 1, transparent: false });
    const source = new Mesh(geometry, material);
    const batch = batchOfficeStaticModels([{ id: 'near-glass', source, position: [0, 0, 1] }, { id: 'far-glass', source, position: [0, 0, 7] }]);
    expect(batch.stats.materialBatches).toBe(2);
    expect(batch.group.children.map(mesh => mesh.position.z)).toEqual([1, 7]);
    expect(batch.group.children.every(mesh => (mesh as Mesh).material === material)).toBe(true);
    closeVector(batchBounds(batch.group).min, new Vector3(0, 0, 1)); closeVector(batchBounds(batch.group).max, new Vector3(1, 1, 7));
    batch.dispose(); geometry.dispose(); material.dispose();
  });

  it('preserves the renderer sort sphere center across asymmetric transformed multi-material glass sections', () => {
    const geometry = new BoxGeometry(1, 2, 3); geometry.translate(3, 1, 0);
    const material = new MeshPhysicalMaterial({ transmission: 1 });
    const source = new Mesh(geometry, Array.from({ length: 6 }, () => material));
    source.position.set(0.2, 0.5, -1); source.rotation.set(0.2, 0.7, 0.1); source.scale.set(2, 1, 0.5);
    const placement = new Matrix4().compose(new Vector3(4, 0, 8), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.6), new Vector3(1, 1, 1));
    const sphereCopy = geometry.clone(); sphereCopy.computeBoundingSphere();
    const expectedCenter = sphereCopy.boundingSphere!.center.clone().applyMatrix4(placement.multiply(local(source)));
    sphereCopy.dispose();
    const batch = batchOfficeStaticModels([{ id: 'glass-sections', source, position: [4, 0, 8], yaw: 0.6 }]);
    expect(batch.stats.materialBatches).toBe(6); batch.group.updateMatrixWorld(true);
    for (const child of batch.group.children) {
      const mesh = child as Mesh, sphere = mesh.geometry.boundingSphere!;
      closeVector(sphere.center.clone().applyMatrix4(mesh.matrixWorld), expectedCenter);
      const position = mesh.geometry.getAttribute('position');
      for (let vertex = 0; vertex < position.count; vertex++) expect(new Vector3().fromBufferAttribute(position, vertex).distanceTo(sphere.center)).toBeLessThanOrEqual(sphere.radius + 1e-8);
    }
    expect(geometry.boundingSphere).toBeNull();
    batch.dispose(); geometry.dispose(); material.dispose();
  });

  it('disposes generated buffers without disposing shared cache geometry or materials', () => {
    const geometry = triangle(), material = new MeshStandardMaterial();
    let sourceDisposals = 0, materialDisposals = 0, generatedDisposals = 0;
    geometry.addEventListener('dispose', () => sourceDisposals++); material.addEventListener('dispose', () => materialDisposals++);
    const batch = batchOfficeStaticModels([{ id: 'retained-cache', source: new Mesh(geometry, material) }]);
    (batch.group.children[0] as Mesh).geometry.addEventListener('dispose', () => generatedDisposals++);
    batch.dispose();
    expect(generatedDisposals).toBe(1); expect(sourceDisposals).toBe(0); expect(materialDisposals).toBe(0);
    geometry.dispose(); material.dispose();
  });
});

const shellPath = fileURLToPath(new URL('../../../office-assets/proof/assets/office/office-shell.glb', import.meta.url));
const furniturePath = fileURLToPath(new URL('../../../office-assets/proof/assets/office/studio-furniture.glb', import.meta.url));
it.skipIf(!existsSync(shellPath) || !existsSync(furniturePath))('batches the optional private proof with unchanged placed bounds and triangle totals (source counts, not GPU proof)', async () => {
  async function load(file: string) { const bytes = await readFile(file); return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''); }
  const [shell, furniture] = await Promise.all([load(shellPath), load(furniturePath)]);
  const legacy = new Group(); legacy.add(shell.scene.clone(true));
  const placements: StaticPlacement[] = [{ id: 'shell', source: shell.scene }];
  for (const instance of makeFurnitureInstances()) {
    const source = furniture.scene.getObjectByName(instance.node); expect(source, instance.node).toBeTruthy();
    const holder = new Group(); holder.position.set(...instance.position); holder.rotation.y = instance.yaw; holder.add(source!.clone(true)); legacy.add(holder);
    placements.push({ id: instance.id, source: source!, position: instance.position, yaw: instance.yaw });
  }
  let primitives = 0, triangles = 0;
  legacy.traverse(object => { if (object instanceof Mesh) { primitives++; triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3; } });
  const before = batchBounds(legacy);
  const batch = batchOfficeStaticModels(placements);
  let batchedTriangles = 0; batch.group.traverse(object => { if (object instanceof Mesh) batchedTriangles += object.geometry.getAttribute('position').count / 3; });
  expect(primitives).toBe(127); expect(triangles).toBe(71372);
  expect(batch.stats.sourcePrimitives).toBe(primitives); expect(batch.stats.triangles).toBe(triangles); expect(batchedTriangles).toBe(triangles);
  expect(batch.stats.materialBatches).toBeLessThanOrEqual(16);
  closeVector(batchBounds(batch.group).min, before.min); closeVector(batchBounds(batch.group).max, before.max);
  console.info('Office static source batching:', JSON.stringify(batch.stats));
  batch.dispose();
}, 15000);
