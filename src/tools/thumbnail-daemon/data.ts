/* Thumbnail Daemon data: the contextual-bandit run script, the variant records, the segment
   matrix, the simulated 14 day series, the Open Cloud log and the API tab rows.
   Every page number is a pure function of script time, so pause, seek and replay stay exact. */

import type { Game } from '@/data/games'
import type { Tone } from '@/lib/tone'
import type { SimStage, Simulation } from '@/lib/useSimulation'
import { easeOut, lerp } from '@/lib/format'
import { createRng } from '@/lib/random'

export type VariantId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5'
export type ModerationStatus = 'Pending' | 'Approved' | 'Rejected'
export type VariantStatus = 'Active' | 'Winner' | 'Exploring' | 'Minimum traffic' | 'Rejected'
export type ConfigStatus = 'Active' | 'Inactive'

export interface ThumbVariant {
  id: VariantId
  assetId: number
  label: string
  moderationStatus: ModerationStatus
  safeZoneOk: boolean
  status: VariantStatus
  impressions: number
  qualifiedPlays: number
  avgPlaytimeMin: number
  qptr: number
  trafficShare: number
  winningSegment?: string
}

export interface SegmentCell {
  segment: string
  variantId: string
  qptr: number
  impressions: number
}

export interface PersonalizationConfig {
  universeId: number
  homepageThumbnailId: string
  personalizedConfigStatus: ConfigStatus
  lastCall: 'create' | 'update'
}

/* The run script. 19.0 s at 1x. */
export const STAGES: SimStage[] = [
  { id: 'upload', label: 'Upload variants', detail: 'Moderation per asset', duration: 2500 },
  { id: 'lint', label: 'Safe-zone lint', detail: 'Bottom 14 percent', duration: 2500 },
  { id: 'explore', label: 'Explore', detail: 'Equal streams at 25 percent', duration: 3000 },
  { id: 'exploit', label: 'Exploit', detail: 'Shares re-weight', duration: 5000 },
  { id: 'segment', label: 'Segment winners', detail: 'One winner per segment', duration: 4000 },
  { id: 'apply', label: 'Apply config', detail: 'PATCH personalization update', duration: 2000 },
]

export const STAGE_AT = { upload: 0, lint: 2500, explore: 5000, exploit: 8000, segment: 13000, apply: 17000 } as const

/* Roblox rules this page enforces. */
export const MIN_ACTIVE_THUMBNAILS = 2
export const MAX_ACTIVE_THUMBNAILS = 5
export const EXPLORE_IMPRESSIONS = 312_000
export const SHARE_FLOOR = 0.05
export const NOVELTY_HOURS = 72
export const READ_LIMIT = 100
export const WRITE_LIMIT = 50
export const LINT_BAND = 0.14

export const SEGMENTS = ['18+ Desktop', '13-17 Desktop', '13-17 Mobile', '9-12 Mobile'] as const
export type Segment = (typeof SEGMENTS)[number]

/* The creative treatment per variant: same source image, four different crops and overlays so
   the cards read as four distinct creatives. */
export interface ThumbCreative {
  scale: number
  position: string
  tint: string
  overlay: string
  note: string
}

export interface VariantMeta {
  uploadedAt: string
  configStatus: ConfigStatus
  lint: { ok: boolean; label: string }
  moderationReason?: string
  creative: ThumbCreative
}

export interface ThumbDataset {
  game: Game
  universeId: number
  variants: ThumbVariant[]
  cells: SegmentCell[]
  series: SeriesPoint[][]
  meta: Record<string, VariantMeta>
  config: PersonalizationConfig
  baselineLift: number
  platformLift: number
}

export interface SeriesPoint {
  day: number
  impressions: number
  qptr: number
}

