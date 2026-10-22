// UI translations. English is the source of truth; Vietnamese must have exactly the same keys (enforced by i18n.test.ts).
//
// Usage:  t('lobby.title')   t('hud.wave', { n: 3, max: 10 })   — placeholders are written {name} in the strings.
// Dictionaries live in ./en/<area>.ts and ./vi/<area>.ts (default export: flat { 'area.key': 'text' }); any file added there is picked up automatically.
// The language is chosen once at startup (saved choice > browser language > English). Changing it saves the choice and reloads the page
// (see selector.ts), so strings can safely be built once when a screen is created.

export type Lang = 'en' | 'vi'
export const LANGS: readonly { id: Lang; label: string }[] = [{ id: 'en', label: 'English' }, { id: 'vi', label: 'Tiếng Việt' }]

const STORAGE_KEY = 'fps.lang'

type Dict = Record<string, string>
function merge(mods: Record<string, { default: Dict }>): Dict {
  const out: Dict = {}
  for (const m of Object.values(mods)) Object.assign(out, m.default)
  return out
}
export const DICTS: Record<Lang, Dict> = {
  en: merge(import.meta.glob<{ default: Dict }>('./en/*.ts', { eager: true })),
  vi: merge(import.meta.glob<{ default: Dict }>('./vi/*.ts', { eager: true })),
}

export function detectLang(): Lang {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'vi') return saved
  } catch { /* storage blocked: fall through */ }
  const nav = (globalThis as { navigator?: { language?: string } }).navigator?.language ?? ''
  return nav.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

let current: Lang = detectLang()
if (typeof document !== 'undefined') document.documentElement.lang = current

export function getLang(): Lang { return current }

/** Switch language in memory (tests) and remember it. The UI does not re-render: callers reload the page. */
export function setLang(l: Lang): void {
  current = l
  try { globalThis.localStorage?.setItem(STORAGE_KEY, l) } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l
}

export type Params = Record<string, string | number>

/** Translate `key`, falling back to English, then to the key itself (so a missing key is visible but never crashes). */
export function t(key: string, params?: Params): string {
  let s = DICTS[current][key] ?? DICTS.en[key] ?? key
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
  return s
}
