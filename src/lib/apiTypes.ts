/* Wire types shared by the dev-server API (server/**) and the client (src/**).
   Types only: nothing in this file may import runtime code. */

/** A game resolved from a pasted Roblox link, straight from games.roblox.com. */
export interface GameInfo {
  universeId: number
  placeId: number
  name: string
  description: string
  playing: number
  visits: number
  favorites: number
  maxPlayers: number
  created: string
  updated: string
  genre: string
  subgenre: string
  creator: string
  /** 16:9 cover (the first gallery image) or a square icon when the gallery is empty. */
  cover: string | null
  /** Canonical roblox.com URL for the game. */
  url: string
}

/** One gallery image of a game, as served by thumbnails.roblox.com (768x432 JPEG). */
export interface GalleryThumb {
  /** The Roblox image asset id (`targetId`); stable, so it keys the variant cache. */
  id: string
  /** tr.rbxcdn.com URL. CORS-open, so the browser may load it directly. */
  url: string
}

export interface ResolveResponse {
  ok: true
  game: GameInfo
  gallery: GalleryThumb[]
}

export type ResolveErrorCode = 'bad-link' | 'not-found' | 'private' | 'rate-limited' | 'upstream'

export interface ApiError {
  ok: false
  code: ResolveErrorCode
  /** Plain-language message, safe to show as is. Names the fix. */
  message: string
  /** Seconds to wait before retrying, when rate limited. */
  retryAfter?: number
}

export interface StatusResponse {
  /** True when GEMINI_API_KEY is set on the server (env or .env.local). */
  geminiKey: boolean
  /** Model id the server asks for. */
  model: string
  /** Variants generated per gallery thumbnail. */
  perThumb: number
}

export interface VariantRequest {
  gallery: GalleryThumb[]
  /** Defaults to the server's perThumb (3). */
  perThumb?: number
  /** Generate only these tiles (retry). Ignored tiles are not emitted. */
  only?: { thumbId: string; index: number }[]
}

export type VariantFailure = 'no-key' | 'blocked' | 'no-image' | 'rate-limited' | 'timeout' | 'upstream'

/** NDJSON events, one JSON object per line, from POST /api/variants. */
export type VariantEvent =
  /** 'live': a key is available and every tile is a fresh call to the model. 'unavailable': no key anywhere, nothing is generated. */
  | { type: 'start'; total: number; mode: 'live' | 'unavailable'; model: string }
  | { type: 'working'; thumbId: string; index: number }
  | { type: 'done'; thumbId: string; index: number; src: string; ms: number }
  | { type: 'failed'; thumbId: string; index: number; reason: VariantFailure; message: string }
  | { type: 'end'; done: number; failed: number }

export const NANO_BANANA_MODEL = 'gemini-nano-banana-2.1'
/** The exact prompt from the product spec. Do not reword. */
export const VARIANT_PROMPT = 'Make a variant of this thumbnail with a novel perspective'
export const VARIANTS_PER_THUMB = 3