const HERO_VARIANTS: ThumbVariant[] = [
  {
    id: 'T1',
    assetId: 892014773,
    label: 'Nest overview',
    moderationStatus: 'Approved',
    safeZoneOk: false,
    status: 'Minimum traffic',
    impressions: 402_100,
    qualifiedPlays: 14_878,
    avgPlaytimeMin: 16.2,
    qptr: 0.037,
    trafficShare: 0.05,
  },
  {
    id: 'T2',
    assetId: 892014799,
    label: 'Golden egg heist',
    moderationStatus: 'Approved',
    safeZoneOk: true,
    status: 'Winner',
    impressions: 1_412_300,
    qualifiedPlays: 64_970,
    avgPlaytimeMin: 18.4,
    qptr: 0.046,
    trafficShare: 0.61,
    winningSegment: '13-17 Desktop',
  },
  {
    id: 'T3',
    assetId: 892014812,
    label: 'Chicken chase',
    moderationStatus: 'Approved',
    safeZoneOk: true,
    status: 'Active',
    impressions: 498_800,
    qualifiedPlays: 20_451,
    avgPlaytimeMin: 17.1,
    qptr: 0.041,
    trafficShare: 0.34,
    winningSegment: '9-12 Mobile',
  },
  {
    id: 'T4',
    assetId: 892014830,
    label: 'Robux egg',
    moderationStatus: 'Rejected',
    safeZoneOk: true,
    status: 'Rejected',
    impressions: 0,
    qualifiedPlays: 0,
    avgPlaytimeMin: 0,
    qptr: 0,
    trafficShare: 0,
  },
]

const HERO_CELLS: Record<Segment, number[]> = {
  '18+ Desktop': [0.039, 0.044, 0.038, 0],
  '13-17 Desktop': [0.036, 0.049, 0.042, 0],
  '13-17 Mobile': [0.034, 0.043, 0.042, 0],
  '9-12 Mobile': [0.035, 0.041, 0.053, 0],
}

const HERO_SERIES: SeriesPoint[][] = [
  [0.041, 0.04, 0.04, 0.039, 0.038, 0.038, 0.037, 0.037, 0.036, 0.036, 0.037, 0.037, 0.037, 0.037].map((qptr, i) => ({
    day: i + 1,
    impressions: Math.round(402_100 * dayWeight(i) * (i === 13 ? 1 : 0.96 + i * 0.003)),
    qptr,
  })),
  [0.032, 0.034, 0.036, 0.038, 0.039, 0.041, 0.042, 0.043, 0.044, 0.045, 0.045, 0.046, 0.046, 0.046].map((qptr, i) => ({
    day: i + 1,
    impressions: Math.round(1_412_300 * dayWeight(i) * (i === 13 ? 1 : 0.97 + i * 0.002)),
    qptr,
  })),
  [0.028, 0.03, 0.031, 0.033, 0.034, 0.036, 0.037, 0.038, 0.039, 0.04, 0.04, 0.041, 0.041, 0.041].map((qptr, i) => ({
    day: i + 1,
    impressions: Math.round(498_800 * dayWeight(i) * (i === 13 ? 1 : 0.95 + i * 0.004)),
    qptr,
  })),
  [0.03, 0.031, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].map((qptr, i) => ({
    day: i + 1,
    impressions: i < 2 ? Math.round(36_000 * dayWeight(i)) : 0,
    qptr,
  })),
]

function dayWeight(i: number) {
  return [0.06, 0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.67, 0.74, 0.81, 0.88, 0.94, 1][i] ?? 1
}

export function creativeSet(noun: string, hero: boolean): Record<string, ThumbCreative> {
  const Noun = noun[0].toUpperCase() + noun.slice(1)
  return {
    T1: {
      scale: 1.02,
      position: '50% 44%',
      tint: 'bg-canvas/25',
      overlay: hero ? 'Nest view' : `${Noun} view`,
      note: 'Full frame, logo bottom center',
    },
    T2: {
      scale: 1.42,
      position: '62% 36%',
      tint: 'bg-warn-soft',
      overlay: hero ? 'Golden egg' : `Golden ${noun}`,
      note: 'Tight crop on the reward',
    },
    T3: {
      scale: 1.78,
      position: '22% 72%',
      tint: 'bg-data-5-soft',
      overlay: hero ? 'Chase cam' : `${Noun} chase`,
      note: 'Low crop with motion framing',
    },
    T4: {
      scale: 1.24,
      position: '84% 18%',
      tint: 'bg-data-6-soft',
      overlay: hero ? 'Robux egg' : `Robux ${noun}`,
      note: 'Corner crop with a text overlay',
    },
  }
}

