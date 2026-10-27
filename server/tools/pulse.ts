import type { PulseDetail } from '../../src/lib/details/pulse.ts'
import type { Finding, RunSummary } from '../../src/lib/runTypes.ts'
import type { Tone } from '../../src/lib/tone.ts'
import { ResolveError } from '../roblox.ts'
import {
  assess,
  BADGE,
  CHECKS,
  cleanReadings,
  fmtN,
  historyOf,
  MAX_READINGS,
  OVERALL_RULE,
  RULES,
  span,
  STATE_RANK,
  takeReading,
  utcClock,
  VITAL_ORDER,
  VITAL_TITLE,
  type Assessment,
  type Reading,
} from './pulse-vitals.ts'
import { RunError, type RunContext, type ToolModule } from './types.ts'

/* Pulse Daemon: the public vital signs of a Roblox game, compared with the previous reading. Players, votes, a sample of
   the public servers (fps, ping, fill) and the last update are read from Roblox public endpoints. No login and no LLM.
   Each run stores one reading in ctx.memory (the last 12) and judges the new reading against the one before it. The rules
   live in pulse-vitals.ts and are printed in words in every row. */

const MEMORY_KEY = 'readings'

const BADGE_TONE: Record<Assessment['state'], Tone> = { regressed: 'danger', improved: 'live', steady: 'muted', first: 'muted' }
const OVERALL_TONE: Record<string, Tone> = { Sick: 'danger', Watch: 'warn', Healthy: 'live', 'First read': 'muted' }

function statusChip(a: Assessment): { label: string; tone: Tone } {
  if (a.state === 'regressed') return { label: 'Flagged', tone: 'danger' }
  if (a.state === 'improved') return { label: 'Better', tone: 'live' }
  if (a.vital === 'update' && a.flagged) return { label: 'Updated', tone: 'accent' }
  if (a.state === 'first') return { label: 'Baseline', tone: 'muted' }
  return { label: 'Not flagged', tone: 'muted' }
}

function mapError(err: unknown): never {
  if (err instanceof RunError) throw err
  if (err instanceof ResolveError) {
    const code = err.code === 'rate-limited' ? 'rate-limited' : err.code === 'not-found' ? 'not-found' : err.code === 'private' ? 'private' : 'upstream'
    throw new RunError(code, err.message, { kind: 'retry', label: 'Run again' })
  }
  throw err
}

