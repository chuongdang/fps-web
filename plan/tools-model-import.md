# Import a 3D model or a texture

Two tools: **models / static scenes** (below) and **map textures** (last section).

For a level or prop made in another tool (Sketchfab download, Blender export, `.obj` / `.fbx` / `.gltf` / `.usdz`). Used for Dust2 (`assets/source/maps/dust2.mjs`). Written for the next model: nothing here is Dust2-specific.

## The three steps

```bash
# 1. Model -> one game-ready glb: metres, Y up, textures embedded as JPEG. Needs Blender (found automatically, or set BLENDER=/path/to/blender).
node scripts/blender.mjs build-scene <src.gltf|glb|obj|fbx|usd*|blend> client/public/maps/<id>.glb \
     --scale=<k> --turn-deg=<deg> --center --ground [--jpeg-quality=85] [--max-tex-px=1024]

# 2. Collision: the glb's triangles (welded, node transforms applied). Library or CLI.
node scripts/glb-collision.mjs client/public/maps/<id>.glb            # prints vertex / triangle counts and the bounds
#    import { readGlbTriangles } from '../../../scripts/glb-collision.mjs'   (see assets/source/maps/dust2.mjs)

# 3. Lobby card (640x360): lit render of the glb
node scripts/blender.mjs preview-scene client/public/maps/<id>.glb client/public/maps/<id>.png [--from=x,y,z] [--look=x,y,z]
```

`build-scene` options: `--scale` multiplies the model (source units -> metres: first measure a doorway or the player-sized thing; the log line prints the final bounds). `--turn-deg` turns it about the up axis (counter-clockwise from above); `--center` puts the middle of the bounds on x = z = 0; `--ground` puts the lowest point at y = 0. Order: centre/ground, then turn, then scale. Importer empties with big offsets are baked into the vertices.

## Making the map file
1. Keep the source under `assets/source/maps/<id>-model/` (with its `license.txt`).
2. Write a generator `assets/source/maps/<id>.mjs` like `dust2.mjs`: read the glb, write `assets/maps/<id>.json` with `mirrorX: false`, `model: '/maps/<id>.glb'`, `trimesh`, `spawnsA`/`spawnsB`, `buyZoneA`/`buyZoneB`. Team A = `-x`, team B = `+x`, the other maps' convention; use `--turn-deg` to get there.
3. Register it in `assets/maps/index.ts`. `server/src/maps.test.ts` checks the glb and the preview exist.
4. Add the credit to `assets/CREDITS.json` for the glb and the preview (`npm run package` checks that every file in `client/public` has a credit). **A downloaded model needs its author credit (CC-BY etc.): copy the line from its `license.txt`.**

## Engine side (shared)
`MapFile.model` (glb url the client draws as is) and `MapFile.trimesh` (`{ vertices, indices }`, same frame) next to the usual boxes/ramps; boxes and ramps can still add invisible walls or fixes. `createWorld` makes one fixed Rapier trimesh collider. Not mirrorable. `MapFile.stepHeight` (optional, metres) turns on the character controller's auto-step for that map only: models have real stairs (Dust2: 0.4-0.8 m risers) and the player cannot jump a whole flight. 0.9 is enough for Dust2; a ledge higher than `stepHeight` still needs a jump.

## Checking a modelled map (a model is not authored for physics)
- Floors and walls are often single-sided sheets with missing risers or hovering ledges, and the stairs can have 0.8 m steps (set `stepHeight`; test a staircase by walking it without jumping, see `dust2.test.ts`). **Walk it**: `server/src/walkAudit.ts` (`walkRoute`, `navRoute`) drives the real `stepMovement` along a route and reports the hops a player cannot make. `server/src/dust2.test.ts` is the template (spawn tests, nav, key routes, one negative control).
- The nav grid is stricter than a player: it called the (walkable) A ramp a "leap". Do not trust "unreachable" in the nav alone, walk it.
- Look at it in the game (create a room over the wire with `mapId`, open `?room=<name>`, F10 orbit view) before saying it is done.

## Import a map texture (the images box / ramp maps tile)
```bash
node scripts/import-texture.mjs <image> --name sand_1 --author "Name" --license "CC0" [--url https://...] [--class sand] [--tile 2] [--max-px 1024] [--quality 88] [--own] [--dry-run]
```
One command does everything the old hand work did: Blender (`asset_tool.py build-texture`) makes a power-of-two JPEG of at most `--max-px` in `client/public/textures/<name>.jpg`; the original goes to `assets/source/texture/`; `shared/src/map/materials.ts` gets the image in `TEXTURE_CLASSES` (a new class called `--class`, default the name, or an extra image in an existing class: boxes then pick by position or `variant`); `assets/CREDITS.json` gets the credit (`--own` = original work, otherwise `--author` and `--license` are required). `--tile` is how many metres one repeat covers. It prints a **seam check** and warns if the left/right or top/bottom edges differ much more than neighbouring pixels (the image will show a line when tiled). `--dry-run` checks the names and changes nothing. A box then uses it with `"texture": "<class>"` and optionally `"color": "#rrggbb"`. `server/src/importTexture.test.ts` tests the edits and checks every class file exists.
