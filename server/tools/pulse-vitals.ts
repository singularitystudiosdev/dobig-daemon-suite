import type { PulseFigure, PulsePoint, PulseState, PulseVital } from '../../src/lib/details/pulse.ts'
import type { RobloxTarget } from '../../src/lib/runTypes.ts'
import { sleep } from '../http.ts'
import { ResolveError, robloxGetJson, takeRobloxToken } from '../roblox.ts'
import { RunError } from './types.ts'

/* Pulse Daemon: reading a game's public vital signs and judging one reading against the previous one.
   Everything here is plain code on top of the shared Roblox limiter (robloxGetJson). The judging (assess) is pure, so the
   live test can prove each rule at its exact threshold with simulated memory. */

// ---------------------------------------------------------------------------------------------- the stated rules

export const PLAYERS_DROP = 0.2
export const PLAYERS_MIN_GAP_HOURS = 3
export const RATIO_DROP_POINTS = 2
export const FPS_DROP = 0.1
export const PING_P90_RISE = 0.25
export const MAX_READINGS = 12
export const SERVER_PAGES = 3
const EPS = 1e-9

export const RULES: Record<PulseVital, string> = {
  players: `Flagged when players now are ${PLAYERS_DROP * 100} percent or more below the previous reading, and only when the two readings are at least ${PLAYERS_MIN_GAP_HOURS} hours apart, because player counts swing with the time of day. The same size rise is marked Improved.`,
  likes: `Flagged when the like ratio (up votes over up plus down votes) is ${RATIO_DROP_POINTS} points or more below the previous reading. A rise of ${RATIO_DROP_POINTS} points or more is marked Improved.`,
  fps: `Flagged when the median server fps is ${FPS_DROP * 100} percent or more below the previous reading. A rise of ${FPS_DROP * 100} percent or more is marked Improved.`,
  ping: `Flagged when the 90th percentile ping is ${PING_P90_RISE * 100} percent or more above the previous reading. A fall of ${PING_P90_RISE * 100} percent or more is marked Improved.`,
  fill: `No flag rule. Fill moves with the time of day and with which servers were sampled, so it is shown for context and never marked Regressed.`,
  update: `Called out when the game was updated after the previous reading, so a regression right after an update says so. An update is never counted as a regression by itself.`,
}

export const OVERALL_RULE = 'Sick when two or more vitals regressed, Watch when one regressed, Healthy otherwise. The first run has nothing to compare with, so it reads First read.'

export const CHECKS: Record<PulseVital, string> = {
  players: 'Compare with the same hour on earlier days before reacting, since the time of day moves this number. If it stays low, check what shipped in the last update.',
  likes: 'Check what shipped in the last update. Recent comments on the game page may show what players are reacting to.',
  fps: 'Check what runs on the server every frame and anything that changed there recently. Server fps is measured on the server, not on player devices.',
  ping: 'Ping is what players measure to reach the server, so it can rise for reasons outside your game. Compare with a few earlier readings before changing anything.',
  fill: 'Mostly empty servers can mean players are spread thin. Check the maximum players per server and how players are placed into servers.',
  update: 'If a vital regressed after an update, check what shipped in it. Roblox shows when a game was updated, not what changed.',
}

// ------------------------------------------------------------------------------------------------------ the reading

/** One stored reading. Numbers only, so memory stays small and JSON-safe. Percent values are 0 to 100. */
export interface Reading {
  t: string
  players: number
  visits: number
  favourites: number
  up: number | null
  down: number | null
  ratio: number | null
  fpsMedian: number | null
  fpsUnder30: number | null
  pingMedian: number | null
  pingP90: number | null
  fill: number | null
  sampled: number
  fullest: number
  emptiest: number
  updated: string
  created: string
}

export interface GameRef {
  universeId: number
  placeId: number
  name: string
}

interface ServerRow {
  id: string
  maxPlayers: number
  playing: number
  fps: number | null
  ping: number | null
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Nearest-rank percentile: the value at rank ceil(p * n) of the sorted list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
}

const round = (x: number | null, d: number): number | null => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d)