export function buildDataset(game: Game): ThumbDataset {
  const hero = game.id === 'steal-an-egg'
  const rng = createRng('thumbnail-daemon-' + game.id)
  const Noun = game.noun[0].toUpperCase() + game.noun.slice(1)
  const scale = hero ? 1 : Math.max(0.22, Math.pow(game.playing / 795_017, 0.62)) * rng.float(0.86, 1.16)

  const variants: ThumbVariant[] = hero
    ? HERO_VARIANTS.map((v) => ({ ...v }))
    : (() => {
        const topShare = rng.float(0.56, 0.64)
        const thirdShare = Math.round((1 - topShare - SHARE_FLOOR) * 100) / 100
        const topQptr = rng.float(0.037, 0.051)
        const topImpressions = Math.round(1_412_300 * scale)
        const thirdImpressions = Math.round(topImpressions * rng.float(0.3, 0.42))
        const firstImpressions = Math.round(topImpressions * rng.float(0.24, 0.33))
        return [
          {
            id: 'T1' as const,
            assetId: rng.int(100_000_000, 999_999_999),
            label: `${Noun} overview`,
            moderationStatus: 'Approved' as const,
            safeZoneOk: false,
            status: 'Minimum traffic' as const,
            impressions: firstImpressions,
            qualifiedPlays: Math.round(firstImpressions * (topQptr - rng.float(0.006, 0.011))),
            avgPlaytimeMin: rng.float(13.4, 18.2),
            qptr: topQptr - rng.float(0.006, 0.011),
            trafficShare: SHARE_FLOOR,
          },
          {
            id: 'T2' as const,
            assetId: rng.int(100_000_000, 999_999_999),
            label: `Golden ${game.noun} heist`,
            moderationStatus: 'Approved' as const,
            safeZoneOk: true,
            status: 'Winner' as const,
            impressions: topImpressions,
            qualifiedPlays: Math.round(topImpressions * topQptr),
            avgPlaytimeMin: rng.float(15.8, 21.4),
            qptr: topQptr,
            trafficShare: topShare,
            winningSegment: '13-17 Desktop',
          },
          {
            id: 'T3' as const,
            assetId: rng.int(100_000_000, 999_999_999),
            label: `${Noun} chase`,
            moderationStatus: 'Approved' as const,
            safeZoneOk: true,
            status: 'Active' as const,
            impressions: thirdImpressions,
            qualifiedPlays: Math.round(thirdImpressions * (topQptr - rng.float(0.002, 0.006))),
            avgPlaytimeMin: rng.float(14.9, 19.6),
            qptr: topQptr - rng.float(0.002, 0.006),
            trafficShare: thirdShare,
            winningSegment: '9-12 Mobile',
          },
          {
            id: 'T4' as const,
            assetId: rng.int(100_000_000, 999_999_999),
            label: `Robux ${game.noun}`,
            moderationStatus: 'Rejected' as const,
            safeZoneOk: true,
            status: 'Rejected' as const,
            impressions: 0,
            qualifiedPlays: 0,
            avgPlaytimeMin: 0,
            qptr: 0,
            trafficShare: 0,
          },
        ]
      })()

  const cells: SegmentCell[] = SEGMENTS.flatMap((segment) =>
    variants.map((v) => {
      if (v.moderationStatus === 'Rejected') {
        return { segment, variantId: v.id, qptr: 0, impressions: 0 }
      }
      const heroQptr = HERO_CELLS[segment][variants.indexOf(v)]
      const qptr = hero ? heroQptr : Math.max(0.021, heroQptr + rng.float(-0.0028, 0.0028))
      const segmentWeight = segment === '13-17 Desktop' ? 0.34 : segment === '18+ Desktop' ? 0.27 : segment === '13-17 Mobile' ? 0.23 : 0.16
      return { segment, variantId: v.id, qptr, impressions: Math.round(v.impressions * segmentWeight) }
    }),
  )

  /* Keep the segment story true after the jitter: T3 owns 9-12 Mobile, T2 owns the other three. */
  for (const segment of SEGMENTS) {
    const intended = segment === '9-12 Mobile' ? 'T3' : 'T2'
    const rows = cells.filter((c) => c.segment === segment)
    const topOther = Math.max(...rows.filter((c) => c.variantId !== intended).map((c) => c.qptr))
    const target = rows.find((c) => c.variantId === intended)
    if (target) target.qptr = Math.max(target.qptr, topOther + 0.0012)
  }

  const series: SeriesPoint[][] = variants.map((v, vi) => {
    if (hero) return HERO_SERIES[vi]
    if (v.moderationStatus === 'Rejected') {
      return Array.from({ length: 14 }, (_, i) => ({ day: i + 1, impressions: i < 2 ? Math.round(28_000 * scale * dayWeight(i)) : 0, qptr: i < 2 ? v.qptr : 0 }))
    }
    return Array.from({ length: 14 }, (_, i) => {
      const rise = 0.66 + 0.34 * (i / 13)
      const jitter = i === 13 ? 1 : rng.float(0.97, 1.03)
      return {
        day: i + 1,
        impressions: Math.round(v.impressions * dayWeight(i) * jitter),
        qptr: v.qptr * rise,
      }
    })
  })

  const creatives = creativeSet(game.noun, hero)
  const meta: Record<string, VariantMeta> = {
    T1: {
      uploadedAt: '2026-10-26T14:52:00-06:00',
      configStatus: 'Active',
      lint: { ok: false, label: 'Logo sits at 88% height, inside the bottom 14% band' },
      creative: creatives.T1,
    },
    T2: {
      uploadedAt: '2026-10-26T14:52:20-06:00',
      configStatus: 'Active',
      lint: { ok: true, label: 'Pass, bottom 14% clear of text and logos' },
      creative: creatives.T2,
    },
    T3: {
      uploadedAt: '2026-10-26T14:52:40-06:00',
      configStatus: 'Active',
      lint: { ok: true, label: 'Pass, bottom 14% clear of text and logos' },
      creative: creatives.T3,
    },
    T4: {
      uploadedAt: '2026-10-26T14:53:00-06:00',
      configStatus: 'Inactive',
      lint: { ok: true, label: 'Not evaluated, rejected before lint' },
      moderationReason: 'Overlay text covers more than 30% of the frame',
      creative: creatives.T4,
    },
  }

  return {
    game,
    universeId: game.universeId,
    variants,
    cells,
    series,
    meta,
    config: {
      universeId: game.universeId,
      homepageThumbnailId: String(variants[1].assetId),
      personalizedConfigStatus: 'Active',
      lastCall: 'create',
    },
    baselineLift: hero ? 0.112 : rng.float(0.052, 0.128),
    platformLift: 0.085,
  }
}

