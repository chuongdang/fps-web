// Personal sounds: a table mapping the game's sound keys → .wav files in client/public/sounds/local/ (gitignored, not packaged).
// The loader tries the local file first; if missing / failing, it uses the game's original file, then the synthesized sound. To change any sound, just edit this table.

const W = (name: string): string => `weapons/${name}`
const P = (name: string): string => `player/${name}`

/** Collects the `guns/<folder>/<name>` keys of one gun. */
function gun(folder: string, files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, file] of Object.entries(files)) out[`guns/${folder}/${name}`] = W(file)
  return out
}

export const LOCAL_SOUNDS: Record<string, string> = {
  // ── Guns ──
  ...gun('ak47', {
    shot_01: 'ak47-2', shot_02: 'ak47-2', shot_03: 'ak47-2', shot_04: 'ak47-2',
    reload_magout: 'ak47_clipout', reload_magin: 'ak47_clipin', reload_bolt: 'ak47_boltpull',
  }),
  ...gun('m16', {
    shot_01: 'm4a1_unsil-1', shot_02: 'm4a1_unsil-2', shot_03: 'm4a1_unsil-1', shot_04: 'm4a1_unsil-2',
    reload_magout: 'm4a1_clipout', reload_magin: 'm4a1_clipin', reload_bolt: 'm4a1_boltpull', draw: 'm4a1_deploy',
  }),
  ...gun('colt', {
    shot_01: 'usp_unsil-1', shot_02: 'usp_unsil-1', shot_03: 'usp_unsil-1',
    reload_magout: 'usp_clipout', reload_magin: 'clipin1', reload_slide: 'usp_slideback',
  }),
  ...gun('rulo', {
    shot_01: 'deagle-1', shot_02: 'deagle-2', shot_03: 'deagle-1',
    reload_open: 'de_clipout', reload_insert: 'de_clipin', reload_close: 'sliderelease1', draw: 'de_deploy',
  }),
  ...gun('sniper', {
    shot_01: 'awp1', shot_02: 'awp1', cock: 'scout_bolt',
    reload_magout: 'awp_clipout', reload_magin: 'awp_clipin', reload_bolt: 'boltpull1', draw: 'awp_deploy',
  }),
  ...gun('smg', {
    shot_01: 'mp5-2', shot_02: 'mp5-2', shot_03: 'mp5-2',
    reload_magout: 'mp5_clipout', reload_magin: 'mp5_clipin', reload_bolt: 'mp5_slideback',
  }),
  ...gun('shotgun', {
    shot_01: 'm3-1', shot_02: 'm3-1', pump: 'm3_pump',
    reload_insert: 'm3_insertshell', reload_close: 'm3_pump',
  }),
  'common/dryfire_rifle': W('dryfire_rifle'),
  'common/dryfire_pistol': W('dryfire_pistol'),
  'common/knife_swing_01': W('knife_slash1'),
  'common/knife_swing_02': W('knife_slash2'),

  // ── Hits / being hit ──
  'common/hit_body_01': P('bhit_flesh-1'), 'common/hit_body_02': P('bhit_flesh-2'), 'common/hit_body_03': P('bhit_flesh-3'),
  'common/hit_head_01': P('headshot1'), 'common/hit_head_02': P('headshot2'),
  'common/hurt_01': P('pl_pain2'), 'common/hurt_02': P('pl_pain4'), 'common/hurt_03': P('pl_pain5'),
  'local/player/pl_fallpain1': P('pl_fallpain1'), 'local/player/pl_fallpain2': P('pl_fallpain2'), 'local/player/pl_fallpain3': P('pl_fallpain3'),

  // ── Footsteps ──
  'common/footstep_01': P('pl_step1'), 'common/footstep_02': P('pl_step2'), 'common/footstep_03': P('pl_step3'), 'common/footstep_04': P('pl_step4'),
  'common/land_01': P('pl_dirt1'),

  // ── Grenades ──
  'grenade/pin': W('pinpull'),
  'grenade/smoke_burst': W('sg_explode'),
  'grenade/bounce_01': W('he_bounce-1'), 'grenade/bounce_02': W('grenade_hit3'),
  'grenade/explode_01': W('hegrenade-2'), 'grenade/explode_02': W('hegrenade-2'), 'grenade/explode_03': W('hegrenade-2'),
}

/** Keys that exist only locally (the original game has no file): must be added to the load list. */
export const LOCAL_EXTRA_KEYS = ['common/knife_swing_01', 'common/knife_swing_02']

/** Local file path of a key (no extension), or undefined. */
export const localPath = (key: string): string | undefined => LOCAL_SOUNDS[key]