export function serverStats(servers: ServerRow[]) {
  const fps = servers.map((s) => s.fps).filter((x): x is number => x !== null && x > 0)
  const ping = servers.map((s) => s.ping).filter((x): x is number => x !== null && x > 0)
  const withCap = servers.filter((s) => s.maxPlayers > 0)
  const cap = withCap.reduce((a, s) => a + s.maxPlayers, 0)
  const used = withCap.reduce((a, s) => a + Math.min(s.playing, s.maxPlayers), 0)
  return {
    fpsMedian: round(median(fps), 2),
    fpsUnder30: fps.length ? round((fps.filter((x) => x < 30).length / fps.length) * 100, 1) : null,
    pingMedian: round(median(ping), 1),
    pingP90: round(percentile(ping, 0.9), 1),
    fill: cap > 0 ? round((used / cap) * 100, 2) : null,
  }
}

export interface Sampled {
  servers: ServerRow[]
  fullest: number
  emptiest: number
  /** Set when the server list could not be read at all or stopped early; shown as a step warning. */
  problem: string | null
}

/* The public server list is limited much harder than the rest of Roblox: 3 requests per 60 seconds per IP
   (x-ratelimit-limit: 3, 3;w=60). So a run reads at most 3 pages and this file keeps its own sliding window for that
   endpoint on top of the shared limiter, waits out a 429 using the reset header, and settles for a partial sample if
   Roblox still refuses. */
const SERVER_WINDOW_MS = 61_000
const SERVER_MAX_PER_WINDOW = 3
const serverStamps: number[] = []

/** For the test only: forget the recorded server list reads (used when the traffic is replayed, not sent to Roblox). */
export function resetServerWindow(): void {
  serverStamps.length = 0
}

async function takeServerSlot(signal: AbortSignal): Promise<void> {
  for (;;) {
    const now = Date.now()
    while (serverStamps.length && now - serverStamps[0] >= SERVER_WINDOW_MS) serverStamps.shift()
    if (serverStamps.length < SERVER_MAX_PER_WINDOW) {
      serverStamps.push(now)
      return
    }
    await sleep(Math.min(serverStamps[0] + SERVER_WINDOW_MS - now + 25, 5000), signal)
  }
}

async function serverPage(placeId: number, order: 'Desc' | 'Asc', cursor: string | null, signal: AbortSignal, count: () => void) {
  const q = new URLSearchParams({ limit: '100', sortOrder: order })
  if (cursor) q.set('cursor', cursor)
  const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?${q}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    await takeServerSlot(signal)
    await takeRobloxToken(signal)
    count()
    let res: Response
    try {
      const timeout = AbortSignal.timeout(15_000)
      res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.any([signal, timeout]) })
    } catch {
      if (signal.aborted) throw new RunError('aborted', 'The run was cancelled.')
      throw new ResolveError('upstream', 'Roblox did not answer the server list request.')
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'))
      const reset = Number(res.headers.get('x-ratelimit-reset'))
      await res.arrayBuffer().catch(() => undefined)
      if (attempt === 3) throw new ResolveError('rate-limited', 'Roblox allows only 3 server list reads a minute and none was free.')
      const waitS = Math.min(Math.max(Number.isFinite(retry) ? retry : 5, Number.isFinite(reset) ? reset : 0, 2), 61)
      await sleep(waitS * 1000 + 250, signal)
      continue
    }
    if (res.status !== 200) {
      await res.arrayBuffer().catch(() => undefined)
      return { ok: false as const, rows: [] as ServerRow[], next: null as string | null }
    }
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      /* non-JSON body */
    }
    const root = obj(json)
    const rows: ServerRow[] = []
    for (const r of Array.isArray(root.data) ? root.data : []) {
      const x = obj(r)
      const id = str(x.id)
      if (!id) continue
      rows.push({ id, maxPlayers: num(x.maxPlayers) ?? 0, playing: num(x.playing) ?? 0, fps: num(x.fps), ping: num(x.ping) })
    }
    return { ok: true as const, rows, next: str(root.nextPageCursor) || null }
  }
  return { ok: false as const, rows: [] as ServerRow[], next: null as string | null }
}

