/* Creator Dox helpers: pure functions that pull invites, handles, links and emails out of PUBLIC text the owner or team
   wrote, pick which group roles count as leadership, rank contact points and dedupe people. Nothing here touches the
   network, so every rule can be checked by feeding it text (server/test/creator.mjs does). An email is only ever
   returned when it appears verbatim in the text it was given; nothing is guessed or built from a pattern. */

export type ChannelKind = 'email' | 'twitter' | 'discord' | 'youtube' | 'twitch' | 'tiktok' | 'instagram' | 'facebook' | 'guilded' | 'linkhub' | 'website' | 'roblox'

export const KIND_LABEL: Record<ChannelKind, string> = {
  email: 'Email',
  twitter: 'X / Twitter',
  discord: 'Discord server',
  youtube: 'YouTube',
  twitch: 'Twitch',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  guilded: 'Guilded',
  linkhub: 'Link page',
  website: 'Website',
  roblox: 'Roblox account',
}

export interface TextHit<T> {
  value: T
  /** Where in the source text it starts, for the quoted excerpt. */
  index: number
}

/* ------------------------------------------------------------------ text */

/** Collapses whitespace and cuts a window of at most `max` characters around `index`, so a finding can quote where it was found. */
export function excerptAround(text: string, index: number, length: number, max = 200): string {
  const flat = (s: string) => s.replace(/\s+/g, ' ')
  const before = flat(text.slice(0, index))
  const hit = flat(text.slice(index, index + length))
  const after = flat(text.slice(index + length))
  const room = Math.max(0, max - hit.length)
  const left = before.slice(-Math.floor(room / 2))
  const right = after.slice(0, room - left.length)
  // Do not start or end the quote in the middle of a word.
  const cutLeft = before.length > left.length && !/\s/.test(before.charAt(before.length - left.length - 1) || ' ') ? left.replace(/^\S*\s?/, '') : left
  const cutRight = after.length > right.length && !/\s/.test(after.charAt(right.length) || ' ') ? right.replace(/\s?\S*$/, '') : right
  let out = `${cutLeft}${hit}${cutRight}`.trim()
  if (out.length > max) out = out.slice(0, max).trim()
  return out
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** Lowercase, letters and digits only, single spaces: for "does this text name the game" checks. */
export const normalizeName = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** True when `text` contains `name` as whole words (case and punctuation ignored). */
export function mentions(text: string, name: string): boolean {
  const n = normalizeName(name)
  if (n.length < 3) return false
  return ` ${normalizeName(text)} `.includes(` ${n} `)
}

/* ------------------------------------------------------------------ invites */

export interface InviteHit {
  code: string
  /** https://discord.gg/<code> */
  url: string
  /** The text as written, for provenance. */
  raw: string
}

const INVITE_RE = /(?<![A-Za-z0-9.-])(?:https?:\/\/)?(?:www\.|ptb\.|canary\.)?(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/([A-Za-z0-9-]{2,32})(?![A-Za-z0-9-])/gi

/** discord.gg/CODE, discord.com/invite/CODE and discordapp.com/invite/CODE, with or without a scheme. Codes keep their case. */
export function extractInvites(text: string): TextHit<InviteHit>[] {
  const out: TextHit<InviteHit>[] = []
  for (const m of text.matchAll(INVITE_RE)) {
    const code = m[2]
    if (/^invite$/i.test(code) || /^(?:channels|login|app|api)$/i.test(code)) continue
    out.push({ value: { code, url: `https://discord.gg/${code}`, raw: m[0] }, index: m.index ?? 0 })
  }
  return out
}

/* ------------------------------------------------------------------ emails */

const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}(?![A-Za-z0-9@])/g

/** Addresses that appear verbatim in the text. Trailing dots are not part of an address. */
export function extractEmails(text: string): TextHit<string>[] {
  const out: TextHit<string>[] = []
  for (const m of text.matchAll(EMAIL_RE)) {
    const value = m[0].replace(/[.]+$/, '')
    // "name@host.png" and similar asset names are not addresses.
    if (/\.(?:png|jpe?g|gif|webp|svg|css|js|json)$/i.test(value)) continue
    out.push({ value, index: m.index ?? 0 })
  }
  return out
}

/* ------------------------------------------------------------------ links and handles */

export interface LinkHit {
  kind: ChannelKind
  /** Normalised handle or host, for dedupe and display: "misfitsbs", "UCabc...", "example.com". */
  handle: string
  /** Canonical link. */
  url: string
  /** The text as written, for provenance. */
  raw: string
}

const TWITTER_RESERVED = new Set(['home', 'intent', 'share', 'i', 'search', 'hashtag', 'explore', 'settings', 'login', 'signup', 'tos', 'privacy', 'about', 'messages', 'notifications', 'compose', 'status', 'download', 'jobs', 'support', 'help', 'oauth', 'account', 'twitter', 'x', 'en', 'games', 'card', 'site', 'creator', 'title', 'description', 'image', 'url', 'app', 'domain', 'widgets', 'privacy', 'whatshot'])
const INSTAGRAM_RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'about', 'direct', 'legal', 'developer', 'web'])
const TWITCH_RESERVED = new Set(['directory', 'videos', 'p', 'downloads', 'jobs', 'turbo', 'settings', 'login', 'signup', 'search', 'popout', 'embed'])
const FACEBOOK_RESERVED = new Set(['sharer', 'sharer.php', 'share', 'dialog', 'tr', 'plugins', 'login', 'policies', 'legal', 'help', 'groups', 'events', 'watch', 'photo', 'photo.php', 'permalink.php', 'story.php', 'login.php', 'l.php'])
const LINKHUBS = new Set(['linktr.ee', 'linkin.bio', 'beacons.ai', 'bio.link', 'lnk.bio', 'allmylinks.com', 'solo.to', 'carrd.co', 'campsite.bio', 'linkpop.com', 'taplink.cc', 'msha.ke', 'withkoji.com', 'tr.ee'])
/** A search-found handle counts only when it contains the game, group or owner name. */
export function handleMatches(handle: string, names: string[]): boolean {
  const h = normalizeName(handle).replace(/ /g, '')
  return names.some((n) => {
    const k = normalizeName(n).replace(/ /g, '')
    return k.length >= 5 && (h.includes(k) || (h.length >= 5 && k.includes(h)))
  })
}

