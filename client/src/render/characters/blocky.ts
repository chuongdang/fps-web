import { t } from '../../i18n'
import { TEAMS } from '@fps/shared'
import { createKit } from './kit'
import type { CharacterSet } from './types'

// Cops & Terrorists fallback (the skinned models live in characterRig.ts). Blocky cops (blue, kepi cap) vs Terrorists (dark grey shirt, black trousers, grey mask, brown hair)
export const blocky: CharacterSet = {
  id: 'copsTerrorists',
  label: t('renderB.charset.copsTerrorists'),
  build(team) {
    const cop = team === 'A'
    const cloth = cop ? TEAMS.A.color : 0x3a3a3a
    const { rig, box } = createKit(team, { torso: cloth, arms: cloth, legs: cop ? 0x1d2f55 : 0x111111, skin: 0xe0b090 })
    if (cop) {
      box(rig.headPivot, 0.38, 0.1, 0.34, 0x1b2748, 0, 0.4, 0)      // kepi cap: flat box
      box(rig.headPivot, 0.38, 0.03, 0.14, 0x0e0e0e, 0, 0.36, -0.2) // brim
      box(rig.headPivot, 0.39, 0.03, 0.35, 0xd9b84a, 0, 0.34, 0)    // yellow band
    } else {
      box(rig.headPivot, 0.37, 0.2, 0.32, 0x3a3a3a, 0, 0.1, 0)      // dark grey mask covering the lower half of the face
      box(rig.headPivot, 0.37, 0.1, 0.32, 0x5a3a20, 0, 0.32, 0)     // brown hair
      box(rig.headPivot, 0.37, 0.2, 0.06, 0x5a3a20, 0, 0.25, 0.13)  // hair at the back of the head
    }
    return rig
  },
}
