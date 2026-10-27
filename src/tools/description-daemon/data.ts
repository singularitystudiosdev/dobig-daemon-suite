import { busFor, type BusEvent } from '@/data/bus'
import type { Game } from '@/data/games'
import { clamp, lerp } from '@/lib/format'
import { createRng, type Rng } from '@/lib/random'
import type { SimStage } from '@/lib/useSimulation'

/* Description Daemon: sequential copy testing with guardrails.
   Roblox ships no native description A/B test, so a run publishes one variant, holds a full weekly
   cycle and reads the primary metric day by day until the 95% interval clears zero. */

export const STAGES: SimStage[] = [
  { id: 'baseline', label: 'Baseline 28d', detail: 'Query 28 days and the benchmark cohort', duration: 3000 },
  { id: 'generate', label: 'Generate variants', detail: 'Three drafts from the live copy', duration: 2500 },
  { id: 'lint', label: 'Policy lint', detail: 'Misleading, giveaway and keyword rules', duration: 2500 },
  { id: 'publish', label: 'Publish', detail: 'One PATCH to one universe', duration: 1500 },
  { id: 'hold', label: 'Hold 7 days', detail: 'Full weekly cycle with daily reads', duration: 6000 },
  { id: 'verdict', label: 'Keep or roll back', detail: 'Primary and guardrail metrics', duration: 2500 },
]

export type LintRuleName = 'misleading' | 'giveaway/Robux' | 'keyword spam'

export interface CopyVariant {
  id: string
  displayName: string
  description: string
  lint: { rule: LintRuleName; span: [number, number] }[]
  status: 'draft' | 'blocked' | 'live' | 'kept' | 'rolled back'
}

export type Verdict = 'keep' | 'roll back' | 'extend' | 'inconclusive'

export interface SeqTest {
  universeId: number
  variantId: string
  baseline: [string, string]
  hold: [string, string]
  primary: 'RFYPlayThroughRate'
  baselineValue: number
  testValue: number
  deltaPp: number
  ci95: [number, number]
  mdePp: number
  confounders: { date: string; label: string; source: string }[]
  guardrails: { metric: string; delta: number; ok: boolean }[]
  verdict: Verdict
}

export interface BaselinePoint {
  date: string
  label: string
  weekday: string
  mean: number
  low: number
  high: number
  weeklyPeak: boolean
}

export interface HoldPoint {
  date: string
  label: string
  dayIndex: number
  value: number
  discounted: boolean
}

export type MetricUnit = 'pct' | 'min' | 'days' | 'count'

export interface MetricRow {
  metric: string
  baseline: number
  delta: number
  benchmark: number
  unit: MetricUnit
  role: 'primary' | 'guardrail' | 'watch'
  /** True when a smaller value is the better outcome (share of short sessions). */
  lowerIsBetter?: boolean
}

export interface AcquisitionRow {
  source: string
  share: number
  impressions: number
  qptr: number
  change: number
  isolated: boolean
}

export interface HistoryRow {
  version: string
  from: string
  to: string
  verdict: Verdict | 'blocked'
  deltaPp: number | null
  note: string
}

export interface LintRuleDef {
  rule: LintRuleName
  title: string
  flags: string
  policy: string
}

export interface LogEntry {
  id: string
  at: number
  level: 'info' | 'ok' | 'warn' | 'error' | 'dim' | 'cmd'
  text: string
}

