import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { segmentIntersectsBox, validateFloorplan } from './office-assets.mjs';

const floorplan = JSON.parse(readFileSync(new URL('../office-spec/data/floorplan.json', import.meta.url), 'utf8'));

test('Measured graph, 0.25 m sweep and 15 reserved docks pass the supplied box layout', () => {
  const result = validateFloorplan(floorplan);
  assert.deepEqual(result.errors, []);
  assert.equal(result.counts.reachable_nodes, 41);
  assert.equal(result.counts.anchors, 15);
  assert.equal(result.counts.review_chairs, 8);
});

test('Clearance validation detects a moved obstacle, not just original author counts', () => {
  const modified = structuredClone(floorplan);
  modified.obstacles[0].box = { min_x: 4.8, max_x: 5.2, min_z: 3, max_z: 4.2 };
  const result = validateFloorplan(modified);
  assert.equal(result.status, 'failed');
  assert.ok(result.corridorConflicts.length > 0);
  assert.ok(result.edgeConflicts.length > 0);
});

test('Missing graph branches and mismatched approach anchors are rejected', () => {
  const modified = structuredClone(floorplan);
  modified.edges = modified.edges.filter((edge) => edge.from !== 'approach_sam' && edge.to !== 'approach_sam');
  modified.workstations.find((station) => station.character_id === 'clara').approach.x += 0.1;
  const result = validateFloorplan(modified);
  assert.ok(result.errors.some((error) => error.includes('Unreachable approach')));
  assert.ok(result.errors.some((error) => error.includes('Approach node/anchor mismatch')));
});

test('Sweep catches interior crossings while permitting a tangent to an inflated boundary', () => {
  const box = { min_x: 1, max_x: 2, min_z: 1, max_z: 2 };
  assert.equal(segmentIntersectsBox({ x: 0, z: 1.5 }, { x: 3, z: 1.5 }, box), true);
  assert.equal(segmentIntersectsBox({ x: 0, z: 1 }, { x: 3, z: 1 }, box), false);
  assert.equal(segmentIntersectsBox({ x: 0, z: 0 }, { x: 0.5, z: 0.5 }, box), false);
});