export const tool: ToolModule = {
  async analyze(ctx: RunContext) {
    if (ctx.target.kind !== 'roblox-game') throw new RunError('bad-input', 'The Pulse Daemon reads a Roblox game.')
    const target = ctx.target
    const check = () => {
      if (ctx.signal.aborted) throw new RunError('aborted', 'The run was cancelled.')
    }
    let requests = 0
    const count = () => {
      requests++
    }

    const stored = cleanReadings(ctx.memory.get<unknown>(MEMORY_KEY))
    const prev = stored.length ? stored[stored.length - 1] : null

    ctx.step('read', 'Reading players, votes and the last update', 'active')
    let result
    try {
      result = await takeReading(target, ctx.signal, ctx.now, count)
    } catch (err) {
      ctx.step('read', 'Reading players, votes and the last update', 'failed')
      mapError(err)
    }
    check()
    const { game, reading, sampled } = result
    ctx.step(
      'read',
      'Read players, votes and the last update',
      'done',
      `${fmtN(reading.players)} playing, ${reading.ratio === null ? 'no votes' : `${reading.ratio.toFixed(1)}% liked`}`,
    )
    if (sampled.problem && sampled.servers.length === 0) ctx.step('servers', 'Sampling public servers', 'warn', sampled.problem)
    else if (sampled.problem) ctx.step('servers', 'Sampled public servers', 'warn', `${sampled.servers.length} servers, then stopped early: ${sampled.problem}`)
    else if (sampled.servers.length === 0) ctx.step('servers', 'Sampled public servers', 'warn', 'Roblox listed no public servers')
    else ctx.step('servers', 'Sampled public servers', 'done', `${fmtN(sampled.servers.length)} servers: ${fmtN(sampled.fullest)} fullest first, ${fmtN(sampled.emptiest)} emptiest first`)

    ctx.step('compare', 'Comparing with the previous reading', 'active')
    const judged = assess(prev, reading, ctx.now)
    const readings: Reading[] = [...stored, reading].slice(-MAX_READINGS)
    ctx.memory.set(MEMORY_KEY, readings)
    ctx.step('compare', 'Compared with the previous reading', 'done', prev ? `${readings.length} stored readings, ${judged.regressed} regressed` : 'First read, nothing to compare with')

    // Display order: Regressed, Improved, Steady, First read; the vital order inside each group.
    const ordered = [...judged.assessments].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || VITAL_ORDER.indexOf(a.vital) - VITAL_ORDER.indexOf(b.vital))
    const clock = utcClock(reading.t)

    const summary: RunSummary = {
      items: [
        { label: 'Overall', value: judged.overall, tone: OVERALL_TONE[judged.overall] },
        { label: 'Players now', value: fmtN(reading.players) },
        { label: 'Like ratio', value: reading.ratio === null ? 'Not available' : `${reading.ratio.toFixed(1)}%` },
        { label: 'Median fps', value: reading.fpsMedian === null ? 'Not available' : reading.fpsMedian.toFixed(1) },
        { label: 'Regressed vitals', value: String(judged.regressed), tone: judged.regressed > 0 ? 'danger' : undefined },
      ],
      sortLabel: 'Regressions first',
      notes: [
        `Players, votes, the last update and game age come from the game's public Roblox data. Server speed, latency and fill come from a sample of the public servers: up to 3 pages of 100, read from the fullest end of the list, the emptiest end, then the next fullest, so the sample is not only full servers. It had ${fmtN(reading.sampled)} servers this time. It is a sample, not every server, and private servers are not included.`,
        `Overall rule: ${OVERALL_RULE}`,
        prev ? `Compared with the previous reading, taken ${span(judged.gapMs ?? 0)} ago.` : 'This is the first reading for this daemon, so every vital is a First read and nothing is flagged.',
      ],
    }
    ctx.summary(summary)

    ctx.step('flags', 'Writing the six vitals', 'active')
    for (const a of ordered) {
      check()
      const history = historyOf(a, readings)
      const plotted = history.filter((p) => p.v !== null).map((p) => p.v as number)
      const detail: PulseDetail = {
        kind: 'pulse',
        vital: a.vital,
        state: a.state,
        gameName: game.name,
        fetchedAt: reading.t,
        previousAt: prev ? prev.t : null,
        now: a.now,
        before: a.before,
        change: a.change,
        rule: RULES[a.vital],
        verdict: a.verdict,
        updatedNote: a.updatedNote,
        figures: a.figures,
        sample: a.server && reading.sampled > 0 ? { servers: reading.sampled, fullest: reading.fullest, emptiest: reading.emptiest } : null,
        historyLabel: a.historyLabel,
        history,
        unit: a.unit,
        check: CHECKS[a.vital],
      }
      const finding: Finding = {
        id: `pulse:${a.vital}`,
        badge: { label: BADGE[a.state], tone: BADGE_TONE[a.state] },
        title: titleOf(a),
        snippet: [{ text: a.line }],
        meta: [
          { label: 'Now', value: a.now },
          { label: 'Before', value: a.before ?? 'None yet' },
          { label: 'Change', value: a.change },
          { label: 'Read', value: clock },
        ],
        status: statusChip(a),
        detail,
      }
      if (plotted.length >= 2) finding.spark = { data: plotted, tone: a.state === 'regressed' ? 'danger' : a.state === 'improved' ? 'live' : 'muted', label: `${a.historyLabel}, last ${plotted.length} readings` }
      ctx.finding(finding)
    }
    ctx.step('flags', 'Wrote the six vitals', 'done', `${requests} Roblox requests`)
  },
}

function titleOf(a: Assessment): string {
  if (a.vital === 'fps') return `${VITAL_TITLE.fps} (median)`
  if (a.vital === 'ping') return `${VITAL_TITLE.ping} (90th percentile)`
  return VITAL_TITLE[a.vital]
}
