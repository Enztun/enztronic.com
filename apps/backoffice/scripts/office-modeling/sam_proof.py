"""Build Enztronic's private, unapproved one-character Sam rig/export proof.

Run with the verified portable Blender 4.5 LTS:
  blender --background --factory-startup --python scripts/office-modeling/sam_proof.py

All geometry, colors, skin weights and animation are authored here. No downloaded
mesh, portrait texture, auto-rig service or paid asset is used. This is a technical
and art-review proof, NOT a production approval or a runtime allowlist writer.
Native Blender axes: Z up, -Y forward. glTF export: meters, Y up, +Z forward.
"""

import hashlib
import json
import math
from pathlib import Path
import sys
import time

import bpy
from mathutils import Matrix, Vector

SCRIPT = Path(__file__).resolve()
APP = SCRIPT.parents[2]
OUT = APP / "office-assets" / "proof"
SRC = OUT / "source" / "office"
ASSET = OUT / "assets" / "office" / "characters"
REPORTS = OUT / "reports"
RENDERS = OUT / "renders"
FPS = 24

SKIN = (0.44, 0.245, 0.14, 1)
SKIN_LIGHT = (0.47, 0.27, 0.16, 1)
EAR_INNER = (0.32, 0.14, 0.085, 1)
NAVY = (0.006, 0.014, 0.030, 1)
NAVY_LIGHT = (0.009, 0.020, 0.038, 1)
TEE = (0.022, 0.078, 0.128, 1)
DENIM = (0.019, 0.029, 0.045, 1)
HAIR = (0.008, 0.005, 0.004, 1)
HAIR_LIGHT = (0.012, 0.007, 0.005, 1)
SHOE = (0.023, 0.028, 0.035, 1)
SOLE = (0.39, 0.41, 0.40, 1)
EYE_WHITE = (0.76, 0.72, 0.64, 1)
IRIS = (0.12, 0.063, 0.030, 1)
PUPIL = (0.009, 0.008, 0.007, 1)
LIP = (0.30, 0.12, 0.075, 1)


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    return t * t * (3 - 2 * t)


class CharacterMesh:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.face_colors = []
        self.face_materials = []
        self.weights = []
        self.parts = {}

    def vertex(self, co, weight):
        self.verts.append(tuple(co))
        self.weights.append(weight.copy())
        return len(self.verts) - 1

    def face(self, verts, color, material):
        self.faces.append(verts)
        self.face_colors.append(color)
        self.face_materials.append(material)

    def rings(self, name, rings, segments=16, color=NAVY, material=1, weight=None,
              cap=True):
        """Closed loft from (center, x-radius, depth-radius, tangent) rings."""
        start = len(self.verts)
        rows = []
        for j, (center, rx, ry, tangent) in enumerate(rings):
            center = Vector(center)
            tangent = Vector(tangent).normalized()
            # X is the preferred cross-section axis for the torso/legs/arms.
            side = Vector((1, 0, 0))
            if abs(tangent.dot(side)) > .95:
                side = Vector((0, 1, 0))
            side = (side - tangent * side.dot(tangent)).normalized()
            depth = tangent.cross(side).normalized()
            row = []
            for i in range(segments):
                a = 2 * math.pi * i / segments
                co = center + side * (rx * math.cos(a)) + depth * (ry * math.sin(a))
                w = weight(j, i, co) if callable(weight) else (weight or {"pelvis": 1})
                row.append(self.vertex(co, w))
            rows.append(row)
        for j in range(len(rows) - 1):
            for i in range(segments):
                k = (i + 1) % segments
                shade = 1.0 + .015 * math.cos(i * 2 * math.pi / segments)
                c = tuple(v * shade for v in color[:3]) + (1,)
                self.face((rows[j][i], rows[j][k], rows[j + 1][k], rows[j + 1][i]), c, material)
        if cap:
            self.face(tuple(reversed(rows[0])), color, material)
            self.face(tuple(rows[-1]), color, material)
        self.parts[name] = [start, len(self.verts)]

    def ellipsoid(self, name, center, radius, color, bone, segments=16, rings=9,
                  material=0, rotation=None):
        start = len(self.verts)
        rows = []
        rot = rotation or Matrix.Identity(3)
        for j in range(1, rings):
            phi = math.pi * j / rings
            row = []
            for i in range(segments):
                theta = 2 * math.pi * i / segments
                p = Vector((radius[0] * math.sin(phi) * math.cos(theta),
                            radius[1] * math.sin(phi) * math.sin(theta),
                            radius[2] * math.cos(phi)))
                row.append(self.vertex(Vector(center) + rot @ p, {bone: 1}))
            rows.append(row)
        top = self.vertex(Vector(center) + rot @ Vector((0, 0, radius[2])), {bone: 1})
        bottom = self.vertex(Vector(center) - rot @ Vector((0, 0, radius[2])), {bone: 1})
        for i in range(segments):
            k = (i + 1) % segments
            self.face((top, rows[0][i], rows[0][k]), color, material)
            self.face((bottom, rows[-1][k], rows[-1][i]), color, material)
        for j in range(len(rows) - 1):
            for i in range(segments):
                k = (i + 1) % segments
                self.face((rows[j][i], rows[j + 1][i], rows[j + 1][k], rows[j][k]), color, material)
        self.parts[name] = [start, len(self.verts)]

    def tube(self, name, points, radii, color, bone, sides=8, material=2):
        rings = []
        for i, co in enumerate(points):
            tangent = Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(0, i - 1)])
            if tangent.length < .00001:
                tangent = Vector((0, 0, 1))
            r = radii[i] if isinstance(radii, list) else radii
            rings.append((co, r, r, tangent))
        self.rings(name, rings, sides, color, material, {bone: 1})

    def patch(self, name, coords, faces, color, weight, material=1):
        start = len(self.verts)
        ids = [self.vertex(v, weight) for v in coords]
        for face in faces:
            self.face(tuple(ids[i] for i in face), color, material)
        self.parts[name] = [start, len(self.verts)]

    def build(self):
        mesh = bpy.data.meshes.new("Sam_AuthoredSurface")
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        obj = bpy.data.objects.new("Sam_Mesh", mesh)
        bpy.context.collection.objects.link(obj)
        for name, rough in (("Sam_Skin", .64), ("Sam_Fabric", .8), ("Sam_HairAndDetails", .83)):
            mat = bpy.data.materials.new(name)
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            bsdf.inputs["Roughness"].default_value = rough
            bsdf.inputs["Metallic"].default_value = 0
            bsdf.inputs["Specular IOR Level"].default_value = .23
            if name == "Sam_Skin":
                bsdf.inputs["Subsurface Weight"].default_value = .045
            colors = mat.node_tree.nodes.new("ShaderNodeVertexColor")
            colors.layer_name = "Color"
            mat.node_tree.links.new(colors.outputs["Color"], bsdf.inputs["Base Color"])
            obj.data.materials.append(mat)
        attr = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
        for poly, col, mi in zip(mesh.polygons, self.face_colors, self.face_materials):
            poly.material_index = mi
            poly.use_smooth = True
            for li in poly.loop_indices:
                attr.data[li].color = col
        names = sorted({name for weights in self.weights for name in weights})
        for name in names:
            obj.vertex_groups.new(name=name)
        for i, weights in enumerate(self.weights):
            total = sum(weights.values())
            for name, w in weights.items():
                if w > 0:
                    obj.vertex_groups[name].add([i], w / total, "REPLACE")
        # Recalculate all custom mesh normals consistently, including loft caps.
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        obj["proof_status"] = "UNAPPROVED one-character authored technical/art proof"
        obj["mesh_parts"] = json.dumps(self.parts)
        obj["identity_reference"] = "office-spec/visuals/reference/sam.png (viewed; no image texture)"
        return obj


