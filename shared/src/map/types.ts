import type { Vec3 } from '../math'

export type { Vec3 }

export interface MapBox {
  pos: Vec3
  size: Vec3
  texture: string
  noMirror?: boolean
}

export interface MapRamp {
  from: Vec3
  to: Vec3
  width: number
  noMirror?: boolean
}

export interface MapSpawn {
  pos: Vec3
  yaw: number
}

export interface MapFile {
  name: string
  mirrorX: boolean
  boxes: MapBox[]
  ramps: MapRamp[]
  spawnsA: MapSpawn[]
}

export interface LoadedMap {
  name: string
  boxes: MapBox[]
  ramps: MapRamp[]
  spawns: { A: MapSpawn[]; B: MapSpawn[] }
}
