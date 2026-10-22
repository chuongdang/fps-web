import { LANGS, getLang, setLang, type Lang } from './index'

/** A small language <select>. Choosing a language saves it and reloads the page so every screen is rebuilt in that language. */
export function createLangSelector(extraCss = ''): HTMLSelectElement {
  const sel = document.createElement('select')
  sel.setAttribute('data-lang-select', '')
  sel.setAttribute('aria-label', 'Language')
  sel.style.cssText = 'font:13px sans-serif;padding:3px 6px;border-radius:6px;background:#1c2028;color:#fff;border:1px solid #556;cursor:pointer;' + extraCss
  for (const l of LANGS) sel.add(new Option(l.label, l.id))
  sel.value = getLang()
  sel.addEventListener('change', () => { setLang(sel.value as Lang); location.reload() })
  return sel
}
