import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { TEXTURE_CLASSES } from '@fps/shared'
import { addCredit, addToTextureClasses } from '../../scripts/import-texture.mjs'

const SRC = `import x
export const TEXTURE_CLASSES: Record<string, TextureClass> = {
  brick:    { files: ['brick_1'], tileM: 3 },                  // red brick
  concrete: { files: ['concrete_1', 'concrete_2'], tileM: 2 }, // grey concrete
  plain:    { files: [], tileM: 1 },                           // no image
}

export const FLOOR_COLOR = '#3d5a2a'
`

describe('import-texture: materials.ts edit', () => {
  it('a new class is added as the last line of TEXTURE_CLASSES, nothing else changes', () => {
    const out = addToTextureClasses(SRC, { cls: 'sand', file: 'sand_1', tileM: 2.5 })
    expect(out).toContain("\n  sand: { files: ['sand_1'], tileM: 2.5 },\n}")
    expect(out.replace("\n  sand: { files: ['sand_1'], tileM: 2.5 },", '')).toBe(SRC)
  })
  it('an image is appended to an existing class (also an empty one)', () => {
    expect(addToTextureClasses(SRC, { cls: 'concrete', file: 'concrete_3', tileM: 2 })).toContain("files: ['concrete_1', 'concrete_2', 'concrete_3']")
    expect(addToTextureClasses(SRC, { cls: 'plain', file: 'plain_1', tileM: 1 })).toContain("files: ['plain_1']")
  })
  it('the same image twice, and a file named like a class, are refused', () => {
    expect(() => addToTextureClasses(SRC, { cls: 'brick', file: 'brick_1', tileM: 3 })).toThrow(/already/)
    expect(() => addToTextureClasses(SRC, { cls: 'concrete', file: 'brick', tileM: 3 })).toThrow(/already a class/)
  })
  it('the real materials.ts is accepted (the tool can edit the file it is meant for)', async () => {
    const { readFileSync } = await import('node:fs')
    const real = readFileSync(new URL('../../shared/src/map/materials.ts', import.meta.url), 'utf8')
    expect(addToTextureClasses(real, { cls: 'zz_new', file: 'zz_new', tileM: 2 })).toContain("zz_new: { files: ['zz_new'], tileM: 2 },")
  })
})

describe('import-texture: credits', () => {
  it('adds an entry and replaces the one of the same file', () => {
    const a = { file: 'textures/a.jpg', author: 'x' }
    const out = addCredit([a, { file: 'textures/b.jpg', author: 'y' }], { file: 'textures/a.jpg', author: 'z' })
    expect(out).toHaveLength(2)
    expect(out.find(e => e.file === 'textures/a.jpg')!.author).toBe('z')
  })
})

describe('texture classes', () => {
  it.each(Object.entries(TEXTURE_CLASSES).flatMap(([cls, c]) => c.files.map(f => [cls, f] as const)))('%s: %s.jpg exists in client/public/textures', (_cls, file) => {
    expect(existsSync(new URL(`../../client/public/textures/${file}.jpg`, import.meta.url))).toBe(true)
  })
})
