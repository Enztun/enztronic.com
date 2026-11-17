"use client";

import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { Info, Maximize2, Minus, Plus, SlidersHorizontal } from "lucide-react";
import { floorplan, makeBlockout, makeFurnitureInstances, palette, type BoxPart } from "./scene-layout";
import { batchOfficeStaticModels, type StaticPlacement } from "./scene-static-batch";
import { PreviewPeople } from "./scene-preview-people";
import approvedRegistry from "./scene-assets.generated.json";
import styles from "./scene.module.css";

type Profile = { id: string; name: string; role?: string; state?: string };
export type OfficeSceneProps = {
  profiles: Profile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  reducedMotion?: boolean;
  paused?: boolean;
  quality?: "normal" | "low";
  onFallback?: (reason: string) => void;
};
type ApprovedAsset = { id: string; url: string; character_id?: string; sha256: string };
const approvedAssets = approvedRegistry.assets as ApprovedAsset[];
type Command = { type: "overview" | "zoom-in" | "zoom-out" | "left" | "right" | "forward" | "back"; serial: number };
const baseTarget = new THREE.Vector3(floorplan.camera.target.x, floorplan.camera.target.y, floorplan.camera.target.z);
const offset = new THREE.Vector3(floorplan.camera.position.x, floorplan.camera.position.y, floorplan.camera.position.z).sub(baseTarget);

class SceneErrorBoundary extends Component<{ children: ReactNode; onError: (reason: string) => void }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error: Error) {
    const unavailable = /^THREE\.WebGLRenderer: (?:Error creating WebGL context|WebGL 1 is not supported)/.test(error.message);
    this.props.onError(unavailable
      ? "This browser could not start WebGL 2. Open this preview in Chrome or Edge and enable graphics acceleration if needed. Your roster and tasks remain available in List view."
      : "The 3D scene could not load. Your roster and tasks remain available in List view.");
  }
  render() { return this.state.error ? null : this.props.children; }
}

function InstancedBoxes({ parts, color }: { parts: BoxPart[]; color: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D();
    parts.forEach((part, index) => {
      dummy.position.set(...part.position); dummy.scale.set(...part.size); dummy.rotation.set(0, part.yaw ?? 0, 0); dummy.updateMatrix();
      ref.current!.setMatrixAt(index, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [parts]);
  return <instancedMesh ref={ref} args={[undefined, undefined, parts.length]} castShadow receiveShadow raycast={() => null}>
    <boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={color} roughness={0.85} />
  </instancedMesh>;
}

// The registry is generated only after hash-bound validator, provenance, source,
// bounds and browser evidence passes. Missing models cause no network requests.
function ApprovedModel({ asset, moving }: { asset: ApprovedAsset; moving: boolean }) {
  const gltf = useGLTF(asset.url);
  const object = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, object);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const action = actions.seated_idle;
    if (action) { action.reset().play().setEffectiveTimeScale(moving ? 1 : 0); }
    invalidate();
    return () => { action?.stop(); };
  }, [actions, moving, invalidate]);
  useEffect(() => () => {
    // SkeletonUtils clones own their skeleton/bone texture, while geometry/materials stay cached.
    // Skeleton.dispose clears boneTexture, so StrictMode replay still permits a fresh upload.
    const skeletons = new Set<THREE.Skeleton>();
    object.traverse(node => { if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
  }, [object]);
  useFrame(() => { if (moving && actions.seated_idle?.isRunning()) invalidate(); });
  return <primitive object={object} dispose={null} />;
}

function ApprovedStaticModels({ shell, furniture, instances }: { shell?: ApprovedAsset; furniture?: ApprovedAsset; instances: ReturnType<typeof makeFurnitureInstances> }) {
  const urls = useMemo(() => [shell, furniture].filter((asset): asset is ApprovedAsset => !!asset).map(asset => asset.url), [shell, furniture]);
  const models = useGLTF(urls);
  const shellModel = shell ? models[0] : undefined;
  const furnitureModel = furniture ? models[shell ? 1 : 0] : undefined;
  const target = useRef<THREE.Group>(null);
  const placements = useMemo(() => {
    if (shellModel?.animations.length || furnitureModel?.animations.length) throw new Error("Static office models unexpectedly contain animations.");
    const placements: StaticPlacement[] = [];
    if (shellModel) placements.push({ id: "office_shell", source: shellModel.scene });
    if (furnitureModel) for (const instance of instances) {
      const source = furnitureModel.scene.getObjectByName(instance.node);
      if (!source) throw new Error(`Validated model no longer contains ${instance.node}`);
      placements.push({ id: instance.id, source, position: instance.position, yaw: instance.yaw });
    }
    return placements;
  }, [shellModel, furnitureModel, instances]);
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => {
    const parent = target.current;
    if (!parent) return;
    // StrictMode replays setup/cleanup. Each setup owns fresh buffers, never a disposed memo.
    const batch = batchOfficeStaticModels(placements);
    parent.add(batch.group); invalidate();
    return () => { parent.remove(batch.group); batch.dispose(); };
  }, [placements, invalidate]);
  // Only generated geometry is disposed. Materials/textures remain owned by the GLTF cache.
  return <group ref={target} dispose={null} />;
}

function AgentMarker({ profile, selected, onSelect, moving }: { profile: Profile; selected: boolean; onSelect: () => void; moving: boolean }) {
  const workstation = floorplan.workstations.find((desk) => desk.character_id === profile.id);
  if (!workstation) return null;
  const asset = approvedAssets.find((candidate) => candidate.character_id === profile.id);
  return <group position={[workstation.seat.x, 0, workstation.seat.z]}>
    <group rotation={[0, workstation.seat.yaw_radians, 0]} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
      {asset ? <ApprovedModel asset={asset} moving={moving} /> : null}
    </group>
    <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[0.39, selected ? 0.48 : 0.42, 32]} /><meshBasicMaterial color={selected ? "#3478f1" : "#6d7d8d"} transparent opacity={selected ? 1 : 0.5} />
    </mesh>
    <Html position={[0, 2.35, 0]} center zIndexRange={[12, 1]}>
      <button type="button" onClick={onSelect} aria-pressed={selected} title={`${profile.name}${profile.role ? ` · ${profile.role}` : ""}`} className={styles.personName}>
        {profile.name}<span className="sr-only">{profile.state ? `, ${profile.state}` : ""}</span>
      </button>
    </Html>
  </group>;
}

