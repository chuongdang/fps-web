import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DICTS, getLang, setLang, t } from './index'

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]!).sort()

describe('i18n dictionaries', () => {
  it('Vietnamese and English have exactly the same keys', () => {
    const en = Object.keys(DICTS.en).sort(), vi = Object.keys(DICTS.vi).sort()
    expect(vi.filter(k => !(k in DICTS.en)), 'keys only in vi').toEqual([])
    expect(en.filter(k => !(k in DICTS.vi)), 'keys only in en').toEqual([])
  })

  it('every translation uses the same {placeholders} as the English text', () => {
    const bad = Object.keys(DICTS.en).filter(k => DICTS.vi[k] !== undefined && placeholders(DICTS.en[k]!).join() !== placeholders(DICTS.vi[k]!).join())
    expect(bad).toEqual([])
  })

  it('no empty strings', () => {
    for (const l of ['en', 'vi'] as const) expect(Object.entries(DICTS[l]).filter(([, v]) => v.trim() === '').map(([k]) => k), l).toEqual([])
  })

  it('every t(\'key\') literal in the client source exists in the dictionaries', () => {
    const root = join(__dirname, '..')
    const files: string[] = []
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'i18n') walk(p) } else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p) } }
    walk(root)
    const missing: string[] = []
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) if (!(m[1]! in DICTS.en)) missing.push(`${f.replace(root, '')}: ${m[1]}`)
    expect(missing).toEqual([])
  })

  it('t() interpolates, falls back to English, then to the key', () => {
    DICTS.en['test.hello'] = 'Hello {name}, {n} left'
    const prev = getLang()
    setLang('vi')   // no Vietnamese entry: falls back to English
    expect(t('test.hello', { name: 'A', n: 3 })).toBe('Hello A, 3 left')
    expect(t('test.hello')).toBe('Hello {name}, {n} left')
    expect(t('test.nope')).toBe('test.nope')
    delete DICTS.en['test.hello']
    setLang(prev)
  })
})
