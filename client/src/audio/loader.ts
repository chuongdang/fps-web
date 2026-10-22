// Loads audio files into AudioBuffers. Missing file → skipped (falls back to synthesized sound),
// collected into ONE console warning, no crash.

import { localPath, LOCAL_EXTRA_KEYS } from './localSounds'

const buffers = new Map<string, AudioBuffer>()

/** Key of the form 'guns/ak47/shot_01' or 'common/kill' (no file extension). */
export const gunKey = (folder: string, name: string): string => `guns/${folder}/${name}`
export const commonKey = (name: string): string => `common/${name}`

export const getBuffer = (key: string): AudioBuffer | undefined => buffers.get(key)
export const hasBuffer = (key: string): boolean => buffers.has(key)

function fileExt(): 'ogg' | 'mp3' {
  const ok = new Audio().canPlayType('audio/ogg; codecs="vorbis"')
  return ok ? 'ogg' : 'mp3'
}

async function load(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(String(res.status))
  return ctx.decodeAudioData(await res.arrayBuffer())   // the dev server's HTML fallback fails here
}

/** Loads in parallel; returns the list of missing keys. */
export async function preload(ctx: BaseAudioContext, keys: string[]): Promise<string[]> {
  const ext = fileExt()
  const missing: string[] = []
  await Promise.all([...new Set(keys)].map(async (key) => {
    // Personal files (localSounds.ts) take priority; if missing, use the game's original file
    const local = localPath(key)
    let buf = local ? await load(ctx, `/sounds/local/${local}.wav`).catch(() => undefined) : undefined
    if (!buf && !key.startsWith('local/')) buf = await load(ctx, `/sounds/${key}.${ext}`).catch(() => undefined)
    if (buf) buffers.set(key, buf)
    else if (!(local && LOCAL_EXTRA_KEYS.includes(key))) missing.push(key)
  }))
  if (missing.length > 0) {
    missing.sort()
    console.warn(`[audio] missing ${missing.length}/${new Set(keys).size} audio files (using synthesized sounds instead):`, missing)
  }
  return missing
}