/* eslint-disable react-hooks/immutability -- R3F owns this mutable Three.js camera. Projection and frame-loop updates must mutate it without React state updates per frame. */
function CameraRig({ selectedId, reducedMotion, command }: { selectedId: string | null; reducedMotion: boolean; command: Command }) {
  const { camera, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const tween = useRef<{ from: THREE.Vector3; to: THREE.Vector3; zoomFrom: number; zoomTo: number; elapsed: number } | null>(null);
  const reduced = useRef(reducedMotion);
  useEffect(() => { reduced.current = reducedMotion; }, [reducedMotion]);
  const setTarget = useCallback((target: THREE.Vector3, zoom: number, immediate = false) => {
    const controller = controls.current;
    if (!controller) return;
    target.x = THREE.MathUtils.clamp(target.x, floorplan.camera.pan_target_bounds.min_x, floorplan.camera.pan_target_bounds.max_x);
    target.z = THREE.MathUtils.clamp(target.z, floorplan.camera.pan_target_bounds.min_z, floorplan.camera.pan_target_bounds.max_z);
    const zoomTo = THREE.MathUtils.clamp(zoom, floorplan.camera.relative_zoom_min, floorplan.camera.relative_zoom_max);
    if (immediate || reduced.current) {
      tween.current = null; controller.target.copy(target); camera.position.copy(target).add(offset); camera.zoom = zoomTo; camera.updateProjectionMatrix(); controller.update();
    } else tween.current = { from: controller.target.clone(), to: target.clone(), zoomFrom: camera.zoom, zoomTo, elapsed: 0 };
    invalidate();
  }, [camera, invalidate]);
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    camera.position.copy(baseTarget).add(offset); camera.lookAt(baseTarget); camera.updateMatrixWorld();
    const inverse = camera.quaternion.clone().invert();
    const points: THREE.Vector3[] = [];
    for (const x of [0, floorplan.room.width_x]) for (const y of [0, floorplan.room.wall_height_y]) for (const z of [0, floorplan.room.depth_z]) points.push(new THREE.Vector3(x, y, z).sub(baseTarget).applyQuaternion(inverse));
    const width = 2 * Math.max(...points.map((p) => Math.abs(p.x)));
    const height = 2 * Math.max(...points.map((p) => Math.abs(p.y)));
    const span = Math.max(height, width / Math.max(size.width / size.height, 0.1)) * 1.12;
    camera.left = -span * size.width / size.height / 2; camera.right = -camera.left; camera.top = span / 2; camera.bottom = -span / 2;
    camera.near = floorplan.camera.near; camera.far = floorplan.camera.far; camera.zoom = 1; camera.updateProjectionMatrix();
    if (controls.current) { controls.current.target.copy(baseTarget); controls.current.update(); }
    tween.current = null; invalidate();
  }, [camera, size.width, size.height, invalidate]);
  useEffect(() => {
    const workstation = floorplan.workstations.find((desk) => desk.character_id === selectedId);
    if (workstation) setTarget(new THREE.Vector3(workstation.seat.x, baseTarget.y, workstation.seat.z), 1.65);
  }, [selectedId, setTarget]);
  useEffect(() => {
    const controller = controls.current;
    if (!controller) return;
    if (command.type === "overview") setTarget(baseTarget.clone(), 1);
    else if (command.type === "zoom-in" || command.type === "zoom-out") setTarget(controller.target.clone(), camera.zoom * (command.type === "zoom-in" ? 1.2 : 1 / 1.2));
    else {
      const target = controller.target.clone();
      if (command.type === "left") target.x -= 1; if (command.type === "right") target.x += 1;
      if (command.type === "forward") target.z += 1; if (command.type === "back") target.z -= 1;
      setTarget(target, camera.zoom);
    }
  }, [command, camera, setTarget]);
  useEffect(() => { if (reducedMotion && tween.current) setTarget(tween.current.to.clone(), tween.current.zoomTo, true); }, [reducedMotion, setTarget]);
  useFrame((_, delta) => {
    if (!tween.current || !controls.current) return;
    const current = tween.current;
    current.elapsed += Math.min(delta, 0.05);
    const fraction = Math.min(current.elapsed / (floorplan.camera.focus_duration_ms / 1000), 1);
    const eased = fraction * fraction * (3 - 2 * fraction);
    controls.current.target.lerpVectors(current.from, current.to, eased); camera.position.copy(controls.current.target).add(offset);
    camera.zoom = THREE.MathUtils.lerp(current.zoomFrom, current.zoomTo, eased); camera.updateProjectionMatrix(); controls.current.update();
    if (fraction === 1) tween.current = null;
    else invalidate();
  });
  return <OrbitControls ref={controls} makeDefault enableRotate={false} enableDamping={false} enablePan minZoom={floorplan.camera.relative_zoom_min} maxZoom={floorplan.camera.relative_zoom_max} target={baseTarget} onStart={() => { tween.current = null; }} onChange={() => {
    const controller = controls.current;
    if (!controller || tween.current) return;
    const before = controller.target.clone();
    controller.target.x = THREE.MathUtils.clamp(before.x, 2, 16); controller.target.z = THREE.MathUtils.clamp(before.z, 2, 11); controller.target.y = baseTarget.y;
    camera.position.add(controller.target.clone().sub(before)); invalidate();
  }} />;
}
/* eslint-enable react-hooks/immutability */

