import type { ImageProvider, VariantEvent, VariantFailure } from '@/lib/apiTypes'
import type { ExistingVariant } from './variantsClient'

/* Tile state for the Thumbnail workspace. A tile that is not in the map has nothing generated yet (idle).
   NDJSON events move a tile to queued, working, then done or failed; outputs from earlier sessions arrive as done
   tiles flagged `earlier`. */

export interface Tile {
  status: 'queued' | 'working' | 'done' | 'failed'
  src?: string
  reason?: VariantFailure
  message?: string
  /** Generated in an earlier session; shown read-only until the user generates again. */
  earlier?: boolean
}

export interface TilesState {
  tiles: Record<string, Tile>
  /** The start event's mode: every tile is a fresh live call to the model. */
  mode: 'live' | null
  /** The start event's provider (Google or OpenRouter), or null when the server did not say. */
  provider: ImageProvider | null
  /** The server has no image key anywhere, so nothing is generated. */
  unavailable: boolean
}

export type TilesAction =
  | { type: 'queue'; keys: string[] }
  | { type: 'event'; event: VariantEvent }
  | { type: 'fail'; keys: string[]; reason: VariantFailure; message: string }
  | { type: 'existing'; items: ExistingVariant[] }
  | { type: 'unavailable' }
  | { type: 'restart' }

export const tileKey = (thumbId: string, index: number) => `${thumbId}:${index}`

export const INITIAL_TILES: TilesState = { tiles: {}, mode: null, provider: null, unavailable: false }

export function tilesReducer(state: TilesState, action: TilesAction): TilesState {
  switch (action.type) {
    case 'queue': {
      const tiles = { ...state.tiles }
      for (const k of action.keys) tiles[k] = { status: 'queued' }
      return { ...state, tiles }
    }
    case 'fail': {
      const tiles = { ...state.tiles }
      for (const k of action.keys) {
        const t = tiles[k]
        if (t && (t.status === 'queued' || t.status === 'working')) tiles[k] = { status: 'failed', reason: action.reason, message: action.message }
      }
      return { ...state, tiles }
    }
    case 'existing': {
      const tiles = { ...state.tiles }
      for (const v of action.items) {
        const k = tileKey(v.thumbId, v.index)
        if (!tiles[k]) tiles[k] = { status: 'done', src: v.src, earlier: true }
      }
      return { ...state, tiles }
    }
    case 'unavailable':
      return { ...state, unavailable: true }
    case 'restart':
      return { ...state, unavailable: false }
    case 'event': {
      const e = action.event
      if (e.type === 'start') return e.mode === 'unavailable' ? state : { ...state, mode: e.mode, provider: e.provider ?? null }
      if (e.type === 'end') return state
      const key = tileKey(e.thumbId, e.index)
      if (e.type === 'working') {
        const cur = state.tiles[key]
        if (cur && (cur.status === 'done' || cur.status === 'failed') && !cur.earlier) return state
        return { ...state, tiles: { ...state.tiles, [key]: { status: 'working' } } }
      }
      if (e.type === 'done') return { ...state, tiles: { ...state.tiles, [key]: { status: 'done', src: e.src } } }
      return { ...state, tiles: { ...state.tiles, [key]: { status: 'failed', reason: e.reason, message: e.message } } }
    }
  }
}
