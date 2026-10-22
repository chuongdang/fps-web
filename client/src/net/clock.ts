const SAMPLES = 8
const MAX_SLEW_MS_PER_FRAME = 1

interface Sample { rtt: number; offset: number }

// Server clock estimated from Ping/Pong. now is injected for tests.
export class ClockSync {
  private samples: Sample[] = []
  private target = 0      // best offset (sample with the smallest RTT)
  private applied = 0     // offset in use; may only decrease gradually so serverNow never runs backwards
  private hasSample = false

  constructor(private now: () => number = () => performance.now()) {}

  // On Pong: rtt = now − clientTime; offset = serverTime + rtt/2 − now
  addSample(clientTime: number, serverTime: number): void {
    const now = this.now()
    const rtt = now - clientTime
    this.samples.push({ rtt, offset: serverTime + rtt / 2 - now })
    if (this.samples.length > SAMPLES) this.samples.shift()
    let best = this.samples[0]!
    for (const s of this.samples) if (s.rtt < best.rtt) best = s
    this.target = best.offset
    if (!this.hasSample) { this.applied = this.target; this.hasSample = true }
  }

  // Call once per frame. If the offset increases, jump immediately (time moves forward);
  // if it decreases, lower it by at most 1ms/frame so serverNow never goes backwards.
  tick(): void {
    if (this.target >= this.applied) this.applied = this.target
    else this.applied -= Math.min(MAX_SLEW_MS_PER_FRAME, this.applied - this.target)
  }

  serverNow(): number { return this.now() + this.applied }
  get offset(): number { return this.applied }
  get synced(): boolean { return this.hasSample }

  // Estimated one-way delay = average RTT / 2 (average, not the minimum: snapshots
  // arrive with the real delay, not the best sample)
  get oneWayMs(): number {
    if (this.samples.length === 0) return 0
    let sum = 0
    for (const s of this.samples) sum += s.rtt
    return sum / this.samples.length / 2
  }
}

export const clock = new ClockSync()
