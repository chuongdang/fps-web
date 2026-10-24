export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 3;   // 20 snapshots/second
export const INTERP_DELAY_MS = 100;
export const MAX_REWIND_MS = 500;   // real rewind = upstream delay + INTERP_DELAY + downstream delay (≈ 2×oneWay+100) → 250 only covers lat≈75ms each way
export const HITBOX_HISTORY_MS = 1000;
// A TCP stall on the player's connection (one lost packet) holds every cmd back for 200+ ms and then delivers them in one burst.
// The queue must hold such a burst (60 cmds/s: 40 = 0.67 s) or the oldest cmds are dropped, the server never simulates them and the
// client is snapped back. The server then catches up at MAX_INPUTS_PER_TICK (3 = two extra steps per tick, a 250 ms stall is back to real time in ~8 ticks).
export const MAX_INPUT_QUEUE = 40;
export const MAX_INPUTS_PER_TICK = 3;
// Over an unreliable channel packets arrive out of order. The queue is kept sorted by seq; when the next cmd is missing but later ones are queued, the server waits
// this many ticks (0.1 s) for the late packet that carries it before giving the missing step up (running ahead would make the late cmd "old" and lose it).
export const INPUT_GAP_WAIT_TICKS = 6;
export const RESPAWN_DELAY_MS = 3000;
export const SPAWN_INVULN_MS = 2000;
// Input queue empty for <= this many ticks (0.6 s): stand and wait for a cmd, do not run the 'idle' step. An idle step moves the server one step the client
// never predicted, and when the held cmds then arrive in a burst (TCP stall) they are simulated on top: a 250 ms stall left the server ~1.5 m ahead of the client = a snap.
export const INPUT_STARVE_GRACE_TICKS = 36;
export const SEQ_AHEAD_SLACK_MS = 1000;   // a cmd's seq may run at most this far ahead of real time (stops seq jumps used to fire faster)
export const PLAYER_MAX_HP = 100;

/** Falling below this height (off the map) counts as death */
export const VOID_Y = -20;

/**
 * Fall damage (Counter-Strike style): impact speed ≤ safeSpeed costs no health,
 * rising with the square up to lethalSpeed which costs maxDamage. With gravity 22: 14 m/s ≈ 4.5 m drop, 21 m/s ≈ 10 m drop.
 */
export const FALL_DAMAGE = {
  safeSpeed: 14,      // m/s
  lethalSpeed: 21,    // m/s
  maxDamage: 100,
}