def body_weights(z):
    if z < 1.04:
        return {"pelvis": 1}
    if z < 1.18:
        t = (z - 1.04) / .14
        return {"pelvis": 1 - t, "spine": t}
    if z < 1.32:
        t = (z - 1.18) / .14
        return {"spine": 1 - t, "chest": t}
    return {"chest": 1}


def make_character():
    m = CharacterMesh()
    # Clothing is a shaped loft with distinct waist, chest and sloping shoulder.
    torso = [(.94, .160, .105), (.98, .166, .112), (1.04, .161, .108),
             (1.12, .157, .104), (1.23, .186, .116), (1.32, .218, .122),
             (1.38, .227, .113), (1.415, .196, .093), (1.448, .085, .068)]
    m.rings("overshirt_body", [((0, 0, z), rx, ry, (0, 0, 1)) for z, rx, ry in torso],
            28, NAVY, 1, lambda j, i, p: body_weights(p.z))
    # Visible crewneck inside an open overshirt: actual color-panel geometry.
    tee_rows = [(z, width, y) for z, width, y in
                [(.955, .054, -.111), (1.05, .060, -.115), (1.18, .065, -.122),
                 (1.30, .073, -.132), (1.39, .077, -.116), (1.425, .060, -.096)]]
    coords = [(x, y, z) for z, width, y in tee_rows for x in [-width, 0, width]]
    start = len(m.verts)
    ids = [m.vertex(p, body_weights(p[2])) for p in coords]
    for j in range(len(tee_rows) - 1):
        for i in range(2):
            m.face((ids[j * 3 + i], ids[j * 3 + i + 1], ids[(j + 1) * 3 + i + 1], ids[(j + 1) * 3 + i]), TEE, 1)
    m.parts["crewneck_visible_panel"] = [start, len(m.verts)]
    # Plackets are cloth geometry; no letters or simulated work markings.
    for side in [-1, 1]:
        pts = [(side * (w + .008), y - .003, z) for z, w, y in tee_rows]
        # A flat cloth strip follows the open front; tiny buttons are dark mesh.
        cs = [tuple(Vector(p) + Vector((side * dx, -.001, 0))) for p in pts for dx in [-.009, .009]]
        ids = [m.vertex(p, body_weights(p[2])) for p in cs]
        for j in range(len(pts) - 1):
            m.face((ids[2*j], ids[2*j+1], ids[2*j+3], ids[2*j+2]), NAVY_LIGHT, 1)
        for z in [1.01, 1.13, 1.25, 1.36]:
            if side == -1:
                m.ellipsoid(f"button_{z}", (-.082, -.135 if z > 1.18 else -.121, z), (.006, .003, .006), HAIR, "chest" if z > 1.25 else "spine", 8, 5, 2)
    # Folded collar planes on either side of a round neck.
    for side in [-1, 1]:
        m.patch("collar_" + str(side), [(side*.060,-.072,1.458), (side*.078,-.070,1.463),
                 (side*.123,-.106,1.410), (side*.095,-.134,1.383), (side*.068,-.113,1.416)],
                [(0,1,2,3,4)], NAVY_LIGHT, {"chest": 1})
    # Breast pocket gives the reference overshirt a readable tailored detail.
    m.patch("breast_pocket", [(.112,-.130,1.28), (.185,-.116,1.28), (.179,-.121,1.20),
            (.148,-.135,1.188), (.111,-.139,1.205)], [(0,1,2,3,4)], NAVY_LIGHT, {"chest": 1})
    # Neck with real volume; small undershirt neckline rim follows the opening.
    m.rings("neck", [((0,0,1.405),.056,.053,(0,0,1)), ((0,0,1.47),.052,.050,(0,0,1)),
            ((0,-.001,1.525),.058,.056,(0,0,1))], 20, SKIN, 0,
            lambda j,i,p: {"neck": .75, "chest": .25} if j == 0 else {"neck": 1})
    m.tube("crewneck_rim", [(-.065,-.088,1.429),(-.048,-.105,1.412),(0,-.113,1.402),
            (.048,-.105,1.412),(.065,-.088,1.429)], .005, TEE, "chest", 8, 1)
    # Pants pelvis includes a rounded seat below the hip pivot; chair top .47m.
    m.rings("trouser_hips", [((0,.006,.895),.156,.083,(0,0,1)), ((0,.008,.925),.171,.100,(0,0,1)),
            ((0,.004,.975),.165,.108,(0,0,1)), ((0,0,1.015),.153,.101,(0,0,1))],
            24, DENIM, 1, {"pelvis": 1})
    for side, suf in [(1,"L"),(-1,"R")]:
        # Segment lengths and intermediate rings give knees/elbows blended skin.
        thigh, shin, foot = "thigh."+suf, "shin."+suf, "foot."+suf
        leg = [(.105,.057,.052),(.15,.058,.055),(.35,.063,.061),(.47,.069,.066),
               (.53,.072,.067),(.60,.076,.071),(.77,.087,.080),(.91,.094,.088),(.97,.090,.085)]
        def leg_w(j,i,p,thigh=thigh,shin=shin):
            if p.z > .63: return {thigh: 1}
            if p.z < .43: return {shin: 1}
            t = smooth((p.z-.43)/.20)
            return {shin: 1-t, thigh: t}
        m.rings("trouser_leg."+suf, [((side*.098, .004, z),rx,ry,(0,0,1)) for z,rx,ry in leg],
                16, DENIM, 1, leg_w)
        # Shoes are low leather trainers with visibly separate sole and toe box.
        shoe = [(.012,.059,.122),(.025,.061,.125),(.047,.062,.125),(.075,.057,.112),
                (.104,.046,.067),(.125,.043,.049)]
        m.rings("shoe."+suf, [((side*.098,-.040,z),rx,ry,(0,0,1)) for z,rx,ry in shoe],
                18, SHOE, 2, {foot:1})
        m.rings("sole."+suf, [((side*.098,-.040,z),.062,.126,(0,0,1)) for z in [.006,.020,.027]],
                18, SOLE, 2, {foot:1})
        for k in range(3):
            m.tube("shoelace", [(side*.098-.025,-.062-k*.015,.105-k*.009),
                    (side*.098+.025,-.062-k*.015,.105-k*.009)], .002, (.12,.14,.155,1), foot, 6, 2)
        shoulder = Vector((side*.205,0,1.39))
        elbow = Vector((side*.355,-.008,1.172))
        wrist = Vector((side*.425,-.023,.967))
        upper, fore, hand = "upper_arm."+suf,"forearm."+suf,"hand."+suf
        arm_points = [(0, .073),(.18,.071),(.45,.066),(.75,.060),(1,.059)]
        rings = [(shoulder+Vector((-side*.050,0,.025)),.042,.050,elbow-shoulder)]
        ws = [{"chest":.6,upper:.4}]
        for t,r in arm_points:
            rings.append((shoulder.lerp(elbow,t),r,r*.92,elbow-shoulder))
            ws.append({upper:1} if t < .7 else {upper:.65,fore:.35})
        for t,r in [(.15,.059),(.45,.052),(.75,.047),(1,.046)]:
            rings.append((elbow.lerp(wrist,t),r,r*.90,wrist-elbow))
            ws.append({fore:.75,upper:.25} if t < .3 else {fore:1})
        m.rings("overshirt_sleeve."+suf,rings,16,NAVY,1,lambda j,i,p,ws=ws:ws[j])
        m.rings("cuff."+suf, [(wrist.lerp(elbow,t),.047,.044,elbow-wrist) for t in [.02,.12,.14]],
                16, NAVY_LIGHT,1,{fore:1})
        # Palm and four merged-but-shaped fingers; individual fingers optional.
        hand_tip = wrist + Vector((side*.019,-.004,-.118))
        mid = wrist.lerp(hand_tip,.45)
        m.rings("hand."+suf, [(wrist,.032,.025,hand_tip-wrist),(mid,.035,.023,hand_tip-wrist),
                 (hand_tip,.026,.018,hand_tip-wrist)], 12,SKIN,0,{hand:1})
        for i in range(4):
            x = side*.425 + (i-1.5)*.014 + side*.019
            tip = (x,-.028,.841 + abs(i-1.5)*.006)
            m.ellipsoid("finger."+suf+str(i),tip,(.009,.016,.025),SKIN,hand,8,6,0)
        m.ellipsoid("thumb."+suf, (side*.395,-.038,.900), (.018,.024,.039),SKIN,hand,10,6,0,
                    Matrix.Rotation(side*.4,3,"Y"))
    make_head(m)
    return m.build()


