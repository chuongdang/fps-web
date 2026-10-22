// Registry of the maps shipped with the game: id (also the name of client/public/maps/<id>.png) -> map file.
// The client, the offline worker and the packaged server all read this list. To add a map: drop <id>.json next to this file,
// add one import + one entry below, and add the preview client/public/maps/<id>.png. maps.test.ts fails if a json is missing here.
import type { MapFile } from '../../shared/src/map/types'
import deathmatch from './deathmatch.json'
import dust2 from './dust2.json'

export const DEFAULT_MAP_ID = 'deathmatch'

export const MAPS: Record<string, MapFile> = {
  deathmatch: deathmatch as unknown as MapFile,
  dust2: dust2 as unknown as MapFile,
}