export interface DescriptionDataset {
  game: Game
  test: SeqTest
  variants: CopyVariant[]
  baseline: BaselinePoint[]
  hold: HoldPoint[]
  ci: [number, number][]
  metrics: MetricRow[]
  acquisition: AcquisitionRow[]
  history: HistoryRow[]
  lintRules: LintRuleDef[]
  logs: LogEntry[]
  jobId: string
  publishAt: string
  publishBody: string
  power: number
  daysHeld: number
  benchmarkCount: number
  baselineImpressions: number
  testImpressions: number
  creatorEvent: BusEvent | null
  thumbnailEvent: BusEvent | null
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shortDay(d: Date) {
  return `${MONTH[d.getMonth()]} ${d.getDate()}`
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function plural(noun: string) {
  if (noun === 'fish') return 'fish'
  if (noun.endsWith('fe')) return noun.slice(0, -2) + 'ves'
  if (noun.endsWith('f')) return noun.slice(0, -1) + 'ves'
  return noun + 's'
}

/* The description that survived lint: restructured, no claims, no keyword run. */
export function survivorCopy(game: Game) {
  const p = plural(game.noun)
  return [
    game.shortName,
    '',
    'Play, learn the map, and build a collection worth showing off.',
    'Upgrade your loadout and unlock new routes, sizes and mutations.',
    `New ${p}, rarities and upgrades land every update.`,
    '',
    'Plays on Desktop, Console, Mobile and Tablet. Free to play, updates every Friday.',
  ].join('\n')
}

/* The draft that lint blocks: bait wording, a keyword run and an unverifiable claim. */
export function blockedCopy(game: Game) {
  const p = plural(game.noun)
  const n = game.noun
  const spam = `${p} ${p} best ${n} game ${n} tycoon 2026 free ${p} codes ${p} roblox ${n} simulator ${p} update ${n} rarity ${p} cheap ${p} best ${p} ever`
  return [`${game.shortName} FREE ROBUX ${p.toUpperCase()} every 10 min!!`, '', spam, '', `Guaranteed legendary ${game.noun} on your first hatch.`].join('\n')
}

function lintSpans(game: Game, description: string, kind: 'b' | 'c'): CopyVariant['lint'] {
  if (kind === 'b') return []
  const p = plural(game.noun)
  const spans: CopyVariant['lint'] = []
  const giveaway = `FREE ROBUX ${p.toUpperCase()}`
  const gi = description.indexOf(giveaway)
  if (gi >= 0) spans.push({ rule: 'giveaway/Robux', span: [gi, gi + giveaway.length] })
  const line = description.split('\n').find((l) => l.split(' ').length > 18)
  if (line) {
    const li = description.indexOf(line)
    spans.push({ rule: 'keyword spam', span: [li, li + line.length] })
  }
  const claim = 'Guaranteed legendary'
  const ci = description.indexOf(claim)
  if (ci >= 0) spans.push({ rule: 'misleading', span: [ci, ci + claim.length] })
  return spans
}

export function buildVariants(game: Game): CopyVariant[] {
  const clean = survivorCopy(game)
  const blocked = blockedCopy(game)
  return [
    { id: 'v-a', displayName: 'Variant A', description: game.description, lint: [], status: 'draft' },
    { id: 'v-b', displayName: 'Variant B', description: clean, lint: lintSpans(game, clean, 'b'), status: 'kept' },
    { id: 'v-c', displayName: 'Variant C', description: blocked, lint: lintSpans(game, blocked, 'c'), status: 'blocked' },
  ]
}

const HERO_CI_SERIES: [number, number][] = [
  [-0.44, 1.16],
  [-0.35, 1.1],
  [-0.22, 0.93],
  [-0.31, 1.02],
  [-0.02, 0.84],
  [0.06, 0.77],
  [0.06, 0.77],
]

function buildBaseline(rng: Rng, baselineValue: number): BaselinePoint[] {
  return Array.from({ length: 28 }, (_, i) => {
    const d = new Date(2026, 8, 21 + i)
    const dow = d.getDay()
    const weekly = dow === 6 ? 0.52 : dow === 5 ? 0.24 : dow === 0 ? 0.18 : 0
    const mean = round2(baselineValue + weekly + rng.float(-0.05, 0.05))
    const spread = rng.float(0.16, 0.3)
    return {
      date: isoOf(d),
      label: shortDay(d),
      weekday: WEEKDAY[dow],
      mean,
      low: round2(mean - spread),
      high: round2(mean + spread),
      weeklyPeak: dow === 6,
    }
  })
}

function buildHold(rng: Rng, baselineValue: number, testValue: number): HoldPoint[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2026, 9, 19 + i)
    const dow = d.getDay()
    const weekly = dow === 6 ? 0.12 : dow === 0 ? 0.06 : 0
    const value = round2(lerp(baselineValue, testValue, (i + 1) / 7) + weekly + rng.float(-0.05, 0.05))
    return { date: isoOf(d), label: `${WEEKDAY[dow]} ${d.getDate()}`, dayIndex: i + 1, value, discounted: i === 3 }
  })
}

