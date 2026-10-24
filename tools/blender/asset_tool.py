"""
Usage:
  blender -b <file.blend> --python tools/blender/asset_tool.py -- inspect [<file.glb>]
  blender -b <file.blend> --python tools/blender/asset_tool.py -- normalize <params.json> <out.glb>
  blender -b --python tools/blender/asset_tool.py -- inspect-character <model.glb> [<preview_dir>]
  blender -b --python tools/blender/asset_tool.py -- prep-mixamo <in.glb> <out.fbx>
  blender -b --python tools/blender/asset_tool.py -- build-character <team_rigged.fbx> <anims_dir> <out.glb> [donor_rigged.fbx]
  blender -b --python tools/blender/asset_tool.py -- build-fp-arms <team_rigged.fbx> <out.glb> [donor_rigged.fbx] [--keep-upper=0.6]
  (donor: use this file's 65-bone skeleton, move its joints onto the team_rigged body, then skin automatically)
  blender -b --python tools/blender/asset_tool.py -- rig-humanoid <unrigged.gltf|glb> <out.glb> <donor_rigged.fbx> [--preset=tr_guerilla] [--height-m=1.72] [--anims=<dir>] [--fparms=<out.glb>] [--keep-upper=0.6]
  blender -b --python tools/blender/asset_tool.py -- preview-rig <rigged.glb> <out_prefix>
  (rig-humanoid: an unrigged A-posed humanoid -> the donor's 65-bone Mixamo skeleton (same bone names/axes, so the shared animations play), skinned, turned into a T-pose.
   Joint positions come from RIG_PRESETS[preset]; fingers are the donor hand scaled onto the hand. --anims merges the Mixamo clips (Hips scaled to this body, z_* skipped), --fparms also writes the first-person arms.
   preview-rig: renders the skeleton over the body, at rest and in test poses)
  blender -b --python tools/blender/asset_tool.py -- build-grenade <src.glb> <out.glb> [height_m=0.09]
  blender -b --python tools/blender/asset_tool.py -- build-scene <src.gltf|glb|obj|fbx|usd*|blend> <out.glb> [--scale=1] [--turn-deg=0] [--center] [--ground] [--jpeg-quality=85] [--max-tex-px=0]
  blender -b --python tools/blender/asset_tool.py -- preview-scene <scene.glb> <out.png> [--size=640x360] [--from=95,70,85] [--look=0,0,3]
  blender -b --python tools/blender/asset_tool.py -- build-texture <src.png|jpg|...> <out.jpg> [--max-px=1024] [--quality=88]
  (build-texture: tileable map texture -> power-of-two square-or-not JPEG no bigger than max-px; prints SEAM numbers. Prefer `node scripts/import-texture.mjs`, which also registers the texture)
  (preview-scene: lit render of a build-scene glb for a lobby card; --from / --look are game coordinates x,y,z)
  (build-scene: a static level / prop with its textures -> one game-ready glb: metres, Y up. Run it through `node scripts/blender.mjs` if `blender` is not on PATH)
(The old gun_tool.py is now just a shortcut that calls this file.)
"""
import bpy, sys, json, os
from mathutils import Vector, Matrix, Euler
import math
from math import radians, exp

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
mode = argv[0] if argv else "inspect"

def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']

def world_bbox(objs):
    mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector((min(mn[i], w[i]) for i in range(3)))
            mx = Vector((max(mx[i], w[i]) for i in range(3)))
    return mn, mx

def tri_count(o):
    me = o.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)

def inspect(glb_path=None):
    if glb_path:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=glb_path)
    objs = mesh_objects()
    mn, mx = world_bbox(objs) if objs else (Vector(), Vector())
    report = {
        "blender": bpy.app.version_string,
        "unit_scale": bpy.context.scene.unit_settings.scale_length,
        "bbox_min": list(mn), "bbox_max": list(mx),
        "size": list(mx - mn),
        "total_tris": sum(tri_count(o) for o in objs),
        "objects": [{
            "name": o.name, "type": o.type,
            "parent": o.parent.name if o.parent else None,
            "location": list(o.matrix_world.translation),
            "dimensions": list(o.dimensions),
            "tris": tri_count(o) if o.type == 'MESH' else 0,
            "materials": [s.material.name for s in getattr(o, "material_slots", []) if s.material],
        } for o in bpy.context.scene.objects],
        "images": [{
            "name": im.name, "filepath": im.filepath,
            "packed": im.packed_file is not None,
            "exists": im.packed_file is not None or os.path.exists(bpy.path.abspath(im.filepath)),
            "size": list(im.size),
        } for im in bpy.data.images if im.type == 'IMAGE'],
    }
    print("INSPECT_JSON_BEGIN")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print("INSPECT_JSON_END")