/** At most SERVER_PAGES pages of 100: the fullest servers first, the emptiest first, then the next fullest. Deduplicated by id. */
export async function sampleServers(placeId: number, signal: AbortSignal, count: () => void): Promise<Sampled> {
  const seen = new Map<string, ServerRow>()
  let fullest = 0
  let emptiest = 0
  let problem: string | null = null
  const read = async (order: 'Desc' | 'Asc', cursor: string | null) => {
    try {
      const res = await serverPage(placeId, order, cursor, signal, count)
      if (!res.ok) {
        problem = 'Roblox did not return the public server list.'
        return null
      }
      let added = 0
      for (const row of res.rows) {
        if (seen.has(row.id)) continue
        seen.set(row.id, row)
        added++
        if (order === 'Desc') fullest++
        else emptiest++
      }
      return { next: res.next, added, total: res.rows.length }
    } catch (e) {
      if (signal.aborted) throw e
      problem = e instanceof ResolveError ? e.message : 'Roblox did not return the server list.'
      return null
    }
  }
  const first = await read('Desc', null)
  // No second page means the whole list fit in one page: the emptiest end would only repeat it.
  if (first && first.next) {
    const asc = await read('Asc', null)
    // The emptiest end brought nothing new when the list is shorter than two pages: nothing left to sample.
    if (asc && asc.added > 0) await read('Desc', first.next)
  }
  return { servers: [...seen.values()], fullest, emptiest, problem }
}

/** Resolves the universe when the target carries none (the test passes 0), then reads games, votes and servers. */
export async function takeReading(
  target: RobloxTarget,
  signal: AbortSignal,
  now: Date,
  count: () => void,
): Promise<{ game: GameRef; reading: Reading; sampled: Sampled }> {
  let universeId = target.universeId
  if (!universeId) {
    count()
    const { status, json } = await robloxGetJson(`https://apis.roblox.com/universes/v1/places/${target.placeId}/universe`, signal)
    universeId = status === 200 ? (num(obj(json).universeId) ?? 0) : 0
    if (!universeId) throw new RunError('not-found', 'Roblox has no public game with that place id.')
  }
  count()
  const g = await robloxGetJson(`https://games.roblox.com/v1/games?universeIds=${universeId}`, signal)
  if (g.status !== 200) throw new RunError('upstream', 'Roblox could not load the game details. Run again in a minute.', { kind: 'retry', label: 'Run again' })
  const row = obj((Array.isArray(obj(g.json).data) ? (obj(g.json).data as unknown[]) : [])[0])
  if (!num(row.id) || !str(row.name) || row.name === '[TITLE UNAVAILABLE]') throw new RunError('not-found', 'Roblox shows no public game for this link.')
  if (row.isContentRestricted === true) throw new RunError('private', 'This game is private or restricted, so Roblox will not show its numbers.')
  const placeId = num(row.rootPlaceId) || target.placeId
  count()
  const v = await robloxGetJson(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`, signal)
  if (v.status !== 200) throw new RunError('upstream', 'Roblox could not load the votes. Run again in a minute.', { kind: 'retry', label: 'Run again' })
  const vote = obj((Array.isArray(obj(v.json).data) ? (obj(v.json).data as unknown[]) : []).map(obj).find((x) => num(x.id) === universeId))
  const up = num(vote.upVotes)
  const down = num(vote.downVotes)
  const ratio = up !== null && down !== null && up + down > 0 ? round((up / (up + down)) * 100, 3) : null
  const sampled = await sampleServers(placeId, signal, count)
  const stats = serverStats(sampled.servers)
  const reading: Reading = {
    t: now.toISOString(),
    players: num(row.playing) ?? 0,
    visits: num(row.visits) ?? 0,
    favourites: num(row.favoritedCount) ?? 0,
    up,
    down,
    ratio,
    ...stats,
    sampled: sampled.servers.length,
    fullest: sampled.fullest,
    emptiest: sampled.emptiest,
    updated: str(row.updated),
    created: str(row.created),
  }
  return { game: { universeId, placeId, name: str(row.name) }, reading, sampled }
}

// ----------------------------------------------------------------------------------------------- plain-words formatting

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtN = (n: number) => Math.round(n).toLocaleString('en-US')
const one = (n: number) => n.toFixed(1)
const signed = (n: number, digits: number, suffix: string) => {
  const v = Number(n.toFixed(digits))
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(digits)}${suffix}`
}
const pctText = (r: number) => signed(r * 100, 1, '%')

export function span(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 1) return 'under a minute'
  if (min < 60) return min === 1 ? '1 minute' : `${min} minutes`
  const hours = ms / 3_600_000
  if (hours < 10) {
    const h = Math.round(hours * 10) / 10
    return h === 1 ? '1 hour' : `${String(h).replace(/\.0$/, '')} hours`
  }
  if (hours < 48) return `${Math.round(hours)} hours`
  const days = Math.round(hours / 24)
  if (days < 60) return `${days} days`
  const months = days / 30.44
  if (months < 24) return `${Math.round(months)} months`
  return `${(months / 12).toFixed(1)} years`
}

