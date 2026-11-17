"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { floorplan } from "./scene-layout";

// Original, static code geometry for the room preview. This does not approve or
// stand in for the separately validated, rigged character asset collection.
type PersonId = "adrian" | "clara" | "nadia" | "leo" | "lisa" | "sam" | "theo";
type Shape = "sphere" | "capsule" | "box" | "torus";
type Part = { id: string; matrix: THREE.Matrix4; color: THREE.Color };
type Appearance = { skin: string; hair: string; shirt: string; jacket?: string; style: "short" | "bob" | "bun" | "swept"; beard?: boolean; glasses?: string };
const looks: Record<PersonId, Appearance> = {
  adrian: { skin: "#be8e6b", hair: "#382b27", shirt: "#6388a4", jacket: "#26364b", style: "short" },
  clara: { skin: "#e0b99c", hair: "#633c2d", shirt: "#283e5c", style: "bob", glasses: "#a98958" },
  nadia: { skin: "#895535", hair: "#231c1b", shirt: "#7296b1", style: "bun" },
  leo: { skin: "#a76b43", hair: "#211e20", shirt: "#aec7d4", jacket: "#2b3d50", style: "short", beard: true },
  lisa: { skin: "#bd8c69", hair: "#392821", shirt: "#396fc1", jacket: "#273c55", style: "bob" },
  sam: { skin: "#c49775", hair: "#282326", shirt: "#397e8c", jacket: "#2c4053", style: "swept" },
  theo: { skin: "#825235", hair: "#211c1b", shirt: "#304459", style: "short", beard: true, glasses: "#242c36" },
};

function makePeople(ids: string[]) {
  const groups: Record<Shape, Part[]> = { sphere: [], capsule: [], box: [], torus: [] };
  const scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), position = new THREE.Vector3();
  for (const id of ids) {
    const desk = floorplan.workstations.find(item => item.character_id === id);
    const look = looks[id as PersonId];
    if (!desk || !look) continue;
    const origin = new THREE.Matrix4().compose(new THREE.Vector3(desk.seat.x, 0, desk.seat.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), desk.seat.yaw_radians), new THREE.Vector3(1, 1, 1));
    function part(shape: Shape, color: string, at: [number, number, number], size: [number, number, number], turn: [number, number, number] = [0, 0, 0]) {
      position.set(...at); scale.set(...size); rotation.setFromEuler(new THREE.Euler(...turn));
      groups[shape].push({ id, color: new THREE.Color(color), matrix: origin.clone().multiply(new THREE.Matrix4().compose(position, rotation, scale)) });
    }
    function limb(color: string, from: [number, number, number], to: [number, number, number], radius: number) {
      const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to), direction = end.clone().sub(start);
      const matrix = new THREE.Matrix4().compose(start.clone().add(end).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()), new THREE.Vector3(radius * 2, direction.length() / 2, radius * 2));
      groups.capsule.push({ id, color: new THREE.Color(color), matrix: origin.clone().multiply(matrix) });
    }
    const outer = look.jacket ?? look.shirt;
    part("sphere", "#293b50", [0, 0.55, 0.035], [0.24, 0.1, 0.18]);
    part("capsule", outer, [0, 0.87, 0], [0.41, 0.235, 0.23]);
    if (look.jacket) part("box", look.shirt, [0, 0.89, 0.116], [0.15, 0.32, 0.02]);
    part("capsule", look.skin, [0, 1.13, 0], [0.075, 0.045, 0.075]);
    part("sphere", look.skin, [0, 1.32, 0.015], [0.15, 0.18, 0.143]);
    part("sphere", look.hair, [0, 1.37, -0.047], [0.158, 0.156, 0.12]);
    part("sphere", look.hair, [0, 1.45, 0.002], [0.156, 0.082, 0.135]);
    if (look.style === "bob") {
      part("sphere", look.hair, [0, 1.27, -0.075], [0.17, 0.21, 0.105]);
      for (const side of [-1, 1]) part("capsule", look.hair, [side * 0.14, 1.27, 0], [0.065, 0.105, 0.10]);
    } else if (look.style === "bun") {
      part("sphere", look.hair, [0, 1.55, -0.05], [0.09, 0.1, 0.088]);
    } else if (look.style === "swept") {
      part("sphere", look.hair, [0.02, 1.47, -0.015], [0.15, 0.08, 0.14], [0, 0, -0.2]);
    } else if (id === "adrian") {
      for (const side of [-1, 1]) part("sphere", look.hair, [side * 0.067, 1.475, 0.035], [0.08, 0.062, 0.08]);
    }
    if (look.beard) part("sphere", look.hair, [0, 1.225, 0.108], [0.112, 0.073, 0.047]);
    for (const side of [-1, 1]) {
      part("sphere", look.skin, [side * 0.147, 1.31, 0.008], [0.024, 0.04, 0.025]);
      part("sphere", "#222b31", [side * 0.055, 1.345, 0.149], [0.012, 0.014, 0.009]);
      limb(outer, [side * 0.215, 1.015, 0], [side * 0.28, 0.79, 0.08], 0.065);
      limb(outer, [side * 0.28, 0.79, 0.08], [side * 0.235, 0.79, 0.32], 0.055);
      part("sphere", look.skin, [side * 0.235, 0.79, 0.36], [0.052, 0.035, 0.07]);
      limb("#283b50", [side * 0.12, 0.53, 0.04], [side * 0.12, 0.49, 0.35], 0.085);
      limb("#283b50", [side * 0.12, 0.48, 0.35], [side * 0.12, 0.105, 0.36], 0.064);
      part("sphere", "#26303b", [side * 0.12, 0.065, 0.42], [0.082, 0.055, 0.145]);
      if (look.glasses) part("torus", look.glasses, [side * 0.057, 1.345, 0.163], [0.048, 0.034, 0.04]);
      if (id === "lisa") part("sphere", "#c8d4df", [side * 0.15, 1.265, 0.025], [0.014, 0.023, 0.014]);
    }
    part("sphere", look.skin, [0, 1.30, 0.151], [0.025, 0.033, 0.025]);
    if (look.glasses) part("box", look.glasses, [0, 1.345, 0.166], [0.025, 0.007, 0.007]);
  }
  return groups;
}

function PeopleInstances({ shape, parts, onSelect }: { shape: Shape; parts: Part[]; onSelect: (id: string) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    parts.forEach((part, index) => { mesh.setMatrixAt(index, part.matrix); mesh.setColorAt(index, part.color); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [parts]);
  return <instancedMesh ref={ref} args={[undefined, undefined, parts.length]} castShadow receiveShadow onClick={event => {
    if (event.instanceId === undefined) return;
    const part = parts[event.instanceId];
    if (part) { event.stopPropagation(); onSelect(part.id); }
  }}>
    {shape === "sphere" ? <sphereGeometry args={[1, 14, 10]} /> : shape === "capsule" ? <capsuleGeometry args={[0.5, 1, 4, 8]} /> : shape === "torus" ? <torusGeometry args={[1, 0.08, 4, 16]} /> : <boxGeometry args={[1, 1, 1]} />}
    <meshStandardMaterial roughness={0.85} />
  </instancedMesh>;
}

export function PreviewPeople({ ids, onSelect }: { ids: string[]; onSelect: (id: string) => void }) {
  const groups = useMemo(() => makePeople(ids), [ids]);
  return <group name="Original static preview figures">{(Object.entries(groups) as [Shape, Part[]][]).filter(([, parts]) => parts.length).map(([shape, parts]) => <PeopleInstances key={shape} shape={shape} parts={parts} onSelect={onSelect} />)}</group>;
}