def normalize(params_path, out_path):
    p = json.load(open(params_path, encoding="utf-8"))
    scene = bpy.context.scene

    # 1) Gather every root object (no parent) under one Empty "GunRoot"
    root = bpy.data.objects.new("GunRoot", None)
    scene.collection.objects.link(root)
    for o in list(scene.objects):
        if o is not root and o.parent is None:
            mw = o.matrix_world.copy()
            o.parent = root
            o.matrix_world = mw

    # 2) Transform: move the grip point to the origin, rotate, scale
    grip = Vector(p.get("grip", [0, 0, 0]))           # grip coordinates, Blender space, BEFORE the transform
    rot = p.get("rotate_deg", [0, 0, 0])               # XYZ rotation (degrees) so the barrel points +Y, up is +Z
    s = p.get("scale", 1.0)
    M = Matrix.Scale(s, 4) @ Euler([radians(a) for a in rot], 'XYZ').to_matrix().to_4x4() @ Matrix.Translation(-grip)
    root.matrix_world = M

    # 3) Add muzzle / eject Empties (Blender space coordinates, BEFORE the transform)
    # anchors (plan 10): {"hand_r": [...], "hand_l": [...], "mag": [...]} same coordinate space as muzzle
    pts = {k: p[k] for k in ("muzzle", "eject") if k in p}
    pts.update(p.get("anchors", {}))
    for name in pts:
        if bpy.data.objects.get(name) is None:
            e = bpy.data.objects.new(name, None)
            e.empty_display_size = 0.02
            scene.collection.objects.link(e)
            e.parent = root
            e.matrix_parent_inverse = Matrix.Identity(4)
            e.location = Vector(pts[name])

    # 4) Rename objects via a map (e.g. the magazine)
    for old, new in p.get("rename", {}).items():
        o = bpy.data.objects.get(old)
        if o: o.name = new

    # 5) Reduce polygons if needed
    ratio = p.get("decimate_ratio")
    if ratio and ratio < 1.0:
        for o in mesh_objects():
            m = o.modifiers.new("Decimate", 'DECIMATE')
            m.ratio = ratio

    # 6) Find textures with lost paths in the .blend file's folder
    try:
        bpy.ops.file.find_missing_files(directory=os.path.dirname(bpy.data.filepath))
    except Exception as ex:
        print("find_missing_files:", ex)

    # 6b) Rebuild materials: the Blender 5.x glTF exporter ignores pbrMetallicRoughness when
    # the material tree has a parent FRAME node, multiple Material Outputs, or blend_method=HASHED
    # (legacy from old .blend files). The safest way: wipe everything and rebuild with Principled BSDF.
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        tree = mat.node_tree
        pbsdf = next((n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        bc = list(pbsdf.inputs['Base Color'].default_value) if pbsdf else [0.8, 0.8, 0.8, 1.0]
        tree.nodes.clear()
        out_node = tree.nodes.new('ShaderNodeOutputMaterial')
        out_node.location = (300, 0)
        bsdf_node = tree.nodes.new('ShaderNodeBsdfPrincipled')
        bsdf_node.location = (0, 0)
        bsdf_node.inputs['Base Color'].default_value = bc
        tree.links.new(bsdf_node.outputs['BSDF'], out_node.inputs['Surface'])
        print(f"  rebuilt material '{mat.name}' base_color={[round(v, 3) for v in bc[:3]]}")

    # 7) Export GLB
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_animations=False,
    )
    print("EXPORTED", out_path)

# ---------------------------------------------------------------- inspect-character
def inspect_character(glb_path, preview_dir=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    scene = bpy.context.scene
    all_meshes = mesh_objects()
    objs = [o for o in all_meshes if len(o.vertex_groups) > 0] or all_meshes  # skinned mesh = the character body
    stray = [o.name for o in all_meshes if o not in objs]
    mn, mx = world_bbox(objs)
    name = os.path.splitext(os.path.basename(glb_path))[0]

    # Mesh: triangles, materials, vertex groups
    meshes = []
    for o in objs:
        meshes.append({
            "name": o.name, "tris": tri_count(o),
            "materials": [s.material.name for s in o.material_slots if s.material],
            "vertex_groups": [g.name for g in o.vertex_groups],
            "dimensions": [round(v, 4) for v in o.dimensions],
            "bbox_world_min": [round(v, 3) for v in (o.matrix_world @ Vector(o.bound_box[0]))],
        })

    # Texture
    images = []
    for im in bpy.data.images:
        if im.type != 'IMAGE':
            continue
        images.append({"name": im.name, "size": list(im.size),
                       "bytes_packed": len(im.packed_file.data) if im.packed_file else 0})

    # Armature: bone tree + lengths
    arms = []
    for a in [o for o in scene.objects if o.type == 'ARMATURE']:
        mw = a.matrix_world
        bones = {}
        def bone_info(b):
            h = mw @ b.head_local
            if b.children:   # the glTF importer's tail is a padding value; use the head of the first child bone
                length = (mw @ b.children[0].head_local - h).length
            else:
                length = None
            return {"head": [round(v, 3) for v in h], "length_to_child": round(length, 4) if length is not None else None}
        def tree(b):
            return {"name": b.name, **bone_info(b), "children": [tree(c) for c in b.children]}
        for b in a.data.bones:
            bones[b.name] = bone_info(b)
        arms.append({
            "name": a.name, "scale": list(a.scale), "bone_count": len(bones),
            "tree": [tree(b) for b in a.data.bones if b.parent is None],
            "has_finger_bones": any(k in n.lower() for n in bones for k in ("thumb", "index", "pinky", "finger")),
            "arm_candidates": {
                "upper_arm": [n for n in bones if n.lower().endswith("arm") and "fore" not in n.lower() and "lower" not in n.lower()],
                "forearm": [n for n in bones if "forearm" in n.lower() or "lowerarm" in n.lower()],
                "hand": [n for n in bones if n.lower().endswith("hand")],
            },
        })

    anims = [{"name": ac.name, "frames": list(ac.frame_range)} for ac in bpy.data.actions]

    height = mx.z - mn.z
    report = {
        "file": glb_path, "blender": bpy.app.version_string,
        "bbox_min": [round(v, 3) for v in mn], "bbox_max": [round(v, 3) for v in mx],
        "height_z": round(height, 4), "feet_z": round(mn.z, 4), "head_top_z": round(mx.z, 4),
        "total_tris": sum(m["tris"] for m in meshes),
        "stray_meshes_excluded_from_bbox": stray,
        "meshes": meshes, "images": images, "armatures": arms, "animations": anims,
    }

    # Facing direction: compare the vertex centroid in the head region along the Y axis (the nose/face usually sticks out front
    # so it is offset to one side of the head box center). Only an estimate.
    if objs:
        dg = bpy.context.evaluated_depsgraph_get()
        head_pts = []
        for o in objs:
            me = o.evaluated_get(dg).to_mesh()
            for v in me.vertices:
                w = o.matrix_world @ v.co
                if w.z > mn.z + height * 0.88:
                    head_pts.append(w)
        if head_pts:
            ymin = min(p.y for p in head_pts); ymax = max(p.y for p in head_pts)
            ymid = (ymin + ymax) / 2
            ymean = sum(p.y for p in head_pts) / len(head_pts)
            xmean = sum(p.x for p in head_pts) / len(head_pts)
            report["facing_estimate"] = {
                "head_y_range": [round(ymin, 3), round(ymax, 3)],
                "head_vertex_mean_y_minus_mid": round(ymean - ymid, 4),
                "note": "Rough estimate, confirm with the preview images",
            }

    print("INSPECT_CHARACTER_JSON_BEGIN")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print("INSPECT_CHARACTER_JSON_END")

    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
        render_previews(name, preview_dir, mn, mx)

def render_previews(name, out_dir, mn, mx):
    from math import pi
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = 600; scene.render.resolution_y = 900
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.world = bpy.data.worlds.new("w"); scene.world.color = (0.5, 0.5, 0.5)
    scene.display.shading.background_type = 'WORLD' if hasattr(scene.display.shading, "background_type") else 'WORLD'
    cam_data = bpy.data.cameras.new("cam"); cam_data.type = 'ORTHO'
    cam_data.ortho_scale = (mx.z - mn.z) * 1.2
    cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam); scene.camera = cam
    c = (mn + mx) / 2; d = max(mx.z - mn.z, 1) * 3
    # front view: camera at −Y looking toward +Y (sees the face if it faces −Y); 90° side view: camera at +X
    for label, pos, rot in (("front", Vector((c.x, c.y - d, c.z)), (pi / 2, 0, 0)),
                            ("side", Vector((c.x + d, c.y, c.z)), (pi / 2, 0, pi / 2))):
        cam.location = pos; cam.rotation_euler = Euler(rot, 'XYZ')
        scene.render.filepath = os.path.join(out_dir, f"{name}_{label}.png")
        bpy.ops.render.render(write_still=True)
        print("PREVIEW", scene.render.filepath)

# ---------------------------------------------------------------- prep-mixamo
def prep_mixamo(glb_path, out_path, target_height=1.8):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    scene = bpy.context.scene
    # delete stray unskinned meshes (Icosphere) and the old armature, keep the body mesh
    for o in list(scene.objects):
        if o.type == 'MESH' and len(o.vertex_groups) == 0:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in list(scene.objects):
        if o.type == 'ARMATURE':
            for c in o.children:
                mw = c.matrix_world.copy(); c.parent = None; c.matrix_world = mw
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = mesh_objects()
    for o in meshes:
        for m in [m for m in o.modifiers if m.type == 'ARMATURE']:
            o.modifiers.remove(m)
        o.vertex_groups.clear()
    # merge the body meshes into one
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1: bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # scale to 1.8 m tall, feet at z=0, horizontally centered at the origin
    mn, mx = world_bbox([body])
    s = target_height / (mx.z - mn.z)
    body.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mn, mx = world_bbox([body])
    body.location = Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    # face −Y: checked beforehand (inspect-character confirmed both models already face −Y), no extra rotation
    for im in bpy.data.images:
        if im.type == 'IMAGE' and im.packed_file is None and im.size[0] > 0:
            im.pack()
    bpy.ops.file.pack_all()
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.export_scene.fbx(filepath=out_path, path_mode='COPY', embed_textures=True,
                             use_selection=False, object_types={'MESH'}, add_leaf_bones=False)
    mn, mx = world_bbox([body])
    print("PREP_MIXAMO", out_path, "height", round(mx.z - mn.z, 4), "min", list(mn), "max", list(mx))

def check_fbx(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    objs = mesh_objects()
    mn, mx = world_bbox(objs)
    print("CHECK_FBX", path, "meshes", [o.name for o in objs], "tris", sum(tri_count(o) for o in objs),
          "height", round(mx.z - mn.z, 4), "feet", round(mn.z, 4), "bbox", [round(v, 3) for v in mn], [round(v, 3) for v in mx],
          "images", [(i.name, list(i.size)) for i in bpy.data.images if i.type == 'IMAGE'])

# ---------------------------------------------------------------- build-character
ROOT_MOTION_LIMIT = 0.3   # m: only remove root drift on animations whose hips shift sideways more than this (death_*)

def _action_fcurves(act):
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                for fc in cb.fcurves:
                    yield fc

def _select_active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o

def fit_donor_rig(arm_c, body, donor_path):
    """Take the donor's full 65-bone skeleton, move the same-named joints to the arm_c positions (this body's own rig),
    infer the three missing fingers from the donor hand; then re-skin the body with Automatic Weights."""
    from mathutils import Vector, Matrix
    before = set(bpy.data.objects); before_im = set(bpy.data.images); before_mat = set(bpy.data.materials)
    bpy.ops.import_scene.fbx(filepath=donor_path)
    new = [o for o in bpy.data.objects if o not in before]
    arm_d = next(o for o in new if o.type == 'ARMATURE')
    for o in [o for o in new if o.type == 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    for im in [i for i in bpy.data.images if i not in before_im]:      # the donor's textures/materials are unused
        bpy.data.images.remove(im)
    for mt in [m for m in bpy.data.materials if m not in before_mat]:
        bpy.data.materials.remove(mt)
    _select_active(arm_d)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    drest = {b.name: b.matrix_local.copy() for b in arm_d.data.bones}
    dlen = {b.name: b.length for b in arm_d.data.bones}
    cb = arm_c.data.bones
    # A hand whose source rig has no middle finger cannot be trusted: Mixamo's auto-rigger gave the fingerless-glove hand of saber-t.fbx only a stray
    # index chain out at the fingertips (it scaled the donor fingers 1.23x so they poked past the mesh, and nothing but the index was weighted).
    # For such a hand drop every source finger bone, size the donor fingers from the forearm, and weight all five fingers ourselves.
    bare = {s for s in ("Left", "Right") if f"mixamorig:{s}HandMiddle1" not in cb}
    def is_finger(n, s): return n.startswith(f"mixamorig:{s}Hand") and n != f"mixamorig:{s}Hand"
    def untrusted(n): return any(is_finger(n, s) for s in bare)
    missing = [n for n in drest if n not in cb or untrusted(n)]
    print("FIT shared", len(drest) - len(missing), "missing", len(missing), "bare hands", sorted(bare))
    hand = {}
    for side in ("Left", "Right"):
        h = f"mixamorig:{side}Hand"
        ik = f"mixamorig:{side}HandIndex1"
        if ik in cb and side not in bare:
            k = (cb[ik].head_local - cb[h].head_local).length / (drest[ik].translation - drest[h].translation).length
        else:   # model is missing fingers (e.g. a zombie with a severed arm): infer the scale from the forearm
            fa = f"mixamorig:{side}ForeArm"
            k = cb[fa].length / dlen[fa]
        M = cb[h].matrix_local.to_3x3() @ drest[h].to_3x3().inverted()
        hand[side] = (k, M, cb[h].head_local.copy(), drest[h].translation.copy())
        print("FIT", side, "finger scale k=%.3f" % k)
    # On a bare hand the donor fingers are laid out along the real mesh: the wrist-to-fingertip length is measured from the hand's own vertices and the
    # knuckles go KNUCKLE_FRAC of the way along (a uniform scale from the forearm put them at ~68%, under the fingerless glove, so only the bare tips bent).
    # Along the hand axis the donor palm and the donor fingers are stretched separately; across it the forearm scale k applies.
    KNUCKLE_FRAC = 0.55
    fit = {}
    for side in bare:
        k, M, hc, hd = hand[side]
        mid = drest[f"mixamorig:{side}HandMiddle1"].translation - hd
        kn_d = mid.length; axis_d = mid / kn_d
        m3n = f"mixamorig:{side}HandMiddle3"
        tip_d = (drest[m3n].translation + drest[m3n].to_3x3() @ Vector((0, dlen[m3n], 0)) - hd).dot(axis_d)
        axis_c = (M @ axis_d).normalized()
        gi = {vg.index for vg in body.vertex_groups if vg.name == f"mixamorig:{side}Hand" or is_finger(vg.name, side)}
        L = max(((v.co - hc).dot(axis_c) for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in gi) >= 0.5), default=k * tip_d)
        fit[side] = (axis_d, kn_d, tip_d, L)
        print("FIT", side, "hand length from mesh %.3f (donor %.3f x k = %.3f)" % (L, tip_d, k * tip_d))
    def scale_vec(side, d):
        """A donor-space offset from the donor wrist -> the same offset on this body (see KNUCKLE_FRAC)"""
        k = hand[side][0]
        if side not in fit:
            return k * d
        axis_d, kn_d, tip_d, L = fit[side]
        a = d.dot(axis_d)
        a2 = a * KNUCKLE_FRAC * L / kn_d if a <= kn_d else KNUCKLE_FRAC * L + (a - kn_d) * (1 - KNUCKLE_FRAC) * L / (tip_d - kn_d)
        return axis_d * a2 + (d - axis_d * a) * k
    cmat = {b.name: (b.matrix_local.copy(), b.length) for b in cb if not untrusted(b.name)}
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = arm_d.data.edit_bones
    for eb in ebs:
        eb.use_connect = False
    for eb in ebs:
        if eb.name in cmat:
            eb.matrix, eb.length = cmat[eb.name][0], cmat[eb.name][1]
        else:
            side = "Left" if "Left" in eb.name else "Right"
            k, M, hc, hd = hand[side]
            md = drest[eb.name]
            d0 = md.translation - hd
            pos = hc + M @ scale_vec(side, d0)
            eb.matrix = Matrix.Translation(pos) @ (M @ md.to_3x3()).to_4x4()
            eb.length = (scale_vec(side, d0 + md.to_3x3() @ Vector((0, dlen[eb.name], 0))) - scale_vec(side, d0)).length
    bpy.ops.object.mode_set(mode='OBJECT')
    for ac in list(bpy.data.actions):
        bpy.data.actions.remove(ac)
    # skin: keep the Mixamo weights of the 41 old bones, attach them to the new armature
    for m in list(body.modifiers):
        if m.type == 'ARMATURE':
            body.modifiers.remove(m)
    # Vertex groups tied to bones the donor lacks (LeftEye/RightEye...): move their weights to the nearest ancestor bone the donor has
    # (Head), otherwise the eyes lose their weights and float above the head during animation. The untrusted finger groups of a bare hand
    # (see above) fold back into their Hand bone the same way, so _weight_missing_fingers can redistribute them over the new finger bones.
    for vg in list(body.vertex_groups):
        if untrusted(vg.name):
            dst = body.vertex_groups.get(next(f"mixamorig:{s}Hand" for s in bare if is_finger(vg.name, s)))
            for v in body.data.vertices:
                for g in v.groups:
                    if g.group == vg.index and g.weight > 0:
                        dst.add([v.index], g.weight, 'ADD')
            print("FIT merged group", vg.name, "->", dst.name)
            body.vertex_groups.remove(vg)
            continue
        if vg.name in drest or vg.name not in cb:
            continue
        anc = cb[vg.name].parent
        while anc is not None and anc.name not in drest:
            anc = anc.parent
        if anc is None:
            continue
        dst = body.vertex_groups.get(anc.name) or body.vertex_groups.new(name=anc.name)
        for v in body.data.vertices:
            for g in v.groups:
                if g.group == vg.index and g.weight > 0:
                    dst.add([v.index], g.weight, 'ADD')
        print("FIT merged group", vg.name, "->", anc.name)
        body.vertex_groups.remove(vg)
    mw = body.matrix_world.copy(); body.parent = None; body.matrix_world = mw
    bpy.data.objects.remove(arm_c, do_unlink=True)
    body.parent = arm_d
    body.matrix_parent_inverse = Matrix.Identity(4)
    mod = body.modifiers.new("Armature", 'ARMATURE'); mod.object = arm_d
    _weight_missing_fingers(body, arm_d, missing, bare)
    return arm_d, body

def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length

def _smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / max(b - a, 1e-9)))
    return t * t * (3.0 - 2.0 * t)

