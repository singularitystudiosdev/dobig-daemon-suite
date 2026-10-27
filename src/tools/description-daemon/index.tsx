import { useMemo } from 'react'
import { Terminal } from 'lucide-react'
import { daemonsBySlug } from '@/data/daemons'
import { useActiveGame } from '@/context/ActiveGame'
import { ToolPage } from '@/components/shell/ToolPage'
import { RunStage } from '@/components/shell/RunStage'
import { fmtCompact, fmtLogTime, clamp } from '@/lib/format'
import { revealed, useSimulation, type Simulation } from '@/lib/useSimulation'
import { toneText, type Tone } from '@/lib/tone'
import { cn } from '@/lib/cn'
import { Badge, EmptyState, LogStream, type LogLine } from '@/components/ui'
import { buildDataset, STAGES, fmtMetricDelta, fmtSigned2, type DescriptionDataset } from './data'
import { HoldChart, ciAt } from './HoldChart'
import { CopyCards } from './CopyCards'
import { DescriptionDiff, OneChangeNotice, PublishRequest } from './Diff'
import { Results } from './tabs'

/* The page follows the active game. The body is keyed by game.id, so a game switch remounts the
   run instead of leaving a half finished test on screen. */
export default function Page() {
  const daemon = daemonsBySlug['description-daemon']
  const { game } = useActiveGame()
  return (
    <ToolPage daemon={daemon} actions={<Badge tone="accent">Experimental API</Badge>}>
      <DaemonBody key={game.id} />
    </ToolPage>
  )
}

function DaemonBody() {
  const { game } = useActiveGame()
  const sim = useSimulation(STAGES)
  const data = useMemo(() => buildDataset(game), [game])
  const p = sim.within('hold') * 7
  const daysRead = Math.floor(p)
  const dayNumber = clamp(Math.ceil(p) || 1, 1, 7)
  const [lo] = ciAt(data.ci, p)
  const lines: LogLine[] = revealed(data.logs, sim).map((entry) => ({
    id: entry.id,
    ts: fmtLogTime(entry.at),
    level: entry.level,
    text: entry.text,
  }))

  const aside = (
    <div className="flex flex-col gap-12">
      <div className="grid grid-cols-2 gap-8">
        <Counter label="Hold day" value={sim.reached('hold') ? `${dayNumber} of 7` : 'not started'} />
        <Counter label="Interval low" value={sim.reached('hold') ? `${fmtSigned2(lo)}pp` : 'no read'} tone={lo > 0 ? 'live' : 'muted'} />
        <Counter label="Reads" value={`${daysRead} of 7`} />
        <Counter label="Variants" value={sim.reached('lint') ? '2 clear, 1 blocked' : '3 drafting'} />
        <Counter label="Write budget" value="12 / 50 per min" />
        <Counter label="Analytics job" value={sim.reached('generate') ? '200, done' : 'running 3s'} tone={sim.reached('generate') ? 'live' : 'warn'} />
      </div>
      {lines.length === 0 ? (
        <EmptyState icon={Terminal} sentence="The daemon log fills as soon as the run starts." actionLabel="Start the run" onAction={sim.start} />
      ) : (
        <LogStream lines={lines} title="Daemon log" heightClass="h-240" />
      )}
      <p className="text-micro text-muted">
        Analytics reads are async jobs: the daemon POSTs the query, polls the job id, then reads the rows. The same id appears in the log.
      </p>
    </div>
  )

  return (
    <>
      <RunStage
        sim={sim}
        daemon="description-daemon"
        title="Sequential copy test"
        subtitle={
          <span>
            {game.shortName}, universe <span className="font-mono">{game.universeId}</span>
          </span>
        }
        aside={aside}
      >
        <div className="flex flex-col gap-16">
          <MdeNote data={data} />
          <OneChangeNotice data={data} />
          <HoldChart data={data} sim={sim} />

          {!sim.reached('generate') && <BenchmarkStrip data={data} />}

          {sim.reached('generate') && !sim.reached('publish') && <CopyCards data={data} sim={sim} />}

          {sim.reached('publish') && !sim.reached('hold') && (
            <div className="flex flex-col gap-12">
              <DescriptionDiff before={data.variants[0].description} after={data.variants[1].description} beforeLabel="live before Oct 19" afterLabel="variant B" />
              <PublishRequest data={data} published />
              <p className="text-micro text-muted">Publish runs after the thumbnail segment settles: 200 OK, one write against the 50 per minute budget.</p>
            </div>
          )}

          {sim.reached('verdict') && <VerdictBlock data={data} />}
        </div>
      </RunStage>

      <Results data={data} sim={sim} />
    </>
  )
}

