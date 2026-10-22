export interface GlbTriangles {
  vertices: number[]
  indices: number[]
  min: [number, number, number]
  max: [number, number, number]
}
export function readGlbTriangles(path: string, options?: { precision?: number }): GlbTriangles
