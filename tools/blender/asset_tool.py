"""
Usage:
  blender -b <file.blend> --python tools/blender/asset_tool.py -- inspect [<file.glb>]
  blender -b <file.blend> --python tools/blender/asset_tool.py -- normalize <params.json> <out.glb>
  blender -b --python tools/blender/asset_tool.py -- inspect-character <model.glb> [<preview_dir>]
  blender -b --python tools/blender/asset_tool.py -- prep-mixamo <in.glb> <out.fbx>
  blender -b --python tools/blender/asset_tool.py -- build-character <team_rigged.fbx> <anims_dir> <out.glb> [donor_rigged.fbx]
  blender -b --python tools/blender/asset_tool.py -- build-fp-arms <team_rigged.fbx> <out.glb> [donor_rigged.fbx] [--keep-upper=0.6]
  (donor: use this file's 65-bone skeleton, move its joints onto the team_rigged body, then skin automatically)
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
from math import radians

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
    missing = [n for n in drest if n not in cb]
    print("FIT shared", len(drest) - len(missing), "missing", len(missing))
    hand = {}
    for side in ("Left", "Right"):
        h = f"mixamorig:{side}Hand"
        ik = f"mixamorig:{side}HandIndex1"
        if ik in cb:
            k = (cb[ik].head_local - cb[h].head_local).length / (drest[ik].translation - drest[h].translation).length
        else:   # model is missing fingers (e.g. a zombie with a severed arm): infer the scale from the forearm
            fa = f"mixamorig:{side}ForeArm"
            k = cb[fa].length / dlen[fa]
        M = cb[h].matrix_local.to_3x3() @ drest[h].to_3x3().inverted()
        hand[side] = (k, M, cb[h].head_local.copy(), drest[h].translation.copy())
        print("FIT", side, "finger scale k=%.3f" % k)
    cmat = {b.name: (b.matrix_local.copy(), b.length) for b in cb}
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = arm_d.data.edit_bones
    for eb in ebs:
        eb.use_connect = False
    for eb in ebs:
        if eb.name in cmat:
            eb.matrix, eb.length = cmat[eb.name][0], cmat[eb.name][1]
        else:
            k, M, hc, hd = hand["Left" if "Left" in eb.name else "Right"]
            md = drest[eb.name]
            pos = hc + k * (M @ (md.translation - hd))
            eb.matrix = Matrix.Translation(pos) @ (M @ md.to_3x3()).to_4x4()
            eb.length = k * dlen[eb.name]
    bpy.ops.object.mode_set(mode='OBJECT')
    for ac in list(bpy.data.actions):
        bpy.data.actions.remove(ac)
    # skin: keep the Mixamo weights of the 41 old bones, attach them to the new armature
    for m in list(body.modifiers):
        if m.type == 'ARMATURE':
            body.modifiers.remove(m)
    # Vertex groups tied to bones the donor lacks (LeftEye/RightEye...): move their weights to the nearest ancestor bone the donor has
    # (Head), otherwise the eyes lose their weights and float above the head during animation.
    for vg in list(body.vertex_groups):
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
    _weight_missing_fingers(body, arm_d, missing)
    return arm_d, body

def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length

def _weight_missing_fingers(body, arm, missing, eps=1e-4):
    """Redistribute the Hand weights in the area far from the palm to the new finger bones (Middle/Ring/Pinky),
    by distance to the bone; the index/thumb already have their own weights so they count as competitors."""
    bones = arm.data.bones
    for side in ("Left", "Right"):
        hand = bones[f"mixamorig:{side}Hand"]
        new = [n for n in missing if side in n and "Hand" in n and any(f in n for f in ("Middle", "Ring", "Pinky"))]
        old = [b.name for b in bones if side in b.name and ("HandIndex" in b.name or "HandThumb" in b.name)]
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
            do = min(_seg_dist(p, *sg) for sg in segs_old)
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

def build_character(rigged_path, anims_dir, out_path, donor_path=None):
    import glob
    from mathutils import Vector
    arm, body = prepare_rigged(rigged_path, donor_path)
    scene = bpy.context.scene
    # 2) Load each animation: take the action, rename it after the file, delete the temp armature
    ad = arm.animation_data_create()
    hips_rest = arm.data.bones['mixamorig:Hips'].matrix_local.to_3x3()
    report = []
    for f in sorted(glob.glob(os.path.join(anims_dir, "*.fbx"))):
        name = os.path.splitext(os.path.basename(f))[0]
        before_a = set(bpy.data.actions); before_o = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=f)
        new = [a for a in bpy.data.actions if a not in before_a]
        for o in [o for o in bpy.data.objects if o not in before_o]:
            bpy.data.objects.remove(o, do_unlink=True)
        if not new:
            print("WARN no action in", f); continue
        act = new[0]; act.name = name; act.use_fake_user = True
        # units: position keyframes of the anim file are in cm, the armature is now in meters
        for fc in _action_fcurves(act):
            if fc.data_path.endswith(".location"):
                for kp in fc.keyframe_points:
                    kp.co.y *= 0.01; kp.handle_left.y *= 0.01; kp.handle_right.y *= 0.01
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
    import bmesh
    from mathutils import Vector
    arm, body = prepare_rigged(rigged_path, donor_path)
    for ac in list(bpy.data.actions):
        bpy.data.actions.remove(ac)
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
elif mode == "normalize":
    normalize(argv[1], argv[2])
else:
    print("unknown mode", mode)