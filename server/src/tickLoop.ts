import { TICK_RATE } from '@fps/shared'

const TICK_MS = 1000 / TICK_RATE
const MAX_CATCHUP_TICKS = 10

// The number of ticks to run is computed from the real elapsed time (accumulator); the setInterval cadence is not trusted.
// Tick k happens at start + k*TICK_MS; the snapshot's serverTime comes from here, so it is steady.
export class TickLoop {
  private start: number
  private _tick = 0
  skipped = 0   // ticks dropped because the server fell too far behind

  constructor(private now: () => number, private onTick: (tick: number, serverTime: number) => void) {
    this.start = now()
  }

  get tick(): number { return this._tick }

  timeOf(tick: number): number { return this.start + tick * TICK_MS }

  pump(): void {
    const target = Math.floor((this.now() - this.start) / TICK_MS)
    if (target - this._tick > MAX_CATCHUP_TICKS) {
      this.skipped += target - this._tick - MAX_CATCHUP_TICKS
      this._tick = target - MAX_CATCHUP_TICKS
    }
    while (this._tick < target) {
      this._tick++
      this.onTick(this._tick, this.timeOf(this._tick))
    }
  }
}