FINGER_RADIUS = {"Thumb": 0.011, "Index": 0.0095, "Middle": 0.0095, "Ring": 0.009, "Pinky": 0.008}   # metres at the base of the visible finger
RING_TAPER = (1.0, 0.95, 0.88, 0.78)
RING_SIDES = 6
SEED_FRAC = 0.62     # skin seeds: confident skin-coloured faces beyond this fraction of the hand length (the shortest bare fingertip, the thumb, starts about here)
GROW_FRAC = 0.55     # ... and the skin region only grows back to here (the glove, with its tan camo, is short of it)
GLOVE_FOLLOW = 0.0   # how much of the finger weighting the old glove vertices take: none, a glove edge that follows the fingers tears into long spikes; only the rebuilt fingers move

def _rebuild_bare_fingers(body, bones, side):
    """The bare fingertips of a fingerless-glove hand (saber-t) are flat low-poly ribbons: they look fine in the T-pose but fold into thin slivers once
    curled round a grip. Replace them with round, tapered 6-sided fingers built along the finger bones (the glove stays). The old skin faces are found
    by colour on the texture atlas (skin is pale orange, the glove dark) beyond the knuckles; the new vertices take the Hand bone as their weight
    (so _weight_bare_fingers skins them) and the UV of a typical skin texel (a flat skin colour)."""
    import bmesh, numpy as np
    from mathutils import Vector
    img = next(n.image for n in body.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE')
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
    hg = body.vertex_groups[f"mixamorig:{side}Hand"]
    wrist = bones[f"mixamorig:{side}Hand"].head_local
    axis = (bones[f"mixamorig:{side}HandMiddle1"].head_local - wrist).normalized()
    knuckle = (bones[f"mixamorig:{side}HandMiddle1"].head_local - wrist).length
    bm = bmesh.new(); bm.from_mesh(body.data)
    dl = bm.verts.layers.deform.verify(); uvl = bm.loops.layers.uv.active
    on_hand = [f for f in bm.faces if min(v[dl].get(hg.index, 0.0) for v in f.verts) >= 0.5]
    on_set = set(on_hand)
    reach = max((v.co - wrist).dot(axis) for f in on_hand for v in f.verts)
    def along(f): return (f.calc_center_median() - wrist).dot(axis)
    def rgb(f):
        uv = sum((l[uvl].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
        return px[int((uv.y % 1) * (h - 1)), int((uv.x % 1) * (w - 1)), :3]
    # The reference skin colour comes from the fingertips themselves. The glove's tan camo patches are close to skin in colour, so a face only
    # counts as skin if it is a confident match near the fingertips (seed) or a looser match connected to such a face (growth).
    tips = [rgb(f) for f in on_hand if along(f) >= 0.8 * reach and rgb(f)[0] > 0.5]
    ref = np.mean(tips, axis=0) if tips else np.array([0.56, 0.43, 0.35])
    def dist(f): return float(np.linalg.norm(rgb(f) - ref))
    skin_set = {f for f in on_hand if along(f) >= SEED_FRAC * reach and dist(f) < 0.085}
    todo = list(skin_set)
    while todo:
        for e in todo.pop().edges:
            for g in e.link_faces:
                if g in on_set and g not in skin_set and along(g) >= GROW_FRAC * reach and dist(g) < 0.13:
                    skin_set.add(g); todo.append(g)
    skin = list(skin_set)
    skin_uv = [(sum((l[uvl].uv for l in f.loops), Vector((0, 0))) / len(f.loops), rgb(f)) for f in skin]
    # edge texels that missed the colour test: slivers at the end of an old finger / long glove-edge triangles reaching out to it
    def warm(f): c = rgb(f); return c[0] - c[2] > 0.09          # the glove is neutral dark; tips with nail/shadow texels are warm brown
    stray = [f for f in on_hand if f not in skin_set and (along(f) > 0.8 * reach or max((v.co - wrist).dot(axis) for v in f.verts) > 0.84 * reach
                                                          or (max((v.co - wrist).dot(axis) for v in f.verts) > 0.755 * reach and warm(f)))]
    if not skin:
        bm.free(); return set()
    mean = np.mean([c for _, c in skin_uv], axis=0)
    skin_uv_pt = min(skin_uv, key=lambda t: float(np.sum((t[1] - mean) ** 2)))[0]
    verts_old = {v for f in skin + stray for v in f.verts}
    bmesh.ops.delete(bm, geom=skin + stray, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in verts_old if v.is_valid and not v.link_faces], context='VERTS')
    made = 0
    fresh = []
    for fname, first in (("Thumb", 2), ("Index", 1), ("Middle", 1), ("Ring", 1), ("Pinky", 1)):
        chain = [bones[f"mixamorig:{side}Hand{fname}{i}"] for i in (1, 2, 3)]
        pts = [b.head_local.copy() for b in chain[first - 1:]] + [chain[2].tail_local.copy()]
        pts = pts[-4:] if len(pts) > 4 else pts
        taper = RING_TAPER[len(RING_TAPER) - len(pts):] if len(pts) < 4 else RING_TAPER
        rings = []
        for i, c in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            hv = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((0, 1, 0))
            a = (hv - t * hv.dot(t)).normalized(); b = t.cross(a)      # a x b = t: outward normals for the winding below
            r = FINGER_RADIUS[fname] * taper[i]
            rings.append([bm.verts.new(c + (a * math.cos(2 * math.pi * j / RING_SIDES) + b * math.sin(2 * math.pi * j / RING_SIDES)) * r) for j in range(RING_SIDES)])
        t_end = (pts[-1] - pts[-2]).normalized()
        pole = bm.verts.new(pts[-1] + t_end * 0.4 * FINGER_RADIUS[fname] * taper[-1])
        quads = []
        for i in range(len(rings) - 1):
            for j in range(RING_SIDES):
                quads.append((rings[i][j], rings[i][(j + 1) % RING_SIDES], rings[i + 1][(j + 1) % RING_SIDES], rings[i + 1][j]))
        quads += [(rings[-1][j], rings[-1][(j + 1) % RING_SIDES], pole) for j in range(RING_SIDES)]
        new_verts = [v for r in rings for v in r] + [pole]
        fresh += new_verts
        for v in new_verts:
            v[dl][hg.index] = 1.0
        for q in quads:
            f = bm.faces.new(q)
            for l in f.loops:
                l[uvl].uv = skin_uv_pt
        made += 1
    bm.normal_update()
    bm.verts.index_update()
    fresh_idx = {v.index for v in fresh}
    bm.to_mesh(body.data); bm.free()
    body.data.update()
    print("FIT bare fingers", side, "replaced", len(skin), "skin +", len(stray), "stray faces with", made, "round fingers")
    return fresh_idx
    return fresh_idx

def _weight_bare_fingers(body, bones, side, fresh=frozenset()):
    """Skin a hand that has no usable finger weights over the donor's five 3-bone finger chains, smoothly so the fingers bend without crumpling:
    a vertex picks its finger by distance to the finger's polyline (soft falloff, so neighbours share the gaps between them), then blends along the
    finger: palm -> bone 1 across the knuckle, bone 1 -> 2 -> 3 across each joint. Vertices far from every finger stay on the Hand bone.
    `fresh` = indices of the rebuilt finger vertices, which follow the fingers fully; the glove only follows by GLOVE_FOLLOW."""
    names = ("Thumb", "Index", "Middle", "Ring", "Pinky")
    chain = {f: [bones[f"mixamorig:{side}Hand{f}{i}"] for i in (1, 2, 3)] for f in names}
    poly = {f: [c[0].head_local, c[1].head_local, c[2].head_local, c[2].tail_local] for f, c in chain.items()}
    seglen = {f: [(poly[f][i + 1] - poly[f][i]).length for i in range(3)] for f in names}
    spacing = (bones[f"mixamorig:{side}HandMiddle1"].head_local - bones[f"mixamorig:{side}HandRing1"].head_local).length
    sigma = 0.9 * spacing
    hg = body.vertex_groups[f"mixamorig:{side}Hand"]
    groups = {c.name: body.vertex_groups.get(c.name) or body.vertex_groups.new(name=c.name) for f in names for c in chain[f]}
    moved = 0
    for v in body.data.vertices:
        wh = next((g.weight for g in v.groups if g.group == hg.index), 0.0)
        if wh < 0.01:
            continue
        p = v.co
        a, s_at = {}, {}
        for f in names:
            best, arc, acc = 1e9, 0.0, 0.0
            for i in range(3):
                ab = poly[f][i + 1] - poly[f][i]
                t = max(0.0, min(1.0, (p - poly[f][i]).dot(ab) / max(ab.length_squared, 1e-12)))
                d = (p - (poly[f][i] + ab * t)).length
                if d < best:
                    best, arc = d, acc + t * seglen[f][i]
                acc += seglen[f][i]
            # beyond the knuckle (arc < 0) the closest point clamps to the chain's base, so arc stays 0: use the signed projection instead
            ab0 = poly[f][1] - poly[f][0]
            proj = (p - poly[f][0]).dot(ab0.normalized())
            if proj < 0.0:
                arc = proj
            a[f] = exp(-(best / sigma) ** 2); s_at[f] = arc
        m = max(a.values()); tot = sum(a.values())
        if m < 0.02 or tot <= 0.0:
            continue
        shares = {}
        for f in names:
            L1, L2, L3 = seglen[f]
            s = s_at[f]
            r0 = 0.5 * L1
            u = _smoothstep(-r0, r0, s)                      # palm -> finger across the knuckle
            j1 = 0.35 * min(L1, L2); j2 = 0.35 * min(L2, L3)
            b12 = _smoothstep(L1 - j1, L1 + j1, s)
            b23 = _smoothstep(L1 + L2 - j2, L1 + L2 + j2, s)
            # rebuilt fingers sit on the bone chains, so they split fully between fingers (no distance falloff, or the tips keep some Hand weight and smear)
            share = wh * (a[f] / tot) * u if v.index in fresh else wh * m * (a[f] / tot) * u * GLOVE_FOLLOW
            shares[f] = (share * (1 - b12), share * b12 * (1 - b23), share * b12 * b23)
        fing_total = sum(sum(x) for x in shares.values())
        if fing_total < 1e-4:
            continue
        hg.add([v.index], wh - fing_total, 'REPLACE')
        for f in names:
            for c, w in zip(chain[f], shares[f]):
                if w > 1e-4:
                    groups[c.name].add([v.index], w, 'REPLACE')
        moved += 1
    print("FIT bare fingers", side, "vertices re-weighted:", moved)

def _weight_missing_fingers(body, arm, missing, bare=(), eps=1e-4):
    """Redistribute the Hand weights in the area far from the palm to the new finger bones (Middle/Ring/Pinky),
    by distance to the bone; the index/thumb already have their own weights so they count as competitors.
    A side in `bare` has no usable finger weights at all: all five fingers are new there and nothing competes with them."""
    bones = arm.data.bones
    for side in ("Left", "Right"):
        if side in bare:
            _weight_bare_fingers(body, bones, side, _rebuild_bare_fingers(body, bones, side))
            continue
        hand = bones[f"mixamorig:{side}Hand"]
        fingers = ("Middle", "Ring", "Pinky")
        new = [n for n in missing if side in n and "Hand" in n and any(f in n for f in fingers)]
        old = [] if side in bare else [b.name for b in bones if side in b.name and ("HandIndex" in b.name or "HandThumb" in b.name)]
        knuckle = bones[f"mixamorig:{side}HandMiddle1"].head_local
        axis = knuckle - hand.head_local; hlen = axis.length; axis.normalize()
        for n in new:
            if n not in body.vertex_groups:
                body.vertex_groups.new(name=n)
        hg = body.vertex_groups.get(f"mixamorig:{side}Hand")
        if hg is None:     # the mesh has no hand on this side (zombie with a severed arm): nothing to split
            continue
        segs_new = {n: (bones[n].head_local, bones[n].tail_local) for n in new}
        segs_old = [(bones[n].head_local, bones[n].tail_local) for n in old]
        moved = 0
        for v in body.data.vertices:
            wh = next((g.weight for g in v.groups if g.group == hg.index), 0.0)
            if wh < 0.01:
                continue
            p = v.co
            t = (p - hand.head_local).dot(axis) / hlen          # 0 = wrist, 1 = knuckle
            g = max(0.0, min(1.0, (t - 0.6) / 0.4))
            if g <= 0.0:
                continue
            dn = {n: _seg_dist(p, *segs_new[n]) for n in new}
            do = min((_seg_dist(p, *sg) for sg in segs_old), default=float('inf'))
            inv = {n: 1.0 / (d + eps) ** 4 for n, d in dn.items()}
            tot_new = sum(inv.values()); inv_old = 1.0 / (do + eps) ** 4
            share = tot_new / (tot_new + inv_old)
            amount = wh * g * share
            if amount < 1e-3:
                continue
            hg.add([v.index], wh - amount, 'REPLACE')
            for n, w in inv.items():
                body.vertex_groups[n].add([v.index], amount * w / tot_new, 'REPLACE')
            moved += 1
        print("FIT fingers", side, "vertices re-weighted:", moved)


def _merge_skinned_meshes(arm):
    """Mixamo often ships a junk 'Cube' (unskinned) and some models have several meshes (body, shoes, hair, glasses...):
    delete meshes without an Armature modifier, merge the rest into one body."""
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    skinned = [o for o in meshes if any(m.type == 'ARMATURE' for m in o.modifiers)]
    for o in meshes:
        if o not in skinned:
            bpy.data.objects.remove(o, do_unlink=True)
    body = max(skinned, key=lambda o: len(o.data.vertices))
    if len(skinned) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in skinned: o.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()
    return body

def _fix_bone_prefix(arm, body):
    """Some Mixamo files use the prefix 'mixamorig1:' ...: normalize it to 'mixamorig:'."""
    import re
    for b in arm.data.bones:
        m = re.match(r"mixamorig\d+:(.*)", b.name)
        if m:
            vg = body.vertex_groups.get(b.name)
            b.name = "mixamorig:" + m.group(1)
            if vg: vg.name = b.name

def prepare_rigged(rigged_path, donor_path=None):
    """Import <team>_rigged.fbx: strip Mixamo junk, apply cm→meters/Z-up, (optionally) switch to the donor's 65-bone skeleton. Returns (arm, body)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=rigged_path)
    scene = bpy.context.scene
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    body = _merge_skinned_meshes(arm)
    _fix_bone_prefix(arm, body)
    for ac in list(bpy.data.actions):          # the action bundled with the rigged file (a single T-pose frame) is unused
        bpy.data.actions.remove(ac)
    # Mixamo attaches junk 0x0 images to Emission (+ an image-less Normal Map): the character would come out blown-out white. Remove them all.
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        tree = mat.node_tree
        bsdf = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
        for n in [n for n in tree.nodes if n.type == 'TEX_IMAGE' and (n.image is None or n.image.size[0] == 0)]:
            tree.nodes.remove(n)
        for n in [n for n in tree.nodes if n.type == 'NORMAL_MAP']:
            tree.nodes.remove(n)
        for sock in ('Emission Color',):
            for l in list(bsdf.inputs[sock].links):
                tree.links.remove(l)
        bsdf.inputs['Emission Color'].default_value = (0, 0, 0, 1)
        bsdf.inputs['Emission Strength'].default_value = 0.0
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.9
    for im in list(bpy.data.images):           # junk 0x0 images created by Mixamo
        if im.size[0] == 0:
            bpy.data.images.remove(im)

    # Apply transform: armature scale 0.01 / 90° rotation (cm, Y-up of FBX) -> meters, Z-up
    mw = body.matrix_world.copy()
    body.parent = None
    body.matrix_world = mw
    for o in (arm, body):
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    body.parent = arm
    body.matrix_parent_inverse = Matrix.Identity(4)
    for m in body.modifiers:
        if m.type == 'ARMATURE':
            m.object = arm
    body.name = "char1"; arm.name = "Armature"
    if donor_path:
        arm, body = fit_donor_rig(arm, body, donor_path)
        body.name = "char1"; arm.name = "Armature"
    for im in bpy.data.images:
        if im.type == 'IMAGE' and im.packed_file is None:
            im.pack()

    return arm, body

def _merge_animations(arm, anims_dir, hips_scale=1.0, skip_prefix=None):
    """Load every <anims_dir>/*.fbx Mixamo clip onto `arm` (same mixamorig:* bones): one action per file, a muted NLA strip each so the exporter writes them all.
    hips_scale multiplies the position keys (the clips were made for a body whose hips are at 0.949 m). Returns [(name, frames, drift, drift removed)]."""
    import glob
    from mathutils import Vector
    # 2) Load each animation: take the action, rename it after the file, delete the temp armature
    ad = arm.animation_data_create()
    hips_rest = arm.data.bones['mixamorig:Hips'].matrix_local.to_3x3()
    report = []
    for f in sorted(glob.glob(os.path.join(anims_dir, "*.fbx"))):
        name = os.path.splitext(os.path.basename(f))[0]
        if skip_prefix and name.startswith(skip_prefix):
            continue
        before_a = set(bpy.data.actions); before_o = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=f)
        new = [a for a in bpy.data.actions if a not in before_a]
        for o in [o for o in bpy.data.objects if o not in before_o]:
            bpy.data.objects.remove(o, do_unlink=True)
        if not new:
            print("WARN no action in", f); continue
        act = new[0]; act.name = name; act.use_fake_user = True
        # units: position keyframes of the anim file are in cm, the armature is now in meters (hips_scale: a body whose hips sit lower/higher than the clips')
        k = 0.01 * hips_scale
        for fc in _action_fcurves(act):
            if fc.data_path.endswith(".location"):
                for kp in fc.keyframe_points:
                    kp.co.y *= k; kp.handle_left.y *= k; kp.handle_right.y *= k
                fc.update()
        # 3) Remove root drift on the Hips bone (in armature space, horizontal axes only), keep the height
        fcs = {fc.array_index: fc for fc in _action_fcurves(act) if fc.data_path == 'pose.bones["mixamorig:Hips"].location'}
        drift = 0.0
        if len(fcs) == 3:
            n = len(fcs[0].keyframe_points)
            vecs = [hips_rest @ Vector((fcs[0].keyframe_points[i].co.y, fcs[1].keyframe_points[i].co.y, fcs[2].keyframe_points[i].co.y)) for i in range(n)]
            hx = [v.x for v in vecs]; hy = [v.y for v in vecs]
            drift = max(max(hx) - min(hx), max(hy) - min(hy))
            if drift > ROOT_MOTION_LIMIT:
                inv = hips_rest.inverted()
                x0, y0 = vecs[0].x, vecs[0].y
                for i, v in enumerate(vecs):
                    loc = inv @ Vector((x0, y0, v.z))
                    for k in range(3):
                        kp = fcs[k].keyframe_points[i]
                        kp.co.y = loc[k]; kp.handle_left.y = loc[k]; kp.handle_right.y = loc[k]
                for k in range(3): fcs[k].update()
        report.append((name, round(act.frame_range[1] - act.frame_range[0] + 1), round(drift, 2), drift > ROOT_MOTION_LIMIT))

    # 4) One (muted) NLA strip per action so the exporter writes them all
    for name, *_ in report:
        act = bpy.data.actions[name]
        ad.action = act
        ad.action_slot = act.slots[0]
        tr = ad.nla_tracks.new(); tr.name = name
        st = tr.strips.new(name, 1, act)
        st.action_slot = act.slots[0]
        st.mute = True
    ad.action = None
    return report

def build_character(rigged_path, anims_dir, out_path, donor_path=None):
    arm, body = prepare_rigged(rigged_path, donor_path)
    scene = bpy.context.scene
    report = _merge_animations(arm, anims_dir)

    # 5) Downscale textures to at most 2048
    for im in bpy.data.images:
        if im.type == 'IMAGE' and max(im.size) > 2048:
            im.scale(2048, 2048)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True,
                              export_animations=True, export_nla_strips=True,
                              export_image_format='WEBP', export_apply=False)
    for r in report:
        print("ANIM", r)
    print("BUILT", out_path)

# ---------------------------------------------------------------- build-fp-arms
def build_fp_arms(rigged_path, out_path, donor_path=None, keep_upper=0.6):
    """Keep only the two arms (upper arm → hand + fingers) of the model as the viewmodel arms. Keeps the armature, no actions."""
    arm, body = prepare_rigged(rigged_path, donor_path)
    for ac in list(bpy.data.actions):
        bpy.data.actions.remove(ac)
    _export_fp_arms(arm, body, out_path, keep_upper)

def _export_fp_arms(arm, body, out_path, keep_upper=0.6):
    """Delete everything but the arms from `body` (in place) and export the skinned result without animations."""
    import bmesh
    from mathutils import Vector
    names = {g.index: g.name for g in body.vertex_groups}
    def side_of(n):
        n = n.replace("mixamorig:", "")
        for side in ("Left", "Right"):
            if n in (side + "Arm", side + "ForeArm") or n.startswith(side + "Hand"):
                return side
        return None
    bones = arm.data.bones
    upper_axis = {}
    for side in ("Left", "Right"):
        a = bones[f"mixamorig:{side}Arm"]; f = bones[f"mixamorig:{side}ForeArm"]
        v = f.head_local - a.head_local
        upper_axis[side] = (a.head_local.copy(), v.normalized(), v.length)
    bm = bmesh.new(); bm.from_mesh(body.data)
    dl = bm.verts.layers.deform.active
    kill = []
    for v in bm.verts:
        w = {"Left": 0.0, "Right": 0.0}; w_up = {"Left": 0.0, "Right": 0.0}
        for gi, wt in v[dl].items():
            n = names.get(gi, ""); side = side_of(n)
            if side:
                w[side] += wt
                if n.replace("mixamorig:", "") == side + "Arm":
                    w_up[side] += wt
        side = max(w, key=w.get)
        if w[side] < 0.5:
            kill.append(v); continue
        head, axis, ln = upper_axis[side]
        t = (v.co - head).dot(axis) / ln          # 0 = shoulder, 1 = elbow
        if w_up[side] > 0.8 and t < (1.0 - keep_upper):
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    # drop leftover small loose pieces (not attached to the arm)
    bm.to_mesh(body.data); bm.free()
    body.data.update()
    # drop unused vertex groups and body bones: keep the armature so IK shares the bone names
    for im in bpy.data.images:
        if im.type == 'IMAGE' and max(im.size) > 1024:
            im.scale(1024, 1024)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True,
                              export_animations=False, export_image_format='WEBP', export_apply=False)
    print("FPARMS verts kept", len(body.data.vertices), "removed", len(kill), "->", out_path)

# ---------------------------------------------------------------- build-grenade
# The user's M67 model has 2 clusters: A (assembled, spoon/pin/ring are already separate objects) and B (a disassembled set, open spoon + pulled pin).
# Use cluster A (option (a) of plan 12): group into nodes body (body + yellow band + fuze), spoon, pin (pin + pull ring).
GRENADE_PARTS = {
    "body": ("Circle_Main", "Circle_Yellow", "Circle.001_Main"),
    "spoon": ("Plane_Main",),
    "pin": ("Cylinder_Main", "Cylinder.001_Metal"),
}
GRENADE_STEEL = (0.62, 0.62, 0.65, 1.0)   # the original 'Metal' material is nearly black (loses its metallic shine on export), raise it to a steel color

def build_grenade(src, out_path, height=0.09):
    from mathutils import Vector
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    scene = bpy.context.scene
    meshes = [o for o in scene.objects if o.type == 'MESH']
    def pick(prefix):
        # cluster A: near the origin (y < 2); cluster B is the disassembled set shifted to +y ≥ 2
        c = [o for o in meshes if o.name.startswith(prefix) and o.matrix_world.translation.y < 2]
        if not c: raise RuntimeError("mesh not found: " + prefix)
        return c
    groups = {k: [m for pre in v for m in pick(pre)] for k, v in GRENADE_PARTS.items()}
    keep = {o for g in groups.values() for o in g}
    for o in list(scene.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in keep:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    # center + radius of the body sphere: measured on the round body mesh alone (the off-center fuze/spoon would skew the whole group's bbox)
    sphere = groups["body"][0]
    sv = [sphere.matrix_world @ v.co for v in sphere.data.vertices]
    cx = (min(v.x for v in sv) + max(v.x for v in sv)) / 2
    cy = (min(v.y for v in sv) + max(v.y for v in sv)) / 2
    rad = (max(v.x for v in sv) - min(v.x for v in sv)) / 2
    cz = min(v.z for v in sv) + rad
    # merge each group into one object
    joined = {}
    for name, objs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1: bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        j.name = name; j.data.name = name
        joined[name] = j
    # normalize: `height` meters tall (body bottom → highest point of the spoon/fuze), origin at the body center
    allv = [j.matrix_world @ v.co for j in joined.values() for v in j.data.vertices]
    zmin = min(v.z for v in allv); zmax = max(v.z for v in allv)
    k = height / (zmax - zmin)
    for j in joined.values():
        j.data.transform(Matrix.Scale(k, 4) @ Matrix.Translation(-Vector((cx, cy, cz))) @ j.matrix_world)
        j.matrix_world = Matrix.Identity(4)
    # materials: rebuild a simple Principled (the Blender 5 exporter ignores complex materials), Metal material → steel
    for mat in bpy.data.materials:
        bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if mat.use_nodes else None
        bc = list(bsdf.inputs['Base Color'].default_value) if bsdf else [0.5, 0.5, 0.5, 1]
        if mat.name.startswith("Metal"): bc = list(GRENADE_STEEL)
        mat.use_nodes = True
        t = mat.node_tree; t.nodes.clear()
        o_ = t.nodes.new('ShaderNodeOutputMaterial'); b_ = t.nodes.new('ShaderNodeBsdfPrincipled')
        b_.inputs['Base Color'].default_value = bc; b_.inputs['Metallic'].default_value = 0.0; b_.inputs['Roughness'].default_value = 0.7
        t.links.new(b_.outputs['BSDF'], o_.inputs['Surface'])
    # each part's origin sits at itself (the client detaches the spoon/pin to fly independently), world positions are kept
    for name in ("spoon", "pin"):
        j = joined[name]
        bpy.ops.object.select_all(action='DESELECT'); j.select_set(True)
        bpy.context.view_layer.objects.active = j
        bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    # Empty: hand_r (right palm presses on the spoon, Blender +Y side = spoon side), pin_pull (pull ring center)
    def empty(name, loc):
        e = bpy.data.objects.new(name, None); e.empty_display_size = 0.005
        scene.collection.objects.link(e); e.location = loc
    pin_v = [joined["pin"].matrix_world @ v.co for v in joined["pin"].data.vertices]
    ring_c = Vector((sum(v.x for v in pin_v) / len(pin_v), sum(v.y for v in pin_v) / len(pin_v), sum(v.z for v in pin_v) / len(pin_v)))
    sp_v = [joined["spoon"].matrix_world @ v.co for v in joined["spoon"].data.vertices]
    sp_y = max(v.y for v in sp_v)
    empty("hand_r", Vector((0, sp_y + 0.012, 0)))
    empty("pin_pull", ring_c)
    root = bpy.data.objects.new("GrenadeRoot", None); scene.collection.objects.link(root)
    for o in list(scene.objects):
        if o is not root and o.parent is None:
            o.parent = root
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True, export_animations=False, export_apply=False)
    allz = [v.z for j in joined.values() for v in (j.matrix_world @ w.co for w in j.data.vertices)]
    print("GRENADE", out_path, "k=%.5f" % k, "height=%.4f" % (max(allz) - min(allz)), "tris", sum(tri_count(j) for j in joined.values()),
          "ring_c", [round(v, 4) for v in ring_c], "sp_y", round(sp_y, 4))

# ---------------------------------------------------------------- build-scene
def build_scene(src, out_path, scale=1.0, turn_deg=0.0, center=False, ground=False, jpeg_quality=85, max_tex_px=0):
    """Any static model (level, prop) -> one game-ready glb with its textures embedded (re-compressed as JPEG).
    scale: multiplied onto the model (source units -> metres); turn_deg: turn about the UP axis, counter-clockwise seen from above (Y up in the glb);
    center: put the middle of the bounding box on x = z = 0; ground: lowest point at y = 0. Order: centre/ground, then turn, then scale.
    Every mesh gets its world matrix baked into its vertices (importers hang meshes under empties that carry big offsets and scales)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ext = os.path.splitext(src)[1].lower()
    if ext in (".gltf", ".glb"): bpy.ops.import_scene.gltf(filepath=src)
    elif ext == ".obj": bpy.ops.wm.obj_import(filepath=src)
    elif ext == ".fbx": bpy.ops.import_scene.fbx(filepath=src)
    elif ext in (".usd", ".usda", ".usdc", ".usdz"): bpy.ops.wm.usd_import(filepath=src)
    elif ext == ".blend": bpy.ops.wm.open_mainfile(filepath=src)
    else: raise SystemExit("build-scene: unsupported input " + ext)
    meshes = mesh_objects()
    worlds = {}
    for o in meshes:
        if o.data.users > 1:
            o.data = o.data.copy()   # instanced meshes: each object needs its own vertices to bake its own matrix
        worlds[o] = o.matrix_world.copy()
    mn, mx = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in meshes:
        for v in o.data.vertices:
            w = worlds[o] @ v.co
            for i in range(3):
                mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    # Blender is Z up (the glb exporter writes it as Y up): "up" here is z, the ground plane is x/y
    shift = Vector((-(mn.x + mx.x) / 2 if center else 0.0, -(mn.y + mx.y) / 2 if center else 0.0, -mn.z if ground else 0.0))
    final = Matrix.Scale(scale, 4) @ Matrix.Rotation(radians(turn_deg), 4, 'Z') @ Matrix.Translation(shift)
    for o in meshes:
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
        o.data.transform(final @ worlds[o])
        o.data.update()
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    if max_tex_px:
        for im in bpy.data.images:
            if im.type == 'IMAGE' and max(im.size) > max_tex_px:
                k = max_tex_px / max(im.size)
                im.scale(max(1, int(im.size[0] * k)), max(1, int(im.size[1] * k)))
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True, export_apply=True, export_animations=False,
                              export_image_format='JPEG', export_jpeg_quality=jpeg_quality, export_cameras=False, export_lights=False)
    mn2, mx2 = world_bbox(meshes)
    print("SCENE", out_path, os.path.getsize(out_path), "bytes", len(meshes), "meshes", sum(tri_count(o) for o in meshes), "tris",
          "game bbox x[%.2f %.2f] y[%.2f %.2f] z[%.2f %.2f]" % (mn2.x, mx2.x, mn2.z, mx2.z, -mx2.y, -mn2.y))

# ---------------------------------------------------------------- build-texture
def _pot_down(n):
    p = 1
    while p * 2 <= n: p *= 2
    return p

def build_texture(src, out_path, max_px=1024, quality=88):
    """A map texture for box/ramp maps: power-of-two sides (mipmaps, repeat wrapping), at most max_px, JPEG. Prints the tiling seam:
    SEAM x=<edge difference left/right> y=<top/bottom> vs inner=<the typical difference between neighbouring columns/rows>; a ratio well above 2 shows a visible seam when tiled."""
    import numpy as np
    bpy.ops.wm.read_factory_settings(use_empty=True)
    im = bpy.data.images.load(src)
    w, h = im.size
    nw, nh = min(max_px, _pot_down(w)), min(max_px, _pot_down(h))
    # the seam is measured on the source picture (before resizing) so a resize cannot hide it
    px = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(px)
    a = px.reshape(h, w, 4)[:, :, :3]
    inner_x = float(np.abs(np.diff(a, axis=1)).mean()); inner_y = float(np.abs(np.diff(a, axis=0)).mean())
    seam_x = float(np.abs(a[:, 0] - a[:, -1]).mean()); seam_y = float(np.abs(a[0] - a[-1]).mean())
    if (nw, nh) != (w, h): im.scale(nw, nh)
    sc = bpy.context.scene
    sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = quality; sc.render.image_settings.color_mode = 'RGB'
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    im.save_render(filepath=os.path.abspath(out_path), scene=sc)
    print("TEXTURE", out_path, "from %dx%d to %dx%d" % (w, h, nw, nh), "bytes", os.path.getsize(out_path))
    print("SEAM x=%.4f y=%.4f inner x=%.4f y=%.4f ratio x=%.2f y=%.2f" % (seam_x, seam_y, inner_x, inner_y, seam_x / max(inner_x, 1e-6), seam_y / max(inner_y, 1e-6)))

# ---------------------------------------------------------------- preview-scene
def preview_scene(glb_path, out_path, size=(640, 360), cam_from=(95, 70, 85), look=(0, 0, 3)):
    """Textured, lit render of a game-ready glb (a lobby preview card). Coordinates are game coordinates (x, y up, z); Blender is (x, -z, y)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'; sh.show_shadows = True; sh.shadow_intensity = 0.5
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('preview'); world.color = (0.08, 0.12, 0.2); sc.world = world
    tgt = bpy.data.objects.new('look', None); sc.collection.objects.link(tgt)
    tgt.location = (look[0], -look[2], look[1])
    cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 28
    cam = bpy.data.objects.new('cam', cam_data); sc.collection.objects.link(cam)
    cam.location = (cam_from[0], -cam_from[2], cam_from[1])
    tc = cam.constraints.new('TRACK_TO'); tc.target = tgt; tc.track_axis = 'TRACK_NEGATIVE_Z'; tc.up_axis = 'UP_Y'
    sc.camera = cam
    sc.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print("PREVIEW", out_path)

# ---------------------------------------------------------------- rig-humanoid
# An unrigged humanoid (A-posed, e.g. a Sketchfab model) -> the 65-bone Mixamo skeleton of the donor (same bone names and axes, so the shared
# Mixamo animation set plays on it), skinned, converted to a T-pose (the pose those animations assume) and exported as a skinned glb.
RIG_HEIGHT_M = 1.72     # the Desert Sandstorm characters are ~1.72 m
# Joint positions measured on the source mesh in its own units, A-pose: x = the character's left, -y = front, z up (the right side mirrors x).
# The fingers are not listed: they are the donor's hand scaled onto hand_tip (the middle fingertip) and turned to hang like this hand.
RIG_PRESETS = {
    "tr_guerilla": {
        "joints": {
            "Hips": (0, -0.5, 37.0), "Spine": (0, -0.3, 42.0), "Spine1": (0, 0.0, 48.0), "Spine2": (0, 0.4, 55.0),
            "Neck": (0, 0.8, 63.5), "Head": (0, 0.4, 66.8), "HeadTop_End": (0, -0.6, 78.2),
            "Shoulder": (1.8, 0.8, 62.0), "Arm": (11.8, 2.6, 60.5), "ForeArm": (17.6, 2.5, 51.2), "Hand": (23.1, 2.4, 45.5),
            "UpLeg": (5.0, -0.8, 34.0), "Leg": (4.7, 0.4, 19.5), "Foot": (4.3, 1.7, 5.3), "ToeBase": (4.3, -4.3, 1.8), "Toe_End": (4.3, -8.3, 1.2),
        },
        "hand_tip": (27.4, 2.3, 36.7),
    },
    # "CT sas" (same author, same scale as the guerilla: 77.5 units tall, A-pose, fingerless gloves)
    "ct_sas": {
        "joints": {
            "Hips": (0, -0.5, 38.0), "Spine": (0, -0.3, 43.0), "Spine1": (0, 0.0, 49.0), "Spine2": (0, 0.4, 56.0),
            "Neck": (0, 0.8, 63.5), "Head": (0, 0.4, 66.8), "HeadTop_End": (0, -0.6, 77.5),
            "Shoulder": (2.0, 1.0, 62.0), "Arm": (11.8, 2.5, 60.5), "ForeArm": (18.0, 2.5, 50.5), "Hand": (22.8, 2.4, 44.4),
            "UpLeg": (4.6, -0.6, 34.5), "Leg": (4.5, 0.2, 20.5), "Foot": (4.2, 0.9, 5.4), "ToeBase": (4.2, -5.2, 1.9), "Toe_End": (4.2, -8.0, 1.2),
        },
        "hand_tip": (26.6, 1.9, 35.6),
    },
}
RIG_FINGERS = ("Thumb", "Index", "Middle", "Ring", "Pinky")
# deform capsules: bone -> (tail joint or None for "the next bone in the chain", radius in source units, blend length in source units)
RIG_CHAIN = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "HeadTop_End"]

def _rig_rot2(v, a):
    """Rotate v about the Y axis through the origin by a (radians), in the x/z plane."""
    from math import cos, sin
    from mathutils import Vector
    return Vector((v.x * cos(a) - v.z * sin(a), v.y, v.x * sin(a) + v.z * cos(a)))

def _rig_import_body(src):
    """Import the source as one mesh in world space (parents flattened, transforms applied)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    body = max(meshes, key=lambda o: len(o.data.vertices))
    if len(meshes) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes: o.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()
    _select_active(body)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    body.name = "char1"
    return body

def _rig_load_donor(donor_path):
    """The donor's armature (meters, Z up) without its meshes/materials. Returns (armature object, {bone: (rest matrix, length, parent, children)})."""
    before_im = set(bpy.data.images); before_mat = set(bpy.data.materials); before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=donor_path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    for o in [o for o in new if o.type == 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    for im in [i for i in bpy.data.images if i not in before_im]: bpy.data.images.remove(im)
    for mt in [m for m in bpy.data.materials if m not in before_mat]: bpy.data.materials.remove(mt)
    for ac in list(bpy.data.actions): bpy.data.actions.remove(ac)
    _select_active(arm)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    info = {b.name: (b.matrix_local.copy(), b.length, b.parent.name if b.parent else None, [c.name for c in b.children]) for b in arm.data.bones}
    return arm, info

def _rig_joints(preset, dinfo):
    """Head position of every bone, A-pose (PA) and T-pose (PT), in source units, plus the per-bone rigid A->T transform (pivot A, pivot T, angle).
    Left-like coordinates are used throughout (x outward); the right side mirrors x at the end."""
    from mathutils import Vector
    from math import atan2
    J = {k: Vector(v) for k, v in preset["joints"].items()}
    tip = Vector(preset["hand_tip"])
    PA, PT, XF = {}, {}, {}
    for n in RIG_CHAIN:
        PA["mixamorig:" + n] = PT["mixamorig:" + n] = J[n].copy()
    for side, sx in (("Left", 1.0), ("Right", -1.0)):
        m = lambda v: Vector((v.x * sx, v.y, v.z))      # left-like -> this side (mirror x for the right)
        def pa(n): return PA[f"mixamorig:{side}{n}"]
        for n in ("Shoulder", "UpLeg", "Leg", "Foot", "ToeBase", "Toe_End"):
            PA[f"mixamorig:{side}{n}"] = PT[f"mixamorig:{side}{n}"] = m(J[n])
        S, E, W = J["Arm"], J["ForeArm"], J["Hand"]
        # arm chain: every bone turns about its own head to lie along +x, so the T-pose is the A-pose straightened out of the vertical plane
        ang = lambda d: -atan2(d.z, d.x)        # angle that sends the x/z direction d onto +x
        a1, a2, a3 = ang(E - S), ang(W - E), ang(tip - W)
        E_T = S + Vector(((E - S).length, 0, 0)); W_T = E_T + Vector(((W - E).length, 0, 0))
        for n, a_, t_, a in (("Arm", S, S, a1), ("ForeArm", E, E_T, a2), ("Hand", W, W_T, a3)):
            PA[f"mixamorig:{side}{n}"] = m(a_); PT[f"mixamorig:{side}{n}"] = m(t_)
            XF[f"mixamorig:{side}{n}"] = (m(a_), m(t_), a, sx)
        # fingers: the donor hand (left-like), scaled so its middle finger ends on hand_tip, then turned (A) / not turned (T)
        dW = dinfo[f"mixamorig:{side}Hand"][0].translation.copy(); dW.x *= sx
        dm4 = f"mixamorig:{side}HandMiddle4"
        dtail = (dinfo[dm4][0] @ Vector((0, dinfo[dm4][1], 0))); dtail.x *= sx
        k = (tip - W).length / (dtail - dW).length
        for f in RIG_FINGERS:
            for i in (1, 2, 3, 4):
                nm = f"mixamorig:{side}Hand{f}{i}"
                d = dinfo[nm][0].translation.copy(); d.x *= sx
                rel = (d - dW) * k
                PT[nm] = m(W_T + rel)
                PA[nm] = m(W + _rig_rot2(rel, a3 * -1.0))
                XF[nm] = XF[f"mixamorig:{side}Hand"]
    return PA, PT, XF

def _rig_capsules(PA, preset):
    """bone -> (segment head, segment tail, radius, blend length) in A-pose source units, for the bones that deform the mesh."""
    from mathutils import Vector
    C = {}
    def cap(name, a, b, r, s): C[name] = (a.copy(), b.copy(), r, s)
    P = lambda n: PA["mixamorig:" + n]
    for a, b, r, s in (("Hips", "Spine", 9.0, 3.0), ("Spine", "Spine1", 9.5, 3.5), ("Spine1", "Spine2", 10.5, 3.5), ("Spine2", "Neck", 11.5, 3.5),
                       ("Neck", "Head", 4.0, 2.5), ("Head", "HeadTop_End", 7.5, 2.0)):
        cap("mixamorig:" + a, P(a), P(b), r, s)
    C["mixamorig:Hips"] = (P("Hips") - Vector((0, 0, 6.0)), P("Spine"), 9.0, 3.0)      # the pelvis reaches down to the crotch
    for side in ("Left", "Right"):
        Q = lambda n: PA[f"mixamorig:{side}{n}"]
        for a, b, r, s in (("Shoulder", "Arm", 4.5, 3.0), ("Arm", "ForeArm", 3.8, 2.5), ("ForeArm", "Hand", 3.2, 2.0), ("UpLeg", "Leg", 6.0, 3.0),
                           ("Leg", "Foot", 4.5, 2.5), ("Foot", "ToeBase", 4.5, 1.8), ("ToeBase", "Toe_End", 3.5, 1.2)):
            cap(f"mixamorig:{side}{a}", Q(a), Q(b), r, s)
        cap(f"mixamorig:{side}Hand", Q("Hand"), Q("HandMiddle1"), 3.2, 1.5)
    return C

def _rig_seg_dist(p, a, b, beyond=2.0):
    """Distance from p to the segment a-b; the part of it that lies past either end counts `beyond` times, so a capsule does not claim what is
    above/below its ends (the neck is not the top of the spine)."""
    from math import sqrt
    ab = b - a
    L2 = max(ab.length_squared, 1e-12)
    t = (p - a).dot(ab) / L2
    tc = max(0.0, min(1.0, t))
    q = a + ab * tc
    perp = (p - q).length
    over = abs(t - tc) * sqrt(L2)
    return sqrt(perp * perp + (beyond * over) ** 2)

def _rig_finger_chains(PA, side):
    """finger -> polyline [head1, head2, head3, head4, tip] (A-pose, source units)"""
    out = {}
    for f in RIG_FINGERS:
        h = [PA[f"mixamorig:{side}Hand{f}{i}"] for i in (1, 2, 3, 4)]
        out[f] = h + [h[3] + (h[3] - h[2])]
    return out

def _rig_finger_weights(W, V, rep, PA):
    """Redistribute the share that the weighting gave to a Hand bone over its finger bones. Per finger: how close the vertex is to the finger's
    polyline (lane, so fingers side by side share the vertices between them) and how far along it (the knuckle and the finger joints are smooth
    ramps), so a glove/finger vertex bends with the phalanx it sits on even when no vertex 'belongs' to that bone."""
    from math import exp
    sm = lambda x: 0.0 if x <= 0 else 1.0 if x >= 1 else x * x * (3 - 2 * x)
    for side in ("Left", "Right"):
        hand = f"mixamorig:{side}Hand"
        chains = _rig_finger_chains(PA, side)
        for i in range(len(V)):
            H = W[i].get(hand, 0.0)
            if H < 1e-3: continue
            p = V[i]
            amp = {}; para = {}
            for f, pts in chains.items():
                best = None; s0 = 0.0
                for k in range(4):
                    a, b = pts[k], pts[k + 1]
                    ab = b - a; L = ab.length
                    t = (p - a).dot(ab) / (L * L)
                    tc = min(t, 1.0) if k == 0 else max(t, 0.0) if k == 3 else max(0.0, min(1.0, t))   # the polyline continues behind the knuckle and past the tip
                    d = (p - (a + ab * tc)).length
                    if best is None or d < best[0]: best = (d, s0 + tc * L, k)
                    s0 += L
                d, s, _ = best
                rho = 1.4 if f == "Thumb" else 0.9
                eps = 0.8
                to_hand = 1.0 - sm((s + eps) / (2 * eps))             # 1 before the knuckle, 0 after
                amp[f] = exp(-(d / rho) ** 2) * (1.0 - to_hand)
                para[f] = s
            tot = sum(amp.values())
            if tot > 1.0:
                amp = {f: a / tot for f, a in amp.items()}; tot = 1.0
            if tot < 1e-3: continue
            Ls = {f: [(chains[f][k + 1] - chains[f][k]).length for k in range(3)] for f in chains}
            for f, a in amp.items():
                if a < 1e-3: continue
                s = para[f]; j2 = Ls[f][0]; j3 = Ls[f][0] + Ls[f][1]; e = 0.35
                s2 = sm((s - (j2 - e)) / (2 * e)); s3 = sm((s - (j3 - e)) / (2 * e))
                for bone, share in ((f"mixamorig:{side}Hand{f}1", 1 - s2), (f"mixamorig:{side}Hand{f}2", s2 - s3), (f"mixamorig:{side}Hand{f}3", s3)):
                    if share > 1e-3: W[i][bone] = W[i].get(bone, 0.0) + H * a * share
            W[i][hand] = H * (1.0 - tot)

def _rig_weights(body, C, PA):
    """Per-vertex weights {vertex index: {bone: w}}: every vertex is owned by the capsule it is nearest to (radius-normalised), each bone's
    influence then falls off with the distance *along the surface* from the vertices it owns, so a pouch next to the arm or a finger next to the
    index finger does not leak onto it. Loose pieces (pouches, radio) follow one bone rigidly."""
    import heapq
    from math import exp
    me = body.data
    V = [v.co.copy() for v in me.vertices]
    key = {}; rep = []
    for i, v in enumerate(V):
        rep.append(key.setdefault((round(v.x, 3), round(v.y, 3), round(v.z, 3)), i))
    adj = {r: {} for r in set(rep)}
    for p in me.polygons:
        vs = [rep[i] for i in p.vertices]
        for j in range(len(vs)):
            a, b = vs[j], vs[(j + 1) % len(vs)]
            if a != b:
                d = (V[a] - V[b]).length; adj[a][b] = d; adj[b][a] = d
    comp = {}; comps = []
    for r in adj:
        if r in comp: continue
        st = [r]; comp[r] = len(comps); cur = [r]
        while st:
            x = st.pop()
            for y in adj[x]:
                if y not in comp: comp[y] = len(comps); st.append(y); cur.append(y)
        comps.append(cur)
    names = list(C)
    def allowed(n, p):
        if n.startswith("mixamorig:Left") and p.x < -2.0: return False
        if n.startswith("mixamorig:Right") and p.x > 2.0: return False
        return True
    def nearest(p):
        """the thinnest capsule that contains p, else the capsule whose surface is nearest"""
        best = []
        for n in names:
            if not allowed(n, p): continue
            d = _rig_seg_dist(p, C[n][0], C[n][1])
            best.append(((0, C[n][2], 0.0) if d <= C[n][2] else (1, d - C[n][2], 0.0), n))
        return min(best)[1]
    owner = {r: nearest(V[r]) for r in adj}
    big = max(len(c) for c in comps)
    for c in comps:
        if len(c) < 0.2 * big:          # loose piece: one bone for all of it
            cen = sum((V[r] for r in c), Vector((0, 0, 0))) / len(c)
            o = nearest(cen)
            for r in c: owner[r] = o
    dist = {}
    for n in names:
        seeds = [r for r in adj if owner[r] == n]
        g = {r: float("inf") for r in adj}
        h = []
        for r in seeds: g[r] = 0.0; h.append((0.0, r))
        heapq.heapify(h)
        while h:
            d, x = heapq.heappop(h)
            if d > g[x]: continue
            for y, l in adj[x].items():
                nd = d + l
                if nd < g[y]: g[y] = nd; heapq.heappush(h, (nd, y))
        dist[n] = g
    W = {}
    for r in adj:
        w = {n: exp(-dist[n][r] / C[n][3]) for n in names if dist[n][r] < 8 * C[n][3]}
        s = sum(w.values()) or 1.0
        W[r] = {n: x / s for n, x in w.items()}
    for _ in range(1):          # one pass of smoothing over the surface
        W2 = {}
        for r in adj:
            nb = list(adj[r])
            acc = {n: 0.5 * x for n, x in W[r].items()}
            for y in nb:
                for n, x in W[y].items(): acc[n] = acc.get(n, 0.0) + 0.5 * x / len(nb)
            W2[r] = acc
        W = W2
    Wv = {i: dict(W[rep[i]]) for i in range(len(V))}        # per vertex from here on (the UV-seam copies of one point stay identical: same position -> same result)
    _rig_finger_weights(Wv, V, rep, PA)
    out = {}
    for i in range(len(V)):
        w = sorted(Wv[i].items(), key=lambda kv: -kv[1])[:4]
        s = sum(x for _, x in w) or 1.0
        out[i] = {n: x / s for n, x in w if x / s > 0.01}
    return out, owner, rep

def rig_humanoid(src, out_path, donor_path, preset_name="tr_guerilla", height_m=RIG_HEIGHT_M, anims_dir=None, fparms_path=None, keep_upper=0.6):
    from mathutils import Vector, Matrix
    preset = RIG_PRESETS[preset_name]
    body = _rig_import_body(src)
    me = body.data
    arm, dinfo = _rig_load_donor(donor_path)
    PA, PT, XF = _rig_joints(preset, dinfo)
    C = _rig_capsules(PA, preset)
    W, owner, rep = _rig_weights(body, C, PA)
    # A-pose -> T-pose: linear blend of the arm-chain bones' rigid turns (everything else stays)
    A = [v.co.copy() for v in me.vertices]
    T = []
    for i, p in enumerate(A):
        q = p.copy()
        for n, w in W[i].items():
            if n in XF:
                pa, pt, a, sx = XF[n]
                local = Vector(((p - pa).x * sx, (p - pa).y, (p - pa).z))       # left-like
                moved = _rig_rot2(local, a)
                tgt = Vector((pt.x + moved.x * sx, pt.y + moved.y, pt.z + moved.z))
                q += (tgt - p) * w
        T.append(q)
    # source units -> metres, feet on the ground
    zmin = min(p.z for p in T); H = max(p.z for p in T) - zmin
    s = height_m / H
    org = Vector((0, 0, zmin))
    to_m = lambda p: (p - org) * s
    for v, p in zip(me.vertices, T): v.co = to_m(p)
    me.update()
    # the donor armature -> this body's joints, keeping the donor's bone axes
    bpy.context.view_layer.objects.active = arm
    _select_active(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = arm.data.edit_bones
    for eb in ebs: eb.use_connect = False
    for eb in ebs:
        rest, length, par, kids = dinfo[eb.name]
        head = to_m(PT[eb.name])
        main = next((k for k in kids if k in PT), None)
        if main is not None and (to_m(PT[main]) - head).length > 1e-4:
            ln = (to_m(PT[main]) - head).length
        else:
            ln = 0.04 if eb.name.endswith("HeadTop_End") else max(length * height_m / 2.0, 0.01)     # an end marker (fingertip, toe end, head top): the donor's length scaled
        eb.matrix = Matrix.Translation(head) @ rest.to_3x3().to_4x4()
        eb.length = ln
    bpy.ops.object.mode_set(mode='OBJECT')
    # skin
    for n in {n for w in W.values() for n in w}:
        body.vertex_groups.new(name=n)
    for i, w in W.items():
        for n, x in w.items():
            body.vertex_groups[n].add([i], x, 'REPLACE')
    body.parent = arm
    body.matrix_parent_inverse = Matrix.Identity(4)
    mod = body.modifiers.new("Armature", 'ARMATURE'); mod.object = arm
    arm.name = "Armature"
    for im in bpy.data.images:
        if im.type == 'IMAGE':
            if max(im.size) > 2048: im.scale(2048, 2048)
            if im.packed_file is None: im.pack()
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    report = []
    if anims_dir:       # the clips key the Hips position for a hips height of 0.949 m (the donor's)
        hips_scale = arm.data.bones["mixamorig:Hips"].head_local.z / dinfo["mixamorig:Hips"][0].translation.z
        print("RIG hips scale", round(hips_scale, 3))
        report = _merge_animations(arm, anims_dir, hips_scale, skip_prefix="z_")      # z_* are the zombie clips, kept in the zombie files
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True, export_animations=bool(anims_dir), export_nla_strips=True,
                              export_image_format='WEBP', export_apply=False)
    for r in report:
        print("ANIM", r)
    if fparms_path:
        _export_fp_arms(arm, body, fparms_path, keep_upper)
    used = sorted({n for w in W.values() for n in w})
    print("RIG bones", len(arm.data.bones), "weighted", len(used), "scale", round(s, 5), "height", round(H * s, 3))
    print("RIG built", out_path)

# ---- preview of a rigged glb: the skeleton drawn over a see-through body, in the rest pose and in a few test poses
def _rig_bone_mesh(name, a, b, r, color):
    import bmesh
    from mathutils import Vector
    d = b - a
    L = max(d.length, 1e-5)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=r, radius2=r * 0.25, depth=L)
    for v in bm.verts: v.co.z += L / 2
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d if d.length > 1e-6 else Vector((0, 0, 1)))
    o.location = a
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs[0].default_value = color; em.inputs[1].default_value = 2.0
    out = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], out.inputs[0])
    me.materials.append(mat)
    return o

def _rig_pose_rot(arm, name, axis, deg):
    """Turn a pose bone about a world axis through its head (the armature sits at the world origin)."""
    from math import radians
    from mathutils import Matrix
    pb = arm.pose.bones["mixamorig:" + name]
    bpy.context.view_layer.update()
    R = Matrix.Rotation(radians(deg), 4, axis)
    h = pb.head.copy()
    pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()

RIG_POSES = {
    "rest": [],
    # arms hanging like the source A-pose, elbows forward, a loose grip
    "hang": [("LeftArm", 'Y', 62), ("RightArm", 'Y', -62), ("LeftForeArm", 'X', -50), ("RightForeArm", 'X', -50)],
    "grip": [("LeftArm", 'Y', 62), ("RightArm", 'Y', -62)] +
            [(f"{s}Hand{f}{i}", 'Y', sg * a) for s, sg in (("Left", 1), ("Right", -1)) for f in ("Index", "Middle", "Ring", "Pinky") for i, a in ((1, 55), (2, 70), (3, 45))] +
            [(f"{s}Hand{f}1", 'Y', sg * 15) for s, sg in (("Left", 1), ("Right", -1)) for f in ("Thumb",)],
    "legs": [("LeftUpLeg", 'X', -60), ("LeftLeg", 'X', 70), ("RightUpLeg", 'X', 20), ("Spine", 'X', -15), ("Spine1", 'X', -15), ("Head", 'Z', 35), ("LeftArm", 'Y', 62), ("RightArm", 'Y', -62)],
}

def preview_rig(glb, out_prefix, size=(900, 1000)):
    from mathutils import Vector
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.2, 0.22, 0.26, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    sc.world = w
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (0.8, 0.2, 0.5); sc.collection.objects.link(sun)
    arm = next(o for o in sc.objects if o.type == 'ARMATURE')
    body = next(o for o in sc.objects if o.type == 'MESH')
    for mat in body.data.materials:
        mat.surface_render_method = 'BLENDED'
        bs = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bs.inputs['Alpha'].default_value = 0.4
    pal = {"Left": (0.2, 1.0, 0.3, 1), "Right": (1.0, 0.55, 0.1, 1), "": (0.3, 0.6, 1.0, 1)}
    def draw():
        for o in [o for o in bpy.data.objects if o.name.startswith("vis_")]: bpy.data.objects.remove(o, do_unlink=True)
        bpy.context.view_layer.update()
        for pb in arm.pose.bones:
            n = pb.name.replace("mixamorig:", "")
            side = "Left" if n.startswith("Left") else "Right" if n.startswith("Right") else ""
            finger = "Hand" in n and n not in ("LeftHand", "RightHand")
            col = pal[side] if not finger else tuple(min(1.0, c * 0.6 + 0.4) for c in pal[side][:3]) + (1,)
            r = 0.0035 if finger else 0.012
            _rig_bone_mesh("vis_" + n, pb.head.copy(), pb.tail.copy(), r, col)
    def shot(name, centre, direction, ortho):
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = ortho; cam.data.clip_end = 100
        cam.location = Vector(centre) - Vector(direction).normalized() * 5
        cam.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
        sc.render.resolution_x, sc.render.resolution_y = size
        sc.render.filepath = f"{out_prefix}_{name}.png"; bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam)
    def hand_c(side="Left"):
        bpy.context.view_layer.update()
        return arm.pose.bones[f"mixamorig:{side}Hand"].head.copy()
    def solid(on):
        for o in bpy.data.objects:
            if o.name.startswith("vis_"): o.hide_render = on
        for mat in body.data.materials:
            next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Alpha'].default_value = 1.0 if on else 0.4
    for pname, ops in RIG_POSES.items():
        for a in arm.pose.bones: a.rotation_mode = 'QUATERNION'; a.rotation_quaternion = (1, 0, 0, 0)
        bpy.context.view_layer.update()
        for n, ax, deg in ops: _rig_pose_rot(arm, n, ax, deg)
        draw()
        if pname == "rest":
            shot("rest_front", (0, 0, 0.88), (0, 1, 0), 2.0)
            shot("rest_hand_front", hand_c() + Vector((0.06, 0, -0.05)), (0, 1, 0), 0.45)
            shot("rest_hand_top", hand_c() + Vector((0.06, 0, -0.05)), (0, 0, -1), 0.45)
            solid(True)
            shot("solid_rest_front", (0, 0, 0.88), (0, 1, 0), 2.0)
            shot("solid_rest_hand_top", hand_c() + Vector((0.06, 0, -0.05)), (0, 0, -1), 0.45)
            solid(False)
        elif pname == "hang":
            shot("hang_front", (0, 0, 0.88), (0, 1, 0), 2.0)
            shot("hang_side", (0, 0, 0.88), (-1, 0, 0), 2.0)
            solid(True)
            shot("solid_hang_front", (0, 0, 0.88), (0, 1, 0), 2.0)
            solid(False)
        elif pname == "grip":
            shot("grip_hand_front", hand_c() + Vector((0.0, 0, -0.1)), (0, 1, 0), 0.4)
            shot("grip_hand_out", hand_c() + Vector((0.0, 0, -0.1)), (-1, 0, 0), 0.4)
            solid(True)
            shot("solid_grip_hand_front", hand_c() + Vector((0.0, 0, -0.1)), (0, 1, 0), 0.4)
            shot("solid_grip_hand_out", hand_c() + Vector((0.0, 0, -0.1)), (-1, 0, 0), 0.4)
            shot("solid_grip_right_hand_front", hand_c("Right") + Vector((0.0, 0, -0.1)), (0, 1, 0), 0.4)
            solid(False)
        else:
            shot(pname + "_front", (0, 0, 0.88), (0, 1, 0), 2.0)
            shot(pname + "_side", (0, 0, 0.88), (-1, 0, 0), 2.0)
    print("PREVIEW", out_prefix)

if mode == "inspect":
    inspect(argv[1] if len(argv) > 1 else None)
elif mode == "build-grenade":
    build_grenade(argv[1], argv[2], float(argv[3]) if len(argv) > 3 else 0.09)
elif mode == "build-fp-arms":
    ku = 0.6
    pos = [a for a in argv[1:] if not a.startswith("--")]
    for a in argv[1:]:
        if a.startswith("--keep-upper="): ku = float(a.split("=")[1])
    build_fp_arms(pos[0], pos[1], pos[2] if len(pos) > 2 else None, ku)
elif mode == "build-character":
    build_character(argv[1], argv[2], argv[3], argv[4] if len(argv) > 4 else None)
elif mode == "prep-mixamo":
    prep_mixamo(argv[1], argv[2])
elif mode == "check-fbx":
    check_fbx(argv[1])
elif mode == "inspect-character":
    inspect_character(argv[1], argv[2] if len(argv) > 2 else None)
elif mode == "build-scene":
    opts = {a.split("=")[0]: (a.split("=")[1] if "=" in a else True) for a in argv[1:] if a.startswith("--")}
    pos = [a for a in argv[1:] if not a.startswith("--")]
    build_scene(pos[0], pos[1], float(opts.get("--scale", 1)), float(opts.get("--turn-deg", 0)), "--center" in opts, "--ground" in opts,
                int(opts.get("--jpeg-quality", 85)), int(opts.get("--max-tex-px", 0)))
elif mode == "build-texture":
    opts = {a.split("=")[0]: a.split("=")[1] for a in argv[1:] if a.startswith("--") and "=" in a}
    pos = [a for a in argv[1:] if not a.startswith("--")]
    build_texture(pos[0], pos[1], int(opts.get("--max-px", 1024)), int(opts.get("--quality", 88)))
elif mode == "preview-scene":
    opts = {a.split("=")[0]: a.split("=")[1] for a in argv[1:] if a.startswith("--") and "=" in a}
    pos = [a for a in argv[1:] if not a.startswith("--")]
    vec = lambda k, d: tuple(float(v) for v in opts[k].split(",")) if k in opts else d
    preview_scene(pos[0], pos[1], tuple(int(v) for v in opts.get("--size", "640x360").split("x")), vec("--from", (95, 70, 85)), vec("--look", (0, 0, 3)))
elif mode == "rig-humanoid":
    pos = [a for a in argv[1:] if not a.startswith("--")]
    pr = next((a.split("=", 1)[1] for a in argv if a.startswith("--preset=")), "tr_guerilla")
    hm = next((float(a.split("=", 1)[1]) for a in argv if a.startswith("--height-m=")), RIG_HEIGHT_M)
    an = next((a.split("=", 1)[1] for a in argv if a.startswith("--anims=")), None)
    fp = next((a.split("=", 1)[1] for a in argv if a.startswith("--fparms=")), None)
    ku = next((float(a.split("=", 1)[1]) for a in argv if a.startswith("--keep-upper=")), 0.6)
    rig_humanoid(pos[0], pos[1], pos[2], pr, hm, an, fp, ku)
elif mode == "preview-rig":
    preview_rig(argv[1], argv[2])
elif mode == "normalize":
    normalize(argv[1], argv[2])
else:
    print("unknown mode", mode)