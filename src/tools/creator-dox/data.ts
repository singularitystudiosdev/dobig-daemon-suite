/* Creator Dox datasets. Every creator, brand and channel here is fictional: the handles are
   invented, the channel ids are synthetic, and every business email sits on example.com.
   Nothing in this file models private data (no address, phone, family, school or precise
   location); the only real input a dossier describes is public channel analytics.

   Deterministic per game: every derived creator, upload and audience estimate comes from
   createRng('creator-dox-' + game.id), so a reload shows the same dossier. The four named
   records are hand-authored from the brief and attached to the game they cover. */

import { createRng, type Rng } from '@/lib/random'
import { fmtCompact, fmtPct } from '@/lib/format'
import { gamesById, type Game } from '@/data/games'

export const AS_OF = '2026-10-26'
export const REFRESHED_AT = '2026-10-26T09:00:00-06:00'

export type Grade = 'A++' | 'A+' | 'A' | 'B+' | 'B' | 'C'

export interface CreatorDossier {
  handle: string
  channelId: string
  grade: Grade
  sbRank: number
  subscribers: number
  totalViews: number
  uploads: number
  avgViews: number
  erOrganic: number
  erSponsored: number
  credibilityPct: number
  cqs: { total: number; influence: number; audience: number; credibility: number; engagement: number }
  earningsRangeUsd: [number, number]
  gameFitPct: Record<string, number>
  publicBusinessEmail?: string
  refreshedAt: string
  cadence: 'weekly' | 'monthly'
}

export interface UploadRow {
  videoId: string
  publishedAt: string
  title: string
  durationSec: number
  viewCount: number
  likeCount: number
  commentCount: number
  madeForKids: boolean
  hasPaidProductPlacement: boolean
  brandHandle?: string
  /** Short name of the Do Big game the upload features, when it features one. */
  game?: string
  /** True when the brand only appears in the description, with no API paid-placement flag. */
  detectedMention?: boolean
}

export type CollabFlag = 'tunes-out' | 'holds' | 'low-sample'

export interface BrandCollab {
  handle: string
  label: string
  videos: number
  er: number
  delta: number
  flag: CollabFlag
}

export interface AgeBand {
  band: string
  pct: number
}

export interface AudienceCountry {
  code: string
  name: string
  pct: number
}

export interface Lookalike {
  handle: string
  subscribers: number
  erOrganic: number
  fitPct: number
  overlapPct: number
}

export interface Creator {
  handle: string
  channelId: string
  dossier: CreatorDossier
  uploads: UploadRow[]
  ageBands: AgeBand[]
  countries: AudienceCountry[]
  lookalikes: Lookalike[]
  brandCollabs: BrandCollab[]
  talkingPoints: string[]
  growth90: number[]
}

/* Fictional brand accounts only. */
const BRANDS = [
  { handle: '@BloxbuckCards', label: 'Bloxbuck Gift Cards' },
  { handle: '@NovaGumCo', label: 'Nova Gum' },
  { handle: '@HatchlingSupply', label: 'Hatchling Supply Co' },
  { handle: '@PixelPopEnergy', label: 'Pixel Pop Energy' },
  { handle: '@CrateClub', label: 'Crate Club' },
] as const

export function brandLabel(handle: string): string {
  return BRANDS.find((b) => b.handle === handle)?.label ?? handle
}

export function isSponsored(row: UploadRow): boolean {
  return row.hasPaidProductPlacement || !!row.brandHandle
}

/** Engagement rate from public counters: (likes + comments) / views. */
export function uploadEr(row: UploadRow): number {
  return row.viewCount > 0 ? (row.likeCount + row.commentCount) / row.viewCount : 0
}

export function gradeFor(cqs: number): Grade {
  if (cqs >= 86) return 'A++'
  if (cqs >= 80) return 'A+'
  if (cqs >= 74) return 'A'
  if (cqs >= 66) return 'B+'
  if (cqs >= 58) return 'B'
  return 'C'
}

/**
 * Reach with two decimals in the millions band: 1.24M, 1.02M. Above ten million the extra
 * digit is noise, so the compact form is right. A reach figure is always a claim about the
 * audience, so it keeps the precision the dossier actually measured.
 */
export function fmtReach(n: number): string {
  if (n >= 1e6 && n < 1e7) {
    return `${(n / 1e6).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}M`
  }
  return fmtCompact(n)
}

