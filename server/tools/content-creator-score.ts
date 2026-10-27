/* Pure functions behind the Content Creator Daemon: name cleaning, the exploit filter, statistics, sponsorship detection and the
   fit score. No network and no LLM: every number is computed here from numbers the analyzer read, so the formula the
   view describes is the formula in this file.
   Scoring differs from the old Creator Dox ranker on purpose: that one gave daily uploaders full marks for coverage and
   cadence, so the top of a list was a wall of 80s. Here coverage is capped at a share of the last 24 uploads, cadence is
   gone, and most points go to views per subscriber (on a log scale, so 2% and 8% are told apart) and to how well the
   channel matches the genre. */
import type { ContentCreatorFitComponent, ContentCreatorTier } from '../../src/lib/details/content-creator.ts'

/* ---------------------------------------------------------------- game name */

/** "[UPDATE] 🥚 Steal An Egg! (BETA)" -> "Steal An Egg". Falls back to the original when nothing is left. */
export function cleanGameName(raw: string): string {
  let s = raw
    .replace(/\[[^\]]*\]|【[^】]*】|\([^)]*\)|\{[^}]*\}/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, ' ')
    .replace(/[|:]\s.*$/, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/[!?]+\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length < 2) s = raw.replace(/\s+/g, ' ').trim()
  return s
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** A matcher for "this text is about the game": the normalised name as whole words, tolerating a plural. */
export function gameMatcher(name: string): (text: string | null | undefined) => boolean {
  const words = norm(name).split(' ').filter(Boolean)
  if (!words.length) return () => false
  const last = words[words.length - 1].replace(/s$/, '')
  const body = [...words.slice(0, -1), last].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(' ')
  const re = new RegExp(`(^| )${body}s?( |$)`)
  return (t) => (t ? re.test(norm(t)) : false)
}

const GENERIC = new Set(['roblox', 'game', 'games', 'video', 'videos', 'new', 'best', 'the', 'and', 'for', 'update', 'gameplay'])

/** A matcher for "this text is about games like this one": a whole search phrase, or two of the genre keywords. */
export function genreMatcher(phrases: string[], keywords: string[]): (text: string | null | undefined) => boolean {
  const ps = phrases.map(norm).filter((p) => p.split(' ').length >= 2)
  const ks = [...new Set(keywords.map(norm).filter((k) => k.length >= 4 && !GENERIC.has(k)))]
  return (t) => {
    if (!t) return false
    const n = ` ${norm(t)} `
    if (ps.some((p) => n.includes(` ${p} `))) return true
    let hits = 0
    for (const k of ks) if (n.includes(` ${k} `) || n.includes(` ${k}s `)) hits++
    return hits >= 2
  }
}

/* ---------------------------------------------------------- exploit filter */

/** Titles and channel names that sell scripts, hacks and executors are not partners. */
export const EXPLOIT_RE = /\b(scripts?|hacks?|hacking|hacked|hackers?|exploit(?:s|ing|ed|er)?|executors?|no[ -]?key|keyless|cheats?|cheating|aimbot|mod menu|pastebin)\b/i

export const isExploitTitle = (t: string): boolean => EXPLOIT_RE.test(t)

/** A channel is an exploit channel when its own name says so, or when many of the titles found for it do. */
export function isExploitChannel(name: string, titles: string[]): boolean {
  if (EXPLOIT_RE.test(name)) return true
  const bad = titles.filter(isExploitTitle).length
  return bad >= 2 || (titles.length >= 2 && bad / titles.length >= 0.5)
}

/* -------------------------------------------------------------- statistics */

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/* ------------------------------------------------------------- sponsorship */