/** Hosts that are never a contact point for the team. */
const IGNORED_HOSTS = /(?:^|\.)(?:roblox\.com|rbxcdn\.com|roblox\.fandom\.com|robloxlabs\.com|rblx\.co|w3\.org|schema\.org|google\.com|googleapis\.com|gstatic\.com|apple\.com|play\.google\.com|bing\.com|microsoft\.com|youtu\.be|giphy\.com|imgur\.com|tenor\.com|example\.com|localhost)$/i

const HANDLE_RE = /^[A-Za-z0-9_]{1,30}$/

/** Trailing sentence punctuation is not part of a link. */
const trimUrl = (s: string): string => s.replace(/[)\]}>'".,;:!?]+$/, '')

function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return u.hostname.includes('.') ? u : null
  } catch {
    return null
  }
}

/** Turns one URL into a channel, or null when it is not a contact point (a video, a share button, a Roblox page). */
export function classifyUrl(raw: string): LinkHit | null {
  const u = parseUrl(raw)
  if (!u) return null
  const host = u.hostname.toLowerCase().replace(/^(?:www|m|mobile|web)\./, '')
  const parts = u.pathname.split('/').filter(Boolean)
  const first = parts[0] ?? ''
  const mk = (kind: ChannelKind, handle: string, url: string): LinkHit => ({ kind, handle, url, raw })
  if (/^(?:discord\.gg|discord\.com|discordapp\.com)$/.test(host)) return null // invites have their own path
  if (host === 'twitter.com' || host === 'x.com') {
    const h = first.replace(/^@/, '')
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h) || TWITTER_RESERVED.has(h.toLowerCase())) return null
    return mk('twitter', h, `https://x.com/${h}`)
  }
  if (host === 'youtube.com') {
    if (first.startsWith('@') && /^@[A-Za-z0-9._-]{2,40}$/.test(first)) return mk('youtube', first, `https://www.youtube.com/${first}`)
    if ((first === 'channel' || first === 'c' || first === 'user') && parts[1] && /^[A-Za-z0-9._-]{2,60}$/.test(parts[1])) return mk('youtube', parts[1], `https://www.youtube.com/${first}/${parts[1]}`)
    return null
  }
  if (host === 'twitch.tv') {
    if (!/^[A-Za-z0-9_]{3,25}$/.test(first) || TWITCH_RESERVED.has(first.toLowerCase())) return null
    return mk('twitch', first, `https://www.twitch.tv/${first}`)
  }
  if (host === 'tiktok.com') {
    if (!/^@[A-Za-z0-9._]{2,30}$/.test(first)) return null
    return mk('tiktok', first, `https://www.tiktok.com/${first}`)
  }
  if (host === 'instagram.com') {
    if (!/^[A-Za-z0-9._]{2,30}$/.test(first) || INSTAGRAM_RESERVED.has(first.toLowerCase())) return null
    return mk('instagram', first, `https://www.instagram.com/${first}/`)
  }
  if (host === 'facebook.com' || host === 'fb.com' || host === 'fb.me') {
    if (!first || FACEBOOK_RESERVED.has(first.toLowerCase()) || !/^[A-Za-z0-9._-]{3,80}$/.test(first)) return null
    return mk('facebook', first, `https://www.facebook.com/${first}`)
  }
  if (host === 'guilded.gg' || host === 'guilded.com') {
    if (!first || !/^[A-Za-z0-9_-]{2,40}$/.test(first)) return null
    return mk('guilded', first, `https://www.guilded.gg/${first}`)
  }
  const apex = host.split('.').slice(-2).join('.')
  if (LINKHUBS.has(host) || LINKHUBS.has(apex)) {
    // carrd.co sites live on a subdomain; the others on a path.
    if (apex === 'carrd.co' && host !== 'carrd.co') return mk('linkhub', host, `https://${host}/`)
    if (!first || !/^[A-Za-z0-9._-]{2,50}$/.test(first)) return null
    return mk('linkhub', `${host}/${first}`, `https://${host}/${first}`)
  }
  if (IGNORED_HOSTS.test(host)) return null
  if (/\.(?:png|jpe?g|gif|webp|svg|mp4|mov|zip|rar|exe|dll|lua|rbxm|rbxl|pdf|css|js)$/i.test(u.pathname)) return null
  if (!/^[a-z0-9.-]+\.[a-z]{2,24}$/.test(host)) return null
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')
  return mk('website', `${host}${path}`, `${u.protocol}//${u.hostname}${path}`)
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi
const BARE_RE = /(?<![A-Za-z0-9@./_-])(?:www\.)?(?:twitter\.com|x\.com|youtube\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|fb\.com|guilded\.gg|linktr\.ee|linkin\.bio|beacons\.ai|bio\.link|lnk\.bio|allmylinks\.com|solo\.to|carrd\.co|ko-fi\.com|patreon\.com)\/[^\s<>"'`]*/gi
const KEYWORD_AT_RE = /(?<![A-Za-z0-9])(twitter|twt|x|instagram|insta|ig|tiktok|tik tok|tt|youtube|yt|twitch)\s*(?:[:=|-]|is|handle)?\s*@([A-Za-z0-9_.]{2,30})(?![A-Za-z0-9_.@])/gi
const KEYWORD_COLON_RE = /(?<![A-Za-z0-9])(twitter|instagram|tiktok|twitch|youtube)\s*[:=]\s*([A-Za-z0-9_.]{3,30})(?![A-Za-z0-9_@.])/gi

function fromKeyword(word: string, handle: string, raw: string): LinkHit | null {
  const w = word.toLowerCase().replace(/\s+/g, '')
  const h = handle.replace(/[._]+$/, '')
  if (h.length < 2) return null
  if (w === 'twitter' || w === 'twt' || w === 'x') {
    return /^[A-Za-z0-9_]{1,15}$/.test(h) && !TWITTER_RESERVED.has(h.toLowerCase()) ? { kind: 'twitter', handle: h, url: `https://x.com/${h}`, raw } : null
  }
  if (w === 'instagram' || w === 'insta' || w === 'ig') return /^[A-Za-z0-9._]{2,30}$/.test(h) ? { kind: 'instagram', handle: h, url: `https://www.instagram.com/${h}/`, raw } : null
  if (w === 'tiktok' || w === 'tt') return /^[A-Za-z0-9._]{2,30}$/.test(h) ? { kind: 'tiktok', handle: `@${h}`, url: `https://www.tiktok.com/@${h}`, raw } : null
  if (w === 'youtube' || w === 'yt') return /^[A-Za-z0-9._-]{2,40}$/.test(h) ? { kind: 'youtube', handle: `@${h}`, url: `https://www.youtube.com/@${h}`, raw } : null
  if (w === 'twitch') return /^[A-Za-z0-9_]{3,25}$/.test(h) ? { kind: 'twitch', handle: h, url: `https://www.twitch.tv/${h}`, raw } : null
  return null
}

/** Every social, link page and website the text names: full links, bare "x.com/name" forms and "twitter: @name" labels. */
export function extractLinks(text: string, opts: { keywords?: boolean } = {}): TextHit<LinkHit>[] {
  const out: TextHit<LinkHit>[] = []
  const seen = new Set<string>()
  const push = (hit: LinkHit | null, index: number) => {
    if (!hit) return
    const key = `${hit.kind}:${hit.handle.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ value: hit, index })
  }
  for (const m of text.matchAll(URL_RE)) push(classifyUrl(trimUrl(m[0])), m.index ?? 0)
  for (const m of text.matchAll(BARE_RE)) push(classifyUrl(trimUrl(m[0])), m.index ?? 0)
  // "twitter: @name" labels are only trusted in text a person wrote, never in page markup.
  if (opts.keywords !== false) {
    for (const m of text.matchAll(KEYWORD_AT_RE)) push(fromKeyword(m[1], m[2], m[0]), m.index ?? 0)
    for (const m of text.matchAll(KEYWORD_COLON_RE)) push(fromKeyword(m[1], m[2], m[0]), m.index ?? 0)
  }
  return out
}

/** Hosts whose pages list the owner's other channels and are worth reading once when the owner linked them. */
export const isLinkHub = (hit: LinkHit): boolean => hit.kind === 'linkhub'

/* ------------------------------------------------------------------ "my other accounts are ..." */

const ALT_CUE =
  /\b(?:(?:my|our)\s+)?(?:other|alt(?:ernate)?|second(?:ary)?|main|backup|old|new|extra)\s+(?:roblox\s+)?(?:accounts?|alts?|users?(?:names?)?)\s*(?:are|is|include|includes|:|-|=)?\s*|\balts?\s*[:=-]\s*|\balso\s+(?:play|on)\s+(?:as|on)\s+/gi
const ALT_STOP = new Set(['and', 'or', 'the', 'are', 'is', 'my', 'other', 'also', 'on', 'roblox', 'account', 'accounts', 'alt', 'alts', 'there', 'at', 'a', 'an', 'to', 'for', 'ok', 'etc', 'more', 'follow', 'me', 'dm', 'none', 'no', 'not', 'real', 'fake', 'main', 'new', 'old'])

/** Usernames the author lists right after a phrase like "my other accounts are". Only plain one-word names in a list count; the caller still checks each against Roblox. */
export function findAltUsernames(text: string, max = 8): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const cue of text.matchAll(ALT_CUE)) {
    const start = (cue.index ?? 0) + cue[0].length
    const tail = text.slice(start).split(/[.!?\n(]/)[0] ?? ''
    for (const piece of tail.split(/\s*(?:,|&|\/|\||\+|\band\b|\bor\b)\s*/i)) {
      const name = piece.trim().replace(/^@/, '').replace(/^["'`]|["'`]$/g, '')
      if (!/^[A-Za-z0-9_]{3,20}$/.test(name) || /^\d+$/.test(name) || ALT_STOP.has(name.toLowerCase()) || /^_|_$/.test(name)) continue
      const k = name.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      names.push(name)
      if (names.length >= max) return names
    }
  }
  return names
}