export function sponsorDelta(d: Pick<CreatorDossier, 'erOrganic' | 'erSponsored'>): number {
  return d.erOrganic > 0 ? (d.erSponsored - d.erOrganic) / d.erOrganic : 0
}

/** Subscribers that read as human: the headline reach times the credibility share. */
export function realReach(d: Pick<CreatorDossier, 'subscribers' | 'credibilityPct'>): number {
  return Math.round(d.subscribers * (d.credibilityPct / 100))
}

const DAY_MS = 86_400_000

/** Fixed-offset ISO time, days before the demo clock (2026-10-26 15:00 MDT). */
function isoDaysAgo(days: number, hour = 17): string {
  const ms = Date.parse('2026-10-26T21:00:00Z') - Math.max(0, days) * DAY_MS
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}T${String(hour).padStart(2, '0')}:00:00-06:00`
}

function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? 'an' : 'a'
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s
}

function roundTo(n: number, step: number): number {
  return Math.max(step, Math.round(n / step) * step)
}

const OTHER_GAME_KEYS = [
  'steal-an-egg',
  'steal-a-brainrot',
  'fisch',
  'murderers-vs-sheriffs',
  'ride-a-pet',
  'fake-an-egg',
  'grow-a-garden',
  'blade-ball',
  'tower-defense-simulator',
  'blue-lock-rivals',
  'a-dusty-trip',
  'knife-duels',
]

/* ---------- uploads ---------- */

function titleFor(game: Game, rng: Rng, brand?: string): string {
  const noun = game.noun
  const short = game.shortName
  if (brand) {
    return rng.pick([
      `${brand} sent me a crate of ${noun} in ${short}`,
      `I gave away ${brand} codes for ${article(noun)} ${noun} hunt in ${short}`,
      `${short} but every ${noun} is sponsored by ${brand}`,
    ])
  }
  return rng.pick([
    `I STOLE the RAREST ${noun} in ${short}`,
    `${short} but every ${noun} is rare`,
    `Testing the NEW ${noun} update in ${short}`,
    `The fastest ${noun} run in ${short}`,
    `I spent 24 hours in ${short}`,
    `${short} with a hundred ${noun} and no help`,
    `This ${noun} trick broke ${short}`,
    `Ranking every ${noun} in ${short}`,
    `New player to pro in ${short}`,
    `The ${noun} everyone wants in ${short}`,
    `${short} but I can only use one ${noun}`,
    `Stealing ${article(noun)} ${noun} from the best ${short} player`,
    `I unlocked the rarest ${noun} in ${short}`,
    `${short} update day, everything new in 12 minutes`,
    `The ${noun} tier list nobody asked for`,
  ])
}

interface UploadInput {
  game: Game
  rng: Rng
  avgViews: number
  erOrganic: number
  erSponsored: number
  fitPct: number
  apiPaidCount: number
  others: string[]
}

function buildUploads({ game, rng, avgViews, erOrganic, erSponsored, fitPct, apiPaidCount, others }: UploadInput): UploadRow[] {
  const paidIndexes = new Set<number>()
  while (paidIndexes.size < Math.min(8, apiPaidCount)) paidIndexes.add(rng.int(0, 47))
  const rows: UploadRow[] = []
  const inGameCount = Math.round((48 * fitPct) / 100)

  for (let i = 0; i < 48; i++) {
    const apiPaid = paidIndexes.has(i)
    const mentionBrand = !apiPaid && rng.chance(0.07) ? rng.pick(BRANDS) : undefined
    const brand = apiPaid ? rng.pick(BRANDS) : mentionBrand
    const sponsored = !!brand
    const er = sponsored ? erSponsored : erOrganic
    const viewCount = Math.max(900, roundTo(rng.normal(avgViews, avgViews * 0.5), 10))
    const interactions = Math.max(6, Math.round(viewCount * er * rng.float(0.86, 1.14)))
    const commentCount = Math.max(1, Math.round(interactions * rng.float(0.06, 0.14)))
    const likeCount = Math.max(commentCount + 1, interactions - commentCount)
    const otherGame = rng.pick(others)
    rows.push({
      videoId: rng.id(11),
      publishedAt: isoDaysAgo(i * 2.6 + rng.float(0.3, 1.8), rng.int(13, 21)),
      title: titleFor(game, rng, brand?.label),
      durationSec: rng.int(214, 1512),
      viewCount,
      likeCount,
      commentCount,
      madeForKids: rng.chance(0.18),
      hasPaidProductPlacement: apiPaid,
      brandHandle: brand?.handle,
      game: i < inGameCount ? game.shortName : otherGame,
      detectedMention: !!mentionBrand,
    })
  }
  return rows
}

/** The hero upload the brief describes, and the one Description Daemon reads on the bus. */
const HERO_UPLOAD: UploadRow = {
  videoId: 'kQ7r2Egg9Fz',
  publishedAt: '2026-10-22T17:00:00-06:00',
  title: 'I STOLE the RAREST egg (Steal An Egg)',
  durationSec: 852,
  viewCount: 241880,
  likeCount: 4682,
  commentCount: 396,
  madeForKids: false,
  hasPaidProductPlacement: true,
  brandHandle: '@BloxbuckCards',
  game: 'Steal An Egg',
}

/* ---------- audience + collabs ---------- */

const AGE_SHAPE = [38, 30, 17, 9, 6]
const AGE_LABELS = ['13-17', '18-24', '25-34', '35-44', '45 and over']
const COUNTRY_SHAPE: Array<[string, string, number]> = [
  ['US', 'United States', 34],
  ['GB', 'United Kingdom', 11],
  ['CA', 'Canada', 8],
  ['AU', 'Australia', 6],
  ['PH', 'Philippines', 5],
  ['BR', 'Brazil', 4],
  ['DE', 'Germany', 3],
  ['IN', 'India', 3],
]

function buildAgeBands(rng: Rng): AgeBand[] {
  const raw = AGE_SHAPE.map((v) => Math.max(2, v + rng.float(-4, 4)))
  const total = raw.reduce((a, b) => a + b, 0)
  const pct = raw.map((v) => Math.round((v / total) * 100))
  pct[0] += 100 - pct.reduce((a, b) => a + b, 0)
  return AGE_LABELS.map((band, i) => ({ band, pct: pct[i] }))
}

function buildCountries(rng: Rng): AudienceCountry[] {
  const raw = COUNTRY_SHAPE.map(([code, name, base]) => ({ code, name, pct: Math.max(1, Math.round(base * rng.float(0.72, 1.3))) }))
  const known = raw.reduce((a, b) => a + b.pct, 0)
  const otherPct = Math.max(6, 100 - known)
  const total = known + otherPct
  const scaled = raw.map((c) => ({ ...c, pct: Math.round((c.pct / total) * 100) }))
  const used = scaled.reduce((a, b) => a + b.pct, 0)
  return [...scaled, { code: 'ZZ', name: 'Other countries', pct: Math.max(0, 100 - used) }]
}

function buildBrandCollabs(uploads: UploadRow[], erOrganic: number): BrandCollab[] {
  const agg = new Map<string, { views: number; interactions: number; videos: number }>()
  for (const u of uploads) {
    if (!u.brandHandle) continue
    const cur = agg.get(u.brandHandle) ?? { views: 0, interactions: 0, videos: 0 }
    cur.views += u.viewCount
    cur.interactions += u.likeCount + u.commentCount
    cur.videos += 1
    agg.set(u.brandHandle, cur)
  }
  return [...agg.entries()]
    .map(([handle, v]) => {
      const er = v.views > 0 ? v.interactions / v.views : 0
      const delta = erOrganic > 0 ? (er - erOrganic) / erOrganic : 0
      const flag: CollabFlag = v.videos < 3 ? 'low-sample' : delta <= -0.25 ? 'tunes-out' : 'holds'
      return { handle, label: brandLabel(handle), videos: v.videos, er, delta, flag }
    })
    .sort((a, b) => b.videos - a.videos)
}

const HAND_PREFIX = ['Pixel', 'Turbo', 'Nova', 'Blaze', 'Echo', 'Frost', 'Rocket', 'Cobalt', 'Mango', 'Hyper', 'Quiet', 'Sunny']
const HAND_SUFFIX = ['Plays', 'Files', 'Frenzy', 'Lab', 'Daily', 'Vault', 'Squad', 'Club', 'Loop', 'Cast', 'Rush', 'HQ']

function derivedHandle(game: Game, rng: Rng, used: Set<string>): string {
  const noun = capitalize(game.noun.replace(/[^a-z]/gi, '').toLowerCase())
  for (let attempt = 0; attempt < 24; attempt++) {
    const style = rng.int(0, 2)
    const candidate =
      style === 0
        ? `${noun}${rng.pick(HAND_SUFFIX)}`
        : style === 1
          ? `${rng.pick(HAND_PREFIX)}${noun}`
          : `${rng.pick(HAND_PREFIX)}${rng.pick(HAND_SUFFIX)}`
    const handle = `@${candidate}`
    if (!used.has(handle)) return handle
  }
  return `@${rng.pick(HAND_PREFIX)}${noun}${rng.int(2, 99)}`
}

function buildLookalikes(game: Game, creatorHandle: string, subscribers: number, erOrganic: number, fitPct: number): Lookalike[] {
  const rng = createRng(`creator-dox-lookalikes-${game.id}-${creatorHandle}`)
  const used = new Set<string>()
  return Array.from({ length: 5 }, () => {
    const handle = derivedHandle(game, rng, used)
    used.add(handle)
    return {
      handle,
      subscribers: Math.max(9000, roundTo(subscribers * rng.float(0.35, 1.6), 1000)),
      erOrganic: Math.max(0.012, erOrganic * rng.float(0.72, 1.3)),
      fitPct: Math.min(97, Math.max(12, Math.round(fitPct * rng.float(0.7, 1.25)))),
      overlapPct: rng.int(46, 79),
    }
  })
}

function buildGameFit(game: Game, fitPct: number, rng: Rng): Record<string, number> {
  const others = OTHER_GAME_KEYS.filter((k) => k !== game.id && gamesById[k])
  const picked = rng.shuffle(others).slice(0, 3)
  const rest = Math.max(0, 100 - fitPct)
  const weights = [0.42, 0.31, 0.18]
  const out: Record<string, number> = { [game.id]: fitPct }
  let used = 0
  picked.forEach((id, i) => {
    const value = Math.round(rest * weights[i])
    out[id] = value
    used += value
  })
  out.other = Math.max(0, rest - used)
  return out
}

function buildGrowth(avgViews: number, rng: Rng): number[] {
  const out: number[] = []
  let v = avgViews * rng.float(0.76, 0.94)
  for (let i = 0; i < 89; i++) {
    v = v * rng.float(0.986, 1.021)
    out.push(Math.round(v))
  }
  out.push(avgViews)
  return out
}

function buildTalkingPoints(game: Game, d: CreatorDossier, delta: number): string[] {
  const points: string[] = []
  points.push(
    `${d.gameFitPct[game.id] ?? 0}% of their last 48 uploads already cover ${game.shortName}, so no introduction video is needed.`,
  )
  if (delta <= -0.25) {
    points.push(
      `Sponsored uploads engage ${Math.abs(Math.round(delta * 100))}% below organic. Offer a flat fee and cap any performance bonus.`,
    )
  } else {
    points.push(
      `Sponsored uploads hold ${Math.abs(Math.round(delta * 100))}% of organic engagement, so a performance bonus is safe to offer.`,
    )
  }
  points.push(
    `Ask for one mid-roll inside their next ${game.shortName} video, the format that carries their ${fmtCompact(d.avgViews)} average views.`,
  )
  points.push(
    `Send the brief through ${d.publicBusinessEmail ?? 'their public business email'}, never to a personal inbox.`,
  )
  points.push(
    `Expect about ${fmtReach(realReach(d))} real viewers of ${fmtReach(d.subscribers)} subscribers. Price the deal on the real number.`,
  )
  return points
}

/* ---------- creators ---------- */

interface NamedSpec {
  handle: string
  subscribers: number
  totalViews: number
  uploads: number
  avgViews: number
  erOrganic: number
  erSponsored: number
  credibilityPct: number
  cqs: number
  sbRank: number
  earnings: [number, number]
  fitPct: number
  apiPaidCount: number
}

/** The four records the brief names, each attached to the game it covers. */
const NAMED: Record<string, NamedSpec> = {
  'steal-an-egg': {
    handle: '@EggHeistHenry',
    subscribers: 1_240_000,
    totalViews: 486_240_000,
    uploads: 412,
    avgViews: 182_000,
    erOrganic: 0.064,
    erSponsored: 0.021,
    credibilityPct: 82,
    cqs: 78,
    sbRank: 14_882,
    earnings: [4_100, 66_000],
    fitPct: 71,
    apiPaidCount: 5,
  },
  fisch: {
    handle: '@ReelRonan',
    subscribers: 386_000,
    totalViews: 128_400_000,
    uploads: 268,
    avgViews: 64_000,
    erOrganic: 0.079,
    erSponsored: 0.071,
    credibilityPct: 91,
    cqs: 84,
    sbRank: 41_230,
    earnings: [1_280, 22_400],
    fitPct: 88,
    apiPaidCount: 4,
  },
  'steal-a-brainrot': {
    handle: '@BrainrotBlitz',
    subscribers: 6_800_000,
    totalViews: 2_940_000_000,
    uploads: 640,
    avgViews: 1_900_000,
    erOrganic: 0.032,
    erSponsored: 0.029,
    credibilityPct: 74,
    cqs: 69,
    sbRank: 2_210,
    earnings: [38_000, 665_000],
    fitPct: 40,
    apiPaidCount: 6,
  },
  'murderers-vs-sheriffs': {
    handle: '@SheriffSnipesYT',
    subscribers: 92_000,
    totalViews: 24_600_000,
    uploads: 156,
    avgViews: 28_000,
    erOrganic: 0.051,
    erSponsored: 0.039,
    credibilityPct: 95,
    cqs: 61,
    sbRank: 96_400,
    earnings: [560, 9_800],
    fitPct: 63,
    apiPaidCount: 2,
  },
}

function channelIdFor(handle: string, rng: Rng): string {
  const clean = handle.replace(/^@/, '')
  const prefix = clean.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'X')
  return `UC${prefix}${rng.id(12, 'abcdefghijklmnopqrstuvwxyz0123456789')}7Fz`
}

function dossierFromSpec(game: Game, spec: NamedSpec, rng: Rng, others: string[]): CreatorDossier {
  const cqs = {
    total: spec.cqs,
    influence: Math.min(97, spec.cqs + 3),
    audience: Math.min(97, Math.max(40, spec.cqs - 4)),
    credibility: spec.credibilityPct,
    engagement: Math.min(97, spec.cqs + 1),
  }
  return {
    handle: spec.handle,
    channelId: game.id === 'steal-an-egg' ? 'UCq3kRt9mEggHeists7Fz' : channelIdFor(spec.handle, rng),
    grade: gradeFor(spec.cqs),
    sbRank: spec.sbRank,
    subscribers: spec.subscribers,
    totalViews: spec.totalViews,
    uploads: spec.uploads,
    avgViews: spec.avgViews,
    erOrganic: spec.erOrganic,
    erSponsored: spec.erSponsored,
    credibilityPct: spec.credibilityPct,
    cqs,
    earningsRangeUsd: spec.earnings,
    gameFitPct: buildGameFit(game, spec.fitPct, rng),
    publicBusinessEmail: `partnerships@${spec.handle.replace(/^@/, '').toLowerCase()}.example.com`,
    refreshedAt: REFRESHED_AT,
    cadence: 'weekly',
  }
}

function derivedDossier(game: Game, rng: Rng, others: string[], used: Set<string>): CreatorDossier {
  const handle = derivedHandle(game, rng, used)
  const subscribers = roundTo(rng.float(28_000, 3_400_000), 1_000)
  const avgViews = roundTo(subscribers * rng.float(0.06, 0.85), 100)
  const erOrganic = Number(rng.float(0.031, 0.086).toFixed(4))
  const erSponsored = Number((erOrganic * rng.float(0.55, 0.95)).toFixed(4))
  const credibilityPct = rng.int(66, 96)
  const total = rng.int(52, 88)
  const cqs = {
    total,
    influence: Math.min(97, Math.max(38, total + rng.int(-8, 8))),
    audience: Math.min(97, Math.max(38, total + rng.int(-9, 7))),
    credibility: credibilityPct,
    engagement: Math.min(97, Math.max(38, total + rng.int(-7, 9))),
  }
  const fitPct = rng.int(22, 92)
  const monthlyViews = avgViews * 4
  const low = roundTo(Math.max(240, monthlyViews * 0.0006), 100)
  const high = roundTo(Math.max(low * 4, monthlyViews * 0.009), 500)
  return {
    handle,
    channelId: channelIdFor(handle, rng),
    grade: gradeFor(total),
    sbRank: Math.max(180, Math.round(rng.float(400, 240_000))),
    subscribers,
    totalViews: roundTo(subscribers * rng.float(40, 300), 1_000),
    uploads: rng.int(90, 720),
    avgViews,
    erOrganic,
    erSponsored,
    credibilityPct,
    cqs,
    earningsRangeUsd: [low, high],
    gameFitPct: buildGameFit(game, fitPct, rng),
    publicBusinessEmail: `partnerships@${handle.replace(/^@/, '').toLowerCase()}.example.com`,
    refreshedAt: REFRESHED_AT,
    cadence: 'weekly',
  }
}

function assemble(game: Game, dossier: CreatorDossier, rng: Rng, others: string[], apiPaidCount: number): Creator {
  let uploads = buildUploads({
    game,
    rng,
    avgViews: dossier.avgViews,
    erOrganic: dossier.erOrganic,
    erSponsored: dossier.erSponsored,
    fitPct: dossier.gameFitPct[game.id] ?? 40,
    apiPaidCount,
    others,
  })
  if (game.id === 'steal-an-egg' && dossier.handle === '@EggHeistHenry') {
    uploads[2] = HERO_UPLOAD
  }
  uploads.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  return {
    handle: dossier.handle,
    channelId: dossier.channelId,
    dossier,
    uploads,
    ageBands: buildAgeBands(rng),
    countries: buildCountries(rng),
    lookalikes: buildLookalikes(game, dossier.handle, dossier.subscribers, dossier.erOrganic, dossier.gameFitPct[game.id] ?? 40),
    brandCollabs: buildBrandCollabs(uploads, dossier.erOrganic),
    talkingPoints: buildTalkingPoints(game, dossier, sponsorDelta(dossier)),
    growth90: buildGrowth(dossier.avgViews, rng),
  }
}

/**
 * The four suggested creators for a game. The first is the hand-authored record for that
 * game where the brief names one; the rest are derived from the game id seed so every game
 * reads coherently (its own noun, its own game name, its own audience shape).
 */
export function creatorsFor(game: Game): Creator[] {
  const used = new Set<string>()
  const rng = createRng(`creator-dox-${game.id}`)
  const others = OTHER_GAME_KEYS.map((id) => gamesById[id]?.shortName).filter(Boolean) as string[]
  const list: Creator[] = []
  const named = NAMED[game.id]
  if (named) {
    used.add(named.handle)
    list.push(assemble(game, dossierFromSpec(game, named, rng, others), rng, others, named.apiPaidCount))
  }
  while (list.length < 4) {
    const d = derivedDossier(game, rng, others, used)
    used.add(d.handle)
    list.push(assemble(game, d, rng, others, rng.int(1, 5)))
  }
  return list
}

/** Case-insensitive lookup among the four suggested creators, with or without the @. */
export function findCreator(creators: Creator[], input: string): Creator | undefined {
  const needle = input.trim().replace(/^@/, '').toLowerCase()
  if (!needle) return undefined
  return creators.find((c) => c.handle.replace(/^@/, '').toLowerCase() === needle)
}

export function gameName(id: string): string {
  if (id === 'other') return 'Other Roblox titles'
  return gamesById[id]?.shortName ?? 'Other Roblox titles'
}

export function collabFlagText(flag: CollabFlag): string {
  if (flag === 'tunes-out') return 'Audience tunes out'
  if (flag === 'holds') return 'Holds engagement'
  return 'Low sample'
}

/** The one-line comparison the studio pays for. */
export function sponsorHeadline(d: CreatorDossier): string {
  const delta = sponsorDelta(d)
  const pct = `${Math.round(delta * 100)}%`
  if (delta <= -0.25) return `${pct} on sponsored: audience tunes out ads`
  return `${pct} on sponsored: audience stays engaged`
}

export function summaryLine(c: Creator, game: Game): string {
  return `${c.dossier.grade} grade, ${fmtReach(c.dossier.subscribers)} subscribers, ${fmtPct(c.dossier.erOrganic)} organic engagement and ${c.dossier.gameFitPct[game.id] ?? 0}% ${game.shortName} fit.`
}
