import { t } from '../i18n'
import { QUALITIES, getQuality, setQuality, type Quality } from './quality'

/** A small "Graphics: Medium" <select> for the lobby (phones only). The pixel ratio is read when the page loads, so a change reloads the page, like the language selector. */
export function createQualitySelector(extraCss = ''): HTMLSelectElement {
  const sel = document.createElement('select')
  sel.setAttribute('data-quality-select', '')
  sel.setAttribute('aria-label', t('lobby.quality', { level: '' }).replace(/[:：]\s*$/, ''))
  sel.style.cssText = 'font:16px sans-serif;padding:3px 6px;border-radius:6px;background:#1c2028;color:#fff;border:1px solid #556;' + extraCss
  for (const q of QUALITIES) sel.add(new Option(t('lobby.quality', { level: t(`lobby.quality.${q}`) }), q))
  sel.value = getQuality()
  sel.addEventListener('change', () => { setQuality(sel.value as Quality); location.reload() })
  return sel
}