/* ---- time-derived values, all pure functions of the simulation ---- */

type SimLike = Pick<Simulation, 't' | 'status' | 'reached' | 'within'>

export function moderationAt(sim: SimLike, v: ThumbVariant): ModerationStatus {
  if (!sim.reached('upload')) return 'Pending'
  const p = sim.within('upload')
  if (v.moderationStatus === 'Rejected') return p > 0.68 ? 'Rejected' : 'Pending'
  return p > 0.5 ? 'Approved' : 'Pending'
}

export function shareAt(sim: SimLike, v: ThumbVariant): number {
  if (moderationAt(sim, v) === 'Rejected') return 0
  if (!sim.reached('exploit')) return 1 / 4
  return lerp(1 / 4, v.trafficShare, easeOut(sim.within('exploit')))
}

export function liveImpressionsAt(sim: SimLike, v: ThumbVariant): number {
  if (moderationAt(sim, v) === 'Rejected' || !sim.reached('explore')) return 0
  const armBase = EXPLORE_IMPRESSIONS / 4
  const explorePart = armBase * easeOut(sim.within('explore'))
  if (!sim.reached('exploit')) return explorePart
  return lerp(armBase, v.impressions, easeOut(sim.within('exploit')))
}

export function servedAt(sim: SimLike, variants: ThumbVariant[]): number {
  return variants.reduce((total, v) => total + liveImpressionsAt(sim, v), 0)
}

export function leaderAt(sim: SimLike, variants: ThumbVariant[]): ThumbVariant {
  return variants.reduce((best, v) => (shareAt(sim, v) > shareAt(sim, best) ? v : best), variants[0])
}

export function winnerOf(cells: SegmentCell[], segment: string) {
  return cells.filter((c) => c.segment === segment).reduce((best, c) => (c.qptr > best.qptr ? c : best))
}

export const variantTone: Record<string, Tone> = { T1: 'warn', T2: 'accent', T3: 'live', T4: 'muted', T5: 'muted' }

export const statusTone: Record<VariantStatus, Tone> = {
  Active: 'accent',
  Winner: 'live',
  Exploring: 'accent',
  'Minimum traffic': 'warn',
  Rejected: 'danger',
}

export const moderationTone: Record<ModerationStatus, Tone> = { Pending: 'warn', Approved: 'live', Rejected: 'danger' }