def make_head(m):
    # A shaped adult face rather than a sphere/capsule: narrow chin, jaw angle,
    # cheekbone width, recessed temples and forehead. Front is local -Y.
    profile = [(1.496,.027,.055,.038), (1.513,.056,.070,.052),
               (1.538,.078,.076,.065), (1.566,.091,.079,.076),
               (1.584,.098,.083,.080), (1.602,.104,.086,.085),
               (1.615,.106,.087,.087), (1.630,.106,.088,.088),
               (1.646,.104,.089,.089), (1.660,.102,.089,.089),
               (1.681,.100,.089,.087),
               (1.714,.101,.085,.083), (1.744,.095,.077,.074),
               (1.770,.075,.060,.058), (1.788,.035,.030,.028)]
    rows=[]
    seg=56
    for z,rx,front,back in profile:
        row=[]
        for i in range(seg):
            a=2*math.pi*i/seg
            x=rx*math.sin(a)
            y=-(front if math.cos(a)>0 else back)*math.cos(a)
            # Cheek plane / brow ridge add modest modeled form to the face.
            if math.cos(a)>.35:
                cheek=math.exp(-((z-1.623)/.033)**2)*math.exp(-((abs(x)-.065)/.029)**2)*.008
                brow=math.exp(-((z-1.680)/.015)**2)*math.exp(-((abs(x)-.045)/.033)**2)*.008
                bridge=math.exp(-(x/.014)**2)*(.018*math.exp(-((z-1.645)/.035)**2)+.027*math.exp(-((z-1.615)/.015)**2))
                y-=cheek+brow+bridge
            row.append(m.vertex((x,y,z),{"head":1}))
        rows.append(row)
    for j in range(len(rows)-1):
        for i in range(seg):
            k=(i+1)%seg
            m.face((rows[j][i],rows[j][k],rows[j+1][k],rows[j+1][i]),SKIN,0)
    m.face(tuple(reversed(rows[0])),SKIN,0)
    m.face(tuple(rows[-1]),SKIN,0)
    m.parts["sculpted_face_and_cranium"]=[rows[0][0],len(m.verts)]
    # Ears: helix volumes, darker recessed concha and small tragus.
    for side in [-1,1]:
        m.ellipsoid("ear",(side*.106,.001,1.626),(.025,.020,.044),SKIN,"head",14,9,0)
        m.ellipsoid("ear_concha",(side*.118,-.016,1.628),(.010,.006,.025),EAR_INNER,"head",12,7,0)
        m.ellipsoid("tragus",(side*.111,-.021,1.617),(.009,.007,.012),SKIN_LIGHT,"head",10,6,0)
    # Eyes are shallow almond volumes with modeled upper/lower lids. Kept adult
    # in proportion, not large cartoon eyeballs or flat eye decals.
    for side in [-1,1]:
        x=side*.044
        m.ellipsoid("eye_sclera",(x,-.080,1.656),(.023,.010,.010),EYE_WHITE,"head",16,9,2)
        m.ellipsoid("iris",(x,-.0900,1.656),(.0073,.0019,.0073),IRIS,"head",14,8,2)
        m.ellipsoid("pupil",(x,-.0918,1.656),(.0035,.0010,.0042),PUPIL,"head",12,7,2)
        m.ellipsoid("eye_glint",(x-.002,-.0928,1.659),(.0012,.0006,.0012),(.95,.94,.88,1),"head",8,5,2)
        pts=[(x-.024,-.081,1.655),(x-.014,-.090,1.664),(x,-.093,1.666),
             (x+.014,-.090,1.663),(x+.024,-.080,1.656)]
        m.tube("upper_lid",pts,[.003,.004,.0045,.004,.003],SKIN,"head",8,0)
        pts=[(x-.024,-.081,1.655),(x-.014,-.089,1.650),(x,-.092,1.648),
             (x+.014,-.089,1.650),(x+.024,-.080,1.656)]
        m.tube("lower_lid",pts,[.002,.003,.003,.003,.002],SKIN,"head",8,0)
        # Slanted, tapered brows reflect Sam's straight dark eyebrows.
        pts=[(side*.020,-.094,1.682),(side*.038,-.101,1.688),
             (side*.058,-.095,1.688),(side*.075,-.083,1.681)]
        m.tube("brow",pts,[.002,.003,.0025,.001],HAIR,"head",8,2)
    # Nose bridge, tip and wings are integrated-looking modeled geometry.
    for side in [-1,1]:
        m.ellipsoid("nose_ala",(side*.012,-.099,1.609),(.009,.009,.008),SKIN,"head",12,7,0)
        m.ellipsoid("nostril",(side*.010,-.109,1.605),(.0035,.002,.0018),EAR_INNER,"head",10,5,2)
    # Restrained clean-shaven mouth with cupid's bow and small asymmetric smile.
    m.tube("upper_lip",[(-.038,-.078,1.565),(-.021,-.088,1.571),(-.009,-.094,1.571),
            (0,-.096,1.568),(.010,-.094,1.572),(.024,-.087,1.573),(.039,-.076,1.570)],
            [.0007,.0015,.002,.002,.002,.0015,.0007],LIP,"head",8,0)
    m.tube("lower_lip",[(-.037,-.079,1.564),(-.020,-.090,1.560),(0,-.095,1.558),
            (.022,-.089,1.562),(.039,-.077,1.569)],[.0007,.0015,.0025,.0015,.0007],
            (.36,.17,.11,1),"head",8,0)
    m.tube("mouth_seam",[(-.034,-.082,1.566),(-.017,-.094,1.566),(0,-.099,1.564),
            (.019,-.093,1.568),(.035,-.081,1.570)],.0009,EAR_INNER,"head",6,2)
    # Main hair cap follows the skull and a swept asymmetric hairline. It is
    # closed geometric volume, not alpha cards, strands textures or a billboard.
    rows=[]
    seg=32
    for j in range(8):
        t=j/7
        row=[]
        for i in range(seg):
            a=2*math.pi*i/seg
            forward=max(0,math.cos(a))
            bottom=(1.695+.047*forward) if forward>0 else (1.600+.095*(1+math.cos(a)))
            # Long fringe drops on Sam's left, higher part on his right.
            bottom-=.020*forward*max(0,-math.sin(a))
            z=lerp(bottom,1.820,smooth(t))
            rad=math.sqrt(max(.0001,1-((z-1.680)/.140)**2))
            rx=.119*rad
            ry=.105*rad
            x=rx*math.sin(a)-.008*t
            y=-ry*math.cos(a)+.008*t
            row.append(m.vertex((x,y,z),{"head":1}))
        rows.append(row)
    for j in range(len(rows)-1):
        for i in range(seg):
            k=(i+1)%seg
            m.face((rows[j][i],rows[j][k],rows[j+1][k],rows[j+1][i]),HAIR,2)
    m.face(tuple(rows[-1]),HAIR,2)
    # Swept ribbon-like locks: broad roots, softly arced volume, tapered ends.
    # Vary length and lay each lock onto the cap, retaining a clean silhouette.
    for k in range(9):
        u=k/8
        x0=.056-u*.012
        y0=-.064+u*.096
        points=[]
        radii=[]
        for j in range(7):
            t=j/6
            x=lerp(x0,-.101+u*.028,t)-.013*math.sin(math.pi*t)
            y=y0-.020*math.sin(math.pi*t)-.018*t
            z=lerp(1.782+u*.007,1.711+u*.045,t)+.031*math.sin(math.pi*t)
            points.append((x,y,z))
            radii.append((.010+.002*math.sin(k))*math.sin(math.pi*(.14+.83*t))+.0005)
        rings=[]
        for j,pt in enumerate(points):
            tangent=Vector(points[min(j+1,6)])-Vector(points[max(0,j-1)])
            rings.append((pt,radii[j]*1.25,radii[j]*.45,tangent))
        m.rings("swept_lock_"+str(k),rings,10,HAIR_LIGHT if k%3==0 else HAIR,2,{"head":1})
    # Close side/back locks are short, directed and lie against the skull.
    for side in [-1,1]:
        for k in range(4):
            y=-.033+k*.026
            m.tube("side_lock",[(side*.097,y,1.732),(side*.106,y+.010,1.693),
                    (side*.103,y+.017,1.661)],[.003,.004,.0005],HAIR,"head",6,2)


