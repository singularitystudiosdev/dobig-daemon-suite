import { randomUUID } from 'node:crypto'
import { RANK_DEPTH, type RankNeighbor } from '../../src/lib/details/rank.ts'
import { ResolveError, robloxGetJson, takeRobloxToken } from '../roblox.ts'
import { parseLooseJson } from './creator-contacts.ts'
import type { GameFacts } from './rank-phrases.ts'

/* Roblox calls for the Rank Daemon, on top of the shared rate limiter in server/roblox.ts. omniSearchGames there drops
   the isSponsored flag, which this tool needs (ads must not count as a position), so the omni-search page is read here. */

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export const gameUrl = (placeId: number) => `https://www.roblox.com/games/${placeId}`

/** The same search on roblox.com. Verified 2026-10-27: https://www.roblox.com/discover/?Keyword=<phrase> renders the
 *  same ordered list the omni-search API returns (the older /search/games?keyword= path answers 404). */
export const searchUrl = (phrase: string) => `https://www.roblox.com/discover/?Keyword=${encodeURIComponent(phrase)}`

export interface GameInfoForRank extends GameFacts {
  universeId: number
  placeId: number
}

/** The game's own name, description and genre words from games.roblox.com. The description holds raw newlines that
 *  strict JSON parsers reject, so a failed strict parse is read again as text with the tolerant parser. */
export async function fetchGameFacts(universeId: number, signal: AbortSignal): Promise<GameInfoForRank> {
  const url = `https://games.roblox.com/v1/games?universeIds=${universeId}`
  let { status, json } = await robloxGetJson(url, signal)
  if (status === 200 && json === null) {
    await takeRobloxToken(signal)
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }).catch(() => null)
    if (res && res.ok) json = parseLooseJson(await res.text())
  }
  if (status === 400 || status === 404) throw new ResolveError('not-found', 'Roblox does not know that game.')
  if (status !== 200) throw new ResolveError('upstream', 'Roblox could not load the game. Try again in a minute.')
  const rows = obj(json).data
  const g = Array.isArray(rows) ? obj(rows[0]) : {}
  if (!num(g.id) || !str(g.name) || g.name === '[TITLE UNAVAILABLE]') throw new ResolveError('not-found', 'Roblox does not know that game.')
  if (g.isContentRestricted === true) throw new ResolveError('private', 'That game is not public, so it cannot be searched for.')
  return {
    universeId: num(g.id),
    placeId: num(g.rootPlaceId),
    name: str(g.name),
    description: str(g.description),
    genre: str(g.genre),
    genreL1: str(g.genre_l1),
    genreL2: str(g.genre_l2),
  }
}

/** One game in a search page, with the flags the omni-search API gives. */
export interface SearchHit {
  universeId: number
  placeId: number
  name: string
  playing: number
  up: number
  down: number
  sponsored: boolean
}

export interface SearchPage {
  hits: SearchHit[]
  next: string | null
}

export async function fetchSearchPage(phrase: string, sessionId: string, pageToken: string | null, signal: AbortSignal): Promise<SearchPage> {
  const params = new URLSearchParams({ searchQuery: phrase, pageToken: pageToken ?? '', sessionId, pageType: 'all' })
  const { status, json } = await robloxGetJson(`https://apis.roblox.com/search-api/omni-search?${params}`, signal)
  if (status !== 200) throw new ResolveError('upstream', 'Roblox search did not answer. Try again in a minute.')
  const root = obj(json)
  const hits: SearchHit[] = []
  for (const group of Array.isArray(root.searchResults) ? root.searchResults : []) {
    const g = obj(group)
    if (str(g.contentGroupType) !== 'Game') continue
    for (const c of Array.isArray(g.contents) ? g.contents : []) {
      const x = obj(c)
      const universeId = num(x.universeId)
      const placeId = num(x.rootPlaceId)
      if (!universeId || !placeId || !str(x.name)) continue
      hits.push({ universeId, placeId, name: str(x.name), playing: num(x.playerCount), up: num(x.totalUpVotes), down: num(x.totalDownVotes), sponsored: x.isSponsored === true })
    }
  }
  return { hits, next: str(root.nextPageToken) || null }
}