/* ------------------------------------------------------------------ roles */

export interface GroupRole {
  id: number
  name: string
  rank: number
  memberCount: number
  isBase?: boolean
}

export interface LeaderRole {
  role: GroupRole
  why: string
}

/** Most people a leader role may hold before it counts as a fan role instead of a team role. */
export const MAX_LEADER_ROLE_MEMBERS = 25

const LEADER_WORDS = new Set(['owner', 'coowner', 'founder', 'cofounder', 'admin', 'administrator', 'dev', 'developer', 'developers', 'devs', 'manager', 'management', 'lead', 'leader', 'leaders', 'head', 'director', 'ceo', 'cto', 'coo', 'executive', 'president', 'vp', 'chief', 'creator', 'founders', 'owners', 'admins'])

/** True when a role name says it is a leadership or owner role (Owner, Admin, Developer, Manager, Founder, Lead ...). */
export function roleNameSaysLeader(name: string): boolean {
  const flat = name.toLowerCase().replace(/[-_]/g, '')
  if (/co(?:owner|founder)/.test(flat)) return true
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => LEADER_WORDS.has(w))
}

/**
 * Which roles count as leadership: any role whose name says so, the highest-ranked role that has members, and any
 * populated role at rank 200 or above. Empty roles, the base member role and mass roles (over 25 members) never count.
 */