function buildCi(rng: Rng, isHero: boolean, deltaPp: number, ci95: [number, number]): [number, number][] {
  if (isHero) return HERO_CI_SERIES
  const pair = (lo: number, hi: number): [number, number] => [round2(lo), round2(hi)]
  return [
    pair(deltaPp - 0.72, deltaPp + 0.78),
    pair(deltaPp - 0.55, deltaPp + 0.62),
    pair(deltaPp - 0.34, deltaPp + 0.42),
    pair(deltaPp - 0.46, deltaPp + 0.55),
    pair(-0.03 - rng.float(0, 0.04), deltaPp + 0.34),
    pair(Math.max(0.02, deltaPp - 0.35), deltaPp + 0.36),
    ci95,
  ]
}

function buildMetrics(rng: Rng, baselineValue: number, deltaPp: number, users: number): MetricRow[] {
  const rateScale = clamp(baselineValue / 3.12, 0.78, 1.2)
  return [
    {
      metric: 'RFYPlayThroughRate',
      baseline: round2(baselineValue),
      delta: round2(deltaPp),
      benchmark: round2(baselineValue - 0.07 - rng.float(0, 0.06)),
      unit: 'pct',
      role: 'primary',
    },
    { metric: 'QualifiedEndToEndCVR', baseline: round2(1.84 * rateScale), delta: round2(0.1 + rng.float(-0.03, 0.05)), benchmark: round2(1.71 * rateScale), unit: 'pct', role: 'watch' },
    { metric: 'ImpressionCVR', baseline: round2(8.42 * rateScale), delta: round2(0.07 + rng.float(0, 0.05)), benchmark: round2(8.1 * rateScale), unit: 'pct', role: 'watch' },
    { metric: 'RFYDuration0To60', baseline: round2(41.6), delta: round2(-0.02 - rng.float(0, 0.02)), benchmark: 42.8, unit: 'pct', role: 'guardrail', lowerIsBetter: true },
    { metric: 'RFYDuration61To180', baseline: round2(28.3), delta: round2(0.02 + rng.float(0, 0.02)), benchmark: 27.9, unit: 'pct', role: 'watch' },
    { metric: 'RFYD1Playtime', baseline: round2(18.4), delta: round2(0.01 + rng.float(0, 0.03)), benchmark: 17.9, unit: 'min', role: 'guardrail' },
    { metric: 'RFYD2To7PlayDays', baseline: round2(1.93), delta: round2(0.01 + rng.float(0, 0.02)), benchmark: 1.88, unit: 'days', role: 'watch' },
    { metric: 'ForwardD1Retention', baseline: round2(24.6), delta: round2(0.08 + rng.float(0, 0.05)), benchmark: 23.9, unit: 'pct', role: 'watch' },
    { metric: 'AverageSessionLengthMinutes', baseline: round2(9.82), delta: round2(0.16 + rng.float(0, 0.08)), benchmark: 9.4, unit: 'min', role: 'watch' },
    { metric: 'UniqueUsersWithImpressions', baseline: users, delta: Math.round(users * 0.014), benchmark: Math.round(users * 0.92), unit: 'count', role: 'watch' },
  ]
}

const SOURCES: [string, number][] = [
  ['Home recommendations', 54],
  ['Continue play', 16.2],
  ["Today's Picks", 9.4],
  ['Search', 7.1],
  ['Charts', 4.3],
  ['Sponsored ads', 3.2],
  ['Search ads', 2.4],
  ['Portal ads', 1.6],
  ['Teleport', 1.1],
  ['Other', 0.7],
]

