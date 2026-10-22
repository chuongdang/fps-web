// Facade of the audio system: main.ts imports only from here.
import { initAudioContext, onAudioReady } from './context'
import { preload, gunKey, commonKey } from './loader'
import { allGunSoundKeys } from './gunProfiles'
import { HIT_FILE_NAMES, FALL_HURT_KEYS } from './hitAudio'
import { LOCAL_EXTRA_KEYS } from './localSounds'
import { FOOTSTEP_FILES } from './footsteps'
import { GRENADE_SOUND_FILES } from './grenadeAudio'
import { ZOMBIE_SOUND_FILES } from './zombieAudio'

export { updateListener, settings, saveSettings } from './context'
export { playBuyOk, playBuyFail, playRoundStart, playRoundWin, playRoundLose, playTick } from './uiAudio'
export { playShot, playShotOther, playSwing, playDry, playDraw, startReload, cancelReload } from './gunAudio'
export { playFootstep, playLanding, playFootstepOther, FOOTSTEPS } from './footsteps'
export { StepTracker } from './audioMath'
export { playHit, playHurt, playFallHurt, setHealthForAudio } from './hitAudio'
export { playPin, playSpoon, playThrowSwish, playBounce, playExplode, playSmokeBurst, tinnitus } from './grenadeAudio'
export { playGrowl, playScream, playClawHit, playZombieStep, playZombieHurt, playZombieDeath, playInfectSting, startNightAmbient, stopNightAmbient, setNearbyZombieHeartbeat, updateZombieAudio } from './zombieAudio'
export type { HitKind } from './hitAudio'

/** Call once at startup: creates the context on the first user gesture, then loads the files (missing ones are skipped); calls onLoaded when done. */
export function initAudio(onLoaded?: () => void): void {
  initAudioContext()
  onAudioReady((g) => {
    const keys = [...allGunSoundKeys(gunKey, commonKey), ...HIT_FILE_NAMES.map(commonKey), ...FALL_HURT_KEYS, ...LOCAL_EXTRA_KEYS, ...FOOTSTEP_FILES, ...GRENADE_SOUND_FILES, ...ZOMBIE_SOUND_FILES]
    void preload(g.ctx, keys).then(() => onLoaded?.())
  })
}