export function pickLeaderRoles(roles: GroupRole[]): LeaderRole[] {
  const populated = roles.filter((r) => r.memberCount > 0 && r.memberCount <= MAX_LEADER_ROLE_MEMBERS && !r.isBase && r.rank > 0)
  const picked = new Map<number, string>()
  for (const r of populated) if (roleNameSaysLeader(r.name)) picked.set(r.id, `The role is named ${r.name}`)
  const baseRank = roles.find((r) => r.isBase)?.rank ?? 1
  const byRank = populated.filter((r) => r.rank > baseRank).sort((a, b) => b.rank - a.rank || a.memberCount - b.memberCount || a.id - b.id)
  if (byRank[0] && !picked.has(byRank[0].id)) picked.set(byRank[0].id, `Highest rank with members (rank ${byRank[0].rank})`)
  for (const r of byRank) if (r.rank >= 200 && !picked.has(r.id)) picked.set(r.id, `Rank ${r.rank} of 255`)
  return roles.filter((r) => picked.has(r.id)).sort((a, b) => b.rank - a.rank || a.id - b.id).map((role) => ({ role, why: picked.get(role.id)! }))
}

/* ------------------------------------------------------------------ people */

export interface PersonLike {
  userId: number
  roles: { group: string; role: string; rank: number }[]
}

