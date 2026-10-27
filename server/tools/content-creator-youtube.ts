/* Content Creator Daemon's reads of public YouTube pages, built on the shared helpers in ../youtube.ts: a channel's videos page
   (header, description, latest uploads), its About page (the full public description) and a watch page with the
   family-safe marker. Every parser fails soft: unreadable markup gives empty fields, never an exception. Nothing here
   signs in: YouTube hides a business email behind a sign-in button, and this code never touches it. */
import { extractJson, getHtml, parseCount, relativeToIso, text, walk, type YtWatch } from '../youtube.ts'

export interface ChannelUpload {
  id: string
  url: string
  title: string
  /** The rounded figure the channel page shows ("34K views"), parsed. Null for scheduled or unreadable rows. */
  views: number | null
  /** What YouTube shows, e.g. "7h ago" or "Streamed 3 weeks ago". */
  publishedText: string | null
  publishedApprox: string | null
}

export interface ChannelPage {
  id: string
  name: string
  handle: string | null
  url: string
  /** Parsed from the rounded header text ("524K subscribers"); null when the channel hides it. */
  subscribers: number | null
  /** The full public description (About text). */
  description: string
  familySafe: boolean | null
  uploads: ChannelUpload[]
}

const VIDEO_ID = /^[\w-]{11}$/

/** Every string leaf under a node, depth-first, capped so a huge page cannot stall the run. */
function strings(node: unknown, out: string[] = [], cap = 4000): string[] {
  if (out.length >= cap || node == null) return out
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const n of node) strings(n, out, cap)
  else if (typeof node === 'object') for (const v of Object.values(node as Record<string, unknown>)) strings(v, out, cap)
  return out
}

function firstContent(node: unknown): string | null {
  const o = node as { content?: unknown; simpleText?: unknown; runs?: unknown } | undefined
  if (!o) return null
  if (typeof o.content === 'string') return o.content
  return text(o)
}

/** Pull one upload out of a lockupViewModel, videoRenderer or gridVideoRenderer; null when it is not a plain video. */
function readUpload(key: string, v: Record<string, unknown>, now: Date): ChannelUpload | null {
  let id: string | null = null
  let title: string | null = null
  const parts: { text: string; label: string }[] = []
  if (key === 'lockupViewModel') {
    if (typeof v.contentType === 'string' && !/VIDEO/.test(v.contentType)) return null
    if (typeof v.contentType === 'string' && /SHORT/.test(v.contentType)) return null
    id = typeof v.contentId === 'string' ? v.contentId : null
    const meta = (v.metadata as { lockupMetadataViewModel?: { title?: unknown; metadata?: unknown } } | undefined)?.lockupMetadataViewModel
    title = firstContent(meta?.title)
    // Each part is {text:{content:"34K"}, accessibilityLabel:"34 thousand views"}; the visible text may omit the word "views".
    const collect = (n: unknown): void => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(collect)
      const o = n as { text?: { content?: unknown }; accessibilityLabel?: unknown; metadataParts?: unknown }
      if (Array.isArray(o.metadataParts)) {
        for (const p of o.metadataParts as { text?: { content?: unknown }; accessibilityLabel?: unknown }[]) {
          if (typeof p.text?.content === 'string') parts.push({ text: p.text.content, label: typeof p.accessibilityLabel === 'string' ? p.accessibilityLabel : '' })
        }
      }
      for (const v of Object.values(n as Record<string, unknown>)) collect(v)
    }
    collect(meta?.metadata)
  } else if (key === 'videoRenderer' || key === 'gridVideoRenderer') {
    id = typeof v.videoId === 'string' ? v.videoId : null
    title = text(v.title)
    const views = text(v.viewCountText) ?? text(v.shortViewCountText)
    const age = text(v.publishedTimeText)
    if (views) parts.push({ text: views, label: '' })
    if (age) parts.push({ text: age, label: '' })
  } else return null
  if (!id || !VIDEO_ID.test(id) || !title) return null
  const isViews = (p: { text: string; label: string }): boolean => /\bviews?\b$|^no views$|\bwatching$/i.test(p.text.trim()) || /\bviews?$|\bwatching$/i.test(p.label.trim()) || /^[\d.,]+\s*[KMB]?$/.test(p.text.trim())
  const viewsText = parts.find(isViews)?.text ?? null
  const ageText = parts.find((p) => /\bago$/i.test(p.text.trim()) || /\bago$/i.test(p.label.trim()))?.text ?? null
  // A scheduled or upcoming row has neither: keep it out of the numbers.
  if (!viewsText && !ageText) return null
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title,
    views: viewsText && !/watching$/i.test(viewsText) ? parseCount(viewsText) : null,
    publishedText: ageText,
    publishedApprox: relativeToIso(ageText, now),
  }
}

