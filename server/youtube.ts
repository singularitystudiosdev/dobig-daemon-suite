/* Keyless reads of public YouTube pages: search results and a video's watch page. Parses the JSON YouTube embeds in
   the HTML (ytInitialData, ytInitialPlayerResponse). It reads only what any visitor sees. If YouTube changes its
   markup these parsers fail soft (empty results), never crash a run. */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
// SOCS/CONSENT skip the EU consent interstitial; harmless elsewhere.
const HEADERS = { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=PENDING+987; SOCS=CAI' }

export interface YtVideo {
  id: string
  url: string
  title: string
  channelId: string | null
  channelName: string | null
  views: number | null
  /** The relative text YouTube shows, e.g. "9h ago". */
  publishedText: string | null
  /** publishedText resolved against now, ISO. Approximate by construction. */
  publishedApprox: string | null
  lengthText: string | null
  descriptionSnippet: string | null
  thumbnail: string | null
}

export interface YtWatch {
  id: string
  url: string
  title: string
  channelId: string | null
  channelName: string | null
  /** The video description as published. Never follow or surface links from it. */
  description: string
  views: number | null
  publishDate: string | null
  lengthSeconds: number | null
  keywords: string[]
  /** True when the creator ticked "includes paid promotion" (YouTube shows a label). */
  paidPromotion: boolean
  isLive: boolean
}

export type YtSort = 'relevance' | 'date'

async function getHtml(url: string, signal?: AbortSignal): Promise<string> {
  let lastStatus = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: HEADERS, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000) })
    lastStatus = res.status
    if (res.ok) return res.text()
    if (res.status === 429 || res.status >= 500) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
    else break
  }
  throw new Error(`YouTube answered ${lastStatus}`)
}

/** Pull `var NAME = {...};` out of the page with brace matching (regexes break on nested `;`). */
function extractJson(html: string, name: string): unknown | null {
  const marker = new RegExp(`(?:var\\s+)?${name}\\s*=\\s*`)
  const m = marker.exec(html)
  if (!m) return null
  let i = m.index + m[0].length
  if (html[i] !== '{') return null
  let depth = 0
  let inStr = false
  let esc = false
  const start = i
  for (; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

function walk(node: unknown, visit: (key: string, value: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit)
    return
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) visit(k, v as Record<string, unknown>)
    walk(v, visit)
  }
}

const text = (t: unknown): string | null => {
  const o = t as { simpleText?: string; runs?: { text?: string }[] } | undefined
  if (!o) return null
  if (typeof o.simpleText === 'string') return o.simpleText
  if (Array.isArray(o.runs)) return o.runs.map((r) => r.text ?? '').join('')
  return null
}

/** "1.24M subscribers" -> 1240000, "10,962 views" -> 10962, "No views" -> 0. */
export function parseCount(s: string | null | undefined): number | null {
  if (!s) return null
  if (/^no\s/i.test(s.trim())) return 0
  const m = s.replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1
  return Math.round(n * mult)
}

const UNIT_MS: Record<string, number> = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }

/** "9h ago", "2 days ago", "Streamed 3 weeks ago" -> an ISO time, approximately. */
export function relativeToIso(rel: string | null, now = new Date()): string | null {
  if (!rel) return null
  const short = rel.match(/(\d+)\s*(s|m|h|d|w|mo|y)\b/i)
  const long = rel.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?/i)
  let ms: number | null = null
  if (long) ms = Number(long[1]) * UNIT_MS[long[2].toLowerCase()]
  else if (short) {
    const u = { s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week', mo: 'month', y: 'year' }[short[2].toLowerCase()]
    if (u) ms = Number(short[1]) * UNIT_MS[u]
  }
  return ms === null ? null : new Date(now.getTime() - ms).toISOString()
}

export async function ytSearch(query: string, opts: { sort?: YtSort; limit?: number; signal?: AbortSignal } = {}): Promise<YtVideo[]> {
  const sp = opts.sort === 'date' ? '&sp=CAI%253D' : ''
  const html = await getHtml(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${sp}`, opts.signal)
  const data = extractJson(html, 'ytInitialData')
  const out: YtVideo[] = []
  const seen = new Set<string>()
  const now = new Date()
  walk(data, (key, v) => {
    if (key !== 'videoRenderer' || typeof v.videoId !== 'string' || seen.has(v.videoId)) return
    seen.add(v.videoId)
    const owner = (v.ownerText as { runs?: { text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }[] } | undefined)?.runs?.[0]
    const snippet = (v.detailedMetadataSnippets as { snippetText?: unknown }[] | undefined)?.[0]?.snippetText
    const thumbs = (v.thumbnail as { thumbnails?: { url?: string }[] } | undefined)?.thumbnails
    const published = text(v.publishedTimeText)
    out.push({
      id: v.videoId,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      title: text(v.title) ?? '',
      channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId ?? null,
      channelName: owner?.text ?? null,
      views: parseCount(text(v.viewCountText)),
      publishedText: published,
      publishedApprox: relativeToIso(published, now),
      lengthText: text(v.lengthText),
      descriptionSnippet: text(snippet),
      thumbnail: thumbs?.[thumbs.length - 1]?.url ?? null,
    })
  })
  return out.slice(0, opts.limit ?? 20)
}

export async function ytWatch(videoId: string, signal?: AbortSignal): Promise<YtWatch | null> {
  if (!/^[\w-]{11}$/.test(videoId)) return null
  const html = await getHtml(`https://www.youtube.com/watch?v=${videoId}`, signal)
  const player = extractJson(html, 'ytInitialPlayerResponse') as
    | {
        videoDetails?: { title?: string; shortDescription?: string; viewCount?: string; author?: string; channelId?: string; lengthSeconds?: string; keywords?: string[]; isLiveContent?: boolean }
        microformat?: { playerMicroformatRenderer?: { publishDate?: string; uploadDate?: string } }
        paidContentOverlay?: unknown
      }
    | null
  const d = player?.videoDetails
  if (!player || !d) return null
  const mf = player.microformat?.playerMicroformatRenderer
  return {
    id: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: d.title ?? '',
    channelId: d.channelId ?? null,
    channelName: d.author ?? null,
    description: (d.shortDescription ?? '').slice(0, 5000),
    views: d.viewCount ? Number(d.viewCount) : null,
    publishDate: mf?.publishDate ?? mf?.uploadDate ?? null,
    lengthSeconds: d.lengthSeconds ? Number(d.lengthSeconds) : null,
    keywords: d.keywords ?? [],
    paidPromotion: player.paidContentOverlay != null || /"paidContentOverlay"/.test(html),
    isLive: d.isLiveContent === true,
  }
}