/** One entry per userId; a person holding several roles keeps every role once. */
export function dedupePeople<T extends PersonLike>(people: T[]): T[] {
  const byId = new Map<number, T>()
  for (const p of people) {
    const have = byId.get(p.userId)
    if (!have) {
      byId.set(p.userId, { ...p, roles: [...p.roles] })
      continue
    }
    for (const r of p.roles) if (!have.roles.some((x) => x.group === r.group && x.role === r.role)) have.roles.push(r)
  }
  return [...byId.values()]
}

/* ------------------------------------------------------------------ ranking */

export type Confidence = 'Linked by the owner' | 'Verified invite' | 'Found by search'

export interface RankInput {
  kind: ChannelKind | 'person'
  /** Whose channel it is: the owner, a leader, an alternate account, or nobody (search). */
  from: 'owner' | 'leader' | 'alt' | 'search'
  confidence: Confidence
  /** A Discord invite whose inviter shares a name with the owner or a leader. */
  inviterIsTeam?: boolean
  expired?: boolean
  members?: number | null
}

/**
 * Lower is better. 1 published email, 2 owner X/Twitter, 3 owner-linked Discord (or one whose inviter is the owner or a leader),
 * 4 the owner's other channels, 5 leaders' channels, 6 Discord servers found by search, 7 matches found only by search.
 * People rows sit after Discord servers found by search and before matches found only by search.
 */
