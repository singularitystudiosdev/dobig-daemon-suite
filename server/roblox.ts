import type { ApiError, GalleryThumb, GameInfo, ResolveErrorCode, ResolveResponse } from '../src/lib/apiTypes.ts'
import { TtlCache } from './cache.ts'
import { sleep } from './http.ts'

/** Raised for every expected failure; the router turns it into an ApiError. */
export class ResolveError extends Error {
  code: ResolveErrorCode
  retryAfter?: number

  constructor(code: ResolveErrorCode, message: string, retryAfter?: number) {
    super(message)
    this.code = code
    this.retryAfter = retryAfter
  }

  toBody(): ApiError {
    const body: ApiError = { ok: false, code: this.code, message: this.message }
    if (this.retryAfter !== undefined) body.retryAfter = this.retryAfter
    return body
  }

  get status(): number {
    switch (this.code) {
      case 'bad-link':
        return 400
      case 'not-found':
      case 'private':
        return 404
      case 'rate-limited':
        return 429
      default:
        return 502
    }
  }
}

const BAD_LINK =
  'That does not look like a Roblox game link. Paste a roblox.com/games/... link or a numeric place id.'
const SHARE_LINK = "Share links can't be opened without a Roblox login. Paste the roblox.com/games/... link instead."
const NOT_FOUND = 'Roblox has no public game with that id. Check the link, or paste the game page URL from roblox.com/games/...'
const PRIVATE =
  'This game is private or restricted, so Roblox will not show its page. Try a public game from roblox.com/games/...'

// ---------------------------------------------------------------- link parsing

type Parsed = { placeId: number } | { follow: string }

function isRobloxHost(host: string): boolean {
  return host === 'roblox.com' || host.endsWith('.roblox.com')
}

function placeFromUrl(u: URL): number | null {
  const m = /\/games\/(\d{1,15})(?:[/?#]|$)/i.exec(u.pathname)
  if (m) return Number(m[1])
  for (const key of ['placeId', 'PlaceId', 'placeid']) {
    const v = u.searchParams.get(key)
    if (v && /^\d{1,15}$/.test(v)) return Number(v)
  }
  return null
}

export function parseLink(input: string): Parsed {
  const raw = input.trim()
  if (!raw || raw.length > 2000) throw new ResolveError('bad-link', BAD_LINK)
  if (/^\d{1,15}$/.test(raw)) return { placeId: Number(raw) }
  let u: URL
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new ResolveError('bad-link', BAD_LINK)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ResolveError('bad-link', BAD_LINK)
  const host = u.hostname.toLowerCase()
  if (host === 'ro.blox.com') return { follow: u.toString() }
  if (!isRobloxHost(host)) throw new ResolveError('bad-link', BAD_LINK)
  if (/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?share\/?$/i.test(u.pathname)) throw new ResolveError('bad-link', SHARE_LINK)
  const placeId = placeFromUrl(u)
  if (placeId === null || placeId === 0) throw new ResolveError('bad-link', BAD_LINK)
  return { placeId }
}

function followable(host: string): boolean {
  return host === 'ro.blox.com' || isRobloxHost(host) || host.endsWith('.app.link') || host.endsWith('.branch.io')
}

/** Follows an ro.blox.com short link (GET, max 3 hops) and finds the place id. */
async function followShortLink(start: string): Promise<number> {
  const fail = () => new ResolveError('bad-link', 'That short link did not lead to a Roblox game. Paste the roblox.com/games/... link instead.')
  let url = start
  for (let hop = 0; hop <= 3; hop++) {
    let res: Response
    try {
      res = await fetch(url, {
        redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; thumbnail-demo)' },
        signal: AbortSignal.timeout(8000),
      })
    } catch {
      throw new ResolveError('upstream', 'Could not open that short link. Paste the roblox.com/games/... link instead.')
    }
    const location = res.headers.get('location')
    if (location && res.status >= 300 && res.status < 400) {
      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        throw fail()
      }
      const id = placeFromUrl(next)
      if (id) return id
      if (hop === 3 || !followable(next.hostname.toLowerCase())) throw fail()
      url = next.toString()
      continue
    }
    // Final page: some short links answer 200 with the target in the HTML.
    const id = placeFromUrl(new URL(url))
    if (id) return id
    const body = (await res.text().catch(() => '')).slice(0, 200_000)
    const m = /roblox\.com(?:\\?\/)(?:[a-z]{2}(?:-[a-z]{2})?(?:\\?\/))?games(?:\\?\/)(\d{1,15})/i.exec(body) ?? /placeId=(\d{1,15})/i.exec(body)
    if (m) return Number(m[1])
    throw fail()
  }
  throw fail()
}

// ------------------------------------------------------------ limiter + fetch

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 50
const stamps: number[] = []

/** Global limiter: at most 50 Roblox calls in any rolling minute. */
async function takeToken(): Promise<void> {
  for (;;) {
    const now = Date.now()
    while (stamps.length && now - stamps[0] >= WINDOW_MS) stamps.shift()
    if (stamps.length < MAX_PER_WINDOW) {
      stamps.push(now)
      return
    }
    const wait = stamps[0] + WINDOW_MS - now
    if (wait > 12_000) throw new ResolveError('rate-limited', `Too many lookups in a row. Wait ${Math.ceil(wait / 1000)} seconds and paste the link again.`, Math.ceil(wait / 1000))
    await sleep(wait + 25)
  }
}

