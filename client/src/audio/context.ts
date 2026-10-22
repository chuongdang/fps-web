// AudioContext + master graph (A.4):
//   gunGroup ─┐
//   (reload, hit, ui, other players' sounds) ─► master Gain ─► muffle (lowpass, fully open) ─► Compressor ─► destination
// gunGroup (own gunshots) is kept separate so it can duck when the kill sound plays.
// The context is only created in the first user event → no autoplay warning.

export interface AudioSettings {
  volume: number
  lowAmmoWarning: boolean
  heartbeat: boolean
  dynamicCrosshair: boolean   // crosshair expands with the real spread (off: fixed gap)
}

const LS_KEY = 'fps_audio'
export const settings: AudioSettings = { volume: 1, lowAmmoWarning: true, heartbeat: true, dynamicCrosshair: true }
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(LS_KEY) ?? '{}'))
} catch { /* localStorage broken/unavailable: use defaults */ }

export function saveSettings(): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(settings)) } catch { /* ignore */ }
  if (graph) graph.master.gain.value = settings.volume
}

export interface AudioGraph {
  ctx: AudioContext
  master: GainNode
  comp: DynamicsCompressorNode
  analyser: AnalyserNode
  gunGroup: GainNode
  muffle: BiquadFilterNode   // lowpass before the compressor: 20kHz normally, 'muffled' down to 700Hz by tinnitus after an explosion (G.8)
}

let graph: AudioGraph | null = null
const readyCbs: ((g: AudioGraph) => void)[] = []

export const getGraph = (): AudioGraph | null => graph

/** Calls cb when the context is ready (immediately if it already exists). */
export function onAudioReady(cb: (g: AudioGraph) => void): void {
  if (graph) cb(graph)
  else readyCbs.push(cb)
}

/** Registers context creation on the first click/key (user gesture). */
export function initAudioContext(): void {
  const start = () => {
    if (!graph) {
      const ctx = new AudioContext()
      const master = ctx.createGain()
      master.gain.value = settings.volume
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.knee.value = 6
      comp.ratio.value = 4
      comp.attack.value = 0.003
      comp.release.value = 0.15
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      const gunGroup = ctx.createGain()
      const muffle = ctx.createBiquadFilter()
      muffle.type = 'lowpass'; muffle.frequency.value = 20000; muffle.Q.value = 0.5
      gunGroup.connect(master)
      master.connect(muffle)
      muffle.connect(comp)
      comp.connect(ctx.destination)
      comp.connect(analyser)
      graph = { ctx, master, comp, analyser, gunGroup, muffle }
      for (const cb of readyCbs.splice(0)) cb(graph)
    }
    if (graph.ctx.state === 'suspended') void graph.ctx.resume()
    document.removeEventListener('click', start)
    document.removeEventListener('keydown', start)
    document.removeEventListener('touchend', start)
  }
  document.addEventListener('click', start)
  document.addEventListener('keydown', start)
  document.addEventListener('touchend', start)   // iOS unlocks audio from a touch gesture
}

// ── Listener (camera) ─────────────────────────────────────────────────────────
export const listenerPos: [number, number, number] = [0, 0, 0]

/** Called every frame: no allocation. yaw/pitch follow the project convention (yaw 0 looks toward -Z). */
export function updateListener(x: number, y: number, z: number, yaw: number, pitch: number): void {
  listenerPos[0] = x; listenerPos[1] = y; listenerPos[2] = z
  if (!graph) return
  const l = graph.ctx.listener
  const cp = Math.cos(pitch)
  const fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp
  if (l.positionX) {
    const t = graph.ctx.currentTime
    l.positionX.setValueAtTime(x, t); l.positionY.setValueAtTime(y, t); l.positionZ.setValueAtTime(z, t)
    l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(fy, t); l.forwardZ.setValueAtTime(fz, t)
    l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t)
  } else {
    l.setPosition(x, y, z)
    l.setOrientation(fx, fy, fz, 0, 1, 0)
  }
}