function buildAcquisition(rng: Rng, baselineValue: number, deltaPp: number, testImpressions: number): AcquisitionRow[] {
  return SOURCES.map(([source, share]) => {
    const isolated = source === 'Home recommendations'
    const qptr = isolated ? round2(baselineValue + deltaPp) : round2(baselineValue + rng.float(-0.55, 0.65))
    return {
      source,
      share,
      impressions: Math.round((testImpressions * share) / 100),
      qptr,
      change: round2(qptr - baselineValue),
      isolated,
    }
  })
}

function buildHistory(game: Game, rng: Rng, isHero: boolean, deltaPp: number, ci95: [number, number], p: string): HistoryRow[] {
  const rows: HistoryRow[] = []
  if (game.id === 'steal-a-brainrot') {
    rows.push({ version: 'v9', from: '2026-09-28', to: 'open', verdict: 'extend', deltaPp: 0.12, note: 'CI [-0.21, +0.45]. Extended to 14 days to widen the read.' })
  } else if (game.id === 'grow-a-garden') {
    rows.push({ version: 'v7', from: '2026-10-05', to: '2026-10-18', verdict: 'inconclusive', deltaPp: -0.18, note: 'Impressions +38% while QPTR dipped 0.18pp. Expected when Home widens reach.' })
  } else {
    rows.push({
      version: 'v6',
      from: '2026-10-19',
      to: '2026-10-25',
      verdict: 'keep',
      deltaPp: round2(deltaPp),
      note: `Variant B. Interval cleared zero on day 6 at [+${ci95[0].toFixed(2)}, +${ci95[1].toFixed(2)}].`,
    })
  }
  rows.push({ version: 'v5', from: '2026-09-28', to: '2026-10-18', verdict: 'roll back', deltaPp: -0.09, note: 'Variant D. Play-through fell after day 3, reverted in one PATCH.' })
  rows.push({ version: 'v4', from: '2026-09-07', to: '2026-09-27', verdict: 'roll back', deltaPp: -0.14, note: 'Keyword run passed the first read and decayed by day 5.' })
  rows.push({ version: 'v3', from: '2026-08-17', to: '2026-09-06', verdict: 'extend', deltaPp: Math.max(0.08, round2(0.12 + rng.float(-0.03, 0.03))), note: 'Extended to 14 days for a wider interval.' })
  const blockedNote = isHero ? 'FREE ROBUX EGGS every 10 min!! failed the giveaway/Robux rule.' : `FREE ROBUX ${p.toUpperCase()} every 10 min!! failed the giveaway/Robux rule.`
  rows.push({ version: 'draft 7', from: 'not published', to: 'blocked at lint', verdict: 'blocked', deltaPp: null, note: blockedNote })
  return rows
}

export const LINT_RULES: LintRuleDef[] = [
  {
    rule: 'misleading',
    title: 'Misleading metadata',
    flags: 'Best game on Roblox, guaranteed drops, invented codes',
    policy: 'Roblox demotes metadata that promises something the game does not deliver.',
  },
  {
    rule: 'giveaway/Robux',
    title: 'Giveaway and Robux bait',
    flags: 'FREE ROBUX, free Robux codes, giveaways that never run',
    policy: 'Roblox demotes giveaway and Robux wording in descriptions because it trains bait clicks.',
  },
  {
    rule: 'keyword spam',
    title: 'Keyword spam',
    flags: 'A long run of keywords with no sentence structure',
    policy: 'Roblox demotes keyword-stuffed metadata, and search ignores the stuffed terms.',
  },
]

