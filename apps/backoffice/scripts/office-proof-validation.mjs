import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import validator from 'gltf-validator';
import { AnimationMixer, Box3, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { privatePath } from './office-assets.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proofRoot = path.join(appRoot, 'office-assets', 'proof');
const requiredClips = ['idle_stand', 'walk', 'seated_idle', 'seated_work', 'sit_down', 'stand_up', 'handoff_gesture'];
const toArray = vector => vector.toArray().map(value => Math.round(value * 100000) / 100000);

function getSkins(object) {
  const skins = [];
  object.traverse(node => { if (node.isSkinnedMesh) skins.push(node); });
  return skins;
}
function skinBounds(object) {
  object.updateMatrixWorld(true);
  const bounds = new Box3();
  object.traverse(node => {
    if (!node.isMesh) return;
    if (node.isSkinnedMesh) { node.skeleton.update(); node.computeBoundingBox(); }
    else if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    if (node.boundingBox ?? node.geometry.boundingBox) bounds.union((node.boundingBox ?? node.geometry.boundingBox).clone().applyMatrix4(node.matrixWorld));
  });
  return bounds;
}
function jointSnapshot(object) {
  const points = [];
  object.traverse(node => { if (node.isBone) points.push(...node.getWorldPosition(new Vector3()).toArray()); });
  return points;
}

/** Offline loader/deformation proof. This cannot approve identity, rendering or GPU performance. */
export async function validateProof(relativeFilename) {
  const filename = privatePath(proofRoot, relativeFilename);
  if (!filename.endsWith('.glb')) throw new Error('A private proof GLB is required');
  const bytes = await readFile(filename);
  if (bytes.length > 32 * 1024 * 1024 || bytes.length < 20) throw new Error('Proof GLB size is invalid');
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('A valid binary glTF2 header is required');
  const jsonEnd = 20 + bytes.readUInt32LE(12);
  if (jsonEnd > bytes.length) throw new Error('Truncated GLB JSON');
  const json = JSON.parse(bytes.subarray(20, jsonEnd).toString('utf8').trim());
  const externalUris = [...(json.buffers ?? []), ...(json.images ?? [])].filter(item => item.uri && !item.uri.startsWith('data:')).map(item => item.uri);
  if (externalUris.length) throw new Error('Proof GLBs must be self-contained; no external resource reads are permitted');
  const report = await validator.validateBytes(new Uint8Array(bytes), { uri: path.basename(filename), maxIssues: 1000, externalResourceFunction: async () => { throw new Error('External resources are forbidden'); } });
  const loaded = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject));
  const skins = getSkins(loaded.scene), allJoints = new Set(skins.flatMap(skin => skin.skeleton.bones));
  const triangles = (json.meshes ?? []).flatMap(mesh => mesh.primitives ?? []).reduce((sum, primitive) => sum + ((primitive.mode ?? 4) === 4 ? (json.accessors?.[primitive.indices ?? primitive.attributes?.POSITION]?.count ?? 0) / 3 : 0), 0);
  const baseBounds = skinBounds(loaded.scene);
  const problems = [];
  if (report.issues.numErrors) problems.push(`Khronos validator: ${report.issues.numErrors} errors`);
  if ((json.skins?.length ?? 0) !== 1 || !skins.length) problems.push('Exactly one skin binding and a real skinned mesh are required');
  if (allJoints.size > 65) problems.push('More than 65 deforming joints');
  if (triangles > 12000) problems.push('More than 12000 character triangles');
  if ((json.materials?.length ?? 0) > 3) problems.push('More than three character materials');
  if (baseBounds.min.y < -0.02 || baseBounds.min.y > 0.02) problems.push('Standing mesh feet are not within 0.02m of finished floor');
  const height = baseBounds.max.y - baseBounds.min.y;
  if (height < 1.5 || height > 2.05) problems.push('Unexpected adult character scale');
  let malformedWeights = 0;
  for (const skin of skins) {
    const weights = skin.geometry.getAttribute('skinWeight');
    if (!weights || weights.itemSize !== 4) { malformedWeights++; continue; }
    for (let i = 0; i < weights.count; i++) {
      const values = [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)];
      if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1) || Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.002) malformedWeights++;
    }
  }
  if (malformedWeights) problems.push(`${malformedWeights} missing/unnormalized four-influence weight records`);
  const samples = [];
  for (const name of requiredClips) {
    const clip = loaded.animations.find(animation => animation.name === name);
    if (!clip || clip.duration <= 0 || clip.duration > 12 || !clip.tracks.length) { problems.push(`Missing or invalid animation ${name}`); continue; }
    const object = clone(loaded.scene), mixer = new AnimationMixer(object);
    const action = mixer.clipAction(clip); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
    const sweep = new Box3(), rootMin = new Vector3(Infinity, Infinity, Infinity), rootMax = new Vector3(-Infinity, -Infinity, -Infinity);
    let initialJoints, moved = false;
    const sampleCount = Math.max(3, Math.ceil(clip.duration * 24));
    const root = object.getObjectByName('Root') ?? object.getObjectByName('root') ?? object.getObjectByName('ROOT');
    if (!root?.isBone) problems.push(`${name} is missing its explicit floor-root bone`);
    for (let frame = 0; frame <= sampleCount; frame++) {
      mixer.setTime(frame * clip.duration / sampleCount);
      sweep.union(skinBounds(object));
      const joints = jointSnapshot(object);
      if (!initialJoints) initialJoints = joints;
      else if (joints.some((value, i) => Math.abs(value - initialJoints[i]) > 0.0002)) moved = true;
      if (root) { const point = root.getWorldPosition(new Vector3()); rootMin.min(point); rootMax.max(point); }
    }
    const rootTravel = root ? rootMax.clone().sub(rootMin) : null;
    if (!moved) problems.push(`${name} has no measurable joint motion`);
    if (sweep.min.y < -0.03) problems.push(`${name} intersects the floor by more than 0.03m`);
    if (rootTravel && (rootTravel.x > 0.002 || rootTravel.z > 0.002)) problems.push(`${name} has horizontal root drift`);
    samples.push({ name, durationSeconds: clip.duration, tracks: clip.tracks.length, sampledFrames: sampleCount + 1, measurableJointMotion: moved, boundsMin: toArray(sweep.min), boundsMax: toArray(sweep.max), rootHorizontalTravel: rootTravel ? { x: rootTravel.x, z: rootTravel.z } : null });
    mixer.stopAllAction(); mixer.uncacheRoot(object);
  }
  const independentClone = clone(loaded.scene);
  const independentSkeletons = getSkins(independentClone).every((skin, i) => skin.skeleton !== skins[i]?.skeleton && skin.skeleton.bones.every((bone, j) => bone !== skins[i]?.skeleton.bones[j]));
  if (!independentSkeletons) problems.push('Skeleton clones share mutable joints');
  const proof = {
    generatedAtUtc: new Date().toISOString(), file: path.relative(appRoot, filename).replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    status: problems.length ? 'technical_checks_failed' : 'technical_rig_export_checks_passed', productionApproved: false,
    validator: { version: validator.version(), errors: report.issues.numErrors, warnings: report.issues.numWarnings },
    geometry: { triangles, materials: json.materials?.length ?? 0, skinBindings: json.skins?.length ?? 0, skinnedMeshes: skins.length, joints: allJoints.size, malformedWeights, baseMin: toArray(baseBounds.min), baseMax: toArray(baseBounds.max), independentSkeletonClones: independentSkeletons },
    animations: samples, problems,
    pending: ['Portrait-derived visual identity and deformation review', 'Real chair/desk dock and limb-clearance review', 'WebGL-capable Chrome loader, animation blend, context loss and hardware performance', 'Source/provenance/owner production acceptance'],
    limits: 'Khronos and headless Three loader/bone sampling are technical evidence only. No WebGL render, final artistic identity, performance, license approval or production promotion is implied.'
  };
  const reports = privatePath(proofRoot, 'reports'); await mkdir(reports, { recursive: true });
  await writeFile(path.join(reports, 'khronos-validator.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(reports, 'runtime-technical-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  return proof;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const proof = await validateProof(process.argv[2] ?? 'assets/office/characters/sam.glb');
  console.log(JSON.stringify({ status: proof.status, validator: proof.validator, geometry: proof.geometry, problems: proof.problems }, null, 2));
  if (proof.problems.length) process.exitCode = 1;
}