/* ---- Open Cloud paths, scopes, limits ---- */

export function apiBase(universeId: number) {
  return `/thumbnail-personalization-api/v1/universes/${universeId}`
}

export function apiPaths(universeId: number) {
  const base = apiBase(universeId)
  return {
    thumbnails: `${base}/thumbnails`,
    uploads: `${base}/thumbnails/uploads`,
    update: `${base}/personalization/update`,
    create: `${base}/personalization/create`,
  }
}

export const SCOPES = ['universe.thumbnail:read', 'universe.thumbnail:write'] as const

/* ---- the run log ---- */

export interface LogScript {
  id: string
  at: number
  level: 'info' | 'ok' | 'warn' | 'error' | 'dim' | 'cmd'
  text: string
}

export const LOG_LINES: LogScript[] = [
  { id: 'l01', at: 120, level: 'cmd', text: 'POST {base}/thumbnails/uploads' },
  { id: 'l02', at: 340, level: 'info', text: '202 Accepted, uploadId upl_7f3a91, 4 files, 1920x1080, 2.1 MB each' },
  { id: 'l03', at: 520, level: 'dim', text: 'x-ratelimit-remaining: 43, x-ratelimit-limit: 50 (write)' },
  { id: 'l04', at: 760, level: 'info', text: 'GET {base}/thumbnails/uploads/upl_7f3a91/status, moderation Pending for T1 T2 T3 T4' },
  { id: 'l05', at: 1180, level: 'ok', text: 'T1 T2 T3 moderation Approved, image/webp, 1920x1080, 2.1 MB' },
  { id: 'l06', at: 1620, level: 'error', text: 'T4 moderation Rejected: overlay text covers more than 30% of the frame' },
  { id: 'l07', at: 2080, level: 'info', text: 'GET {base}/thumbnails, 200, 3 active, 1 rejected' },
  { id: 'l08', at: 2260, level: 'dim', text: 'x-ratelimit-remaining: 78, x-ratelimit-limit: 100 (read)' },
  { id: 'l09', at: 2740, level: 'info', text: 'safe-zone lint: bottom 14 percent reserved for the player-count overlay' },
  { id: 'l10', at: 3120, level: 'warn', text: 'T1 logo text sits at 88 percent height, covered by player-count overlay' },
  { id: 'l11', at: 3560, level: 'ok', text: 'size 1920x1080, 16:9, 2.1 MB under 3 MB, type image/webp: pass for T1 T2 T3' },
  { id: 'l12', at: 4520, level: 'info', text: 'lint complete, 3 pass, 1 warning (T1)' },
  { id: 'l13', at: 5180, level: 'cmd', text: 'bandit: 4 arms, uniform prior, reward is a qualified play through' },
  { id: 'l14', at: 5560, level: 'info', text: 'explore: serving 25 percent of Home impressions to each arm' },
  { id: 'l15', at: 6620, level: 'info', text: 'impressions {early}, every arm within 0.6 pp of the others' },
  { id: 'l16', at: 7840, level: 'ok', text: 'explore complete, 312,000 impressions, 4 arms still live' },
  { id: 'l17', at: 8400, level: 'info', text: 'reward update: T2 {t2} percent QPTR, T3 {t3}, T1 {t1}, T4 rejected' },
  { id: 'l18', at: 9000, level: 'cmd', text: 'policy update: T2 {s2}, T3 {s3}, T1 0.05, floor 0.05' },
  { id: 'l19', at: 9800, level: 'info', text: 'impressions {mid}, T2 receiving {s2pct} percent of Home traffic' },
  { id: 'l20', at: 10600, level: 'dim', text: 'write 7/50 per min, read 92/100 per min' },
  { id: 'l21', at: 11400, level: 'warn', text: 'novelty check: the first 72 hours overstate lift, early decay expected' },
  { id: 'l22', at: 12200, level: 'ok', text: 'impressions {total}, T1 held above the 5 percent floor' },
  { id: 'l23', at: 13200, level: 'cmd', text: 'GET {base}/thumbnails?segments=true, 200, 4 segments by 4 variants' },
  { id: 'l24', at: 13900, level: 'info', text: '18+ Desktop: T2 leads at {d18} percent QPTR' },
  { id: 'l25', at: 15300, level: 'info', text: '13-17 Mobile: T2 leads at {d17m} percent QPTR' },
  { id: 'l26', at: 16100, level: 'warn', text: '9-12 Mobile: T3 takes the segment at {mobile} percent QPTR, {gap} pp over T2' },
  { id: 'l27', at: 16700, level: 'info', text: 'segment matrix written, one winner column per segment' },
  { id: 'l28', at: 17360, level: 'cmd', text: 'PATCH {base}/personalization/update' },
  { id: 'l29', at: 17400, level: 'error', text: '429 Too Many Requests, retry-after: 1.2s, backoff 1/5, x-ratelimit-remaining: 0' },
  { id: 'l30', at: 17960, level: 'cmd', text: 'PATCH {base}/personalization/update (retry 1/5)' },
  { id: 'l31', at: 18000, level: 'ok', text: '200 OK, personalizedConfigStatus Active, homepageThumbnailId {top}' },
  { id: 'l32', at: 18400, level: 'info', text: 'update keeps impression stats, create would reset them' },
  { id: 'l33', at: 18800, level: 'ok', text: 'config Active, the next run starts from these shares' },
]