function buildLogs(game: Game, jobId: string, publishBody: string, creator: BusEvent | null, deltaPp: number, mdePp: number, giveawaySpan: [number, number] | null): LogEntry[] {
  const universe = game.universeId
  const patchLine = `PATCH /cloud/v2/universes/${universe}`
  return [
    { id: 'l01', at: 120, level: 'cmd', text: `POST /analytics-query-api/v1/universes/${universe}/metrics` },
    { id: 'l02', at: 300, level: 'info', text: 'scopes: universe.analytics:read. Requesting 28 days and the benchmark cohort.' },
    { id: 'l03', at: 520, level: 'ok', text: `202 Accepted, job ${jobId} queued` },
    { id: 'l04', at: 1500, level: 'dim', text: `GET /analytics-query-api/v1/jobs/${jobId}` },
    { id: 'l05', at: 1580, level: 'dim', text: `job ${jobId} running 3s` },
    { id: 'l06', at: 2600, level: 'ok', text: '200 OK: 28 daily reads, benchmark cohort 50+ similar experiences' },
    { id: 'l07', at: 2900, level: 'info', text: `minimum detectable effect ${mdePp.toFixed(2)}pp. Needs 7+ days of impressions to resolve.` },
    { id: 'l08', at: 3150, level: 'info', text: `drafting 3 variants of the ${game.shortName} description. One change at a time.` },
    { id: 'l09', at: 3800, level: 'dim', text: 'variant A: current live copy, kept as the control' },
    { id: 'l10', at: 4500, level: 'info', text: 'variant B: restructured, no claims, no keyword run' },
    { id: 'l11', at: 5200, level: 'warn', text: 'variant C: holds giveaway wording and a keyword run' },
    { id: 'l12', at: 5650, level: 'cmd', text: 'POST /description-daemon/v1/lint' },
    { id: 'l13', at: 6100, level: 'error', text: `variant C blocked: giveaway/Robux wording at chars ${giveawaySpan ? giveawaySpan[0] : 0} to ${giveawaySpan ? giveawaySpan[1] : 0}` },
    { id: 'l14', at: 6600, level: 'error', text: 'variant C blocked: keyword spam, 21 terms in one run' },
    { id: 'l15', at: 7100, level: 'error', text: 'variant C blocked: misleading claim, guaranteed legendary drop' },
    { id: 'l16', at: 7600, level: 'ok', text: 'variant B passed 3 of 3 rules' },
    { id: 'l17', at: 8150, level: 'warn', text: 'write budget 12 of 50 per minute on this universe. One change in flight.' },
    { id: 'l18', at: 8350, level: 'cmd', text: `${patchLine} (${publishBody.length} byte body, displayName and description)` },
    { id: 'l19', at: 8750, level: 'warn', text: '429 write budget exceeded. retry-after 2s, backing off 2000ms.' },
    { id: 'l20', at: 9200, level: 'ok', text: '200 OK. Description published, variant B live on Home traffic.' },
    { id: 'l21', at: 9600, level: 'info', text: 'hold opened Mon Oct 19. Full weekly cycle, seven daily reads.' },
    { id: 'l22', at: 10100, level: 'info', text: 'read 1 of 7: interval wide, delta not separable from zero' },
    { id: 'l23', at: 10900, level: 'info', text: 'read 2 of 7: interval narrows, Saturday peak lands inside the hold' },
    { id: 'l24', at: 11350, level: 'warn', text: `Creator Dox event ${creator ? creator.at.slice(0, 10) : '2026-10-22'}: sponsored creator video. Discounting that traffic.` },
    { id: 'l25', at: 11750, level: 'info', text: 'confounder discounted: 4.2% of impressions excluded from the delta, interval widens' },
    { id: 'l26', at: 13350, level: 'ok', text: `read 6 of 7: interval cleared zero at +${deltaPp.toFixed(2)}pp` },
    { id: 'l27', at: 14300, level: 'info', text: 'read 7 of 7 complete. Weekly cycle closed.' },
    { id: 'l28', at: 15700, level: 'info', text: 'guardrails: RFYDuration0To60 flat, RFYD1Playtime flat' },
    { id: 'l29', at: 16500, level: 'ok', text: `verdict keep. Primary +${deltaPp.toFixed(2)}pp, no guardrail regression.` },
    { id: 'l30', at: 17200, level: 'dim', text: `rollback ready: ${patchLine} with the previous description` },
    { id: 'l31', at: 17700, level: 'ok', text: 'bus: description-kept emitted for the Description Daemon' },
  ]
}