REST = {
    "root": ((0,0,0),(0,0,.12),None),
    "pelvis": ((0,0,.97),(0,0,1.07),"root"),
    "spine": ((0,0,1.07),(0,0,1.25),"pelvis"),
    "chest": ((0,0,1.25),(0,0,1.405),"spine"),
    "neck": ((0,0,1.405),(0,0,1.52),"chest"),
    "head": ((0,0,1.52),(0,0,1.77),"neck"),
}
for side,suf in [(1,"L"),(-1,"R")]:
    REST.update({
      "clavicle."+suf: ((0,0,1.39),(side*.205,0,1.39),"chest"),
      "upper_arm."+suf: ((side*.205,0,1.39),(side*.355,-.008,1.172),"clavicle."+suf),
      "forearm."+suf: ((side*.355,-.008,1.172),(side*.425,-.023,.967),"upper_arm."+suf),
      "hand."+suf: ((side*.425,-.023,.967),(side*.444,-.027,.849),"forearm."+suf),
      "thigh."+suf: ((side*.098,0,.95),(side*.098,-.006,.53),"pelvis"),
      "shin."+suf: ((side*.098,-.006,.53),(side*.098,0,.11),"thigh."+suf),
      "foot."+suf: ((side*.098,0,.11),(side*.098,-.156,.052),"shin."+suf),
      "toe."+suf: ((side*.098,-.156,.052),(side*.098,-.188,.052),"foot."+suf),
    })


