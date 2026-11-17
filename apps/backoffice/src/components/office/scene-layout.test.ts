import { describe, expect, it } from 'vitest';
import { floorplan, findOfficeRoute, makeBlockout, makeFurnitureInstances } from './scene-layout';

describe('measured scene geometry', () => {
  it('keeps every graybox part inside the obstacle envelope that clearance tests use', () => {
    const obstacles = new Map(floorplan.obstacles.map((obstacle) => [obstacle.id, obstacle]));
    for (const part of Object.values(makeBlockout()).flat()) {
      expect(part.position.every(Number.isFinite)).toBe(true);
      expect(part.size.every((size) => Number.isFinite(size) && size > 0)).toBe(true);
      const obstacle = obstacles.get(part.sourceId);
      if (!obstacle) continue;
      const yaw = part.yaw ?? 0;
      const halfX = (Math.abs(Math.cos(yaw)) * part.size[0] + Math.abs(Math.sin(yaw)) * part.size[2]) / 2;
      const halfZ = (Math.abs(Math.sin(yaw)) * part.size[0] + Math.abs(Math.cos(yaw)) * part.size[2]) / 2;
      expect(part.position[0] - halfX, `${part.sourceId} minimum X`).toBeGreaterThanOrEqual(obstacle.box.min_x - 1e-8);
      expect(part.position[0] + halfX, `${part.sourceId} maximum X`).toBeLessThanOrEqual(obstacle.box.max_x + 1e-8);
      expect(part.position[2] - halfZ, `${part.sourceId} minimum Z`).toBeGreaterThanOrEqual(obstacle.box.min_z - 1e-8);
      expect(part.position[2] + halfZ, `${part.sourceId} maximum Z`).toBeLessThanOrEqual(obstacle.box.max_z + 1e-8);
    }
  });
  it('puts the slab top at finished floor zero and all seven desk surfaces at 0.75 m', () => {
    const parts = makeBlockout();
    const slab = parts.floor[0];
    expect(slab.position[1] + slab.size[1] / 2).toBe(0);
    expect(slab.size).toEqual([18, 0.25, 13]);
    for (const desk of floorplan.workstations) {
      const top = parts.oak.find((part) => part.sourceId === desk.id)!;
      expect(top.position[1] + top.size[1] / 2).toBeCloseTo(0.75);
    }
  });
  it('uses at most eight material batches for all static blockout boxes', () => {
    expect(Object.values(makeBlockout()).filter((parts) => parts.length).length).toBeLessThanOrEqual(8);
    // Instancing group count is an offline regression bound, not a device FPS claim.
  });
  it('replaces only the accepted asset class when optional models are approved', () => {
    const shellOnly = Object.values(makeBlockout({ shell: true })).flat();
    expect(shellOnly.some((part) => ['floor_slab', 'wall_rear', 'wall_left'].includes(part.sourceId))).toBe(false);
    expect(shellOnly.some((part) => part.sourceId === 'project_board')).toBe(true);
    const furnitureOnly = Object.values(makeBlockout({ furniture: true })).flat();
    expect(furnitureOnly.map((part) => part.sourceId).sort()).toEqual(['floor_slab', 'wall_left', 'wall_rear']);
    expect(Object.values(makeBlockout({ shell: true, furniture: true })).flat()).toEqual([]);
  });
  it('places seven desks, seven desk chairs and eight independent review chairs including empty owner seat', () => {
    const instances = makeFurnitureInstances();
    expect(instances.filter((item) => item.node.startsWith('Desk_'))).toHaveLength(7);
    expect(instances.filter((item) => item.node === 'DeskChair')).toHaveLength(7);
    expect(instances.filter((item) => item.node === 'ReviewChair')).toHaveLength(8);
    expect(instances.find((item) => item.id === 'chair_review_owner')?.position).toEqual([11.3, 0, 6]);
    expect(new Set(instances.map((item) => item.id)).size).toBe(instances.length);
  });
  it('routes handoffs along authored branches and rejects arbitrary unknown destinations', () => {
    expect(findOfficeRoute('approach_sam', 'approach_lisa')).toEqual(['approach_sam', 'right_2', 'right_3', 'right_4', 'approach_lisa']);
    expect(findOfficeRoute('approach_sam', 'approach_review_sam')).toEqual(['approach_sam', 'right_2', 'right_3', 'rear_center', 'branch_review_sam', 'approach_review_sam']);
    expect(findOfficeRoute('approach_sam', 'unrecognized')).toBeNull();
  });
});