function Room({ profiles, selectedId, onSelect, reducedMotion, paused, command, routes, quality, onReady, onLost }: OfficeSceneProps & { command: Command; routes: boolean; onReady: () => void; onLost: () => void }) {
  const shell = approvedAssets.find((asset) => asset.id === "office_shell");
  const furniture = approvedAssets.find((asset) => asset.id === "studio_furniture");
  const parts = useMemo(() => makeBlockout({ shell: !!shell, furniture: !!furniture }), [shell, furniture]);
  const instances = useMemo(() => makeFurnitureInstances(), []);
  const previewIds = useMemo(() => profiles.filter(profile => !approvedAssets.some(asset => asset.character_id === profile.id)).map(profile => profile.id), [profiles]);
  const { gl } = useThree();
  useEffect(() => {
    onReady();
    const canvas = gl.domElement;
    function lost(event: Event) { event.preventDefault(); onLost(); }
    canvas.addEventListener("webglcontextlost", lost);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [gl, onReady, onLost]);
  const nodes = new Map(floorplan.nodes.map((node) => [node.id, node]));
  return <>
    <color attach="background" args={["#dbe4ed"]} />
    <ambientLight intensity={1.5} /><hemisphereLight args={["#fff4dd", "#7b8d9a", 1.4]} />
    <directionalLight position={[5, 14, -5]} intensity={2.1} castShadow={quality !== "low"} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-15} shadow-camera-right={15} shadow-camera-top={15} shadow-camera-bottom={-15} shadow-normalBias={0.06} />
    {shell || furniture ? <ApprovedStaticModels shell={shell} furniture={furniture} instances={instances} /> : null}
    {Object.entries(parts).filter(([, boxes]) => boxes.length > 0).map(([key, boxes]) => <InstancedBoxes key={key} parts={boxes} color={palette[key as keyof typeof palette]} />)}
    {routes && floorplan.edges.map((edge, i) => {
      const from = nodes.get(edge.from)!, to = nodes.get(edge.to)!;
      return <Line key={`${edge.from}-${edge.to}-${i}`} points={[[from.x, 0.035, from.z], [to.x, 0.035, to.z]]} color="#4c7d8d" lineWidth={1.5} transparent opacity={0.55} raycast={() => null} />;
    })}
    <Html position={[7.4, 2.65, 12.75]} center transform rotation={[0, Math.PI, 0]} distanceFactor={2.6}><span aria-hidden="true" style={{ color: "#f1e8d9", fontSize: 18, fontWeight: 700, letterSpacing: 3, whiteSpace: "nowrap" }}>ENZTRONIC</span></Html>
    <PreviewPeople ids={previewIds} onSelect={onSelect} />
    {profiles.map((profile) => <AgentMarker key={profile.id} profile={profile} selected={profile.id === selectedId} onSelect={() => onSelect(profile.id)} moving={!reducedMotion && !paused} />)}
    <CameraRig selectedId={selectedId} reducedMotion={!!reducedMotion} command={command} />
  </>;
}