export async function fetchChannel(channelId: string, signal?: AbortSignal): Promise<ChannelPage | null> {
  if (!/^UC[\w-]{20,24}$/.test(channelId)) return null
  let data: unknown = null
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500))
    data = extractJson(await getHtml(`https://www.youtube.com/channel/${channelId}/videos`, signal), 'ytInitialData')
  }
  if (!data) return null
  const now = new Date()

  type Meta = { title?: string; description?: string; ownerUrls?: string[]; isFamilySafe?: boolean; externalId?: string }
  const found: { meta: Meta | null } = { meta: null }
  walk(data, (k, v) => {
    if (!found.meta && k === 'channelMetadataRenderer') found.meta = v as Meta
  })
  const m = found.meta

  // Subscribers: the header's own text first, then any string that is exactly "<n> subscribers".
  const header: { node: unknown } = { node: null }
  walk(data, (k, v) => {
    if (!header.node && (k === 'pageHeaderViewModel' || k === 'c4TabbedHeaderRenderer' || k === 'pageHeaderRenderer')) header.node = v
  })
  const headerNode = header.node
  const SUBS = /^([\d.,]+\s*[KMB]?)\s+subscribers?$/i
  const headerStrings = strings(headerNode, [], 600)
  const subText = headerStrings.find((s) => SUBS.test(s.trim())) ?? strings(data, [], 6000).find((s) => SUBS.test(s.trim())) ?? null
  const subscribers = subText ? parseCount(subText.trim().replace(/\s+subscribers?$/i, '')) : null

  const handleFromOwner = m?.ownerUrls?.map((u) => /@([\w.\-]+)/.exec(u)?.[1]).find(Boolean) ?? null
  const handleFromHeader = headerStrings.map((s) => /^@([\w.\-]+)$/.exec(s.trim())?.[1]).find(Boolean) ?? null
  const handle = handleFromOwner ?? handleFromHeader

  const uploads: ChannelUpload[] = []
  const seen = new Set<string>()
  walk(data, (k, v) => {
    const u = readUpload(k, v, now)
    if (u && !seen.has(u.id)) {
      seen.add(u.id)
      uploads.push(u)
    }
  })

  let name = m?.title ?? ''
  if (!name) {
    const t = (headerNode as { title?: { dynamicTextViewModel?: { text?: { content?: string } } } } | null)?.title?.dynamicTextViewModel?.text?.content
    name = t ?? ''
  }
  if (!name && !uploads.length) return null
  return {
    id: channelId,
    name: name || channelId,
    handle,
    url: `https://www.youtube.com/channel/${channelId}`,
    subscribers,
    description: (m?.description ?? '').slice(0, 6000),
    familySafe: typeof m?.isFamilySafe === 'boolean' ? m.isFamilySafe : null,
    uploads,
  }
}

export interface WatchRead extends YtWatch {
  /** From the player response's microformat when YouTube includes it. */
  familySafe: boolean | null
}

/** One watch page: same fields as ytWatch plus the player response's family-safe marker. One request. */
export async function watchVideo(videoId: string, signal?: AbortSignal): Promise<WatchRead | null> {
  if (!VIDEO_ID.test(videoId)) return null
  const html = await getHtml(`https://www.youtube.com/watch?v=${videoId}`, signal)
  const player = extractJson(html, 'ytInitialPlayerResponse') as
    | {
        videoDetails?: { title?: string; shortDescription?: string; viewCount?: string; author?: string; channelId?: string; lengthSeconds?: string; keywords?: string[]; isLiveContent?: boolean }
        microformat?: { playerMicroformatRenderer?: { publishDate?: string; uploadDate?: string; isFamilySafe?: boolean } }
        paidContentOverlay?: unknown
        playabilityStatus?: { status?: string; reason?: string }
      }
    | null
  const d = player?.videoDetails
  if (player && !d && player.playabilityStatus?.status === 'LOGIN_REQUIRED') throw new Error('YouTube asked for a bot check on watch pages')
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
    familySafe: typeof mf?.isFamilySafe === 'boolean' ? mf.isFamilySafe : null,
  }
}

export interface AboutPage {
  /** The full public description shown on the About page. */
  description: string
}

/** The channel's About page: the full public description (the videos page only carries a shortened copy). One request. */
export async function fetchAbout(channelId: string, signal?: AbortSignal): Promise<AboutPage | null> {
  if (!/^UC[\w-]{20,24}$/.test(channelId)) return null
  const data = extractJson(await getHtml(`https://www.youtube.com/channel/${channelId}/about`, signal), 'ytInitialData')
  if (!data) return null
  const found: { d: string | null } = { d: null }
  walk(data, (k, v) => {
    if (found.d === null && k === 'aboutChannelViewModel' && typeof v.description === 'string') found.d = v.description
  })
  return found.d === null ? null : { description: found.d.slice(0, 6000) }
}