export function rankOf(r: RankInput): number {
  const sub = r.from === 'owner' ? 0 : r.from === 'leader' ? 1 : r.from === 'alt' ? 2 : 3
  const size = r.members ? Math.min(0.09, r.members / 1e9) : 0
  let base: number
  if (r.kind === 'person') base = r.from === 'owner' ? 6.4 : r.from === 'leader' ? 6.5 : 6.6
  else if (r.from === 'search') base = r.kind === 'discord' ? 6 : 7
  else if (r.kind === 'email') base = 1
  else if (r.kind === 'twitter' && r.from === 'owner') base = 2
  else if (r.kind === 'discord' && (r.from === 'owner' || r.inviterIsTeam)) base = 3
  else base = r.from === 'owner' || r.from === 'alt' ? 4 : 5
  if (r.expired) base += 0.4
  return base + sub * 0.1 - size
}

/* ------------------------------------------------------------------ web search results */

export interface SearchResult {
  title: string
  url: string
  snippet: string
  query: string
}

/** Reads the <item> blocks of a Bing RSS answer. Titles and snippets are entity-decoded plain text. */
export function parseSearchRss(xml: string, query: string): SearchResult[] {
  const out: SearchResult[] = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const field = (name: string) => decodeEntities((new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(m[1])?.[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const url = field('link')
    if (!/^https?:\/\//i.test(url)) continue
    out.push({ title: field('title'), url, snippet: field('description'), query })
  }
  return out
}

/** Keeps invites and links that sit close to a mention of one of `names` in a page that is not written by the team (a wiki, a fan page). */
export function nearName(text: string, index: number, names: string[], radius = 500): boolean {
  const window = text.slice(Math.max(0, index - radius), index + radius)
  return names.some((n) => mentions(window, n))
}

/** HTML to readable text with links kept as plain "href text" so extractors can still see them. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/<script[\s\S]*?<\/script>/gi, (s) => ` ${s.replace(/<[^>]+>/g, ' ')} `)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<a\s[^>]*?href=["']([^"']+)["'][^>]*>/gi, ' $1 ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t\r\f\v]+/g, ' ')
}

/** Any generated string must be free of em dashes and middle dots (house style). */
export const houseStyle = (s: string): string => s.replace(/\u2014/g, ',').replace(/\u2013/g, '-').replace(/\u00b7/g, ',')

/** JSON.parse that also accepts raw line breaks and tabs inside strings, which Roblox sometimes sends in descriptions. */
export function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    /* fall through to the tolerant pass */
  }
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (escaped) {
      out += ch
      escaped = false
    } else if (ch === '\\') {
      out += ch
      escaped = true
    } else if (ch === '"') {
      inString = false
      out += ch
    } else {
      const code = ch.charCodeAt(0)
      out += code >= 0x20 ? ch : code === 10 ? '\\n' : code === 13 ? '\\r' : code === 9 ? '\\t' : `\\u${code.toString(16).padStart(4, '0')}`
    }
  }
  try {
    return JSON.parse(out)
  } catch {
    return null
  }
}
