import { existsSync, readFileSync, mkdirSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (filename) => JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
const overlap = (a, b) => a.min_x < b.max_x - 1e-8 && a.max_x > b.min_x + 1e-8 && a.min_z < b.max_z - 1e-8 && a.max_z > b.min_z + 1e-8;
const inflate = (box, radius) => ({ min_x: box.min_x - radius, max_x: box.max_x + radius, min_z: box.min_z - radius, max_z: box.max_z + radius });

/** Slab intersection includes the whole swept center segment, not point samples. */
export function segmentIntersectsBox(a, b, box) {
  let near = 0, far = 1;
  for (const axis of ['x', 'z']) {
    const delta = b[axis] - a[axis];
    const min = box[`min_${axis}`] + 1e-8, max = box[`max_${axis}`] - 1e-8;
    if (Math.abs(delta) < 1e-10) { if (a[axis] < min || a[axis] > max) return false; }
    else {
      const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta;
      near = Math.max(near, Math.min(t1, t2)); far = Math.min(far, Math.max(t1, t2));
      if (near > far) return false;
    }
  }
  return near <= far;
}

export function validateFloorplan(plan) {
  const errors = [], observations = [];
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  if (nodes.size !== plan.nodes.length) errors.push('Duplicate waypoint IDs');
  const corridorConflicts = [], edgeConflicts = [], approachConflicts = [], dockConflicts = [];
  for (const corridor of plan.clear_corridors) for (const obstacle of plan.obstacles) {
    if (overlap(corridor.box, obstacle.box)) corridorConflicts.push({ corridor: corridor.id, obstacle: obstacle.id });
  }
  const neighbors = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const edge of plan.edges) {
    const a = nodes.get(edge.from), b = nodes.get(edge.to);
    if (!a || !b) { errors.push(`Unresolved edge ${edge.from} → ${edge.to}`); continue; }
    neighbors.get(edge.from).push(edge.to); neighbors.get(edge.to).push(edge.from);
    if (a.x === b.x && a.z === b.z) observations.push(`Coincident authored nodes: ${edge.from} / ${edge.to}; retained as a zero-length graph link.`);
    for (const obstacle of plan.obstacles) {
      if (segmentIntersectsBox(a, b, inflate(obstacle.box, plan.navigation.agent_radius_m))) edgeConflicts.push({ from: edge.from, to: edge.to, obstacle: obstacle.id });
    }
  }
  const seen = new Set(), queue = ['entry'];
  while (queue.length) { const id = queue.shift(); if (seen.has(id)) continue; seen.add(id); queue.push(...(neighbors.get(id) ?? []).filter((next) => !seen.has(next))); }
  const anchors = [...plan.workstations, ...plan.review_seats];
  for (const anchor of anchors) {
    const node = nodes.get(anchor.approach.node_id);
    if (!node || node.x !== anchor.approach.x || node.z !== anchor.approach.z) errors.push(`Approach node/anchor mismatch: ${anchor.id}`);
    if (!seen.has(anchor.approach.node_id)) errors.push(`Unreachable approach: ${anchor.id}`);
    const ownChair = anchor.dock?.own_chair_exception ?? anchor.own_chair_exception;
    if (!plan.obstacles.some((obstacle) => obstacle.id === ownChair)) errors.push(`Missing destination chair: ${anchor.id}`);
    for (const obstacle of plan.obstacles) {
      if (overlap(anchor.approach.clearance_box, obstacle.box)) approachConflicts.push({ anchor: anchor.id, obstacle: obstacle.id });
      if (obstacle.id !== ownChair && segmentIntersectsBox(anchor.approach, anchor.seat, inflate(obstacle.box, plan.navigation.agent_radius_m))) dockConflicts.push({ anchor: anchor.id, obstacle: obstacle.id });
    }
  }
  for (const node of plan.nodes) if (node.x < 0 || node.x > plan.room.width_x || node.z < 0 || node.z > plan.room.depth_z) errors.push(`Node outside room: ${node.id}`);
  const counts = {
    characters: plan.workstations.length,
    individual_desks: plan.obstacles.filter((o) => o.category === 'desk').length,
    desk_chairs: plan.obstacles.filter((o) => o.category === 'desk_chair').length,
    review_chairs: plan.review_seats.length,
    obstacles: plan.obstacles.length,
    graph_nodes: plan.nodes.length,
    reachable_nodes: seen.size,
    graph_edges: plan.edges.length,
    corridors: plan.clear_corridors.length,
    anchors: anchors.length,
  };
  if (counts.reachable_nodes !== counts.graph_nodes) errors.push('Not all graph nodes are reachable from entry');
  for (const [key, value] of Object.entries(counts)) if (key in plan.counts && value !== plan.counts[key]) errors.push(`Count mismatch: ${key}`);
  if (counts.characters !== 7 || counts.review_chairs !== 8 || !plan.review_seats.find((s) => s.id === 'review_owner')?.owner_seat_is_empty_until_needed) errors.push('Seven-person/eight-seat roster or empty owner-seat contract failed');
  for (const [label, conflicts] of Object.entries({ corridorConflicts, edgeConflicts, approachConflicts, dockConflicts })) if (conflicts.length) errors.push(`${label}: ${conflicts.length}`);
  return { status: errors.length ? 'failed' : 'passed_planning_geometry_only', units: 'meters', radius_m: plan.navigation.agent_radius_m, counts, corridorConflicts, edgeConflicts, approachConflicts, dockConflicts, errors, observations, limits: '2D authored boxes and straight graph/dock segments only. No exported mesh bounds, limb sweep, seat animation, route smoothing, simultaneous-agent reservation or browser collision acceptance.' };
}

