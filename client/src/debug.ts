import type { PlayerState } from '@fps/shared'
import type { PingStats } from './net/ping'
import { clock } from './net/clock'
import { interp } from './net/interpolation'
import type { SnapshotStore } from './net/snapshots'
import type { Prediction } from './net/prediction'
import { weaponSyncStats } from './net/weaponSync'
import { rtcDebug } from './net/rtc'

function rtcLine(): string {
  const t = rtcDebug.transport!
  const st = t.stats
  const path = t.unreliableActive?.() ? 'WebRTC (unreliable)' : 'WebSocket'
  return `net path  ${path}   [rtc ${rtcDebug.state}]  sent ${st.sentUnreliable} udp / ${st.sentReliable} ws   recv ${st.recvUnreliable} udp / ${st.recvReliable} ws   fallbacks ${st.fallbacks}`
}

export function initDebugOverlay(
  net?: PingStats,
  snap?: () => SnapshotStore | null,
  pred?: () => Prediction | null,
  extra?: () => string[],   // extra lines (spread…)
): (state: PlayerState, fps: number) => void {
  const el = document.createElement('pre')
  el.style.cssText =
    'position:fixed;top:8px;left:8px;color:#0f0;font:11px/1.5 monospace;' +
    'background:rgba(0,0,0,0.55);padding:4px 6px;pointer-events:none;z-index:20;display:none'
  document.body.appendChild(el)

  let visible = false
  document.addEventListener('keydown', e => {
    if (e.code === 'F3') { visible = !visible; el.style.display = visible ? 'block' : 'none'; e.preventDefault() }
  })

  return (state: PlayerState, fps: number) => {
    if (!visible) return
    const hspd = Math.hypot(state.vel[0], state.vel[2])
    el.textContent = [
      `FPS        ${fps.toFixed(0)}`,
      `Speed    ${hspd.toFixed(2)} m/s`,
      `grounded  ${state.grounded}`,
      `slideTimer ${state.slideTimer.toFixed(3)}   adsT ${state.adsT.toFixed(2)}`,
      ...(extra ? extra() : []),
      `pos  ${state.pos.map(v => v.toFixed(2)).join('  ')}`,
      `yaw  ${state.yaw.toFixed(3)}   pitch ${state.pitch.toFixed(3)}`,
      ...(pred?.() ? [`pending ${pred()!.pending.length}   reconcile error ${pred()!.lastError.toFixed(3)} m   max 5s ${pred()!.maxError().toFixed(3)} m`] : []),
      ...(pred?.() ? [`weapon: server mismatches ${weaponSyncStats.mismatches}/${weaponSyncStats.checks}`] : []),
      ...(snap?.() ? [`snapshot/s ${snap()!.perSec.toFixed(1)}   ghost(F5) server ghosts`] : []),
      ...(snap?.()?.serverTime ? [`snapshot: serverNow − serverTime = ${(clock.serverNow() - snap()!.serverTime).toFixed(0)} ms   #${snap()!.count}`] : []),
      ...(rtcDebug.transport ? [rtcLine()] : []),
      ...(net ? [`RTT  ${net.rttMs.toFixed(0)} ms   out-of-order pongs ${net.outOfOrder}`, `interp delay ${interp.delayMs.toFixed(0)} ms (one-way ${clock.oneWayMs.toFixed(0)})`, `serverNow ${clock.serverNow().toFixed(0)}   offset ${clock.offset.toFixed(1)}${clock.synced ? '' : ' (not synced)'}`] : []),
    ].join('\n')
  }
}
