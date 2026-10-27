/* Pure functions behind Creator Dox: name cleaning, exploit-promo filter, statistics, sponsorship detection, contact
   parsing and the fit score. No network, no LLM: every number is computed here from numbers the analyzer read, so the
   formula in the UI is the formula in this file. */
import type { CreatorFitComponent, CreatorTier, FlagConfidence } from '../../src/lib/details/creator.ts'

/* ---------------------------------------------------------------- game name */

/** "[UPDATE] 🥚 Steal An Egg! (BETA)" -> "Steal An Egg". Falls back to the original when nothing is left. */
export function cleanGameName(raw: string): string {
  let s = raw
    .replace(/\[[^\]]*\]|【[^】]*】|\([^)]*\)|\{[^}]*\}/g, ' ')
    .replace(/[\p{Extended_Pictographic}‍️]/gu, ' ')
    .replace(/[|:]\s.*$/, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/[!?]+\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length < 2) s = raw.replace(/\s+/g, ' ').trim()
  return s
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** A matcher for "this text is about the game": the normalised name as whole words, tolerating a plural. */
export function gameMatcher(name: string): (text: string | null | undefined) => boolean {
  const words = norm(name).split(' ').filter(Boolean)
  if (!words.length) return () => false
  const last = words[words.length - 1].replace(/s$/, '')
  const body = [...words.slice(0, -1), last].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(' ')
  const re = new RegExp(`(^| )${body}s?( |$)`)
  return (t) => (t ? re.test(norm(t)) : false)
}

/* ---------------------------------------------------------- exploit filter */

/** Titles that sell scripts, hacks and executors are not partners. */
export const EXPLOIT_RE = /\b(scripts?|hacks?|hacking|hacked|hackers?|exploit(?:s|ing|ed|er)?|executors?|no[ -]?key|keyless|cheats?|cheating|aimbot|mod menu|pastebin)\b/i

export const isExploitTitle = (t: string): boolean => EXPLOIT_RE.test(t)

/* -------------------------------------------------------------- statistics */

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

export function mean(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null
}

/** Median days between consecutive uploads, from approximate publish times (newest first or any order). */
export function cadenceDays(isoTimes: (string | null)[]): number | null {
  const t = isoTimes
    .map((x) => (x ? Date.parse(x) : NaN))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a)
  if (t.length < 3) return null
  const gaps: number[] = []
  for (let i = 0; i < t.length - 1; i++) gaps.push((t[i] - t[i + 1]) / 864e5)
  const m = median(gaps.map((g) => Math.round(g * 10)))
  return m === null ? null : m / 10
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

export interface SponsorCheck {
  sponsored: boolean
  /** Human-readable reason, with the creator's own words and no links. */
  disclosure: string
}

/** Sponsored when YouTube's paid-promotion label is set OR the title or description carries disclosure language. */
export function detectSponsored(title: string, description: string, paidPromotion: boolean): SponsorCheck {
  const hay = `${title}\n${description}`
  for (const d of DISCLOSURES) {
    const m = d.re.exec(hay)
    if (!m) continue
    const at = m.index
    const excerpt = stripUrls(hay.slice(Math.max(0, at - 30), at + 90)).replace(/\s+/g, ' ')
    const prefix = paidPromotion ? 'YouTube paid-promotion label; ' : ''
    return { sponsored: true, disclosure: `${prefix}"${excerpt}"` }
  }
  if (paidPromotion) return { sponsored: true, disclosure: 'YouTube paid-promotion label' }
  return { sponsored: false, disclosure: '' }
}

/** Percent difference of sponsored vs organic median, only with 3+ of each; otherwise null (never invented). */
export function sponsoredDeltaPct(sponsored: number[], organic: number[]): number | null {
  if (sponsored.length < 3 || organic.length < 3) return null
  const s = median(sponsored)
  const o = median(organic)
  if (s === null || o === null || o === 0) return null
  return Math.round(((s - o) / o) * 1000) / 10
}

/* ------------------------------------------------------------------ contact */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const CONTACT_LINE_RE = /business|inquir|enquir|sponsor|partnership|collab|contact|e-?mail|management|promo/i

/** Only what the creator published in the public channel description: an address in the text and the lines about contact. */
export function parseContact(description: string): { email: string | null; lines: string[] } {
  const emails = description.match(EMAIL_RE) ?? []
  const email: string | null = emails[0] ?? null
  const lines: string[] = []
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line || line.length < 4) continue
    if (EMAIL_RE.test(line) || CONTACT_LINE_RE.test(line)) {
      EMAIL_RE.lastIndex = 0
      const short = line.length > 160 ? `${line.slice(0, 157)}...` : line
      if (!lines.includes(short)) lines.push(short)
    }
    EMAIL_RE.lastIndex = 0
    if (lines.length >= 4) break
  }
  return { email, lines }
}

/* ---------------------------------------------------------------- fit score */

export const FIT_WEIGHTS = { coverage: 30, viewsPerSub: 25, sponsorship: 20, brandSafety: 15, cadence: 10 } as const

export const FULL_COVERAGE_SHARE = 0.3
export const FULL_VPS = 0.08
export const KEPT_VIEWS_RATIO = 0.7