async function robloxJson(url: string): Promise<{ status: number; json: unknown }> {
  let lastRetry = 5
  for (let attempt = 1; attempt <= 3; attempt++) {
    await takeToken()
    let res: Response
    try {
      res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
    } catch {
      throw new ResolveError('upstream', 'Roblox did not answer. Check your connection and paste the link again in a moment.')
    }
    if (res.status === 429) {
      const header = Number(res.headers.get('retry-after'))
      lastRetry = Math.min(Number.isFinite(header) && header > 0 ? header : 5, 10)
      await res.arrayBuffer().catch(() => undefined)
      if (attempt < 3) {
        await sleep(lastRetry * 1000)
        continue
      }
      throw new ResolveError('rate-limited', `Roblox is rate limiting lookups. Wait ${lastRetry} seconds and try again.`, lastRetry)
    }
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      /* non-JSON body */
    }
    if (res.status >= 500) throw new ResolveError('upstream', 'Roblox is having trouble right now. Try again in a minute.')
    return { status: res.status, json }
  }
  throw new ResolveError('rate-limited', 'Roblox is rate limiting lookups. Try again in a few seconds.', lastRetry)
}

// ------------------------------------------------------------------- lookups

const universeCache = new TtlCache<number | null>(5 * 60_000, 500)
const gameCache = new TtlCache<ResolveResponse>(5 * 60_000, 200)

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

async function universeOf(placeId: number): Promise<number> {
  const id = await universeCache.wrap(`p${placeId}`, async () => {
    const { status, json } = await robloxJson(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`)
    if (status === 400 || status === 404) return null
    if (status !== 200) throw new ResolveError('upstream', 'Roblox could not look up that place. Try again in a minute.')
    const u = obj(json).universeId
    return typeof u === 'number' && u > 0 ? u : null
  })
  if (id === null) throw new ResolveError('not-found', NOT_FOUND)
  return id
}

function trUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && u.hostname === 'tr.rbxcdn.com' ? u.toString() : null
  } catch {
    return null
  }
}

async function fetchGallery(universeId: number): Promise<GalleryThumb[]> {
  const url = `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${universeId}&countPerUniverse=50&defaults=true&size=768x432&format=Jpeg&isCircular=false`
  let ready: GalleryThumb[] = []
  for (let attempt = 0; attempt < 4; attempt++) {
    const { status, json } = await robloxJson(url)
    if (status !== 200) throw new ResolveError('upstream', 'Roblox could not load this game\'s screenshots. Try again in a minute.')
    const rows = obj(json).data
    const thumbs = Array.isArray(rows) ? obj(rows[0]).thumbnails : null
    const list = Array.isArray(thumbs) ? thumbs.map(obj) : []
    ready = []
    const seen = new Set<string>()
    let pending = 0
    for (const t of list) {
      if (str(t.state) !== 'Completed') {
        if (str(t.state) === 'Pending') pending++
        continue
      }
      const id = String(t.targetId ?? '')
      const imageUrl = trUrl(t.imageUrl)
      if (!/^\d{1,20}$/.test(id) || !imageUrl || seen.has(id)) continue
      seen.add(id)
      ready.push({ id, url: imageUrl })
    }
    // Roblox renders some images lazily; ask again (up to 3 times) while any are pending.
    if (pending === 0 || attempt === 3) break
    await sleep(1000 + Math.random() * 1000)
  }
  return ready.slice(0, 12)
}

async function fetchIcon(universeId: number): Promise<string | null> {
  const { status, json } = await robloxJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png`)
  if (status !== 200) return null
  const rows = obj(json).data
  const row = Array.isArray(rows) ? obj(rows[0]) : {}
  return str(row.state) === 'Completed' ? trUrl(row.imageUrl) : null
}

async function loadGame(universeId: number): Promise<ResolveResponse> {
  const { status, json } = await robloxJson(`https://games.roblox.com/v1/games?universeIds=${universeId}`)
  if (status === 400 || status === 404) throw new ResolveError('not-found', NOT_FOUND)
  if (status !== 200) throw new ResolveError('upstream', 'Roblox could not load that game. Try again in a minute.')
  const rows = obj(json).data
  const g = Array.isArray(rows) ? obj(rows[0]) : null
  if (!g || num(g.id) === 0) throw new ResolveError('not-found', NOT_FOUND)
  if (g.name === '[TITLE UNAVAILABLE]') throw new ResolveError('not-found', NOT_FOUND)
  if (g.isContentRestricted === true || !str(g.name)) throw new ResolveError('private', PRIVATE)
  const placeId = num(g.rootPlaceId)
  let gallery = await fetchGallery(universeId)
  let cover: string | null = gallery[0]?.url ?? null
  if (!cover) cover = await fetchIcon(universeId).catch(() => null)
  const game: GameInfo = {
    universeId,
    placeId,
    name: str(g.name),
    description: str(g.description),
    playing: num(g.playing),
    visits: num(g.visits),
    favorites: num(g.favoritedCount),
    maxPlayers: num(g.maxPlayers),
    created: str(g.created),
    updated: str(g.updated),
    genre: str(g.genre_l1) || str(g.genre),
    subgenre: str(g.genre_l2),
    creator: str(obj(g.creator).name),
    cover,
    url: `https://www.roblox.com/games/${placeId}`,
  }
  gallery = gallery.slice(0, 12)
  return { ok: true, game, gallery }
}

export async function resolveGame(link: string): Promise<ResolveResponse> {
  const parsed = parseLink(link)
  const placeId = 'placeId' in parsed ? parsed.placeId : await followShortLink(parsed.follow)
  const universeId = await universeOf(placeId)
  return gameCache.wrap(`u${universeId}`, () => loadGame(universeId))
}