export function buildDataset(game: Game): DescriptionDataset {
  const isHero = game.id === 'steal-an-egg'
  const rng = createRng('description-daemon-' + game.id)
  const p = plural(game.noun)

  const baselineValue = isHero ? 3.12 : round2(clamp(2.2 + (Math.log10(Math.max(1000, game.playing)) - 3) * 0.22 + rng.float(-0.25, 0.25), 2.4, 3.4))
  const deltaPp = isHero ? 0.41 : round2(rng.float(0.26, 0.58))
  const testValue = round2(baselineValue + deltaPp)
  const mdePp = isHero ? 0.3 : round2(rng.float(0.22, 0.38))
  const power = isHero ? 0.81 : round2(rng.float(0.74, 0.89))
  const ci95: [number, number] = isHero ? [0.06, 0.77] : [round2(deltaPp - 0.16 - rng.float(0, 0.06)), round2(deltaPp + 0.17 + rng.float(0, 0.06))]
  const users = Math.round(game.playing * 1.62)

  const events = busFor(game)
  const creatorEvent = events.find((e) => e.kind === 'creator-video') ?? null
  const thumbnailEvent = events.find((e) => e.kind === 'thumbnail-winner') ?? null

  const variants = buildVariants(game)
  const metrics = buildMetrics(rng, baselineValue, deltaPp, users)
  const test: SeqTest = {
    universeId: game.universeId,
    variantId: 'v-b',
    baseline: ['2026-09-21', '2026-10-18'],
    hold: ['2026-10-19', '2026-10-25'],
    primary: 'RFYPlayThroughRate',
    baselineValue,
    testValue,
    deltaPp,
    ci95,
    mdePp,
    confounders: [{ date: creatorEvent ? creatorEvent.at.slice(0, 10) : '2026-10-22', label: 'Sponsored creator video', source: 'Creator Dox' }],
    guardrails: [
      { metric: 'RFYDuration0To60', delta: metrics[3].delta, ok: true },
      { metric: 'RFYD1Playtime', delta: metrics[5].delta, ok: true },
    ],
    verdict: 'keep',
  }

  const jobId = 'job_' + rng.hex(8)
  const publishAt = '2026-10-19T09:01:12-06:00'
  const publishBody = JSON.stringify({ displayName: game.shortName, description: variants[1].description }, null, 2)
  const testImpressions = Math.round(game.playing * 1.62)

  return {
    game,
    test,
    variants,
    baseline: buildBaseline(rng, baselineValue),
    hold: buildHold(rng, baselineValue, testValue),
    ci: buildCi(rng, isHero, deltaPp, ci95),
    metrics,
    acquisition: buildAcquisition(rng, baselineValue, deltaPp, testImpressions),
    history: buildHistory(game, rng, isHero, deltaPp, ci95, p),
    lintRules: LINT_RULES,
    logs: buildLogs(game, jobId, publishBody, creatorEvent, deltaPp, mdePp, variants[2].lint.find((l) => l.rule === 'giveaway/Robux')?.span ?? null),
    jobId,
    publishAt,
    publishBody,
    power,
    daysHeld: 7,
    benchmarkCount: 50,
    baselineImpressions: Math.round(game.playing * 5.9),
    testImpressions,
    creatorEvent,
    thumbnailEvent,
  }
}

/* Display helpers shared by the chart and the tables. */
export function fmtSigned2(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`
}

export function fmtMetricValue(v: number, unit: MetricUnit) {
  if (unit === 'pct') return `${v.toFixed(2)}%`
  if (unit === 'min') return `${v.toFixed(2)} min`
  if (unit === 'days') return v.toFixed(2)
  return new Intl.NumberFormat('en-US').format(Math.round(v))
}

export function fmtMetricDelta(v: number, unit: MetricUnit) {
  if (unit === 'pct') return `${fmtSigned2(v)}pp`
  if (unit === 'min') return `${fmtSigned2(v)} min`
  if (unit === 'days') return fmtSigned2(v)
  return `${v >= 0 ? '+' : '-'}${new Intl.NumberFormat('en-US').format(Math.abs(Math.round(v)))}`
}

export function fmtBandPct(v: number, digits = 2) {
  return `${v.toFixed(digits)}%`
}
