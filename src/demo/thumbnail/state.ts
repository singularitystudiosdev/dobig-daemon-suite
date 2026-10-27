import type { VariantEvent, VariantFailure } from '@/lib/apiTypes'

/* Tile state for the Thumbnail workspace. Every variant frame exists from the first render as 'queued';
   NDJSON events move it to working, then done or failed. */

export interface Tile {
  status: 'queued' | 'working' | 'done' | 'failed'
  src?: string
  reason?: VariantFailure
  message?: string
}

export interface TilesState {
  tiles: Record<string, Tile>
  /** The start event's mode: every tile is a fresh live call to the model. */
  mode: 'live' | null
  /** The server has no Gemini key anywhere, so nothing is generated. */
  unavailable: boolean
}

export type TilesAction =
  | { type: 'queue'; keys: string[] }
  | { type: 'event'; event: VariantEvent }
  | { type: 'fail'; keys: string[]; reason: VariantFailure; message: string }
  | { type: 'unavailable' }
  | { type: 'restart' }

export const tileKey = (thumbId: string, index: number) => `${thumbId}:${index}`

export function initTiles(keys: string[]): TilesState {
  return { tiles: Object.fromEntries(keys.map((k) => [k, { status: 'queued' } as Tile])), mode: null, unavailable: false }
}

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
    case 'unavailable':
      return { ...state, unavailable: true }
    case 'restart':
      return { ...state, unavailable: false }
    case 'event': {
      const e = action.event
      if (e.type === 'start') return e.mode === 'unavailable' ? state : { ...state, mode: e.mode }
      if (e.type === 'end') return state
      const key = tileKey(e.thumbId, e.index)
      if (!(key in state.tiles)) return state
      if (e.type === 'working') {
        const cur = state.tiles[key]
        if (cur.status === 'done' || cur.status === 'failed') return state
        return { ...state, tiles: { ...state.tiles, [key]: { status: 'working' } } }
      }
      if (e.type === 'done') return { ...state, tiles: { ...state.tiles, [key]: { status: 'done', src: e.src } } }
      return { ...state, tiles: { ...state.tiles, [key]: { status: 'failed', reason: e.reason, message: e.message } } }
    }
  }
}