def make_rig(obj):
    arm=bpy.data.armatures.new("Enztronic_Biped_v1")
    rig=bpy.data.objects.new("Sam_Rig",arm)
    bpy.context.collection.objects.link(rig)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name,(head,tail,parent) in REST.items():
        b=arm.edit_bones.new(name)
        b.head=head; b.tail=tail
        b.roll=0
        if parent: b.parent=arm.edit_bones[parent]
        b.use_connect=False
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.display_type="OCTAHEDRAL"
    rig.show_in_front=True
    for bone in rig.pose.bones:
        bone.rotation_mode="QUATERNION"
        bone["control"]="FK: rotate; pelvis supports vertical local translation; root remains floor anchored"
    obj.parent=rig
    mod=obj.modifiers.new("CommonBipedSkin", "ARMATURE")
    mod.object=rig
    mod.use_deform_preserve_volume=False
    rig["rig_version"]="enztronic_biped_proof_v1"
    rig["axes"]="Blender Z-up / -Y forward; glTF Y-up / +Z forward"
    rig["controls"]="Named FK bones editable in Pose Mode. root master; pelvis height; bilateral arms/legs. No external rig add-on."
    rig["production_gate"]="PENDING art, rig deformation, source rights, docks and browser review"
    return rig


def aim_bone(rig,name,direction):
    """World-space direction -> local pose quaternion, preserving rest roll."""
    pb=rig.pose.bones[name]
    rb=rig.data.bones[name]
    rest_world=rb.matrix_local.to_quaternion()
    rest_direction=rest_world @ Vector((0,1,0))
    desired=rest_direction.rotation_difference(Vector(direction).normalized()) @ rest_world
    if pb.parent:
        parent_rest=pb.parent.bone.matrix_local.to_quaternion()
        local_rest=parent_rest.inverted() @ rest_world
        parent_pose=pb.parent.matrix.to_quaternion()
        pb.rotation_quaternion=local_rest.inverted() @ parent_pose.inverted() @ desired
    else:
        pb.rotation_quaternion=rest_world.inverted() @ desired
    bpy.context.view_layer.update()


def two_bone_knee(hip,ankle,l1,l2,pole):
    vector=ankle-hip
    d=min(vector.length,l1+l2-.00001)
    direction=vector.normalized()
    a=(l1*l1-l2*l2+d*d)/(2*d)
    h=math.sqrt(max(0,l1*l1-a*a))
    side=(pole-direction*pole.dot(direction)).normalized()
    return hip+direction*a+side*h


def apply_pose(rig, kind, t, frame, key=True):
    """In-place poses; solve legs against floor and arms against actual targets."""
    for pb in rig.pose.bones:
        pb.location=(0,0,0)
        pb.rotation_quaternion=(1,0,0,0)
        pb.scale=(1,1,1)
    seated=1.0 if kind in ("seated_idle","seated_work") else 0.0
    if kind=="sit_down": seated=smooth(t)
    if kind=="stand_up": seated=1-smooth(t)
    p=2*math.pi*t
    breath=math.sin(p)*(.003 if kind in ("idle_stand","seated_idle") else 0)
    # Seat anchor at floor root; hips advance 2cm as thighs reach forward. The
    # butt-to-seat distance is measured from deformed vertices, not a magic flag.
    # A straight standing leg has no spare reach for a stride. Lower only the
    # walking pelvis so the .2m forward/back planted targets are reachable.
    drop=.405*seated+(.026 if kind=="walk" else 0)
    rig.pose.bones["pelvis"].location=(0,-drop,0)
    # pelvis local Y points up in this skeleton, thus local -Y lowers globally.
    bpy.context.view_layer.update()
    lean=.025*seated + (breath if kind != "walk" else .014*math.sin(p))
    aim_bone(rig,"spine",(0,-lean,1))
    aim_bone(rig,"chest",(0,-.035*seated,1))
    aim_bone(rig,"neck",(0,.012*seated,1))
    aim_bone(rig,"head",(.015*math.sin(p) if kind=="idle_stand" else 0,.015,1))
    # Each ankle contact is solved by an actual two-segment leg. A walk clip is
    # in-place for scene navigation at .8m/s; stride is .8m per cycle.
    for side,suf in [(1,"L"),(-1,"R")]:
        hip=rig.pose.bones["thigh."+suf].head.copy()
        if kind=="walk":
            phase=(t+(0 if side==1 else .5))%1
            # .4m stance displacement / .5s = .8m/s, cancelling authored
            # navigation during the grounded half-cycle. Swing clears floor.
            if phase<.5:
                y=lerp(-.20,.20,phase*2);lift=0
            else:
                swing=(phase-.5)*2
                y=lerp(.20,-.20,smooth(swing));lift=.085*math.sin(math.pi*swing)
            ankle=Vector((side*.098,y,.11+lift))
        else:
            ankle=Vector((side*.098,-.415*seated,.11))
        knee=two_bone_knee(hip,ankle,.42004,.42004,Vector((0,-1,0)))
        aim_bone(rig,"thigh."+suf,knee-hip)
        aim_bone(rig,"shin."+suf,ankle-knee)
        # Keep shoe sole horizontal. No root translation is used for movement.
        aim_bone(rig,"foot."+suf,(0,-.156,-.058))
        aim_bone(rig,"toe."+suf,(0,-1,0))
        shoulder=rig.pose.bones["upper_arm."+suf].head.copy()
        if seated:
            # Desk keys lie just beyond the knees; wrists are above .75m top.
            elbow=Vector((side*.225,-.095,1.155-drop))
            wrist=Vector((side*.17,-.355,.81))
            if kind=="seated_work":
                wrist.x+=.012*math.sin(2*p+(0 if side==1 else 1))
                wrist.z+=.005*math.sin(4*p+(0 if side==1 else 1))
            # Blend stand/rest arms into the seated solve during transitions.
            rest_elbow=Vector(REST["upper_arm."+suf][1])
            rest_wrist=Vector(REST["forearm."+suf][1])
            elbow=rest_elbow.lerp(elbow,seated)
            wrist=rest_wrist.lerp(wrist,seated)
        else:
            swing=.065*math.sin(p+(0 if side==-1 else math.pi)) if kind=="walk" else .003*math.sin(p)
            elbow=Vector((side*.285,swing,1.145))
            wrist=Vector((side*.31,swing*1.4,.925))
        if kind=="handoff_gesture" and side==1:
            gesture=math.sin(math.pi*t)**2
            elbow=elbow.lerp(Vector((.28,-.10,1.20)),gesture)
            wrist=wrist.lerp(Vector((.29,-.33,1.32)),gesture)
        aim_bone(rig,"upper_arm."+suf,elbow-shoulder)
        # Use actual new elbow location because upper arm length is fixed.
        elbow_actual=rig.pose.bones["forearm."+suf].head.copy()
        aim_bone(rig,"forearm."+suf,wrist-elbow_actual)
        if seated:
            aim_bone(rig,"hand."+suf,(0,-1,-.03))
        elif kind=="handoff_gesture" and side==1:
            gesture=math.sin(math.pi*t)**2
            aim_bone(rig,"hand."+suf,(0,-gesture,.8*gesture-1))
        else:
            aim_bone(rig,"hand."+suf,(side*.12,-.04,-1))
    if key:
        for pb in rig.pose.bones:
            pb.keyframe_insert(data_path="location",frame=frame,group=pb.name)
            pb.keyframe_insert(data_path="rotation_quaternion",frame=frame,group=pb.name)
            pb.keyframe_insert(data_path="scale",frame=frame,group=pb.name)


