# Convert gun `.blend` → `.glb` with headless Blender

This document has 2 parts: **part A for the user** (install Blender, one-time), **part B for Claude Code** (automated script).

---

## Part A – The user does (one-time)

### A1. Install Blender (version 4.x or later)

Windows (PowerShell):
```powershell
winget install BlenderFoundation.Blender
```

macOS:
```bash
brew install --cask blender
```

Or download the installer from the official blender.org site.

### A2. Make the `blender` command callable from the terminal

Check:
```bash
blender --version
```

If it says "command not found":
- **Windows:** add the Blender install folder to PATH. Usually `C:\Program Files\Blender Foundation\Blender 4.x\` (replace `4.x` with the version you installed). Open *Start → "Edit the system environment variables" → Environment Variables → Path → New*, paste the path, and reopen the terminal.
- **macOS:** run this command once:
  ```bash
  sudo ln -s /Applications/Blender.app/Contents/MacOS/Blender /usr/local/bin/blender
  ```

Run `blender --version` again; you are done when it prints a version number.

### A3. Put the files in the repo

```
assets/source/guns/rifle.blend
assets/source/guns/pistol.blend
```

Loose textures (if any, accompanying `.png`/`.jpg` files) go in the **same folder** as the `.blend` file.

### A4. Hand the work to Claude Code

Sample prompt:
> Read CLAUDE.md and plan/tools-blend-to-glb.md. Do part B for the file assets/source/guns/rifle.blend, gun type rifle. When done, report with the inspect results from before and after.

### A5. Check the result yourself

Drag and drop the `.glb` file onto **gltf-viewer.donmccurdy.com** for a quick look: are all the textures there, are all the parts there. Then look in the project's viewer page (step B5) to check scale and barrel direction.

---

## Part B – Claude Code does

Target output: `client/public/models/<name>.glb` that satisfies:

| Requirement | Value |
|---|---|
| Unit | meters. Rifle 0.8–1.0m long; pistol 0.18–0.25m |
| Barrel direction | **−Z** in Three.js (equivalent to **+Y** in Blender) |
| Up axis | +Y in Three.js (+Z in Blender) |
| Origin | at the grip (where the right hand holds) |
| Required node | `muzzle` (an Empty at the muzzle tip) |
| Nodes that should exist | `mag` (magazine, separate mesh), `eject` (shell ejection port) |
| Triangle count | ≤ 20,000 |
| Textures | embedded in the glb, ≤ 1024px |

### B1. Shared script

Create `tools/blender/gun_tool.py`:

```python
"""
Usage:
  blender -b <file.blend> --python tools/blender/gun_tool.py -- inspect
  blender -b <file.blend> --python tools/blender/gun_tool.py -- normalize <params.json> <out.glb>
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

def inspect():
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

    # 3) Add Empties muzzle / eject (coordinates in Blender space, BEFORE the transform)
    for name in ("muzzle", "eject"):
        if name in p and bpy.data.objects.get(name) is None:
            e = bpy.data.objects.new(name, None)
            e.empty_display_size = 0.02
            scene.collection.objects.link(e)
            e.parent = root
            e.matrix_parent_inverse = Matrix.Identity(4)
            e.location = Vector(p[name])

    # 4) Rename objects via a map (for example the magazine)
    for old, new in p.get("rename", {}).items():
        o = bpy.data.objects.get(old)
        if o: o.name = new

    # 5) Reduce polygons if needed
    ratio = p.get("decimate_ratio")
    if ratio and ratio < 1.0:
        for o in mesh_objects():
            m = o.modifiers.new("Decimate", 'DECIMATE')
            m.ratio = ratio

    # 6) Look for textures with missing paths in the .blend file's folder
    try:
        bpy.ops.file.find_missing_files(directory=os.path.dirname(bpy.data.filepath))
    except Exception as ex:
        print("find_missing_files:", ex)

    # 7) Export GLB
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_animations=False,
    )
    print("EXPORTED", out_path)

if mode == "inspect":
    inspect()
elif mode == "normalize":
    normalize(argv[1], argv[2])
else:
    print("unknown mode", mode)
```

### B2. Inspect the source file

```bash
blender -b assets/source/guns/rifle.blend --python tools/blender/gun_tool.py -- inspect
```

Read the JSON between `INSPECT_JSON_BEGIN/END` and determine:
1. The **longest axis** of `size` = the barrel axis.
2. **Which end of that axis the muzzle is on**: look for an object whose name contains `barrel`, `muzzle`, `silencer`; if there is none, the muzzle is usually the side **far** from the object whose name contains `stock`/`butt` (the gun stock). Not sure → **ask the user**, do not guess.
3. **Scale**: the barrel-axis length versus the requirement (rifle 0.8–1.0m) → compute `scale`.
4. **Grip**: an object whose name contains `grip`/`handle`; take its center. If there is none, estimate: for a rifle ~35% of the length measured from the stock, at the lower edge.
5. **Magazine**: an object whose name contains `mag`/`clip`/`magazine` → put it into `rename` as `mag`. If the magazine is fused to the gun body (no separate object) → note it in the report, **do not** cut the mesh yourself.
6. **Textures**: an image with `exists: false` → tell the user the name of the missing file.
7. `total_tris` > 20,000 → set `decimate_ratio = 20000 / total_tris` (rounded down to 0.05).

### B3. Write the params file

`assets/source/guns/rifle.params.json`, for example:

```json
{
  "scale": 0.01,
  "rotate_deg": [0, 0, 90],
  "grip": [0.0, -12.5, -3.0],
  "muzzle": [0.0, 48.0, 2.1],
  "eject": [1.2, 8.0, 3.5],
  "rename": { "Magazine_low": "mag" },
  "decimate_ratio": null
}
```

- `grip`, `muzzle`, `eject` are in the file's **original coordinates** (numbers read from inspect); the script transforms them itself.
- Choose `rotate_deg` so that **after rotating**: the barrel points **+Y** and the top of the gun is **+Z** (Blender space).

### B4. Export and inspect again

```bash
blender -b assets/source/guns/rifle.blend --python tools/blender/gun_tool.py -- normalize assets/source/guns/rifle.params.json client/public/models/rifle.glb
```

Do not overwrite the original `.blend` file (`-b` mode does not save by itself; do not add a save command).

Verify by importing the glb into an empty Blender:
```bash
blender -b --python-expr "import bpy; bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath='client/public/models/rifle.glb')" --python tools/blender/gun_tool.py -- inspect
```
After import, Blender's axes are back to Z-up, so you should see: the barrel along **+Y**, size correct in meters, an object `muzzle`, `total_tris` ≤ 20,000, and every image `packed` or embedded.

```
cd /Users/I762313/projects/personal/fps-web && \
blender -b assets/source/guns/m16.blend --python tools/blender/gun_tool.py -- normalize assets/source/guns/m16.params.json client/public/models/m16.glb 2>&1 | grep -E "(rebuilt|EXPORTED|Error)" && \
blender -b assets/source/guns/ak47.blend --python tools/blender/gun_tool.py -- normalize assets/source/guns/ak47.params.json client/public/models/ak47.glb 2>&1 | grep -E "(rebuilt|EXPORTED|Error)"
```

### B5. Viewer page in the project

Create `client/viewer.html` (dev route `/viewer.html?model=rifle`):
- Load the glb with `GLTFLoader`, placed at the origin.
- `GridHelper` with 0.1m cells, `AxesHelper` 0.5m.
- A 1m-long red box along −Z next to the gun as a ruler.
- A small yellow sphere at the `muzzle` node position (`getObjectByName('muzzle').getWorldPosition`).
- OrbitControls for rotating the view.

Acceptance:
- [x] The barrel points along the **−Z** axis (same direction as the red ruler).
- [x] The length is right for the gun type compared to the 1m ruler.
- [x] The yellow sphere sits exactly at the muzzle tip.
- [x] The origin (the AxesHelper intersection) is at the grip.
- [x] Textures show the right colors, not white/not pink.

### B6. Compression (after B5 passes)

```bash
npx @gltf-transform/cli optimize client/public/models/ak47.glb client/public/models/ak47.glb --texture-compress webp --texture-size 1024

npx @gltf-transform/cli optimize client/public/models/m16.glb client/public/models/m16.glb --texture-compress webp --texture-size 1024
```

If the game reports a decoder error after compression: add `MeshoptDecoder` (from `three/examples/jsm/libs/meshopt_decoder.module.js`) to `GLTFLoader` with `loader.setMeshoptDecoder(...)`. Open the viewer again to re-check.

---

## Pitfalls

- **Complex materials:** glTF only understands *Principled BSDF* nodes + textures wired in directly. Materials that use many mixing nodes or procedural textures will be lost or come out a flat color. If the viewer shows wrong colors while inspect reports all images present → tell the user, the textures need to be "baked" in Blender (done by hand in the UI; Claude Code does not do it itself).
- **API parameter errors:** the parameter names of `export_scene.gltf` can differ between Blender versions. If it reports `unrecognized keyword`, drop that parameter and rerun, and note it in the report; do not write a different exporter yourself.
- **Source file units:** many models are built in centimeters so the size comes out in the tens/hundreds. Always compute `scale` from the actual `size`, do not assume.
- **Hidden objects:** the file may contain hidden objects (drafts, low LODs). Look at the list in inspect; objects clearly auxiliary (name contains `LOD1`, `old`, `backup`) → ask the user whether to delete them.
- **Do not modify the original `.blend` file.** All changes exist only within the headless run.