/** Everything one phrase's search read: the ordered results (organic and ads) and where the game sat. */
export interface PhraseRead {
  phrase: string
  /** Organic results in order, ads left out. Index 0 is position 1. At most RANK_DEPTH. */
  organic: SearchHit[]
  /** Every result in order including ads, for showing ads where they sat. */
  all: (SearchHit & { position: number | null })[]
  /** 1-based organic position of the game, or null when it is not in the first RANK_DEPTH. */
  position: number | null
  pages: number
  adsSeen: number
}

/** Below the game we want this many organic results so the ten games around it are shown. */
const WANT_BELOW = 5

/** Searches one phrase and pages with nextPageToken until the game is found and five games below it are read, or
 *  100 organic results are read, or the results end. Ads (isSponsored) are kept for display but are not positions. */
export async function readPhrase(phrase: string, game: { universeId: number; placeId: number }, signal: AbortSignal): Promise<PhraseRead> {
  const sessionId = randomUUID()
  const organic: SearchHit[] = []
  const all: PhraseRead['all'] = []
  const seen = new Set<number>()
  let position: number | null = null
  let pages = 0
  let adsSeen = 0
  let token: string | null = null
  for (;;) {
    const page = await fetchSearchPage(phrase, sessionId, token, signal)
    pages++
    for (const h of page.hits) {
      if (seen.has(h.universeId)) continue
      seen.add(h.universeId)
      if (h.sponsored) {
        adsSeen++
        all.push({ ...h, position: null })
        continue
      }
      if (organic.length >= RANK_DEPTH) continue
      organic.push(h)
      all.push({ ...h, position: organic.length })
      if (position === null && (h.universeId === game.universeId || h.placeId === game.placeId)) position = organic.length
    }
    token = page.next
    if (!token || page.hits.length === 0 || organic.length >= RANK_DEPTH) break
    if (position !== null && organic.length >= position + WANT_BELOW) break
  }
  return { phrase, organic, all, position, pages, adsSeen }
}

const likeRatio = (up: number, down: number) => (up + down > 0 ? up / (up + down) : null)

const toNeighbor = (h: SearchHit & { position: number | null }): RankNeighbor => ({
  placeId: h.placeId,
  universeId: h.universeId,
  name: h.name,
  url: gameUrl(h.placeId),
  playing: h.playing,
  likeRatio: likeRatio(h.up, h.down),
  sponsored: h.sponsored,
  position: h.position,
})

/** The ten organic games around the game (five above, five below; the window slides when the game is near an end),
 *  with ads that sat inside that window. When the game is not found: the top ten organic results. */
export function aroundWindow(read: PhraseRead, universeId: number): { rows: RankNeighbor[]; kind: 'around' | 'top' } {
  const organicRows = read.all.filter((r) => r.position !== null)
  const mine = organicRows.findIndex((r) => r.universeId === universeId)
  const others = organicRows.filter((r) => r.universeId !== universeId)
  if (mine < 0) {
    const top = others.slice(0, 10)
    return { rows: inclusiveSlice(read, top), kind: 'top' }
  }
  const aboveAll = organicRows.slice(0, mine)
  const belowAll = organicRows.slice(mine + 1)
  let above = Math.min(5, aboveAll.length)
  let below = Math.min(10 - above, belowAll.length)
  if (below < 5) above = Math.min(aboveAll.length, 10 - below)
  const chosen = [...aboveAll.slice(aboveAll.length - above), organicRows[mine], ...belowAll.slice(0, below)]
  return { rows: inclusiveSlice(read, chosen), kind: 'around' }
}

/** The chosen organic rows plus any ad that sat between the first and the last of them, in result order. */
function inclusiveSlice(read: PhraseRead, chosen: (SearchHit & { position: number | null })[]): RankNeighbor[] {
  if (chosen.length === 0) return []
  const ids = new Set(chosen.map((c) => c.universeId))
  const first = read.all.findIndex((r) => ids.has(r.universeId))
  let last = first
  read.all.forEach((r, i) => {
    if (ids.has(r.universeId)) last = i
  })
  return read.all.slice(first, last + 1).filter((r) => ids.has(r.universeId) || r.sponsored).map(toNeighbor)
}