CLIPS={"idle_stand":3,"walk":1,"seated_idle":4,"seated_work":4,
       "sit_down":1.25,"stand_up":1.25,"handoff_gesture":2}


def animate(rig):
    rig.animation_data_create()
    for name,duration in CLIPS.items():
        action=bpy.data.actions.new(name)
        rig.animation_data.action=action
        end=round(duration*FPS)
        for f in range(end+1):
            bpy.context.scene.frame_set(f)
            apply_pose(rig,name,f/end,f)
        action.use_fake_user=True
        action["duration_seconds"]=duration
        action["root_policy"]="floor root fixed; no horizontal displacement; navigation owns travel"
        track=rig.animation_data.nla_tracks.new()
        track.name=name
        strip=track.strips.new(name,0,action)
        strip.action_frame_start=0
        strip.action_frame_end=end
        track.mute=True
    rig.animation_data.action=None
    for track in rig.animation_data.nla_tracks:
        track.mute=False
    bpy.context.scene.frame_set(0)


def select_export(rig,obj):
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True); obj.select_set(True)
    bpy.context.view_layer.objects.active=rig


def export_glb(rig,obj,path):
    select_export(rig,obj)
    # glTF recommends skinned mesh nodes at scene root. The modifier references
    # the armature directly, so source parenting is not needed for export.
    source_parent=obj.parent
    world=obj.matrix_world.copy()
    obj.parent=None
    obj.matrix_world=world
    bpy.ops.export_scene.gltf(filepath=str(path),export_format="GLB",use_selection=True,
        export_yup=True,export_apply=False,export_animations=True,
        export_animation_mode="NLA_TRACKS",export_frame_range=False,
        export_anim_slide_to_zero=True,export_bake_animation=False,
        export_force_sampling=True,export_skins=True,export_all_influences=False,
        export_def_bones=True,export_extras=True,export_cameras=False,
        export_lights=False,export_materials="EXPORT",export_normals=True,
        export_texcoords=True,export_tangents=False,export_image_format="AUTO")
    obj.parent=source_parent
    obj.matrix_world=world


def material(name,color,rough=.7):
    mat=bpy.data.materials.new(name); mat.diffuse_color=(*color,1); mat.use_nodes=True
    shader=mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value=(*color,1)
    shader.inputs["Roughness"].default_value=rough
    return mat


def cube(name,location,dimensions,mat,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=location)
    obj=bpy.context.object; obj.name=name
    obj.dimensions=dimensions
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod=obj.modifiers.new("Small edge rounding","BEVEL"); mod.width=bevel; mod.segments=2
        obj.modifiers.new("Weighted normals","WEIGHTED_NORMAL")
    return obj


def proof_furniture():
    oak=material("Proof stage oak",(.42,.26,.125))
    navy=material("Proof stage chair",(.025,.052,.090))
    metal=material("Proof stage dark steel",(.055,.062,.067),.35)
    # Native forward -Y. Surface at .75m and seat upper face at .47m.
    cube("PROOF_DeskTop_height0.750m",(0,-.70,.725),(1.6,.8,.05),oak,.012)
    for x in [-.7,.7]:
        for y in [-1.02,-.38]: cube("PROOF_DeskLeg",(x,y,.35),(.035,.035,.70),metal,.004)
    cube("PROOF_ChairSeat_top0.470m",(0,.075,.44),(.46,.44,.06),navy,.045)
    cube("PROOF_ChairBack",(0,.26,.71),(.45,.055,.47),navy,.04)
    for x in [-.17,.17]:
        for y in [-.075,.23]: cube("PROOF_ChairLeg",(x,y,.205),(.03,.03,.41),metal,.004)
    cube("PROOF_Keyboard",(0,-.49,.761),(.37,.135,.018),metal,.004)
    cube("PROOF_MonitorStand",(0,-.86,.82),(.045,.045,.14),metal,.004)
    cube("PROOF_Monitor",(0,-.93,1.02),(.57,.04,.34),navy,.012)


def point_camera(camera,target):
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat("-Z","Y").to_euler()


