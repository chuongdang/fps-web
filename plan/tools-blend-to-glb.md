# Chuyển súng `.blend` → `.glb` bằng Blender headless

Tài liệu này gồm 2 phần: **phần A cho người dùng** (cài Blender, làm một lần), **phần B cho Claude Code** (script tự động).

---

## Phần A – Người dùng làm (một lần)

### A1. Cài Blender (bản 4.x trở lên)

Windows (PowerShell):
```powershell
winget install BlenderFoundation.Blender
```

macOS:
```bash
brew install --cask blender
```

Hoặc tải bản cài từ trang chính thức blender.org.

### A2. Cho terminal gọi được lệnh `blender`

Kiểm tra:
```bash
blender --version
```

Nếu báo "không tìm thấy lệnh":
- **Windows:** thêm thư mục cài Blender vào PATH. Thường là `C:\Program Files\Blender Foundation\Blender 4.x\` (thay `4.x` bằng bản bạn cài). Mở *Start → "Edit the system environment variables" → Environment Variables → Path → New*, dán đường dẫn, mở lại terminal.
- **macOS:** chạy lệnh sau một lần:
  ```bash
  sudo ln -s /Applications/Blender.app/Contents/MacOS/Blender /usr/local/bin/blender
  ```

Chạy lại `blender --version`, thấy in ra số phiên bản là xong.

### A3. Đặt file vào repo

```
assets/source/guns/rifle.blend
assets/source/guns/pistol.blend
```

Texture rời (nếu có, file `.png`/`.jpg` đi kèm) để **cùng thư mục** với file `.blend`.

### A4. Giao việc cho Claude Code

Prompt mẫu:
> Đọc CLAUDE.md và plan/tools-blend-to-glb.md. Làm phần B cho file assets/source/guns/rifle.blend, súng loại rifle. Xong thì báo cáo kèm kết quả inspect trước và sau.

### A5. Tự kiểm tra kết quả

Kéo thả file `.glb` vào trang **gltf-viewer.donmccurdy.com** để xem nhanh: có đủ texture không, có đủ bộ phận không. Sau đó xem trong trang viewer của dự án (bước B5) để kiểm tra tỉ lệ và hướng nòng.

---

## Phần B – Claude Code làm

Mục tiêu đầu ra: `client/public/models/<tên>.glb` thoả mãn:

| Yêu cầu | Giá trị |
|---|---|
| Đơn vị | mét. Rifle dài 0,8–1,0m; pistol 0,18–0,25m |
| Hướng nòng | **−Z** trong Three.js (tương đương **+Y** trong Blender) |
| Trục lên | +Y trong Three.js (+Z trong Blender) |
| Gốc toạ độ | tại tay cầm (chỗ tay phải nắm) |
| Node bắt buộc | `muzzle` (Empty ở đầu nòng) |
| Node nên có | `mag` (băng đạn, mesh riêng), `eject` (cửa văng vỏ đạn) |
| Số tam giác | ≤ 20.000 |
| Texture | nhúng trong glb, ≤ 1024px |

### B1. Script dùng chung

Tạo `tools/blender/gun_tool.py`:

```python
"""
Dùng:
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

    # 1) Gom mọi object gốc (không có parent) vào một Empty "GunRoot"
    root = bpy.data.objects.new("GunRoot", None)
    scene.collection.objects.link(root)
    for o in list(scene.objects):
        if o is not root and o.parent is None:
            mw = o.matrix_world.copy()
            o.parent = root
            o.matrix_world = mw

    # 2) Biến đổi: dời điểm tay cầm về gốc, xoay, scale
    grip = Vector(p.get("grip", [0, 0, 0]))           # toạ độ tay cầm, hệ Blender, TRƯỚC biến đổi
    rot = p.get("rotate_deg", [0, 0, 0])               # xoay XYZ (độ) để nòng chĩa +Y, trên là +Z
    s = p.get("scale", 1.0)
    M = Matrix.Scale(s, 4) @ Euler([radians(a) for a in rot], 'XYZ').to_matrix().to_4x4() @ Matrix.Translation(-grip)
    root.matrix_world = M

    # 3) Thêm Empty muzzle / eject (toạ độ hệ Blender, TRƯỚC biến đổi)
    for name in ("muzzle", "eject"):
        if name in p and bpy.data.objects.get(name) is None:
            e = bpy.data.objects.new(name, None)
            e.empty_display_size = 0.02
            scene.collection.objects.link(e)
            e.parent = root
            e.matrix_parent_inverse = Matrix.Identity(4)
            e.location = Vector(p[name])

    # 4) Đổi tên object theo map (ví dụ băng đạn)
    for old, new in p.get("rename", {}).items():
        o = bpy.data.objects.get(old)
        if o: o.name = new

    # 5) Giảm polygon nếu cần
    ratio = p.get("decimate_ratio")
    if ratio and ratio < 1.0:
        for o in mesh_objects():
            m = o.modifiers.new("Decimate", 'DECIMATE')
            m.ratio = ratio

    # 6) Tìm texture bị mất đường dẫn trong thư mục của file .blend
    try:
        bpy.ops.file.find_missing_files(directory=os.path.dirname(bpy.data.filepath))
    except Exception as ex:
        print("find_missing_files:", ex)

    # 7) Xuất GLB
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

### B2. Inspect file gốc

```bash
blender -b assets/source/guns/rifle.blend --python tools/blender/gun_tool.py -- inspect
```

Đọc JSON giữa `INSPECT_JSON_BEGIN/END`, xác định:
1. **Trục dài nhất** của `size` = trục của nòng.
2. **Đầu nòng ở đầu nào** của trục đó: tìm object tên chứa `barrel`, `muzzle`, `silencer`; nếu không có thì đầu nòng thường là phía **xa** object tên chứa `stock`/`butt` (báng súng). Không chắc → **hỏi người dùng**, đừng đoán.
3. **Tỉ lệ**: chiều dài trục nòng so với yêu cầu (rifle 0,8–1,0m) → tính `scale`.
4. **Tay cầm**: object tên chứa `grip`/`handle`; lấy tâm của nó. Không có thì ước lượng: rifle ~ 35% chiều dài tính từ báng, ở mép dưới.
5. **Băng đạn**: object tên chứa `mag`/`clip`/`magazine` → đưa vào `rename` thành `mag`. Nếu băng đạn dính liền thân súng (không có object riêng) → ghi vào báo cáo, **không** tự cắt mesh.
6. **Texture**: image có `exists: false` → báo người dùng tên file bị thiếu.
7. `total_tris` > 20.000 → đặt `decimate_ratio = 20000 / total_tris` (làm tròn xuống 0,05).

### B3. Viết file params

`assets/source/guns/rifle.params.json`, ví dụ:

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

- `grip`, `muzzle`, `eject` tính theo **toạ độ gốc của file** (số đọc từ inspect), script tự biến đổi.
- `rotate_deg` chọn sao cho **sau khi xoay**: nòng chĩa **+Y**, phía trên súng là **+Z** (hệ Blender).

### B4. Xuất và inspect lại

```bash
blender -b assets/source/guns/rifle.blend --python tools/blender/gun_tool.py -- normalize assets/source/guns/rifle.params.json client/public/models/rifle.glb
```

Không lưu đè file `.blend` gốc (chế độ `-b` không tự lưu, đừng thêm lệnh save).

Kiểm tra lại bằng cách import file glb vào Blender trống:
```bash
blender -b --python-expr "import bpy; bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath='client/public/models/rifle.glb')" --python tools/blender/gun_tool.py -- inspect
```
Sau khi import, trục của Blender lại về Z-up, nên phải thấy: nòng theo **+Y**, size đúng mét, có object `muzzle`, `total_tris` ≤ 20.000, image đều `packed` hoặc nhúng.

```
cd /Users/I762313/projects/personal/fps-web && \
blender -b assets/source/guns/m16.blend --python tools/blender/gun_tool.py -- normalize assets/source/guns/m16.params.json client/public/models/m16.glb 2>&1 | grep -E "(rebuilt|EXPORTED|Error)" && \
blender -b assets/source/guns/ak47.blend --python tools/blender/gun_tool.py -- normalize assets/source/guns/ak47.params.json client/public/models/ak47.glb 2>&1 | grep -E "(rebuilt|EXPORTED|Error)"
```

### B5. Trang viewer trong dự án

Tạo `client/viewer.html` (route dev `/viewer.html?model=rifle`):
- Load glb bằng `GLTFLoader`, đặt ở gốc.
- `GridHelper` ô 0,1m, `AxesHelper` 0,5m.
- Một khối hộp đỏ 1m dài theo −Z cạnh súng làm thước đo.
- Quả cầu nhỏ màu vàng tại vị trí node `muzzle` (`getObjectByName('muzzle').getWorldPosition`).
- OrbitControls để xoay xem.

Nghiệm thu:
- [x] Nòng chĩa theo trục **−Z** (cùng chiều thước đỏ).
- [x] Chiều dài đúng loại súng so với thước 1m.
- [x] Quả cầu vàng nằm đúng đầu nòng.
- [x] Gốc toạ độ (giao điểm AxesHelper) nằm ở tay cầm.
- [x] Texture hiện đúng màu, không trắng/không hồng.

### B6. Nén (sau khi B5 đạt)

```bash
npx @gltf-transform/cli optimize client/public/models/ak47.glb client/public/models/ak47.glb --texture-compress webp --texture-size 1024

npx @gltf-transform/cli optimize client/public/models/m16.glb client/public/models/m16.glb --texture-compress webp --texture-size 1024
```

Nếu sau khi nén game báo lỗi decoder: thêm `MeshoptDecoder` (từ `three/examples/jsm/libs/meshopt_decoder.module.js`) vào `GLTFLoader` bằng `loader.setMeshoptDecoder(...)`. Mở lại viewer kiểm tra lần nữa.

---

## Pitfall

- **Vật liệu phức tạp:** glTF chỉ hiểu node *Principled BSDF* + texture nối thẳng vào. Material dùng nhiều node trộn, procedural texture sẽ bị mất/ra màu trơn. Nếu viewer hiện sai màu mà inspect báo đủ image → báo người dùng, cần "bake" texture trong Blender (việc này làm tay trong giao diện, Claude Code không tự làm).
- **Lỗi tham số API:** tên tham số của `export_scene.gltf` có thể khác nhau giữa các bản Blender. Nếu báo `unrecognized keyword`, bỏ tham số đó và chạy lại, ghi chú vào báo cáo; không tự viết exporter khác.
- **Đơn vị file gốc:** nhiều model làm theo centimet nên size ra số hàng chục/hàng trăm. Luôn tính `scale` từ `size` thực tế, đừng giả định.
- **Object ẩn:** file có thể chứa object ẩn (bản nháp, LOD thấp). Xem danh sách trong inspect; object rõ ràng là phụ (tên chứa `LOD1`, `old`, `backup`) → hỏi người dùng có xoá không.
- **Không sửa file `.blend` gốc.** Mọi thay đổi chỉ nằm trong lần chạy headless.