export function utcDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'not available' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
export function utcClock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'not available' : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}
const utcDateTime = (iso: string) => `${utcDate(iso).replace(/, \d{4}$/, '')}, ${utcClock(iso)}`

const NA = 'Not available'

// ------------------------------------------------------------------------------------------------------------ judging

export const VITAL_ORDER: PulseVital[] = ['players', 'likes', 'fps', 'ping', 'fill', 'update']
export const VITAL_TITLE: Record<PulseVital, string> = {
  players: 'Players now',
  likes: 'Like ratio',
  fps: 'Server speed',
  ping: 'Server latency',
  fill: 'Server fill',
  update: 'Last update',
}
export const BADGE: Record<PulseState, string> = { regressed: 'Regressed', improved: 'Improved', steady: 'Steady', first: 'First read' }

export interface Assessment {
  vital: PulseVital
  state: PulseState
  /** Headline value now and then, and how it moved, exactly as the row prints them. */
  now: string
  before: string | null
  change: string
  /** One plain sentence for the row. */
  line: string
  /** What the rule said on this run (detail view). */
  verdict: string
  /** True when the rule fired. */
  flagged: boolean
  /** "updated 3 hours ago" when the game was updated after the previous reading. */
  updatedNote: string | null
  figures: PulseFigure[]
  /** The number plotted in the history line, per stored reading. */
  plot: (r: Reading) => number | null
  historyLabel: string
  unit: string
  /** True when the vital reads from the server sample. */
  server: boolean
}

export interface Judged {
  first: boolean
  gapMs: number | null
  assessments: Assessment[]
  regressed: number
  overall: 'First read' | 'Healthy' | 'Watch' | 'Sick'
}

const fpsText = (x: number | null) => (x === null ? NA : `${one(x)} fps`)
const msText = (x: number | null) => (x === null ? NA : `${Math.round(x)} ms`)
const pctPlain = (x: number | null) => (x === null ? NA : `${one(x)}%`)