const DISCLOSURES: { re: RegExp; label: string }[] = [
  { re: /(^|[\s(])#ad\b/i, label: '#ad' },
  { re: /\bsponsored\b/i, label: 'sponsored' },
  { re: /\bpaid promotion\b/i, label: 'paid promotion' },
  { re: /\b(?:partnered with|in partnership with)\b/i, label: 'partnered with' },
  { re: /\buse code\b/i, label: 'use code' },
  { re: /\baffiliate\b/i, label: 'affiliate' },
]

const stripUrls = (s: string): string => s.replace(/https?:\/\/\S+|\bwww\.\S+/gi, '').replace(/\s+/g, ' ').trim()

export interface ContentCreatorCheck {
  sponsored: boolean
  /** Human-readable reason, with the creator's own words and no links. */
  disclosure: string
}

/** Sponsored when YouTube's paid-promotion label is set OR the title or description carries disclosure language. */
export function detectSponsored(title: string, description: string, paidPromotion: boolean): ContentCreatorCheck {
  const hay = `${title}\n${description}`
  for (const d of DISCLOSURES) {
    const m = d.re.exec(hay)
    if (!m) continue
    const excerpt = stripUrls(hay.slice(Math.max(0, m.index - 30), m.index + 90))
    return { sponsored: true, disclosure: `${paidPromotion ? 'YouTube paid-promotion label; ' : ''}"${excerpt}"` }
  }
  if (paidPromotion) return { sponsored: true, disclosure: 'YouTube paid-promotion label' }
  return { sponsored: false, disclosure: '' }
}

/* ---------------------------------------------------------------- fit score */

export const FIT_WEIGHTS = { game: 15, genre: 15, reach: 30, sponsorship: 20, safety: 20 } as const
/** Full marks for covering the game at this share of the last 24 uploads (6 of 24). A daily uploader cannot go past it. */
export const GAME_SHARE_CAP = 0.25
/** Full marks for covering games like this at this share of the recent uploads. */
export const GENRE_SHARE_CAP = 0.4
/** Views per subscriber on a log scale: nothing at 0.5%, full marks at 15%. */
export const REACH_LOW = 0.005
export const REACH_HIGH = 0.15
export const KEPT_VIEWS_RATIO = 0.7
export const STRONG_AT = 68
export const GOOD_AT = 48

export interface FitInput {
  game: string
  uploadsRead: number
  gameUploads: number
  gameUploads30d: number
  /** Uploads about games like this one that are not about the game itself. */
  similarUploads: number
  median: number | null
  subscribers: number | null
  viewsPerSub: number | null
  sampled: number
  sponsored: number
  sponsoredMedian: number | null
  channelMedian: number | null
  /** null when the brand-safety check did not run. */
  flags: { confidence: 'low' | 'medium' | 'high' }[] | null
  titlesChecked: number
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
const pct = (r: number, d = 0): string => `${(r * 100).toFixed(d)}%`

export function compact(n: number | null): string {
  if (n === null) return 'Hidden'
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`.replace('.0B', 'B')
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`.replace('.0M', 'M')
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`.replace('.0K', 'K')
  return String(n)
}

export const groupedInt = (n: number): string => n.toLocaleString('en-US')

export function scoreFit(i: FitInput): { score: number; tier: ContentCreatorTier; components: ContentCreatorFitComponent[] } {
  const comps: ContentCreatorFitComponent[] = []
  const n = Math.max(i.uploadsRead, 1)

  const gameShare = i.gameUploads / n
  let game = Math.round(FIT_WEIGHTS.game * clamp01(gameShare / GAME_SHARE_CAP))
  if (i.gameUploads > 0 && i.gameUploads30d === 0) game = Math.round(game * 0.7)
  comps.push({
    key: 'game',
    label: 'Covers your game',
    points: game,
    max: FIT_WEIGHTS.game,
    line:
      i.gameUploads === 0
        ? `None of the last ${i.uploadsRead} uploads are about ${i.game}.`
        : `${i.gameUploads} of the last ${i.uploadsRead} uploads are about ${i.game}${i.gameUploads30d === 0 ? ', none in the last 30 days' : ''}.`,
  })

  const genre = Math.round(FIT_WEIGHTS.genre * clamp01(i.similarUploads / n / GENRE_SHARE_CAP))
  comps.push({
    key: 'genre',
    label: 'Covers similar games',
    points: genre,
    max: FIT_WEIGHTS.genre,
    line: i.similarUploads === 0 ? 'No recent upload is about similar games.' : `${i.similarUploads} of the last ${i.uploadsRead} uploads are about games like ${i.game}.`,
  })

  const vps = i.viewsPerSub
  const reach = vps === null || vps <= 0 ? 0 : Math.round(FIT_WEIGHTS.reach * clamp01(Math.log10(vps / REACH_LOW) / Math.log10(REACH_HIGH / REACH_LOW)))
  comps.push({
    key: 'reach',
    label: 'Views for their size',
    points: reach,
    max: FIT_WEIGHTS.reach,
    line:
      vps === null || i.median === null || i.subscribers === null
        ? 'Not available: the channel hides its subscriber count or no views were readable.'
        : `A typical video gets ${compact(i.median)} views on ${compact(i.subscribers)} subscribers (${pct(vps, 1)}).`,
  })

  let spon = 0
  let sponLine: string
  if (i.sampled === 0) {
    sponLine = 'Not checked: YouTube did not serve the video pages that carry this.'
  } else if (i.sponsored === 0) {
    spon = 4
    sponLine = `None of ${i.sampled} recent videos carry a paid-promotion label or disclosure words.`
  } else {
    spon = 10
    if (i.sponsoredMedian !== null && i.channelMedian && i.channelMedian > 0) {
      const kept = i.sponsoredMedian / i.channelMedian
      spon += kept >= KEPT_VIEWS_RATIO ? 10 : kept >= 0.4 ? 5 : 0
      sponLine = `${i.sponsored} of ${i.sampled} recent videos are labelled or disclosed as sponsored, and they keep ${pct(Math.min(kept, 9.99))} of the usual views.`
    } else {
      sponLine = `${i.sponsored} of ${i.sampled} recent videos are labelled or disclosed as sponsored.`
    }
  }
  comps.push({ key: 'sponsorship', label: 'Past sponsorships', points: spon, max: FIT_WEIGHTS.sponsorship, line: sponLine })

  let safe: number
  let safeLine: string
  if (i.flags === null) {
    safe = 0
    safeLine = 'The brand-safety check did not run, so no points are given.'
  } else {
    const deduct = i.flags.reduce((t, f) => t + (f.confidence === 'high' ? 20 : f.confidence === 'medium' ? 10 : 4), 0)
    safe = Math.max(0, FIT_WEIGHTS.safety - deduct)
    safeLine = i.flags.length ? `${i.flags.length} concern${i.flags.length === 1 ? '' : 's'} in ${i.titlesChecked} recent titles.` : `No concerns in ${i.titlesChecked} recent titles.`
  }
  comps.push({ key: 'safety', label: 'Brand safety', points: safe, max: FIT_WEIGHTS.safety, line: safeLine })

  const score = comps.reduce((t, c) => t + c.points, 0)
  const risky = (i.flags ?? []).some((f) => f.confidence === 'high')
  const tier: ContentCreatorTier = risky ? 'Risky' : score >= STRONG_AT ? 'Strong fit' : score >= GOOD_AT ? 'Good fit' : 'Weak fit'
  return { score, tier, components: comps }
}

/* ---------------------------------------------------------------- formatting */

/** The product has no em dashes or middle dots: LLM wording is normalised before it is shown. */
export function plain(s: string): string {
  return s
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/\u00b7/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Percent change between two numbers, rounded; null when the earlier one is not usable. */
export function pctChange(before: number | null | undefined, after: number | null): number | null {
  if (before === null || before === undefined || after === null || before <= 0) return null
  return Math.round(((after - before) / before) * 100)
}