export function privatePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative)) throw new Error('A relative private asset path is required');
  root = path.resolve(root);
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(`Asset path escapes private root: ${relative}`);
  // Incoming bundles are task data. A junction or symlink must not turn a
  // provenance/validator path into a reader of host credentials or other clients.
  let cursor = root;
  const canonicalRoot = existsSync(root) ? realpathSync(root) : root;
  for (const segment of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!existsSync(cursor)) continue;
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Private asset symlinks and junctions are forbidden: ${relative}`);
    const canonical = realpathSync(cursor);
    if (canonical !== canonicalRoot && !canonical.startsWith(canonicalRoot + path.sep)) throw new Error(`Canonical asset path escapes private root: ${relative}`);
  }
  return resolved;
}

function inspectGlb(filename, asset) {
  const bytes = readFileSync(filename);
  const issues = [];
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB 2.0 header or declared byte length');
  const jsonSize = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || jsonSize + 20 > bytes.length) throw new Error('Missing or truncated GLB JSON chunk');
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString('utf8').trim());
  const nodes = (gltf.nodes ?? []).map((node) => node.name).filter(Boolean);
  const clips = (gltf.animations ?? []).map((clip) => ({ name: clip.name ?? null, duration_seconds: Math.max(0, ...(clip.samplers ?? []).map((sampler) => gltf.accessors?.[sampler.input]?.max?.[0] ?? 0)) }));
  const requiredNodes = asset.required_nodes ?? asset.components?.map((component) => component.name) ?? [];
  for (const name of requiredNodes) if (!nodes.includes(name)) issues.push(`Missing node ${name}`);
  for (const name of asset.required_clip_names ?? []) if (!clips.some((clip) => clip.name === name && clip.duration_seconds > 0)) issues.push(`Missing/zero-duration animation ${name}`);
  const externalUris = [...(gltf.buffers ?? []), ...(gltf.images ?? [])].filter((item) => item.uri && !item.uri.startsWith('data:')).map((item) => item.uri);
  if (externalUris.length) issues.push('External buffer/texture URIs are not enabled in the initial private loader');
  if ((gltf.extensionsRequired ?? []).some((name) => ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression'].includes(name))) issues.push('Compressed decoder pipeline requires separate browser/CSP validation; initial loader supports uncompressed proof only');
  const triangles = (gltf.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []).reduce((sum, primitive) => sum + ((primitive.mode ?? 4) === 4 ? (gltf.accessors?.[primitive.indices ?? primitive.attributes?.POSITION]?.count ?? 0) / 3 : 0), 0);
  if (asset.character_id) {
    if ((gltf.skins?.length ?? 0) !== 1) issues.push('Character requires exactly one skin binding');
    if ((gltf.skins?.[0]?.joints?.length ?? 0) > 65) issues.push('Character exceeds provisional 65 deforming-bone ceiling');
    if ((gltf.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []).some((primitive) => primitive.attributes?.WEIGHTS_1 !== undefined)) issues.push('Additional weight sets exceed four-influence export contract');
  }
  return { version: gltf.asset?.version, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), node_names: nodes, animations: clips, skin_count: gltf.skins?.length ?? 0, joint_counts: (gltf.skins ?? []).map((skin) => skin.joints?.length ?? 0), materials: gltf.materials?.length ?? 0, triangles, external_uris: externalUris, issues, limits: 'Structural JSON metadata inspection only; Khronos validator, dimensions, identity, deformation, texture color-space and browser evidence remain separate requirements.' };
}

function detectBlender() {
  const executable = process.platform === 'win32' ? 'where.exe' : 'which';
  const lookup = spawnSync(executable, ['blender'], { encoding: 'utf8', windowsHide: true });
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Blender Foundation'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Blender Foundation'),
    path.join(process.env.LOCALAPPDATA ?? 'C:\\Users\\hoyec\\AppData\\Local', 'Programs', 'Blender Foundation'),
  ] : ['/usr/bin/blender', '/usr/local/bin/blender', '/Applications/Blender.app'];
  const configured = process.env.OFFICE_BLENDER_EXECUTABLE;
  const configuredExists = !!configured && path.isAbsolute(configured) && existsSync(configured) && lstatSync(configured).isFile();
  return { path_lookup_found: lookup.status === 0, path_matches: lookup.status === 0 ? lookup.stdout.trim().split(/\r?\n/) : [], targeted_locations: candidates.map((filename) => ({ path: filename, exists: existsSync(filename) })), configured_portable_executable: configuredExists ? configured : null, installed: lookup.status === 0 || candidates.some(existsSync) || configuredExists, scope: 'Read-only PATH, standard installation locations and an explicitly configured local portable executable. No exhaustive scan or automatic tool execution. Tool availability does not establish modeled asset acceptance.' };
}

export function main() {
  const specRoot = path.join(appRoot, 'office-spec');
  const assetRoot = path.resolve(process.env.OFFICE_ASSET_ROOT ?? path.join(appRoot, 'office-assets'));
  const plan = readJson(path.join(specRoot, 'data', 'floorplan.json'));
  const manifest = readJson(path.join(specRoot, 'data', 'asset-manifest.json'));
  const evidenceFile = privatePath(assetRoot, 'reports/runtime-approval.json');
  const evidence = existsSync(evidenceFile) ? readJson(evidenceFile) : { assets: {} };
  const provenanceFile = privatePath(assetRoot, 'source/office/provenance-and-licenses.json');
  const provenance = existsSync(provenanceFile) ? readJson(provenanceFile) : { assets: {} };
  const registry = [], assets = [];
  for (const asset of manifest.required_assets) {
    const filename = privatePath(assetRoot, asset.required_filename);
    const sourceFile = privatePath(assetRoot, asset.required_source_filename);
    const entry = { id: asset.id, kind: asset.kind, required_filename: asset.required_filename, required_source_filename: asset.required_source_filename, exists: existsSync(filename), source_exists: existsSync(sourceFile), status: 'missing', runtime_approved: false, missing_requirements: [] };
    if (!entry.exists) entry.missing_requirements.push(asset.required_filename);
    if (!entry.source_exists) entry.missing_requirements.push(asset.required_source_filename);
    if (entry.exists) {
      const bytes = readFileSync(filename);
      entry.sha256 = createHash('sha256').update(bytes).digest('hex'); entry.bytes = bytes.length; entry.status = 'present_unvalidated';
      if (asset.required_filename.endsWith('.glb')) {
        try { entry.inspection = inspectGlb(filename, asset); } catch (error) { entry.missing_requirements.push(error.message); }
      }
    }
    const provenanceEntry = provenance.assets?.[asset.id];
    if (!provenanceEntry?.creator || !provenanceEntry?.license_name || !provenanceEntry?.commercial_use_approved || !provenanceEntry?.edit_and_redistribute_approved) entry.missing_requirements.push('Complete source/creator/license record and reviewed commercial/edit/redistribution rights');
    if (!provenanceEntry?.license_document_filename || !existsSync(privatePath(assetRoot, provenanceEntry.license_document_filename))) entry.missing_requirements.push('Retained license document in private asset bundle');
    if (asset.required_filename.endsWith('.glb')) {
      const approval = evidence.assets?.[asset.id];
      if (!approval || approval.sha256 !== entry.sha256 || !approval.approved_for_runtime) entry.missing_requirements.push('Explicit runtime approval bound to actual GLB SHA-256');
      const checks = ['geometry', 'dimensions', 'loader', 'source_opened', 'provenance_reviewed', 'private_asset_route'];
      if (asset.character_id) checks.push('rig', 'animations', 'identity', 'docks', 'root_motion');
      if (asset.character_id) for (const requiredSource of [asset.rig_source, asset.animation_source]) if (!requiredSource || !existsSync(privatePath(assetRoot, requiredSource))) entry.missing_requirements.push(`Shared native rig/animation source: ${requiredSource ?? 'not recorded'}`);
      for (const check of checks) if (approval?.checks?.[check] !== true) entry.missing_requirements.push(`Evidence check: ${check}`);
      let validator;
      if (approval?.khronos_validator_report) {
        const validatorFile = privatePath(assetRoot, approval.khronos_validator_report);
        if (existsSync(validatorFile)) validator = readJson(validatorFile);
      }
      if (!validator || validator.issues?.numErrors !== 0) entry.missing_requirements.push('Khronos glTF Validator report with zero errors');
      if ((entry.inspection?.issues?.length ?? 0) > 0) entry.missing_requirements.push(...entry.inspection.issues);
      if (!entry.inspection) entry.missing_requirements.push('Successful GLB structural metadata inspection');
      if (!entry.missing_requirements.length) {
        entry.runtime_approved = true; entry.status = 'approved_for_runtime';
        registry.push({ id: asset.id, character_id: asset.character_id, sha256: entry.sha256, url: `/api/office/assets?file=${encodeURIComponent(asset.required_filename)}` });
      }
    }
    assets.push(entry);
  }
  const report = { generated_at_utc: new Date().toISOString(), asset_root: assetRoot, status: registry.length ? 'partial_validated_assets' : 'graybox_only_final_assets_pending', floorplan: validateFloorplan(plan), modeling_tooling: detectBlender(), reference_review: { filename: 'office-spec/visuals/reference/office-overview.png', reviewed: true, use: 'Warm oak/navy/cobalt and cutaway atmosphere only. Measured floorplan controls geometry. No portraits were used as scene billboards.' }, assets, production_milestones: { sam_rigged_proof: 'pending_identity_docks_and_browser_approval', final_seven_character_scene: 'pending', hardware_performance: 'not_measured', licenses_and_native_sources: 'pending' }, limits: ['This is an implementation status report, not a produced-asset validator report from the manifest.', 'Planning geometry uses measured source data. Separate development-proof meshes, rigs, animations and native sources are not promoted by this inventory.', 'Browser loader/performance/route and docking acceptance requires actual models and actual hardware.'] };
  const reportsDir = path.join(appRoot, 'docs', 'office'); mkdirSync(reportsDir, { recursive: true });
  writeFileSync(path.join(reportsDir, 'asset-status.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(appRoot, 'src', 'components', 'office', 'scene-assets.generated.json'), JSON.stringify({ generated_by: 'scripts/office-assets.mjs', status: registry.length ? 'validated_runtime_assets' : 'no_validated_runtime_assets', assets: registry }, null, 2) + '\n');
  console.log(JSON.stringify({ floorplan: report.floorplan.status, counts: report.floorplan.counts, conflicts: report.floorplan.errors, runtime_models_approved: registry.length, required_deliverables_missing: assets.filter((asset) => !asset.exists).length, blender_detected: report.modeling_tooling.installed, report: 'docs/office/asset-status.json' }, null, 2));
  if (report.floorplan.errors.length) process.exitCode = 1;
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