export interface FitInput {
  game: string
  uploadsRead: number
  gameUploads: number
  gameShare: number
  median: number | null
  subscribers: number | null
  viewsPerSub: number | null
  sampled: number
  sponsored: number
  /** Median views of the sponsored samples and of the channel's last uploads (the yardstick). */
  sponsoredMedian: number | null
  channelMedian: number | null
  cadenceDays: number | null
  /** null when the brand-safety check did not run. */
  flags: { confidence: FlagConfidence }[] | null
  titlesChecked: number
}

const fmt = (n: number): string => n.toLocaleString('en-US')
const pct = (r: number, d = 0): string => `${(r * 100).toFixed(d)}%`
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

export function scoreFit(i: FitInput): { score: number; tier: CreatorTier; components: CreatorFitComponent[] } {
  const comps: CreatorFitComponent[] = []

  const cov = Math.round(FIT_WEIGHTS.coverage * clamp01(i.gameShare / FULL_COVERAGE_SHARE))
  comps.push({
    label: 'Coverage of the game',
    points: cov,
    max: FIT_WEIGHTS.coverage,
    basis: `${i.gameUploads} of the last ${i.uploadsRead} uploads are about ${i.game} (${pct(i.gameShare)}); full marks at ${pct(FULL_COVERAGE_SHARE)}.`,
  })

  const vps = i.viewsPerSub === null ? 0 : Math.round(FIT_WEIGHTS.viewsPerSub * clamp01(i.viewsPerSub / FULL_VPS))
  comps.push({
    label: 'Views per subscriber',
    points: vps,
    max: FIT_WEIGHTS.viewsPerSub,
    basis:
      i.viewsPerSub === null || i.median === null || i.subscribers === null
        ? 'Not available: the channel hides its subscriber count or no views were readable.'
        : `Median ${fmt(i.median)} views on ${fmt(i.subscribers)} subscribers is ${pct(i.viewsPerSub, 1)}; full marks at ${pct(FULL_VPS)}.`,
  })

  let spon = 0
  let sponBasis: string
  if (i.sampled === 0) {
    sponBasis = 'Not checked: YouTube did not serve any of the sampled watch pages, so no points are given.'
  } else if (i.sponsored === 0) {
    sponBasis = `No sponsored upload among the ${i.sampled} sampled, so no sponsorship track record is visible.`
  } else {
    spon += 10
    if (i.sponsoredMedian !== null && i.channelMedian && i.channelMedian > 0) {
      const kept = i.sponsoredMedian / i.channelMedian
      const bonus = kept >= KEPT_VIEWS_RATIO ? 10 : kept >= 0.4 ? 5 : 0
      spon += bonus
      sponBasis = `${i.sponsored} of ${i.sampled} sampled uploads are sponsored (10 points); their median ${fmt(i.sponsoredMedian)} views is ${pct(kept)} of the channel median ${fmt(i.channelMedian)} (${bonus} of 10 points: 70% or more keeps all 10, 40% or more keeps 5).`
    } else {
      sponBasis = `${i.sponsored} of ${i.sampled} sampled uploads are sponsored (10 points); views could not be compared with the channel median.`
    }
  }
  comps.push({ label: 'Sponsorship track record', points: spon, max: FIT_WEIGHTS.sponsorship, basis: sponBasis })

  let safe: number
  let safeBasis: string
  if (i.flags === null) {
    safe = 0
    safeBasis = 'The brand-safety check did not run, so no points are given.'
  } else {
    const deduct = i.flags.reduce((n, f) => n + (f.confidence === 'high' ? 15 : f.confidence === 'medium' ? 7 : 3), 0)
    safe = Math.max(0, FIT_WEIGHTS.brandSafety - deduct)
    safeBasis = i.flags.length
      ? `${i.flags.length} flag${i.flags.length === 1 ? '' : 's'} in ${i.titlesChecked} recent titles (high costs 15, medium 7, low 3 points).`
      : `No concerns found in ${i.titlesChecked} recent titles.`
  }
  comps.push({ label: 'Brand safety', points: safe, max: FIT_WEIGHTS.brandSafety, basis: safeBasis })

  let cad = 0
  const c = i.cadenceDays
  if (c !== null) cad = c <= 4 ? 10 : c <= 7 ? 8 : c <= 14 ? 5 : c <= 30 ? 2 : 0
  comps.push({
    label: 'Upload cadence',
    points: cad,
    max: FIT_WEIGHTS.cadence,
    basis:
      c === null
        ? 'Not available: too few uploads with readable ages.'
        : `${c < 1 ? 'The median gap between uploads is under 1 day' : `A new upload about every ${c} day${c === 1 ? '' : 's'} (median gap)`}, from approximate ages; 4 days or less keeps 10, 7 days 8, 14 days 5, 30 days 2.`,
  })

  const score = comps.reduce((n, x) => n + x.points, 0)
  const risky = (i.flags ?? []).some((f) => f.confidence === 'high')
  const tier: CreatorTier = risky ? 'Risky' : score >= 75 ? 'Strong fit' : score >= 55 ? 'Good fit' : 'Weak fit'
  return { score, tier, components: comps }
}

/* ---------------------------------------------------------------- formatting */

export function compact(n: number | null): string {
  if (n === null) return 'Hidden'
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
  return String(n)
}

export const groupedInt = fmt

/** The product has no em dashes or middle dots: LLM wording is normalised before it is shown. */
export function plain(s: string): string {
  return s
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/\u00b7/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
}
