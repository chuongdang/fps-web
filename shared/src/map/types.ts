import type { Vec3 } from '../math'

export type { Vec3 }

export interface MapBox {
  pos: Vec3
  size: Vec3
  texture: string     // class / type / image name — see materials.ts
  variant?: number    // pick the nth image (from 1) in the class
  color?: string      // '#rrggbb' multiplied into the image (or flat paint)
  noMirror?: boolean
  invisible?: boolean // collision only, not drawn (sky-blocking wall)
}

export interface MapRamp {
  from: Vec3
  to: Vec3
  width: number
  texture?: string    // like MapBox (class / image name); omitted = blue-grey grid
  variant?: number
  color?: string
  noMirror?: boolean
}

/** A triangle mesh used as map collision (indexed: vertices = x,y,z,x,y,z,...; indices = three per triangle). Metres, Y up, same frame as the boxes. */
export interface MapTriMesh {
  vertices: number[]
  indices: number[]
}

export interface MapSpawn {
  pos: Vec3
  yaw: number
}

export interface MapZone {
  min: Vec3
  max: Vec3
}

export interface MapFile {
  name: string
  mirrorX: boolean
  boxes: MapBox[]
  ramps: MapRamp[]
  spawnsA: MapSpawn[]
  buyZoneA?: MapZone   // buy zone of the base on the negative-x side; loadMap mirrors it to B
  // Only read when mirrorX is false (an asymmetric map): the side that is not mirrored from A
  spawnsB?: MapSpawn[]
  buyZoneB?: MapZone
  // A modelled map (asymmetric only): `model` is the glb the client draws (url under client/public, same frame as the boxes) and `trimesh` is its
  // collision. Boxes and ramps still work next to it (invisible walls, fixes). Made by `scripts/glb-collision.mjs`, see plan/tools-model-import.md.
  model?: string
  trimesh?: MapTriMesh
  // Highest ledge (m) the player walks up without jumping, so stairs work. Omitted = no auto-step (every older map).
  stepHeight?: number
}

export interface LoadedMap {
  name: string
  boxes: MapBox[]
  ramps: MapRamp[]
  spawns: { A: MapSpawn[]; B: MapSpawn[] }
  buyZones: { A?: MapZone; B?: MapZone }
  model?: string
  trimesh?: MapTriMesh
  stepHeight?: number
}