/** Judges `cur` against `prev` (null on the first run). Pure: no I/O, no clock besides `now`. */
export function assess(prev: Reading | null, cur: Reading, now: Date): Judged {
  const first = prev === null
  const gapMs = prev ? Math.max(0, now.getTime() - new Date(prev.t).getTime()) : null
  const gapText = gapMs === null ? '' : span(gapMs)
  const curUpdated = new Date(cur.updated).getTime()
  const updatedSince = !!prev && Number.isFinite(curUpdated) && curUpdated > new Date(prev.updated).getTime()
  const updatedNote = updatedSince ? `updated ${span(now.getTime() - curUpdated)} ago` : null
  const afterUpdate = updatedSince ? ` It came after the update: the game was ${updatedNote}, since the previous reading.` : ''

  /* One vital judged by a numeric rule. `dir` is the bad direction: 'down' for players, ratio and fps, 'up' for ping.
     `delta` is the change as the rule measures it (ratio: percent of previous; points: absolute points). */
  const numeric = (a: {
    vital: PulseVital
    c: number | null
    p: number | null | undefined
    mode: 'pct' | 'points'
    threshold: number
    bad: 'down' | 'up'
    text: (n: number) => string
    figures: PulseFigure[]
    plot: Assessment['plot']
    historyLabel: string
    unit: string
    server: boolean
    noun: string
    minGapMs?: number
  }): Assessment => {
    const base = { vital: a.vital, updatedNote, figures: a.figures, plot: a.plot, historyLabel: a.historyLabel, unit: a.unit, server: a.server }
    if (a.c === null) {
      return { ...base, state: first ? 'first' : 'steady', now: NA, before: prev && a.p !== null && a.p !== undefined ? a.text(a.p) : null, change: NA, flagged: false, line: `${a.noun} could not be read this time, so nothing is compared.`, verdict: `${a.noun} could not be read on this run, so the rule was not applied.` }
    }
    if (prev === null || a.p === null || a.p === undefined) {
      return {
        ...base,
        state: 'first',
        now: a.text(a.c),
        before: null,
        change: 'First read',
        flagged: false,
        line: prev === null ? `First read: ${a.text(a.c)}. The next run compares with it.` : `First read of this vital: ${a.text(a.c)}. The previous reading did not have it.`,
        verdict: 'There is no earlier reading of this vital, so nothing was compared and nothing is flagged.',
      }
    }
    const diff = a.mode === 'pct' ? (a.p > 0 ? (a.c - a.p) / a.p : null) : a.c - a.p
    const changeText = diff === null ? signed(a.c - a.p, 0, '') : a.mode === 'pct' ? pctText(diff) : signed(diff, 1, ' pts')
    const badSign = a.bad === 'down' ? -1 : 1
    const moved = diff === null ? 0 : diff * badSign
    const nowT = a.text(a.c)
    const prevT = a.text(a.p)
    if (a.minGapMs !== undefined && gapMs !== null && gapMs < a.minGapMs) {
      return {
        ...base,
        state: 'steady',
        now: nowT,
        before: prevT,
        change: 'Not compared',
        flagged: false,
        line: `${nowT} now, ${prevT} ${gapText} ago. Not compared: the readings are under ${PLAYERS_MIN_GAP_HOURS} hours apart and player counts swing with the time of day.`,
        verdict: `The change is ${changeText} over ${gapText}, but the readings are under ${PLAYERS_MIN_GAP_HOURS} hours apart, so the rule did not apply and nothing is flagged.`,
      }
    }
    const regressed = diff !== null && moved >= a.threshold - EPS
    const improved = diff !== null && moved <= -(a.threshold - EPS)
    const size = a.mode === 'pct' ? `${a.threshold * 100} percent` : `${a.threshold} points`
    const gapPart = a.minGapMs !== undefined ? `, with the readings ${gapText} apart (at least ${PLAYERS_MIN_GAP_HOURS} hours, so they are compared)` : ` in ${gapText}`
    if (regressed) {
      return {
        ...base,
        state: 'regressed',
        now: nowT,
        before: prevT,
        change: changeText,
        flagged: true,
        line: `${a.noun} went from ${prevT} to ${nowT} (${changeText}) in ${gapText}.${afterUpdate}`,
        verdict: `Flagged: ${a.noun.toLowerCase()} moved ${changeText}${gapPart}. The threshold is ${size}.${afterUpdate}`,
      }
    }
    if (improved) {
      return {
        ...base,
        state: 'improved',
        now: nowT,
        before: prevT,
        change: changeText,
        flagged: false,
        line: `${a.noun} went from ${prevT} to ${nowT} (${changeText}) in ${gapText}.`,
        verdict: `Improved: ${a.noun.toLowerCase()} moved ${changeText}${gapPart}, past the ${size} threshold in the good direction.`,
      }
    }
    return {
      ...base,
      state: 'steady',
      now: nowT,
      before: prevT,
      change: changeText,
      flagged: false,
      line: `${a.noun} is ${nowT} now and was ${prevT} ${gapText} ago (${changeText}).`,
      verdict: `Not flagged: ${a.noun.toLowerCase()} moved ${changeText}${gapPart}, under the ${size} threshold.`,
    }
  }

  const serverNote = cur.sampled === 0 ? NA : `${fmtN(cur.sampled)} (${fmtN(cur.fullest)} fullest first, ${fmtN(cur.emptiest)} emptiest first)`

  const players = numeric({
    vital: 'players',
    c: cur.players,
    p: prev?.players,
    mode: 'pct',
    threshold: PLAYERS_DROP,
    bad: 'down',
    text: (n) => fmtN(n),
    figures: [
      { label: 'Players now', value: fmtN(cur.players), before: prev ? fmtN(prev.players) : null },
      { label: 'Total visits', value: fmtN(cur.visits), before: prev ? fmtN(prev.visits) : null },
      { label: 'Favourites', value: fmtN(cur.favourites), before: prev ? fmtN(prev.favourites) : null },
    ],
    plot: (r) => r.players,
    historyLabel: 'Players now',
    unit: '',
    server: false,
    noun: 'Players',
    minGapMs: PLAYERS_MIN_GAP_HOURS * 3_600_000,
  })

  const likes = numeric({
    vital: 'likes',
    c: cur.ratio,
    p: prev?.ratio,
    mode: 'points',
    threshold: RATIO_DROP_POINTS,
    bad: 'down',
    text: (n) => `${one(n)}%`,
    figures: [
      { label: 'Like ratio', value: pctPlain(cur.ratio), before: prev ? pctPlain(prev.ratio) : null },
      { label: 'Up votes', value: cur.up === null ? NA : fmtN(cur.up), before: prev ? (prev.up === null ? NA : fmtN(prev.up)) : null },
      { label: 'Down votes', value: cur.down === null ? NA : fmtN(cur.down), before: prev ? (prev.down === null ? NA : fmtN(prev.down)) : null },
    ],
    plot: (r) => r.ratio,
    historyLabel: 'Like ratio, up votes over all votes',
    unit: '%',
    server: false,
    noun: 'The like ratio',
  })

  const fps = numeric({
    vital: 'fps',
    c: cur.fpsMedian,
    p: prev?.fpsMedian,
    mode: 'pct',
    threshold: FPS_DROP,
    bad: 'down',
    text: (n) => fpsText(n),
    figures: [
      { label: 'Median server fps', value: fpsText(cur.fpsMedian), before: prev ? fpsText(prev.fpsMedian) : null },
      { label: 'Servers under 30 fps', value: pctPlain(cur.fpsUnder30), before: prev ? pctPlain(prev.fpsUnder30) : null },
      { label: 'Servers sampled', value: serverNote, before: prev ? (prev.sampled ? fmtN(prev.sampled) : NA) : null },
    ],
    plot: (r) => r.fpsMedian,
    historyLabel: 'Median server fps',
    unit: ' fps',
    server: true,
    noun: 'Median server fps',
  })

  const ping = numeric({
    vital: 'ping',
    c: cur.pingP90,
    p: prev?.pingP90,
    mode: 'pct',
    threshold: PING_P90_RISE,
    bad: 'up',
    text: (n) => msText(n),
    figures: [
      { label: 'Ping, 90th percentile', value: msText(cur.pingP90), before: prev ? msText(prev.pingP90) : null },
      { label: 'Ping, median', value: msText(cur.pingMedian), before: prev ? msText(prev.pingMedian) : null },
      { label: 'Servers sampled', value: serverNote, before: prev ? (prev.sampled ? fmtN(prev.sampled) : NA) : null },
    ],
    plot: (r) => r.pingP90,
    historyLabel: 'Ping, 90th percentile',
    unit: ' ms',
    server: true,
    noun: 'The 90th percentile ping',
  })

  // Fill has no rule: it only reports, and it never regresses.
  const fillNow = pctPlain(cur.fill)
  let fill: Assessment
  {
    const base = {
      vital: 'fill' as const,
      updatedNote,
      figures: [
        { label: 'Players over max players', value: fillNow, before: prev ? pctPlain(prev.fill) : null },
        { label: 'Servers sampled', value: serverNote, before: prev ? (prev.sampled ? fmtN(prev.sampled) : NA) : null },
      ],
      plot: (r: Reading) => r.fill,
      historyLabel: 'Server fill, players over max players',
      unit: '%',
      server: true,
      flagged: false,
    }
    if (cur.fill === null) {
      fill = { ...base, state: first ? 'first' : 'steady', now: NA, before: prev?.fill != null ? pctPlain(prev.fill) : null, change: NA, line: 'No public servers were listed, so fill could not be read.', verdict: 'Roblox listed no public servers for this game, so fill could not be read. Private servers are not included.' }
    } else if (prev === null || prev.fill === null) {
      fill = { ...base, state: 'first', now: fillNow, before: null, change: 'First read', line: `First read: public servers are ${fillNow} full in the sample.`, verdict: 'There is no earlier reading of fill. This vital has no flag rule in any case.' }
    } else {
      const d = cur.fill - prev.fill
      fill = { ...base, state: 'steady', now: fillNow, before: pctPlain(prev.fill), change: signed(d, 1, ' pts'), line: `Public servers are ${fillNow} full in the sample, ${pctPlain(prev.fill)} ${gapText} ago.`, verdict: `Fill moved ${signed(d, 1, ' points')} over ${gapText}. Fill has no flag rule, so it is never marked Regressed.` }
    }
  }

  // Last update: a call-out, not a regression.
  const ageNow = now.getTime() - curUpdated
  const gameAge = Number.isNaN(new Date(cur.created).getTime()) ? NA : span(now.getTime() - new Date(cur.created).getTime())
  const shortDate = (iso: string) => (new Date(iso).getUTCFullYear() === now.getUTCFullYear() ? utcDate(iso).replace(/, \d{4}$/, '') : utcDate(iso))
  const updNow = Number.isFinite(curUpdated) ? `${span(ageNow)} ago` : NA
  const update: Assessment = {
    vital: 'update',
    state: first ? 'first' : 'steady',
    now: shortDate(cur.updated),
    before: prev ? shortDate(prev.updated) : null,
    change: first ? 'First read' : updatedSince ? 'Updated since' : 'No update since',
    flagged: updatedSince,
    updatedNote,
    line: first
      ? `First read: last updated ${updNow}. The game is ${gameAge} old.`
      : updatedSince
        ? `The game was ${updatedNote}, after the previous reading ${gapText} ago. The game is ${gameAge} old.`
        : `No update since the previous reading ${gapText} ago. Last updated ${updNow}.`,
    verdict: first
      ? 'There is no earlier reading, so there is nothing to call out yet.'
      : updatedSince
        ? `Called out: the game was ${updatedNote}, which is after the previous reading ${gapText} ago (last update was ${utcDateTime(prev!.updated)}, now ${utcDateTime(cur.updated)}).`
        : `No update since the previous reading ${gapText} ago. The last update was ${utcDateTime(cur.updated)}.`,
    figures: [
      { label: 'Last updated', value: utcDateTime(cur.updated), before: prev ? utcDateTime(prev.updated) : null },
      { label: 'Time since the update', value: updNow, before: null },
      { label: 'Game age', value: gameAge, before: null },
    ],
    plot: (r) => {
      const u = new Date(r.updated).getTime()
      const t = new Date(r.t).getTime()
      return Number.isFinite(u) && Number.isFinite(t) ? Math.round(((t - u) / 86_400_000) * 10) / 10 : null
    },
    historyLabel: 'Days since the last update, at each reading',
    unit: ' days',
    server: false,
  }

  const assessments = [players, likes, fps, ping, fill, update]
  const regressed = assessments.filter((a) => a.state === 'regressed').length
  const overall = first ? 'First read' : regressed >= 2 ? 'Sick' : regressed === 1 ? 'Watch' : 'Healthy'
  return { first, gapMs, assessments, regressed, overall }
}

