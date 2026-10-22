"""
Render a flat white silhouette weapon icon (transparent background, barrel pointing left) from a NORMALIZED .glb (barrel +Y, up +Z after import).

Usage:
  blender -b --python tools/blender/render_icon.py -- <model.glb> <client/public/icons/weapons/ak47.png>

Orthographic camera placed on the −X side looking toward +X, up axis +Z → +Y appears on the left of the screen → barrel points left.
Output is a 512×256 PNG. The HUD prefers <key>.png and falls back to <key>.svg in the same folder.
"""
import bpy, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    raise SystemExit("usage: blender -b --python render_icon.py -- <model.glb> <out.png>")
src, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit("no mesh in " + src)

mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn[i], w[i]) for i in range(3)))
        mx = Vector((max(mx[i], w[i]) for i in range(3)))
# Small object (9 cm grenade): scale up to ~1 m so the default camera/clip and workbench work normally
span = max((mx - mn)[i] for i in range(3))
if span < 0.5:
    k = 1.0 / span
    root = bpy.data.objects.new("scale_root", None)
    bpy.context.scene.collection.objects.link(root)
    for o in list(bpy.context.scene.objects):
        if o is not root and o.parent is None:
            o.parent = root
    root.scale = (k, k, k)
    bpy.context.view_layer.update()
    mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector((min(mn[i], w[i]) for i in range(3)))
            mx = Vector((max(mx[i], w[i]) for i in range(3)))
center = (mn + mx) / 2
size = mx - mn

cam_data = bpy.data.cameras.new("icon_cam")
cam_data.type = 'ORTHO'
# Longest bbox edge (along the on-screen axes: Y horizontal, Z vertical) × 1.1; the frame is 2:1 so the horizontal extent decides
cam_data.ortho_scale = max(size.y, size.z * 2) * 1.1
cam = bpy.data.objects.new("icon_cam", cam_data)
bpy.context.scene.collection.objects.link(cam)
cam.location = Vector((center.x - max(size.x, 1.0) - 5, center.y, center.z))
cam.rotation_euler = (1.5707963, 0, -1.5707963)   # looks toward +X (camera at −X), up axis +Z, +Y appears on the left (rotZ +90° would look away from the model)
bpy.context.scene.camera = cam

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x, sc.render.resolution_y = 512, 256
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.filepath = os.path.abspath(out)
sh = sc.display.shading
sh.light = 'FLAT'
sh.color_type = 'SINGLE'
sh.single_color = (1, 1, 1)
sh.show_cavity = False
sh.show_shadows = False
sh.show_object_outline = False
sh.show_specular_highlight = False
sc.view_settings.view_transform = 'Standard'

os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
bpy.ops.render.render(write_still=True)
print("icon ->", out)
