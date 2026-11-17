import floorplan from "../../../office-spec/data/floorplan.json";

export { floorplan };
export type Point = { x: number; z: number };
export type Footprint = (typeof floorplan.obstacles)[number];
export type BoxPart = { position: [number, number, number]; size: [number, number, number]; yaw?: number; sourceId: string };

export const palette = {
  floor: "#d5c1a6", wall: "#ece4d6", oak: "#b98a56", navy: "#203450",
  metal: "#424b54", screen: "#244e72", foliage: "#4c6849", pot: "#b7a28b",
} as const;

// All occupied horizontal bounds come directly from the planning JSON. Detail
// stays inside those boxes; this is editable graybox geometry, not final assets.
export function makeBlockout({ shell = false, furniture = false }: { shell?: boolean; furniture?: boolean } = {}) {
  const parts: Record<keyof typeof palette, BoxPart[]> = {
    floor: [], wall: [], oak: [], navy: [], metal: [], screen: [], foliage: [], pot: [],
  };
  let sourceId = "floor_slab";
  function box(color: keyof typeof palette, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0) {
    parts[color].push({ position: [x, y, z], size: [w, h, d], yaw, sourceId });
  }
  const { room } = floorplan;
  if (!shell) box("floor", room.width_x / 2, -room.floor_thickness / 2, room.depth_z / 2, room.width_x, room.floor_thickness, room.depth_z);
  for (const o of floorplan.obstacles) {
    sourceId = o.id;
    const { x, z } = o.center;
    const w = o.width_x, d = o.depth_z, h = o.height_y;
    if (o.category === "wall") { if (!shell) box("wall", x, h / 2, z, w, h, d); }
    else if (furniture) continue;
    else if (o.category === "desk" || o.category === "review_table" || o.category === "client_side_table") {
      box("oak", x, h - 0.04, z, w, 0.08, d);
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
        box("metal", x + dx * (w / 2 - 0.08), (h - 0.08) / 2, z + dz * (d / 2 - 0.08), 0.055, h - 0.08, 0.055);
      }
    } else if (["desk_chair", "review_chair", "client_armchair", "sofa"].includes(o.category)) {
      const sideways = Math.abs(Math.sin(o.yaw_radians)) > 0.5;
      const localW = sideways ? d : w, localD = sideways ? w : d;
      const yaw = o.yaw_radians;
      const backOffset = -localD / 2 + 0.07;
      box("navy", x, 0.43, z, localW, 0.08, localD, yaw);
      box("navy", x + Math.sin(yaw) * backOffset, (h + 0.47) / 2, z + Math.cos(yaw) * backOffset, localW, h - 0.47, 0.14, yaw);
      box("metal", x, 0.21, z, w * 0.64, 0.42, d * 0.64);
    } else if (o.category === "plant") {
      box("pot", x, 0.2, z, w * 0.8, 0.4, d * 0.8);
      box("foliage", x, 0.9, z, w, h - 0.4, d);
    } else {
      box("oak", x, h / 2, z, w, h, d);
      box("navy", x, h * 0.5, z - d / 2 + 0.002, w * 0.82, h * 0.74, 0.004);
    }
  }
  for (const desk of furniture ? [] : floorplan.workstations) {
    sourceId = desk.id;
    const { x, z } = desk.desk_center;
    const yaw = desk.seat.yaw_radians;
    // One monitor plus a keyboard/mouse set at each of the seven desks.
    box("metal", x, 0.87, z, 0.12, 0.24, 0.12);
    box("screen", x, 1.11, z, 0.62, 0.36, 0.055, yaw);
    box("metal", x - Math.sin(yaw) * 0.2, 0.805, z - Math.cos(yaw) * 0.2, 0.38, 0.025, 0.12, yaw);
    box("metal", x + Math.cos(yaw) * 0.26 - Math.sin(yaw) * 0.2, 0.81, z - Math.sin(yaw) * 0.26 - Math.cos(yaw) * 0.2, 0.07, 0.03, 0.09, yaw);
  }
  for (const feature of furniture ? [] : floorplan.non_blocking_features) {
    sourceId = feature.id;
    box(feature.id === "project_board" ? "wall" : "navy", feature.center.x, feature.center.y, feature.center.z, feature.width_m, feature.height_m, 0.04);
  }
  return parts;
}

export function makeFurnitureInstances() {
  const names: Record<string, string> = { desk_chair: "DeskChair", review_table: "ReviewTable_360x140", review_chair: "ReviewChair", client_armchair: "ClientArmchair", client_side_table: "ClientSideTable", sofa: "Sofa2", coffee_cabinet: "CoffeeCabinet", low_shelf: "LowShelf_200x040", plant: "Plant" };
  const instances: { id: string; node: string; position: [number, number, number]; yaw: number }[] = [];
  for (const obstacle of floorplan.obstacles) {
    if (obstacle.category === "wall") continue;
    instances.push({ id: obstacle.id, node: obstacle.category === "desk" ? obstacle.id === "desk_adrian" ? "Desk_180x080" : "Desk_160x080" : names[obstacle.category], position: [obstacle.center.x, 0, obstacle.center.z], yaw: obstacle.yaw_radians });
  }
  for (const desk of floorplan.workstations) {
    instances.push({ id: `monitor_${desk.character_id}`, node: "Monitor", position: [desk.desk_center.x, desk.desk_top_y, desk.desk_center.z], yaw: desk.seat.yaw_radians });
    instances.push({ id: `keyboard_${desk.character_id}`, node: "KeyboardMouse", position: [desk.desk_center.x - Math.sin(desk.seat.yaw_radians) * 0.2, desk.desk_top_y, desk.desk_center.z - Math.cos(desk.seat.yaw_radians) * 0.2], yaw: desk.seat.yaw_radians });
  }
  for (const feature of floorplan.non_blocking_features) instances.push({ id: feature.id, node: feature.id === "project_board" ? "ProjectBoard" : feature.id === "brand_sign" ? "BrandPlaque" : "SharedDisplay", position: [feature.center.x, feature.center.y - feature.height_m / 2, feature.center.z], yaw: Math.PI });
  return instances;
}

/** Dijkstra on the authored bidirectional graph; no arbitrary straight-line travel. */
export function findOfficeRoute(from: string, to: string): string[] | null {
  const nodes = new Map(floorplan.nodes.map((node) => [node.id, node]));
  if (!nodes.has(from) || !nodes.has(to)) return null;
  const distance = new Map<string, number>([[from, 0]]), previous = new Map<string, string>();
  const pending = new Set(nodes.keys());
  while (pending.size) {
    const current = [...pending].reduce((best, id) => (distance.get(id) ?? Infinity) < (distance.get(best) ?? Infinity) ? id : best);
    if (!Number.isFinite(distance.get(current) ?? Infinity)) return null;
    pending.delete(current);
    if (current === to) {
      const path = [to];
      while (path[0] !== from) path.unshift(previous.get(path[0])!);
      return path;
    }
    for (const edge of floorplan.edges) {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (!next || !pending.has(next)) continue;
      const a = nodes.get(current)!, b = nodes.get(next)!;
      const candidate = distance.get(current)! + Math.hypot(a.x - b.x, a.z - b.z);
      if (candidate < (distance.get(next) ?? Infinity)) { distance.set(next, candidate); previous.set(next, current); }
    }
  }
  return null;
}
