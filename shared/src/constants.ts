export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 3;   // 20 snapshots/second
export const INTERP_DELAY_MS = 100;
export const MAX_REWIND_MS = 500;   // real rewind = upstream delay + INTERP_DELAY + downstream delay (≈ 2×oneWay+100) → 250 only covers lat≈75ms each way
export const HITBOX_HISTORY_MS = 1000;
export const MAX_INPUT_QUEUE = 10;
export const MAX_INPUTS_PER_TICK = 2;
export const RESPAWN_DELAY_MS = 3000;
export const SPAWN_INVULN_MS = 2000;
export const INPUT_STARVE_GRACE_TICKS = 6;   // input queue empty for ≤ this many ticks: stand and wait for a cmd, do not run the 'idle' step
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