export const STATE_RANK: Record<PulseState, number> = { regressed: 0, improved: 1, steady: 2, first: 3 }

export function historyOf(a: Assessment, readings: Reading[]): PulsePoint[] {
  return readings.map((r) => ({ t: r.t, v: a.plot(r) }))
}

/** Stored readings from memory, tolerant of anything else that may be in there. */
export function cleanReadings(raw: unknown): Reading[] {
  if (!Array.isArray(raw)) return []
  const out: Reading[] = []
  for (const r of raw) {
    const x = obj(r)
    if (typeof x.t !== 'string' || Number.isNaN(new Date(x.t).getTime()) || num(x.players) === null) continue
    const n = (k: string) => num(x[k])
    out.push({
      t: x.t,
      players: n('players') ?? 0,
      visits: n('visits') ?? 0,
      favourites: n('favourites') ?? 0,
      up: n('up'),
      down: n('down'),
      ratio: n('ratio'),
      fpsMedian: n('fpsMedian'),
      fpsUnder30: n('fpsUnder30'),
      pingMedian: n('pingMedian'),
      pingP90: n('pingP90'),
      fill: n('fill'),
      sampled: n('sampled') ?? 0,
      fullest: n('fullest') ?? 0,
      emptiest: n('emptiest') ?? 0,
      updated: str(x.updated),
      created: str(x.created),
    })
  }
  return out.sort((a, b) => a.t.localeCompare(b.t)).slice(-MAX_READINGS)
}