export function logText(line: LogScript, dataset: ThumbDataset) {
  const cell = (segment: Segment) => dataset.cells.find((c) => c.segment === segment && c.variantId === 'T2')?.qptr ?? 0
  const mobile = dataset.cells.find((c) => c.segment === '9-12 Mobile' && c.variantId === 'T3')?.qptr ?? 0
  const total = dataset.variants.reduce((sum, v) => sum + v.impressions, 0)
  const tokens: Record<string, string> = {
    base: apiBase(dataset.universeId),
    top: String(dataset.variants[1].assetId),
    t1: (dataset.variants[0].qptr * 100).toFixed(1),
    t2: (dataset.variants[1].qptr * 100).toFixed(1),
    t3: (dataset.variants[2].qptr * 100).toFixed(1),
    s2: (dataset.variants[1].trafficShare * 100).toFixed(0),
    s3: (dataset.variants[2].trafficShare * 100).toFixed(0),
    s2pct: (dataset.variants[1].trafficShare * 100).toFixed(0),
    gap: ((mobile - cell('9-12 Mobile')) * 100).toFixed(1),
    mobile: (mobile * 100).toFixed(1),
    d18: (cell('18+ Desktop') * 100).toFixed(1),
    d17m: (cell('13-17 Mobile') * 100).toFixed(1),
    early: Math.round(EXPLORE_IMPRESSIONS * 0.59).toLocaleString('en-US'),
    mid: Math.round(total * 0.41).toLocaleString('en-US'),
    total: total.toLocaleString('en-US'),
  }
  return line.text.replace(/\{(\w+)\}/g, (whole, key: string) => tokens[key] ?? whole)
}

/* ---- the API tab call list ---- */

export interface ApiCallRow {
  id: string
  at: number
  method: 'GET' | 'POST' | 'PATCH'
  path: string
  status: number
  remaining: number
  limit: number
  kind: 'read' | 'write'
  note?: string
}

export function apiCallRows(universeId: number): ApiCallRow[] {
  const p = apiPaths(universeId)
  return [
    { id: 'a1', at: 340, method: 'POST', path: p.uploads, status: 202, remaining: 43, limit: WRITE_LIMIT, kind: 'write' },
    { id: 'a2', at: 760, method: 'GET', path: `${p.uploads}/upl_7f3a91/status`, status: 200, remaining: 81, limit: READ_LIMIT, kind: 'read' },
    { id: 'a3', at: 2080, method: 'GET', path: p.thumbnails, status: 200, remaining: 78, limit: READ_LIMIT, kind: 'read' },
    { id: 'a4', at: 13200, method: 'GET', path: `${p.thumbnails}?segments=true`, status: 200, remaining: 74, limit: READ_LIMIT, kind: 'read' },
    { id: 'a5', at: 17400, method: 'PATCH', path: p.update, status: 429, remaining: 0, limit: WRITE_LIMIT, kind: 'write', note: 'retry-after: 1.2s, backoff 1/5' },
    { id: 'a6', at: 18000, method: 'PATCH', path: p.update, status: 200, remaining: 46, limit: WRITE_LIMIT, kind: 'write' },
  ]
}

/* ---- segment heatmap helpers ---- */

export function heatRatio(value: number, max: number) {
  return Math.max(0, Math.min(1, value / Math.max(max, 0.0001)))
}
