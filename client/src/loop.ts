import { DT } from '@fps/shared'
import { stepMovement, lerpState, defaultMovement } from '@fps/shared'
import type { PlayerState, MovementConfig, InputCmd } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { sampleButtons, yaw, pitch } from './input'

let _seq      = 0
let _prev: PlayerState
let _curr: PlayerState

function _buildCmd(): InputCmd {
  return { seq: _seq++, buttons: sampleButtons(), yaw, pitch, weapon: 0 }
}

export function startLoop(
  world: CollisionWorld,
  cfg: MovementConfig,
  onRender: (state: PlayerState) => void,
): void {
  let acc  = 0
  let last = performance.now()

  function frame(now: number) {
    acc  += Math.min((now - last) / 1000, 0.25)
    last  = now

    while (acc >= DT) {
      _prev  = _curr
      _curr  = stepMovement(_curr, _buildCmd(), world, cfg, DT)
      acc   -= DT
    }

    onRender(lerpState(_prev, _curr, acc / DT))
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}

export function initGameState(spawnPos: [number, number, number], spawnYaw: number): void {
  _curr = {
    pos:          [...spawnPos],
    vel:          [0, 0, 0],
    yaw:          spawnYaw,
    pitch:        0,
    grounded:     false,
    crouching:    false,
    slideTimer:   0,
    slideCooldown: 0,
  }
  _prev = _curr
}

export { defaultMovement }