def render_setup():
    scene=bpy.context.scene
    scene.render.engine="CYCLES"
    scene.cycles.device="CPU"
    scene.cycles.samples=32
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1000
    scene.render.resolution_y=1100
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"
    scene.render.film_transparent=False
    scene.view_settings.view_transform="AgX"
    world=bpy.data.worlds.new("Proof studio environment")
    world.use_nodes=True
    world.node_tree.nodes["Background"].inputs[0].default_value=(.12,.15,.20,1)
    world.node_tree.nodes["Background"].inputs[1].default_value=.35
    scene.world=world
    ground=material("Proof ground",(.13,.16,.19))
    cube("PROOF_Stage_floor",(0,0,-.055),(200,200,.10),ground)
    for name,loc,power,size,col in [
        ("Key",(-3,-4,5),500,4,(1,.88,.74)),
        ("Fill",(3,-2,3),260,3,(.73,.84,1)),
        ("Rim",(0,3,4),450,3,(.75,.85,1))]:
        data=bpy.data.lights.new(name,"AREA"); data.energy=power; data.shape="DISK"; data.size=size; data.color=col
        ob=bpy.data.objects.new(name,data); scene.collection.objects.link(ob); ob.location=loc
        point_camera(ob,(0,0,1))
    camera_data=bpy.data.cameras.new("ProofCamera")
    camera=bpy.data.objects.new("ProofCamera",camera_data); scene.collection.objects.link(camera)
    scene.camera=camera; camera_data.type="ORTHO"; camera_data.ortho_scale=2.22
    camera.location=(2.8,-4.8,2.5); point_camera(camera,(0,0,.93))
    return camera


def show_action(rig,name,time_sec=0):
    for track in rig.animation_data.nla_tracks: track.mute=True
    rig.animation_data.action=bpy.data.actions[name]
    bpy.context.scene.frame_set(round(time_sec*FPS))
    bpy.context.view_layer.update()


def render_still(name):
    bpy.context.scene.render.filepath=str(RENDERS/name)
    bpy.ops.render.render(write_still=True)


def actual_mesh_bounds(obj):
    depsgraph=bpy.context.evaluated_depsgraph_get()
    evaluated=obj.evaluated_get(depsgraph)
    mesh=evaluated.to_mesh()
    coords=[evaluated.matrix_world@v.co for v in mesh.vertices]
    low=[min(v[i] for v in coords) for i in range(3)]
    high=[max(v[i] for v in coords) for i in range(3)]
    evaluated.to_mesh_clear()
    return {"min_blender_xyz":low,"max_blender_xyz":high,
            "dimensions_m":[high[i]-low[i] for i in range(3)]}


def document(rig,obj):
    mesh=obj.data; mesh.calc_loop_triangles()
    bones=[{"name":b.name,"parent":b.parent.name if b.parent else None,
            "head_blender_m":list(b.head_local),"tail_blender_m":list(b.tail_local),
            "deform":b.use_deform} for b in rig.data.bones]
    poses={}
    for name,duration in CLIPS.items():
        sampled=[]
        for t in [0,.25,.5,.75,1]:
            show_action(rig,name,duration*t)
            sampled.append({"normalized_time":t,"bounds":actual_mesh_bounds(obj),
                            "root_head_blender_m":list(rig.pose.bones["root"].head),
                            "pelvis_head_blender_m":list(rig.pose.bones["pelvis"].head)})
        poses[name]=sampled
    data={
      "status":"UNAPPROVED_TECHNICAL_AND_ART_PROOF",
      "blender_version":bpy.app.version_string,
      "generator":"scripts/office-modeling/sam_proof.py",
      "reference":"office-spec/visuals/reference/sam.png; viewed and interpreted, never texture-mapped",
      "axes":{"native":"right-handed meters, Z-up, -Y forward","glb":"right-handed meters, Y-up, +Z forward"},
      "geometry":{"vertices":len(mesh.vertices),"triangles":len(mesh.loop_triangles),
                  "materials":len(mesh.materials),"textures":[],"uv_usage":"none; authored vertex colors with PBR materials",
                  "skins":1,"deform_bones":len(bones),"max_vertex_influences":max(len(v.groups) for v in mesh.vertices)},
      "bone_map":bones,
      "clips":[{"name":n,"duration_seconds":d,"frames":[0,round(d*FPS)],"fps":FPS,
                 "root_horizontal_motion_m":0,"loop":n in ("idle_stand","walk","seated_idle","seated_work")} for n,d in CLIPS.items()],
      "sampled_deformed_bounds":poses,
      "proof_furniture":{"desk_surface_y_m":.75,"chair_seat_y_m":.47,"front_direction":"native -Y / glTF +Z"},
      "acceptance":{"identity":"pending human art review; stylized interpretation, not portrait likeness claimed",
                    "deformation":"pending visual and quantitative review of exported animation",
                    "full_docks":"pending all room anchors and actual furniture geometry",
                    "browser_loader":"pending: available IAB has no WebGL context",
                    "performance":"not measured; Blender CPU renders are not browser performance evidence",
                    "khronos_validator":"root implementation agent runs official validator against final bytes",
                    "production_approved":False},
      "provenance":{"creator":"Procedurally authored by Codex for Enztronic in this workspace",
                    "external_meshes":[],"external_textures":[],"external_fonts":[],
                    "portrait":"owner supplied reference only; source rights require owner review",
                    "license":"No third-party model or texture license invented. Owner legal/source acceptance remains pending."},
    }
    glb=ASSET/"sam.glb"
    data["glb"]={"path":str(glb.relative_to(OUT)).replace("\\","/"),"sha256":hashlib.sha256(glb.read_bytes()).hexdigest(),"bytes":glb.stat().st_size}
    (REPORTS/"sam-authoring-metadata.json").write_text(json.dumps(data,indent=2),encoding="utf-8")
    (SRC/"common-biped-bone-map.json").write_text(json.dumps({"version":1,"axes":data["axes"],"bones":bones,
        "retargeting":"Use identical bone names and rest pose. Pose controls are the named FK bones. root is navigation anchor; only pelvis vertical offset authors seat height. Do not scale skeleton per action."},indent=2),encoding="utf-8")
    (SRC/"material-and-source-index.json").write_text(json.dumps({"materials":[{"name":mat.name,"color_source":"Color vertex attribute","textures":[]} for mat in mesh.materials],"texture_files":[],"texture_dimensions":[],"provenance":data["provenance"]},indent=2),encoding="utf-8")
    return data