function Counter({ label, value, tone = 'ink' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-8 bg-raised px-8 py-8">
      <div className="truncate text-micro text-muted">{label}</div>
      <div className={cn('tabular mt-2 truncate font-mono text-micro', toneText[tone])}>{value}</div>
    </div>
  )
}

function MdeNote({ data }: { data: DescriptionDataset }) {
  return (
    <div className="flex flex-wrap items-center gap-8 rounded-8 border border-line bg-raised px-12 py-8">
      <Badge tone="warn">7+ days</Badge>
      <span className="text-label text-ink">
        Needs 7+ days of impressions to detect a {data.test.mdePp.toFixed(2)}pp move.
      </span>
      <span className="text-micro text-muted">The minimum detectable effect is fixed before the run, and the run changes one thing at a time.</span>
    </div>
  )
}

function BenchmarkStrip({ data }: { data: DescriptionDataset }) {
  const ticks = Array.from({ length: 40 }, (_, i) => 8 + Math.round(Math.abs(Math.sin((i + 3) * 0.7)) * 26))
  return (
    <div className="rounded-8 border border-line bg-sunken px-12 py-12">
      <div className="flex flex-wrap items-center justify-between gap-8">
        <span className="text-label font-medium text-ink">Benchmark cohort</span>
        <Badge tone="accent">50+ similar experiences</Badge>
      </div>
      <div aria-hidden className="mt-8 flex h-32 items-end gap-2">
        {ticks.map((h, i) => (
          <span key={i} className="w-4 rounded-full bg-line-strong" style={{ height: `${h}px` }} />
        ))}
      </div>
      <p className="mt-8 text-micro text-muted">
        Benchmark p50 {data.metrics[0].benchmark.toFixed(2)}%. Your 28-day read is {data.test.baselineValue.toFixed(2)}% over {fmtCompact(data.baselineImpressions)} impressions, with Saturday peaks in the band.
      </p>
    </div>
  )
}

function VerdictBlock({ data }: { data: DescriptionDataset }) {
  return (
    <div className="grid gap-16 rounded-8 border border-line bg-sunken p-16 md:grid-cols-3">
      <div className="flex flex-col items-start justify-center gap-8">
        <div className="flex -rotate-6 items-center justify-center rounded-8 border-4 border-live px-24 py-12 motion-safe:animate-stamp">
          <span className="text-display text-live">KEEP</span>
        </div>
        <p className="text-micro text-muted">Verdict: keep variant B on Home traffic.</p>
      </div>
      <div className="flex flex-col gap-8 md:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-8">
          <span className="text-label font-medium text-ink">Secondary metrics</span>
          <Badge tone="live">guardrails pass</Badge>
        </div>
        {data.test.guardrails.map((g) => (
          <div key={g.metric} className="flex flex-wrap items-center justify-between gap-8 rounded-8 bg-raised px-12 py-8">
            <span className="font-mono text-micro text-ink">{g.metric}</span>
            <span className="flex items-center gap-8">
              <span className="tabular text-label text-muted">flat, {fmtMetricDelta(g.delta, data.metrics.find((m) => m.metric === g.metric)?.unit ?? 'pct')}</span>
              <Badge tone="live">guardrail pass</Badge>
            </span>
          </div>
        ))}
        <p className="text-micro text-muted">
          RFYDuration0To60 flat and RFYD1Playtime flat, so no guardrail moved. The keep moves {data.test.deltaPp.toFixed(2)}pp of play-through on Home recommendations at a 95% interval of [
          {fmtSigned2(data.test.ci95[0])}, {fmtSigned2(data.test.ci95[1])}].
        </p>
        <p className="text-micro text-muted">A rollback is one call away: PATCH the previous description back to /cloud/v2/universes/{data.test.universeId}.</p>
      </div>
    </div>
  )
}

/* Kept for the results panel: the run's own summary line, so a paused frame is readable. */
export function runSummary(sim: Simulation, data: DescriptionDataset) {
  const p = sim.within('hold') * 7
  return `${data.game.shortName}: hold day ${Math.ceil(clamp(p)) || 0} of 7`
}
