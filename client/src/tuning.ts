import type { MovementConfig } from '@fps/shared'

type FieldRange = [min: number, max: number, step: number]

const RANGES: Record<keyof MovementConfig, FieldRange> = {
  runSpeed:      [1,    20,  0.5],
  crouchSpeed:   [1,    10,  0.5],
  groundAccel:   [1,    40,  0.5],
  airAccel:      [1,    40,  0.5],
  airWishCap:    [0.1,  5,   0.1],
  friction:      [1,    20,  0.5],
  stopSpeed:     [0.1,  5,   0.1],
  gravity:       [5,    50,  1  ],
  jumpVelocity:  [1,    20,  0.5],
  standHeight:   [1,    3,   0.1],
  crouchHeight:  [0.5,  2,   0.1],
  radius:        [0.1,  1,   0.05],
  eyeStand:      [0.5,  2.5, 0.1],
  eyeCrouch:     [0.3,  2,   0.1],
  slideBoost:    [0,    10,  0.5],
  slideDuration: [0.1,  2,   0.1],
  slideFriction: [0,    3,   0.1],
  slideCooldown: [0,    5,   0.1],
  slideMinSpeed: [0,    15,  0.5],
}

export function initTuningPanel(cfg: MovementConfig): void {
  const panel = document.createElement('div')
  panel.style.cssText =
    'position:fixed;top:8px;right:8px;width:280px;max-height:90vh;overflow-y:auto;' +
    'background:rgba(0,0,0,0.8);color:#fff;font:12px monospace;padding:8px;' +
    'border:1px solid #555;z-index:20;display:none'
  document.body.appendChild(panel)

  const title = document.createElement('div')
  title.style.cssText = 'font-weight:bold;margin-bottom:6px;color:#ff0'
  title.textContent = 'MovementConfig  [F6 đóng]'
  panel.appendChild(title)

  const labels: Partial<Record<keyof MovementConfig, HTMLSpanElement>> = {}

  for (const key of Object.keys(RANGES) as (keyof MovementConfig)[]) {
    const [min, max, step] = RANGES[key]
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:2px'

    const lbl = document.createElement('span')
    lbl.style.cssText = 'width:110px;flex-shrink:0;font-size:10px'
    lbl.textContent = key

    const val = document.createElement('span')
    val.style.cssText = 'width:40px;text-align:right;font-size:10px;color:#0ff'
    val.textContent = (cfg[key] as number).toFixed(2)
    labels[key] = val

    const slider = document.createElement('input')
    slider.type  = 'range'
    slider.min   = String(min)
    slider.max   = String(max)
    slider.step  = String(step)
    slider.value = String(cfg[key])
    slider.style.cssText = 'flex:1;cursor:pointer'
    slider.addEventListener('input', () => {
      const n = parseFloat(slider.value);
      (cfg as unknown as Record<string, number>)[key] = n
      val.textContent = n.toFixed(2)
    })

    row.append(lbl, slider, val)
    panel.appendChild(row)
  }

  const copyBtn = document.createElement('button')
  copyBtn.textContent = 'Copy JSON'
  copyBtn.style.cssText =
    'margin-top:8px;width:100%;padding:4px;background:#333;color:#fff;' +
    'border:1px solid #888;cursor:pointer;font:12px monospace'
  copyBtn.addEventListener('click', () => {
    const json = JSON.stringify(cfg, null, 2)
    navigator.clipboard.writeText(json).then(() => {
      copyBtn.textContent = 'Đã copy!'
      setTimeout(() => { copyBtn.textContent = 'Copy JSON' }, 1500)
    })
  })
  panel.appendChild(copyBtn)

  let visible = false
  document.addEventListener('keydown', e => {
    if (e.code === 'F6') {
      visible = !visible
      panel.style.display = visible ? 'block' : 'none'
      // Đồng bộ slider nếu cfg bị thay đổi từ ngoài
      if (visible) {
        for (const key of Object.keys(RANGES) as (keyof MovementConfig)[]) {
          const inputs = panel.querySelectorAll<HTMLInputElement>('input[type=range]')
          const idx = (Object.keys(RANGES) as string[]).indexOf(key)
          if (inputs[idx]) {
            inputs[idx].value = String(cfg[key])
            labels[key]!.textContent = (cfg[key] as number).toFixed(2)
          }
        }
      }
      e.preventDefault()
    }
  })
}
