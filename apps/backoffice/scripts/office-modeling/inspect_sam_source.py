"""Reopen each Sam native source in a fresh Blender and inspect real datablocks.

blender --background SOURCE.blend --python scripts/office-modeling/inspect_sam_source.py
Writes a per-file report in the private proof bundle; never approves production.
"""
import hashlib
import json
import math
from pathlib import Path
import bpy

expected={"idle_stand","walk","seated_idle","seated_work","sit_down","stand_up","handoff_gesture"}
source=Path(bpy.data.filepath)
report_root=Path(__file__).resolve().parents[2]/"office-assets"/"proof"/"reports"
rig=bpy.data.objects.get("Sam_Rig")
mesh=bpy.data.objects.get("Sam_Mesh")
actions={a.name:{"frame_range":list(a.frame_range),"duration_seconds":(a.frame_range[1]-a.frame_range[0])/24} for a in bpy.data.actions}
data={"status":"opened_and_inspected_native_source_not_production_approved",
      "source":str(source),"sha256":hashlib.sha256(source.read_bytes()).hexdigest(),
      "blender_version":bpy.app.version_string,"editable_mesh":mesh is not None and mesh.type=="MESH",
      "vertices":len(mesh.data.vertices) if mesh else None,
      "armature_bones":len(rig.data.bones) if rig else None,
      "actions":actions,"required_actions_present":expected.issubset(actions),
      "skin_modifier_matches_rig":bool(mesh and any(m.type=="ARMATURE" and m.object==rig for m in mesh.modifiers)),
      "weight_groups":len(mesh.vertex_groups) if mesh else None,
      "max_influences":max(len(v.groups) for v in mesh.data.vertices) if mesh else None,
      "mesh_object_transform":{"location":list(mesh.location),"scale":list(mesh.scale),"rotation_euler":list(mesh.rotation_euler)} if mesh else None,
      "root_rest_head_native_m":list(rig.data.bones["root"].head_local) if rig else None,
      "root_rest_tail_native_m":list(rig.data.bones["root"].tail_local) if rig else None,
      "external_images":[im.filepath for im in bpy.data.images if im.source=="FILE" and im.users],
      "source_pose_access":"Armature data Pose Position REST shows editable common A-pose; named pose bones are FK controls.",
      "art_and_docks_approval":False}
for track in rig.animation_data.nla_tracks:track.mute=True
rig.animation_data.action=bpy.data.actions["walk"]
max_target_error=0
max_stance_height_error=0
for frame in range(25):
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    for side,suffix in [(1,"L"),(-1,"R")]:
        phase=(frame/24+(0 if side==1 else .5))%1
        if phase<.5:
            target_y=-.2+.8*phase;lift=0
        else:
            swing=(phase-.5)*2
            smooth=swing*swing*(3-2*swing)
            target_y=.2-.4*smooth;lift=.085*math.sin(math.pi*swing)
        ankle=rig.pose.bones["foot."+suffix].head
        error=math.sqrt((ankle.y-target_y)**2+(ankle.z-(.11+lift))**2)
        max_target_error=max(max_target_error,error)
        if phase<.5:max_stance_height_error=max(max_stance_height_error,abs(ankle.z-.11))
data["walk_ankle_check"]={"samples":50,"target_max_error_m":max_target_error,
       "planted_height_max_error_m":max_stance_height_error,
       "authored_stance_speed_native_y_m_per_s":.8,
       "navigation_speed_local_forward_m_per_s":.8,
       "scope":"Fresh-source FK ankle positions, not browser shoe-ground or gait art acceptance"}
assert data["editable_mesh"] and data["armature_bones"]==22 and data["required_actions_present"] and data["skin_modifier_matches_rig"]
assert data["max_influences"]<=4 and data["external_images"]==[]
assert max_target_error<.0001 and max_stance_height_error<.0001
path=report_root/(source.stem+"-source-reopen.json")
path.write_text(json.dumps(data,indent=2),encoding="utf-8")
print("SAM_SOURCE_REOPEN_OK "+str(path))