export default function OfficeScene(props: OfficeSceneProps) {
  const [quality, setQuality] = useState(props.quality ?? "normal");
  const [systemReduced, setSystemReduced] = useState(false);
  const [reduceSetting, setReduceSetting] = useState(false);
  const [paused, setPaused] = useState(props.paused ?? true);
  const [routes, setRoutes] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [inViewport, setInViewport] = useState(true);
  const sceneElement = useRef<HTMLElement>(null);
  const [command, setCommand] = useState<Command>({ type: "overview", serial: 0 });
  const reducedMotion = !!props.reducedMotion || systemReduced || reduceSetting;
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(media.matches); change(); media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const onFallback = props.onFallback;
  const fail = useCallback((reason: string) => { setFailure(reason); setReady(false); onFallback?.(reason); }, [onFallback]);
  const onReady = useCallback(() => setReady(true), []);
  const onLost = useCallback(() => fail("WebGL context was lost. The roster and tasks remain available in List view. Retry the scene or reduce quality."), [fail]);
  useEffect(() => {
    const change = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    const observer = new IntersectionObserver(([entry]) => setInViewport(entry.isIntersecting));
    if (sceneElement.current) observer.observe(sceneElement.current);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", change); };
  }, []);
  useEffect(() => {
    if (ready || failure) return;
    const timeout = window.setTimeout(() => fail("The scene did not become ready within 15 seconds. Your roster and tasks remain available in List view. Retry in low quality."), 15_000);
    return () => window.clearTimeout(timeout);
  }, [ready, failure, attempt, fail]);
  function run(type: Command["type"]) { setCommand((current) => ({ type, serial: current.serial + 1 })); }
  return <section ref={sceneElement} aria-label="3D office preview" className={styles.scene}>
    <div className={styles.viewport} aria-busy={!ready && !failure}>
      {!failure && <SceneErrorBoundary key={attempt} onError={fail}>
        {/* Canvas mounts its fallback even when supported; keep it inert and let renderer errors reach the boundary. */}
        <Canvas key={quality} orthographic frameloop="demand" dpr={quality === "low" ? 1 : [1, 1.5]} shadows={quality === "low" ? false : { type: THREE.PCFShadowMap }} camera={{ position: [31, 22.8, -15.5], near: 0.1, far: 100, zoom: 1 }} gl={{ antialias: quality !== "low", powerPreference: "low-power", alpha: false }} aria-label="Interactive 3D office with seven selectable preview figures and eight review seats" fallback={<span>Interactive 3D office preview. Profiles and tasks are also available below.</span>}>
          <Suspense fallback={null}><Room {...props} quality={quality} reducedMotion={reducedMotion} paused={paused || !documentVisible || !inViewport} command={command} routes={routes} onReady={onReady} onLost={onLost} /></Suspense>
        </Canvas>
      </SceneErrorBoundary>}
      {!ready && !failure && <p className={styles.loading} role="status">Opening your office…</p>}
      {failure && <div className={styles.failure}><p role="status">{failure}</p><button type="button" className={styles.button} onClick={() => { setQuality("low"); setFailure(null); setAttempt((value) => value + 1); }}>Retry in low quality</button></div>}
    </div>
    <div className={styles.controls} role="group" aria-label="Office scene controls">
      <button type="button" className={styles.button} onClick={() => run("overview")}><Maximize2 size={14} aria-hidden="true" />Overview</button>
      <div className={styles.zoom}>
        <button type="button" className={styles.button} onClick={() => run("zoom-out")} aria-label="Zoom out"><Minus size={15} aria-hidden="true" /></button>
        <button type="button" className={styles.button} onClick={() => run("zoom-in")} aria-label="Zoom in"><Plus size={15} aria-hidden="true" /></button>
      </div>
      <span className={styles.gestureHint}>Drag to pan · Scroll to zoom · PC: Ctrl + click and hold to pan</span>
      <details className={styles.options} onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary className={styles.button}><SlidersHorizontal size={14} aria-hidden="true" />View options</summary>
        <div className={styles.popover}>
          <label className={styles.quality}>Graphics<select value={quality} onChange={event => { setReady(false); setQuality(event.target.value as "normal" | "low"); }}><option value="normal">Standard</option><option value="low">Power saving</option></select></label>
          <p className={styles.optionsLabel}>Pan the room</p>
          <div className={styles.pan}>
            <button type="button" className={styles.button} onClick={() => run("left")} aria-label="Pan left">←</button><button type="button" className={styles.button} onClick={() => run("right")} aria-label="Pan right">→</button><button type="button" className={styles.button} onClick={() => run("forward")} aria-label="Pan toward rear">↑</button><button type="button" className={styles.button} onClick={() => run("back")} aria-label="Pan toward entry">↓</button>
          </div>
          <label className={styles.option}><input type="checkbox" checked={reduceSetting} onChange={event => setReduceSetting(event.target.checked)} />Reduce motion{systemReduced ? " (system setting on)" : ""}</label>
          <label className={styles.option}><input type="checkbox" checked={routes} onChange={event => setRoutes(event.target.checked)} />Show floor routes</label>
          {approvedAssets.some(asset => asset.character_id) ? <button type="button" className={styles.button} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? "Resume character motion" : "Pause character motion"}</button> : null}
        </div>
      </details>
      <details className={styles.information} onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary className={styles.infoButton} aria-label="About the 3D office" title="Select a person to open their profile. Open for preview details."><Info size={17} aria-hidden="true" /></summary>
        <div className={styles.popover}>
          <strong>Your office preview</strong>
          <p>Select a name or person to see their profile. On PC, hold Ctrl, click and hold, then drag to pan. Scroll to zoom, or use the zoom and view controls.</p>
          <p>The 18 × 13 m layout contains seven workstations and eight review seats. The owner seat is empty.</p>
          <p>{approvedAssets.length ? `${approvedAssets.length} validated models are loaded. Other room geometry and static preview figures are provisional.` : "These seven static figures are original stylized previews. Final rigged characters, furniture, animation and model validation are still pending."}</p>
          <p>The scene illustrates the team; task records and reviews show their work. Motion never proves a task is running.</p>
        </div>
      </details>
    </div>
  </section>;
}