def render_contact_sheet(rig,obj,camera):
    # A single Blender render containing the actual mesh at seven authored poses,
    # rather than raster compositing or a fabricated screenshot of a running app.
    show_action(rig,"idle_stand",0)
    # Camera-aligned floor rows keep the true 30-degree pose view while avoiding
    # projected actor / label overlap. These are proof staging coordinates only.
    placements=[(-2.7,0,"idle_stand",0),(-.9,0,"walk",.25),(.9,0,"handoff_gesture",1),
                (2.7,0,"sit_down",.625),(-1.8,5.1,"seated_idle",0),
                (0,5.1,"seated_work",1),(1.8,5.1,"stand_up",.625)]
    screen_right=Vector((math.cos(math.pi/6),math.sin(math.pi/6),0))
    floor_away=Vector((-math.sin(math.pi/6),math.cos(math.pi/6),0))
    copies=[]
    label_mat=material("Proof contact sheet labels",(.65,.72,.77))
    for x,y,name,t in placements:
        origin=screen_right*x+floor_away*y
        # Snapshot evaluated skin geometry after selecting the real source clip.
        # This avoids Blender 4.5 action-slot / NLA name binding on copied rigs
        # accidentally rendering rest poses in every cell of a pose sheet.
        show_action(rig,name,t)
        graph=bpy.context.evaluated_depsgraph_get()
        evaluated=obj.evaluated_get(graph)
        snapshot=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=graph)
        new_mesh=bpy.data.objects.new("PROOF_Pose_"+name,snapshot)
        bpy.context.collection.objects.link(new_mesh)
        new_mesh.location=origin
        label_data=bpy.data.curves.new("PROOF_Label_"+name,"FONT")
        label_data.body=f"{name}  {t:g}s"
        label_data.align_x="CENTER";label_data.size=.13
        label=bpy.data.objects.new("PROOF_Label_"+name,label_data)
        bpy.context.collection.objects.link(label)
        label.location=origin-floor_away*.98+Vector((0,0,.008))
        label.rotation_euler.z=math.pi/6
        label.data.materials.append(label_mat)
        copies.extend([new_mesh,label])
    rig.hide_render=True; obj.hide_render=True
    scene=bpy.context.scene
    scene.render.resolution_x=1800;scene.render.resolution_y=1100
    camera.data.ortho_scale=8.5
    center=floor_away*2.55
    target=center+Vector((0,0,.8))
    camera.location=target+Vector((5.3,-9.15,4.7));point_camera(camera,target)
    for name in ["Key","Fill","Rim"]:
        bpy.data.objects[name].location+=center
    render_still("sam-seven-clips-contact-sheet.png")
    for ob in copies: bpy.data.objects.remove(ob,do_unlink=True)
    rig.hide_render=False;obj.hide_render=False
    show_action(rig,"idle_stand",0)


def main():
    start=time.time()
    args=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    bpy.context.preferences.filepaths.save_version=0
    for path in [SRC/"characters",ASSET,REPORTS,RENDERS]:path.mkdir(parents=True,exist_ok=True)
    if "--contact-only" in args:
        bpy.ops.wm.open_mainfile(filepath=str(SRC/"characters"/"sam.blend"))
        camera=render_setup()
        render_contact_sheet(bpy.data.objects["Sam_Rig"],bpy.data.objects["Sam_Mesh"],camera)
        bpy.ops.wm.save_as_mainfile(filepath=str(SRC/"sam-proof-render-stage.blend"),check_existing=False)
        print("SAM_CONTACT_SHEET_CORRECTED")
        return
    bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene;scene.unit_settings.system="METRIC";scene.unit_settings.scale_length=1
    scene.render.fps=FPS;scene.frame_start=0;scene.frame_end=96
    obj=make_character();rig=make_rig(obj)
    for unused in list(bpy.data.materials):
        if unused.users==0:bpy.data.materials.remove(unused)
    if "--preview-only" in args:
        apply_pose(rig,"idle_stand",0,0,key=False)
        camera=render_setup()
        bpy.ops.wm.save_as_mainfile(filepath=str(SRC/"sam-initial-standing-review.blend"),check_existing=False)
        render_still("sam-initial-standing-review.png")
        camera.location=(2.6,-4.0,2.0);point_camera(camera,(0,0,1.60));camera.data.ortho_scale=.70
        render_still("sam-initial-face-review.png")
        print("SAM_INITIAL_REVIEW_COMPLETE")
        return
    animate(rig)
    show_action(rig,"idle_stand",0)
    # Save native editable FK rig and action library before render-stage props.
    for track in rig.animation_data.nla_tracks:track.mute=False
    rig.animation_data.action=None
    export_glb(rig,obj,ASSET/"sam.glb")
    show_action(rig,"idle_stand",0)
    source=SRC/"characters"/"sam.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(source),check_existing=False)
    # Independently openable native sources retain the reference mesh for rig /
    # animation editing. They do not yet establish a production shared-rig gate.
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC/"common-biped-rig.blend"),check_existing=False,copy=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC/"common-animations.blend"),check_existing=False,copy=True)
    metadata=document(rig,obj)
    if "--skip-renders" in args:
        print("SAM_PROOF_COMPLETE "+json.dumps({"seconds":round(time.time()-start,1),"glb":metadata["glb"],"geometry":metadata["geometry"],"renders":"skipped; existing image geometry unchanged"}))
        return
    camera=render_setup()
    show_action(rig,"idle_stand",0)
    for angle,name in [(0,"front"),(math.pi/2,"left"),(math.pi,"rear"),(math.pi*1.5,"right")]:
        camera.location=(4*math.sin(angle),-4*math.cos(angle),1.50)
        point_camera(camera,(0,0,.92));camera.data.ortho_scale=2.12
        render_still("sam-turntable-"+name+".png")
    camera.location=(2.6,-4.0,2.0);point_camera(camera,(0,0,1.52));camera.data.ortho_scale=.82
    scene.render.resolution_x=1100;scene.render.resolution_y=1100
    render_still("sam-face-three-quarter.png")
    camera.location=(3,-4,2.2);point_camera(camera,(0,-.28,.72));camera.data.ortho_scale=2.35
    proof_furniture();show_action(rig,"seated_work",1)
    render_still("sam-seated-desk-proof.png")
    for ob in list(bpy.data.objects):
        if ob.name.startswith("PROOF_") and ob.name!="PROOF_Stage_floor":bpy.data.objects.remove(ob,do_unlink=True)
    render_contact_sheet(rig,obj,camera)
    show_action(rig,"idle_stand",0)
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC/"sam-proof-render-stage.blend"),check_existing=False)
    print("SAM_PROOF_COMPLETE "+json.dumps({"seconds":round(time.time()-start,1),"glb":metadata["glb"],"geometry":metadata["geometry"]}))


if __name__=="__main__":main()
