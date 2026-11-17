"""Original, reproducible Enztronic environment production proof.

Run in Blender 4.5 LTS:
  blender --background --factory-startup --threads 4 --python this_file.py

Models remain private proof assets. This script never changes the approved asset
registry, the authoritative floorplan, production configuration or business data.
Author coordinates are the handoff's meters / +Y up / +Z rear. They are converted
to Blender (x, -z, y); Blender's Y-up glTF export returns the exact handoff axes.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
PROOF = ROOT / "office-assets" / "proof"
ASSETS = PROOF / "assets" / "office"
SOURCES = PROOF / "source" / "office"
REPORTS = PROOF / "reports"
RENDERS = PROOF / "renders"
PLAN_PATH = ROOT / "office-spec" / "data" / "floorplan.json"
PLAN = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
MANIFEST = json.loads((ROOT / "office-spec" / "data" / "asset-manifest.json").read_text(encoding="utf-8"))
MATERIALS = {}
PARTS = []
COMPONENTS = {}


def task(v):
    return Vector((v[0], -v[2], v[1]))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    bpy.context.scene.render.threads_mode = "FIXED"
    bpy.context.scene.render.threads = 4


def material(name, color, roughness=0.55, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    MATERIALS[name] = mat
    return mat


def palette():
    MATERIALS.clear()
    material("Warm limestone", (0.68, 0.61, 0.50), 0.78)
    material("Chalk plaster", (0.83, 0.80, 0.72), 0.84)
    material("Natural oak", (0.51, 0.32, 0.15), 0.40)
    material("Oak end grain", (0.36, 0.20, 0.085), 0.46)
    material("Deep navy upholstery", (0.025, 0.055, 0.105), 0.83)
    material("Cobalt woven accent", (0.035, 0.16, 0.38), 0.70)
    material("Graphite powdercoat", (0.048, 0.065, 0.080), 0.38, 0.28)
    material("Satin porcelain", (0.68, 0.65, 0.57), 0.32)
    material("Leaf green", (0.085, 0.23, 0.115), 0.64)
    material("Leaf light", (0.19, 0.37, 0.17), 0.62)
    material("Dark soil", (0.045, 0.030, 0.020), 0.95)
    material("Display glass", (0.013, 0.031, 0.049), 0.24, 0.12)
    material("Display muted blue", (0.05, 0.16, 0.26), 0.52)


def add_part(obj, mat):
    obj.data.materials.append(MATERIALS[mat])
    PARTS.append(obj)
    return obj


def box(name, center, size, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=task(center))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("Authored soft edge", "BEVEL")
        mod.width = min(bevel, min(size) / 3)
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
        normal = obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
        bpy.ops.object.modifier_apply(modifier=normal.name)
    return add_part(obj, mat)


def cylinder(name, center, radius, depth, mat, vertices=16, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=task(center))
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=r2, depth=depth, location=task(center))
    obj = bpy.context.object
    obj.name = name
    for poly in obj.data.polygons:
        poly.use_smooth = len(poly.vertices) == 4
    return add_part(obj, mat)


def rod(name, a, b, radius, mat, vertices=10):
    va, vb = task(a), task(b)
    obj = cylinder(name, (0, 0, 0), radius, (vb - va).length, mat, vertices)
    obj.location = (va + vb) / 2
    obj.rotation_euler = (vb - va).to_track_quat("Z", "Y").to_euler()
    return obj


def component(name, metadata=None):
    global PARTS
    bpy.ops.object.select_all(action="DESELECT")
    for obj in PARTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    if len(PARTS) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name + "_editable_mesh"
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj["units"] = "meters"
    obj["pivot"] = "floor-plan center at local Y=0; task +Z forward"
    obj["original_geometry"] = True
    if metadata:
        for key, value in metadata.items():
            obj[key] = value
    COMPONENTS[name] = obj
    PARTS = []
    return obj


def table(name, width, depth, height=0.75, review=False):
    box("Solid oak softened top", (0, height - 0.025, 0), (width, 0.05, depth), "Natural oak", 0.018)
    box("Dark oak apron", (0, height - 0.07, 0), (width - 0.12, 0.04, depth - 0.12), "Oak end grain", 0.008)
    for x in (-1, 1):
        if review:
            # Two trestles preserve knee space and visually distinguish the shared table.
            xx = x * (width * 0.31)
            box("Trestle vertical", (xx, 0.35, 0), (0.10, 0.70, depth * 0.63), "Graphite powdercoat", 0.012)
        else:
            for z in (-1, 1):
                xx, zz = x * (width / 2 - 0.085), z * (depth / 2 - 0.085)
                rod("Oak tapered leg", (xx * 1.02, 0.015, zz * 1.02), (xx, height - 0.07, zz), 0.026, "Natural oak", 10)
                cylinder("Floor glide", (xx * 1.02, 0.008, zz * 1.02), 0.029, 0.016, "Natural oak", 10)
    component(name, {"top_surface_m": height})


def desk_chair():
    # The caster tips deliberately define the accepted 0.8 x 0.8 envelope.
    for angle in (index * 2 * math.pi / 5 for index in range(5)):
        endpoint = (math.sin(angle) * 0.365, 0.075, math.cos(angle) * 0.365)
        rod("Cast base spoke", (0, 0.13, 0), endpoint, 0.025, "Graphite powdercoat")
        wheel = cylinder("Soft caster", (endpoint[0], 0.035, endpoint[2]), 0.035, 0.04, "Graphite powdercoat", 12)
        wheel.rotation_euler = task((math.cos(angle), 0, -math.sin(angle))).to_track_quat("Z", "Y").to_euler()
    # Five-spoke silhouettes have asymmetric AABBs. Center only the caster base
    # geometry so the reusable seat/root can stay at the authored dock center.
    bpy.context.view_layer.update()
    base_points = [obj.matrix_world @ Vector(p) for obj in PARTS for p in obj.bound_box]
    base_center_x = (min(p.x for p in base_points) + max(p.x for p in base_points)) / 2
    base_center_y = (min(p.y for p in base_points) + max(p.y for p in base_points)) / 2
    for obj in PARTS:
        obj.location.x -= base_center_x
        obj.location.y -= base_center_y
    cylinder("Gas lift", (0, 0.265, 0), 0.037, 0.30, "Graphite powdercoat")
    box("Seat cushion", (0, 0.425, 0.015), (0.52, 0.09, 0.48), "Deep navy upholstery", 0.035)
    box("Seat piping", (0, 0.40, 0.015), (0.525, 0.018, 0.485), "Cobalt woven accent", 0.008)
    box("Support yoke", (0, 0.67, -0.24), (0.085, 0.44, 0.065), "Graphite powdercoat", 0.015)
    box("Ergonomic upholstered back", (0, 0.805, -0.27), (0.51, 0.49, 0.12), "Deep navy upholstery", 0.048)
    box("Lumbar seam", (0, 0.715, -0.202), (0.36, 0.018, 0.008), "Cobalt woven accent", 0.003)
    for side in (-1, 1):
        rod("Arm stem", (side * 0.25, 0.43, -0.13), (side * 0.29, 0.64, -0.13), 0.018, "Graphite powdercoat")
        box("Arm pad", (side * 0.29, 0.65, -0.04), (0.065, 0.045, 0.30), "Deep navy upholstery", 0.018)
    obj = component("DeskChair", {"seat_surface_m": 0.47, "height_m": 1.05})
    obj.dimensions = (0.8, 0.8, 1.05)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def review_chair():
    box("Upholstered seat", (0, 0.43, 0.02), (0.56, 0.08, 0.54), "Deep navy upholstery", 0.028)
    box("Wrap back", (0, 0.725, -0.31), (0.70, 0.45, 0.18), "Deep navy upholstery", 0.06)
    for x in (-1, 1):
        for z in (-1, 1):
            rod("Splayed oak leg", (x * 0.32, 0.025, z * 0.36), (x * 0.23, 0.42, z * 0.21), 0.025, "Natural oak")
    # Foot pads bound depth at precisely 0.8 m while keeping the seat compact.
    for x in (-1, 1):
        for z in (-1, 1):
            box("Oak foot glide", (x * 0.32, 0.012, z * 0.375), (0.055, 0.024, 0.05), "Natural oak", 0.006)
    component("ReviewChair", {"seat_surface_m": 0.47})


def lounge(name, width, depth, height, armchair=False):
    box("Oak lower frame", (0, 0.20, 0), (width - 0.04, 0.16, depth - 0.04), "Natural oak", 0.025)
    for x in (-1, 1):
        for z in (-1, 1):
            cylinder("Short turned foot", (x * (width / 2 - 0.09), 0.07, z * (depth / 2 - 0.09)), 0.035, 0.14, "Natural oak", 10)
    box("Upholstered back", (0, (height + 0.32) / 2, -depth / 2 + 0.10), (width, height - 0.32, 0.20), "Deep navy upholstery", 0.065)
    for x in (-1, 1):
        box("Rounded armrest", (x * (width / 2 - 0.075), 0.48, 0), (0.15, 0.43, depth), "Deep navy upholstery", 0.055)
    n = 1 if armchair else 2
    span = (width - 0.34) / n
    for index in range(n):
        xx = (index + 0.5) * span - (width - 0.34) / 2
        box("Loose seat cushion", (xx, 0.405, 0.055), (span - 0.018, 0.13, depth - 0.24), "Cobalt woven accent" if armchair else "Deep navy upholstery", 0.035)
    component(name, {"seat_surface_m": 0.47, "capacity": n})


def cabinet():
    # Width is 0.6 m along local X; depth 1.6 m along local Z, per floorplan.
    box("Oak carcase", (0, 0.49, 0), (0.60, 0.98, 1.60), "Natural oak", 0.025)
    box("Stone countertop", (0, 1.025, 0), (0.60, 0.09, 1.60), "Satin porcelain", 0.015)
    for z in (-0.38, 0.38):
        box("Cabinet navy doors", (-0.294, 0.50, z), (0.012, 0.81, 0.71), "Deep navy upholstery", 0.006)
        rod("Recessed door pull", (-0.294, 0.67, z - 0.09), (-0.294, 0.67, z + 0.09), 0.006, "Graphite powdercoat")
    # A flush recessed hot-drink tray avoids extending above the 1.1 m envelope.
    box("Coffee tray", (0, 1.085, 0.17), (0.39, 0.03, 0.64), "Graphite powdercoat", 0.012)
    component("CoffeeCabinet", {"top_surface_m": 1.1})


def shelf():
    box("Oak back", (0, 0.55, 0.185), (2.0, 1.10, 0.03), "Natural oak", 0.008)
    for x in (-0.98, 0, 0.98):
        box("Oak upright", (x, 0.55, 0), (0.04, 1.10, 0.4), "Natural oak", 0.008)
    for y in (0.025, 0.55, 1.075):
        box("Oak shelf", (0, y, 0), (2.0, 0.05, 0.4), "Natural oak", 0.008)
    for i in range(12):
        x = -0.82 + (i % 6) * 0.14
        y = 0.78 if i < 6 else 0.255
        box("Bound reference volumes", (x, y, -0.025), (0.09, 0.34 + (i % 3) * 0.025, 0.26), "Deep navy upholstery" if i % 3 else "Cobalt woven accent", 0.004)
    component("LowShelf_200x040")


def leaf(name, start, end, width, mat):
    # Four-sided gently bent leaf: original solid geometry, no alpha textures.
    start, end = Vector(start), Vector(end)
    direction = end - start
    side = Vector((direction.z, 0, -direction.x)).normalized() * width / 2
    middle = start.lerp(end, 0.6) + Vector((0, 0.035, 0))
    verts = [task(start), task(middle + side), task(end), task(middle - side), task(middle + Vector((0, 0.018, 0)))]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    add_part(obj, mat)


def plant():
    cylinder("Tapered ceramic planter", (0, 0.225, 0), 0.17, 0.45, "Satin porcelain", 20, r2=0.21)
    cylinder("Visible soil", (0, 0.451, 0), 0.195, 0.006, "Dark soil", 20)
    rod("Plant stem", (0, 0.45, 0), (0, 1.4, 0), 0.012, "Leaf green")
    for i in range(18):
        angle = i * 2.39996
        y = 0.58 + (i % 6) * 0.13
        spread = 0.20 if i < 15 else 0.235
        end = (math.cos(angle) * spread, min(y + 0.25, 1.4), math.sin(angle) * spread)
        start = (0, y, 0)
        rod("Leaf petiole", start, tuple(Vector(start).lerp(Vector(end), 0.35)), 0.005, "Leaf green", 6)
        leaf("Sculpted leaf", start, end, 0.11, "Leaf light" if i % 4 == 0 else "Leaf green")
    obj = component("Plant")
    obj.dimensions = (0.5, 0.5, 1.4)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def monitor():
    box("Monitor base", (0, 0.0125, 0), (0.28, 0.025, 0.20), "Graphite powdercoat", 0.012)
    box("Monitor stem", (0, 0.14, 0), (0.065, 0.25, 0.055), "Graphite powdercoat", 0.008)
    box("Monitor frame", (0, 0.36, 0), (0.62, 0.36, 0.045), "Graphite powdercoat", 0.012)
    # A monitor's screen faces the user at local -Z (chair forward is local +Z).
    box("Blank monitor glass", (0, 0.36, -0.025), (0.585, 0.322, 0.006), "Display glass", 0.006)
    component("Monitor", {"pivot_note": "desk surface center; screen faces local -Z; no fabricated task content"})


def keyboard():
    box("Keyboard case", (-0.045, 0.014, 0), (0.39, 0.028, 0.13), "Graphite powdercoat", 0.009)
    for row in range(4):
        for col in range(12):
            box("Keyboard key", (-0.219 + col * 0.029, 0.032, -0.043 + row * 0.028), (0.023, 0.009, 0.021), "Satin porcelain", 0.002)
    box("Mouse", (0.23, 0.019, 0.003), (0.065, 0.038, 0.10), "Graphite powdercoat", 0.018)
    component("KeyboardMouse", {"pivot_note": "desk surface center; all detail within parent desk footprint"})


LETTER_PATHS = {
    "E": [[(0.9, 1), (0, 1), (0, 0), (0.9, 0)], [(0, 0.5), (0.75, 0.5)]],
    "N": [[(0, 0), (0, 1), (0.9, 0), (0.9, 1)]],
    "Z": [[(0, 1), (0.9, 1), (0, 0), (0.9, 0)]],
    "T": [[(0, 1), (1, 1)], [(0.5, 1), (0.5, 0)]],
    "R": [[(0, 0), (0, 1), (0.7, 1), (0.9, 0.85), (0.9, 0.65), (0.7, 0.5), (0, 0.5)], [(0.45, 0.5), (0.95, 0)]],
    "O": [[(0.2, 0), (0, 0.2), (0, 0.8), (0.2, 1), (0.7, 1), (0.9, 0.8), (0.9, 0.2), (0.7, 0), (0.2, 0)]],
    "I": [[(0.15, 1), (0.75, 1)], [(0.45, 1), (0.45, 0)], [(0.15, 0), (0.75, 0)]],
    "C": [[(0.9, 0.85), (0.7, 1), (0.2, 1), (0, 0.8), (0, 0.2), (0.2, 0), (0.7, 0), (0.9, 0.15)]],
}


def wall_panels():
    box("Project board oak frame", (0, 0.575, 0), (3.5, 1.15, 0.045), "Natural oak", 0.012)
    box("Blank pinboard", (0, 0.575, 0.027), (3.42, 1.07, 0.01), "Chalk plaster", 0.006)
    component("ProjectBoard", {"content": "blank; task and activity text remains DOM-owned"})
    box("Shared display frame", (0, 0.525, 0), (1.8, 1.05, 0.045), "Graphite powdercoat", 0.018)
    box("Blank review display", (0, 0.525, 0.027), (1.74, 0.99, 0.01), "Display glass", 0.012)
    component("SharedDisplay", {"content": "blank; no illustrative work presented as real activity"})
    box("Brand plaque", (0, 0.175, 0), (2.3, 0.35, 0.04), "Deep navy upholstery", 0.015)
    # Original geometric stroke lettering, no loaded font or third-party logo file.
    letters = "ENZTRONIC"
    height, width, gap = 0.17, 0.145, 0.055
    span = len(letters) * width + (len(letters) - 1) * gap
    for index, letter in enumerate(letters):
        left = -span / 2 + index * (width + gap)
        for path in LETTER_PATHS[letter]:
            for a, b in zip(path[:-1], path[1:]):
                start = (left + a[0] * width, 0.085 + a[1] * height, 0.025)
                end = (left + b[0] * width, 0.085 + b[1] * height, 0.025)
                rod("Original " + letter + " stroke", start, end, 0.010, "Satin porcelain", 6)
    component("BrandPlaque", {"text": "ENZTRONIC", "font_source": "original geometric polylines in this script; no external font"})


def metrics(obj):
    pts = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
    task_pts = [(p.x, p.z, -p.y) for p in pts]
    lo = [min(p[i] for p in task_pts) for i in range(3)]
    hi = [max(p[i] for p in task_pts) for i in range(3)]
    mesh = obj.data
    mesh.calc_loop_triangles()
    return {"name": obj.name, "min_xyz_m": lo, "max_xyz_m": hi, "size_xyz_m": [hi[i] - lo[i] for i in range(3)], "triangles": len(mesh.loop_triangles), "vertices": len(mesh.vertices), "materials": sorted({m.name for m in mesh.materials if m}), "pivot_xyz_m": [0, 0, 0], "transforms_applied": all(abs(v) < 1e-8 for v in obj.location) and all(abs(v) < 1e-8 for v in obj.rotation_euler) and all(abs(v - 1) < 1e-8 for v in obj.scale)}


def save_export(stem, objects):
    source = SOURCES / (stem + ".blend")
    bpy.context.scene["asset_stage"] = "original technical proof; final browser and owner acceptance pending"
    bpy.context.scene["generator"] = str(Path(__file__).relative_to(ROOT)).replace("\\", "/")
    bpy.context.scene["coordinate_policy"] = "Blender x,-z,y; glTF export Y-up -> handoff x,y,z; meters"
    bpy.context.scene["source_reference"] = "office-spec/data/floorplan.json"
    bpy.context.scene["provenance"] = "Original procedural mesh and PBR material definitions by Codex for Enztronic; no downloaded meshes/textures/fonts"
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    target = ASSETS / (stem + ".glb")
    bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_texcoords=False, export_normals=True, export_materials="EXPORT", export_animations=False, export_cameras=False, export_lights=False, export_extras=True)
    return {"glb": str(target.relative_to(PROOF)).replace("\\", "/"), "native_source": str(source.relative_to(PROOF)).replace("\\", "/"), "bytes": target.stat().st_size, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "nodes": [metrics(obj) for obj in objects]}


def shell():
    reset()
    palette()
    COMPONENTS.clear()
    box("Finished slab", (9, -0.125, 6.5), (18, 0.25, 13), "Warm limestone")
    component("FloorSlab", {"pivot": "room front-left finished-floor corner [0,0,0]"})
    box("Rear plaster wall", (9, 1.6, 12.925), (18, 3.2, 0.15), "Chalk plaster")
    component("WallRear", {"pivot": "room front-left finished-floor corner [0,0,0]"})
    box("Left lowered plaster wall", (0.075, 0.55, 6.5), (0.15, 1.1, 13), "Chalk plaster")
    component("WallLeftCutaway", {"pivot": "room front-left finished-floor corner [0,0,0]"})
    return save_export("office-shell", list(COMPONENTS.values()))


def furniture():
    reset()
    palette()
    COMPONENTS.clear()
    table("Desk_160x080", 1.6, 0.8)
    table("Desk_180x080", 1.8, 0.8)
    desk_chair()
    table("ReviewTable_360x140", 3.6, 1.4, review=True)
    review_chair()
    lounge("ClientArmchair", 0.85, 0.85, 0.95, True)
    table("ClientSideTable", 0.55, 0.55, 0.5)
    lounge("Sofa2", 2.0, 0.9, 0.9)
    cabinet()
    shelf()
    plant()
    monitor()
    keyboard()
    wall_panels()
    return save_export("studio-furniture", list(COMPONENTS.values()))


def verify_sources(report):
    results = []
    for asset in report["assets"]:
        source = PROOF / asset["native_source"]
        bpy.ops.wm.open_mainfile(filepath=str(source))
        measured = {o.name: metrics(o) for o in bpy.context.scene.objects if o.type == "MESH"}
        failures = []
        for expected in asset["nodes"]:
            actual = measured.get(expected["name"])
            if not actual:
                failures.append("Missing " + expected["name"])
            elif any(abs(a - b) > 0.000001 for a, b in zip(actual["size_xyz_m"], expected["size_xyz_m"])):
                failures.append("Changed bounds " + expected["name"])
        results.append({"source": asset["native_source"], "opened_in_blender": True, "version": bpy.app.version_string, "mesh_nodes": len(measured), "bounds_roundtrip_errors": failures})
    return results


def instance(template, identity, location, yaw=0):
    obj = template.copy()
    obj.data = template.data
    obj.name = identity
    obj.hide_render = False
    obj.hide_viewport = False
    obj.location = task(location)
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = (0, 0, yaw)
    bpy.context.collection.objects.link(obj)
    return obj


def setup_camera(location, target, objects, width, height):
    bpy.ops.object.camera_add(location=task(location))
    camera = bpy.context.object
    camera.name = "Proof camera"
    camera.rotation_euler = (task(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.sensor_fit = "VERTICAL"
    bpy.context.view_layer.update()
    inv = camera.matrix_world.inverted()
    pts = [inv @ (obj.matrix_world @ Vector(p)) for obj in objects if obj.type == "MESH" for p in obj.bound_box]
    xspan = max(p.x for p in pts) - min(p.x for p in pts)
    yspan = max(p.y for p in pts) - min(p.y for p in pts)
    camera.data.ortho_scale = max(yspan, xspan / (width / height)) * 1.16
    # Center the image on projected bounds rather than assuming room center projects to center.
    mid_x = (max(p.x for p in pts) + min(p.x for p in pts)) / 2
    mid_y = (max(p.y for p in pts) + min(p.y for p in pts)) / 2
    camera.location += camera.rotation_euler.to_matrix() @ Vector((mid_x, mid_y, 0))
    camera.data.clip_start = 0.1
    camera.data.clip_end = 150
    bpy.context.scene.camera = camera
    return camera


def render(stem, location, target, objects, width=1440, height=1000, samples=48):
    scene = bpy.context.scene
    setup_camera(location, target, objects, width, height)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(RENDERS / (stem + ".png"))
    scene.view_settings.view_transform = "AgX"
    scene.render.film_transparent = False
    bpy.ops.render.render(write_still=True)
    return {"image": "renders/" + stem + ".png", "renderer": "Blender Cycles CPU", "samples": samples, "threads": 4, "resolution_px": [width, height], "source": "actual imported proof GLB meshes", "not_browser_evidence": True}


def daylight():
    world = bpy.data.worlds.new("Soft studio daylight")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.72, 0.77, 0.82, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.45
    bpy.context.scene.world = world
    for name, location, energy, size, color in [
        ("Large soft daylight", (8, 12, -4), 3200, 10, (1.0, 0.88, 0.72)),
        ("Open side fill", (22, 8, 5), 1800, 9, (0.72, 0.82, 1.0)),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.shape, data.size = energy, "DISK", size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = task(location)
        obj.rotation_euler = (task((9, 0, 6)) - obj.location).to_track_quat("-Z", "Y").to_euler()


def overview(report):
    reset()
    bpy.ops.import_scene.gltf(filepath=str(ASSETS / "office-shell.glb"))
    shell_objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.import_scene.gltf(filepath=str(ASSETS / "studio-furniture.glb"))
    templates = {o.name: o for o in bpy.context.selected_objects if o.type == "MESH"}
    for obj in templates.values():
        obj.hide_render = True
        obj.hide_viewport = True
    # glTF import converted the axes back to Blender. Template roots remain applied.
    names = {"desk_chair": "DeskChair", "review_table": "ReviewTable_360x140", "review_chair": "ReviewChair", "client_armchair": "ClientArmchair", "client_side_table": "ClientSideTable", "sofa": "Sofa2", "coffee_cabinet": "CoffeeCabinet", "low_shelf": "LowShelf_200x040", "plant": "Plant"}
    all_objects = list(shell_objects)
    bound_failures = []
    for obstacle in PLAN["obstacles"]:
        if obstacle["category"] == "wall":
            continue
        name = "Desk_180x080" if obstacle["id"] == "desk_adrian" else "Desk_160x080" if obstacle["category"] == "desk" else names[obstacle["category"]]
        obj = instance(templates[name], obstacle["id"], (obstacle["center"]["x"], 0, obstacle["center"]["z"]), obstacle["yaw_radians"])
        all_objects.append(obj)
        bpy.context.view_layer.update()
        actual = metrics(obj)
        expected = obstacle["box"]
        if actual["min_xyz_m"][0] < expected["min_x"] - 0.02 or actual["max_xyz_m"][0] > expected["max_x"] + 0.02 or actual["min_xyz_m"][2] < expected["min_z"] - 0.02 or actual["max_xyz_m"][2] > expected["max_z"] + 0.02:
            bound_failures.append({"id": obstacle["id"], "actual": actual, "expected": expected})
    for desk in PLAN["workstations"]:
        x, z = desk["desk_center"]["x"], desk["desk_center"]["z"]
        yaw = desk["seat"]["yaw_radians"]
        all_objects.append(instance(templates["Monitor"], "monitor_" + desk["character_id"], (x, 0.75, z), yaw))
        all_objects.append(instance(templates["KeyboardMouse"], "keyboard_" + desk["character_id"], (x - math.sin(yaw) * 0.2, 0.75, z - math.cos(yaw) * 0.2), yaw))
    for feature in PLAN["non_blocking_features"]:
        name = "ProjectBoard" if feature["id"] == "project_board" else "BrandPlaque" if feature["id"] == "brand_sign" else "SharedDisplay"
        center = feature["center"]
        all_objects.append(instance(templates[name], feature["id"], (center["x"], center["y"] - feature["height_m"] / 2, center["z"]), math.pi))
    bpy.context.view_layer.update()
    daylight()
    c = PLAN["camera"]
    image = render("environment-overview", tuple(c["position"][a] for a in ("x", "y", "z")), tuple(c["target"][a] for a in ("x", "y", "z")), all_objects)
    report["assembled_layout"] = {"source": "office-spec/data/floorplan.json", "furniture_instances": len(all_objects) - len(shell_objects), "shell_nodes": len(shell_objects), "envelope_tolerance_m": 0.02, "out_of_envelope": bound_failures, "rendered_static_triangles": sum(metrics(o)["triangles"] for o in all_objects), "note": "Real static mesh bounds only; animated limbs, navigation capsule sweeps, docking and browser/GPU remain pending."}
    report["renders"] = [image]
    # Detail frame from the same imported environment, no new or substituted models.
    details = [o for o in all_objects if o.name in ("desk_sam", "chair_sam", "monitor_sam", "keyboard_sam")]
    report["renders"].append(render("environment-desk-detail", (19.5, 3.8, 4.4), (16.0, 0.75, 7.1), details, 1200, 1000, 48))


def independent_node_validation():
    """Use the project's actual Three loader and official Khronos validator.

    Headless parsing cannot establish a working WebGL renderer, visual identity,
    draw calls on hardware, animation docking or frame performance.
    """
    node = shutil.which("node")
    if not node:
        return {"status": "not_run", "reason": "Node executable unavailable"}
    code = r'''
import fs from 'node:fs';
import crypto from 'node:crypto';
import validator from 'gltf-validator';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const result={status:'headless_loader_technical_check',browserGPUVerified:false,productionApproved:false,assets:[]};
for(const stem of ['office-shell','studio-furniture']){
 const path='office-assets/proof/assets/office/'+stem+'.glb';
 const bytes=fs.readFileSync(path);
 const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 const checked=await validator.validateBytes(new Uint8Array(bytes),{uri:stem+'.glb',maxIssues:200,externalResourceFunction:async()=>{throw new Error('Self-contained proof must not fetch external resources');}});
 checked.proof={sha256,bytes:bytes.length,productionApproved:false};
 const validatorPath='office-assets/proof/reports/environment-'+stem+'-khronos.json';
 fs.writeFileSync(validatorPath,JSON.stringify(checked,null,2)+'\n');
 const array=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(array,'',resolve,reject));
 const nodes=gltf.scene.children.map(object=>{
  const bounds=new Box3().setFromObject(object),size=bounds.getSize(new Vector3());let triangles=0,primitives=0;
  object.traverse(child=>{if(child.isMesh){primitives++;triangles+=(child.geometry.index?.count??child.geometry.attributes.position.count)/3;}});
  return{name:object.name,min:bounds.min.toArray(),max:bounds.max.toArray(),size:size.toArray(),triangles,primitives};
 });
 result.assets.push({path,sha256,bytes:bytes.length,actualThreeLoaderParsed:true,validatorPath,validatorErrors:checked.issues.numErrors,validatorWarnings:checked.issues.numWarnings,nodes});
}
fs.writeFileSync('office-assets/proof/reports/environment-three-loader.json',JSON.stringify(result,null,2)+'\n');
if(result.assets.some(asset=>asset.validatorErrors>0))process.exitCode=1;
console.log(JSON.stringify(result.assets.map(asset=>({path:asset.path,bytes:asset.bytes,nodes:asset.nodes.length,validatorErrors:asset.validatorErrors,validatorWarnings:asset.validatorWarnings}))));
'''
    executed = subprocess.run([node, "--input-type=module", "-"], input=code, text=True, cwd=str(ROOT), capture_output=True, timeout=60, check=False)
    if executed.returncode:
        raise RuntimeError("Independent environment validation failed: " + executed.stderr + executed.stdout)
    print(executed.stdout)
    return {"status": "passed", "Khronos": ["reports/environment-office-shell-khronos.json", "reports/environment-studio-furniture-khronos.json"], "Three_loader": "reports/environment-three-loader.json", "browser_GPU_verified": False}


def main():
    for folder in (ASSETS, SOURCES, REPORTS, RENDERS):
        folder.mkdir(parents=True, exist_ok=True)
    report = {"status": "technical_proof_pending_visual_and_browser_acceptance", "production_approved": False, "blender_version": bpy.app.version_string, "blender_build_hash": bpy.app.build_hash.decode(), "units": "meters", "glTF_axes": "+Y up, +Z forward/rear", "generator": "scripts/office-modeling/build_office_environment.py", "generator_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "floorplan_sha256": hashlib.sha256(PLAN_PATH.read_bytes()).hexdigest(), "external_meshes_textures_fonts": [], "textures": [], "UV_usage": "Image textures are unused; UV attributes omitted from GLB export", "compression": "None; no decoder dependency", "materials": "Portable PBR constants; no Blender-only procedural nodes, no texture URLs", "provenance": "Original procedural geometry and letter polylines authored for this implementation; owner rights/visual acceptance pending, no purchased or downloaded asset inputs", "assets": [shell(), furniture()]}
    report["source_open_checks"] = verify_sources(report)
    target_by_name = {c["name"]: c for c in next(a for a in MANIFEST["required_assets"] if a["id"] == "studio_furniture")["components"]}
    dimensions = []
    for measured in report["assets"][1]["nodes"]:
        expected = target_by_name[measured["name"]]["proposed_dimensions_m"]
        diffs = {}
        for index, key in enumerate(("width_x", "height_y", "depth_z")):
            if expected.get(key) is not None:
                diffs[key] = measured["size_xyz_m"][index] - expected[key]
        dimensions.append({"name": measured["name"], "difference_from_spec_m": diffs, "within_0_02_m": all(abs(d) <= 0.020001 for d in diffs.values())})
    report["component_dimension_checks"] = dimensions
    overview(report)
    report["independent_validation"] = independent_node_validation()
    report["remaining_acceptance"] = ["Owner visual approval and source/provenance rights review", "Real browser WebGL on recorded hardware", "Animated dock and capsule clearance integration", "Full scene batching/draw-call and hardware performance evidence"]
    (REPORTS / "environment-production-proof.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("ENVIRONMENT_PROOF_REPORT=" + str(REPORTS / "environment-production-proof.json"))
    failures = [d["name"] for d in dimensions if not d["within_0_02_m"]]
    print("DIMENSION_FAILURES=" + json.dumps(failures))
    print("ENVELOPE_FAILURES=" + json.dumps([f["id"] for f in report["assembled_layout"]["out_of_envelope"]]))
    if failures or report["assembled_layout"]["out_of_envelope"] or any(check["bounds_roundtrip_errors"] for check in report["source_open_checks"]):
        raise RuntimeError("Environment source or dimension verification failed; inspect the retained proof report")


if __name__ == "__main__":
    main()
