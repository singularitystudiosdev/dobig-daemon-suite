import { ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { clamp, fmtInt } from '@/lib/format'
import { useReducedMotion } from '@/lib/hooks'
import { revealed, type Simulation } from '@/lib/useSimulation'
import { Badge, Code, LogStream, ProgressBar, Skeleton, StatPill } from '@/components/ui'
import { SEARCH_CAP, T, VIDEOS_CAP, type DevBrief, type HackDataset } from './data'
import { clsDot } from './ExploitMap'
import { quotaAt, sevTone, viewT } from './shared'

/* The verbatim watchlist query, typed out during the Watchlist stage. */
export function QueryBar({ data, sim }: { data: HackDataset; sim: Simulation }) {
  const t = viewT(sim)
  const typed = clamp((t - 150) / 1100)
  const shown = data.query.slice(0, Math.round(data.query.length * typed))
  const typing = typed > 0 && typed < 1
  const paramsIn = clamp((t - 1100) / 300)
  return (
    <div className="mb-12 flex flex-col gap-8 rounded-8 border border-line bg-raised px-12 py-12">
      <div className="flex flex-wrap items-center gap-8">
        <span className="text-micro text-muted">YouTube search query</span>
        <code className="min-w-0 break-all font-mono text-label text-ink" aria-label={`Search query: ${data.query}`}>
          {shown || ' '}
          {typing && <span aria-hidden className="ml-2 inline-block h-14 w-6 translate-y-2 bg-accent-ink motion-safe:animate-blink" />}
        </code>
      </div>
      <div className="flex flex-wrap gap-6" style={{ opacity: paramsIn }}>
        {data.params.map((p) => (
          <Code key={p}>{p}</Code>
        ))}
      </div>
    </div>
  )
}

/* Aside: live quota meters, run counters and the API log. */
export function RunAside({ data, sim }: { data: HackDataset; sim: Simulation }) {
  const t = viewT(sim)
  const q = quotaAt(data.calls, t)
  const fetched = t < T.crawl ? 0 : t >= T.filter ? data.sources.length : Math.min(data.sources.length, Math.floor(((t - T.crawl - 150) * data.sources.length) / 2700))
  const struck = Object.values(data.strikeAt).filter((at) => at <= t).length
  const clustersIn = t >= T.classify + 3100 ? data.clusters.length : 0
  const lines = revealed(data.logs, sim.status === 'done' ? { t: Infinity, status: 'done' } : sim)
  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-12 rounded-8 border border-line px-12 py-12" aria-label="YouTube Data API quota today">
        <QuotaMeter method="search.list" used={q.search} cap={SEARCH_CAP} unit="calls" />
        <QuotaMeter method="videos.list" used={q.units} cap={VIDEOS_CAP} unit="units" />
        <p className="text-micro text-subtle">search.list draws on its own 100 calls a day bucket. Both reset at midnight Pacific time.</p>
      </div>
      <div className="grid grid-cols-2 gap-8">
        <StatPill label="Fetched" value={fmtInt(fetched)} />
        <StatPill label="Struck" value={fmtInt(struck)} tone={struck ? 'warn' : 'ink'} />
        <StatPill label="Real" value={t >= T.filter + 3900 ? fmtInt(fetched - struck) : '0'} tone="live" />
        <StatPill label="Clusters" value={clustersIn} />
      </div>
      <LogStream lines={lines} title="YouTube Data API log" heightClass="h-320" />
    </div>
  )
}

function QuotaMeter({ method, used, cap, unit }: { method: string; used: number; cap: number; unit: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-8">
        <span className="font-mono text-micro text-ink">{method}</span>
        <span className="tabular text-micro text-muted">
          <span className="text-label font-medium text-ink">{fmtInt(used)}</span> of {fmtInt(cap)} {unit} today
        </span>
      </div>
      <ProgressBar value={Math.max(used / cap, used ? 0.01 : 0)} tone="live" size="sm" label={`${method}: ${used} of ${cap} ${unit} used today`} />
    </div>
  )
}

/* Dev summary: briefs deal in under the map during the last stage. The headline brief gets the
   full block; the rest are list rows so no three siblings share one anatomy. */
export function BriefDeal({ data, sim, statusOf }: { data: HackDataset; sim: Simulation; statusOf: (b: DevBrief) => DevBrief['status'] }) {
  const reduced = useReducedMotion()
  const t = viewT(sim)
  const deal = (i: number) => (reduced ? (t >= T.summarise + i * 350 ? 1 : 0) : clamp((t - (T.summarise + 150 + i * 350)) / 380))
  const head = data.clusters.find((c) => c.cls === 'remote abuse')!
  const headBrief = data.briefs.find((b) => b.clusterId === head.id)!
  const rest = data.clusters.filter((c) => c.id !== head.id)
  const started = t >= T.summarise

  if (!started)
    return (
      <div className="mt-16 grid gap-16 lg:grid-cols-2" aria-busy>
        <div className="flex flex-col gap-8 rounded-8 border border-line px-16 py-16">
          <Skeleton className="h-16 w-1/2" />
          <Skeleton className="h-12 w-4/5" />
          <Skeleton className="h-12 w-3/5" />
          <p className="mt-4 text-micro text-subtle">Dev briefs land after the map.</p>
        </div>
        <div className="flex flex-col gap-12 py-4">
          {rest.map((c) => (
            <Skeleton key={c.id} className="h-16 w-full" />
          ))}
        </div>
      </div>
    )

  const style = (i: number) => ({ opacity: deal(i), transform: `translateY(${(1 - deal(i)) * 12}px)` })
  return (
    <div className="mt-16 grid gap-16 lg:grid-cols-2">
      <article className="flex flex-col gap-8 rounded-8 border border-line bg-raised px-16 py-16" style={style(0)}>
        <div className="flex flex-wrap items-center gap-8">
          <Badge tone={sevTone[head.severity]}>{head.severity}</Badge>
          <h3 className="text-label font-medium text-ink">Remote abuse on {head.system}</h3>
          <Badge tone={statusOf(headBrief) === 'patched' ? 'live' : 'warn'} className="ml-auto">
            {statusOf(headBrief)}
          </Badge>
        </div>
        <p className="text-label text-muted">
          <span className="text-ink">Likely cause.</span> {headBrief.cause}
        </p>
        <p className="text-label text-muted">
          <span className="text-ink">Server fix.</span> {headBrief.fix}
        </p>
        <p className="flex items-start gap-6 text-micro text-subtle">
          <ShieldAlert aria-hidden className="mt-2 size-12 shrink-0" />
          Client anti-tamper does not fix server trust: never trust the client.
        </p>
      </article>
      <ul className="flex flex-col" aria-label="Other dev briefs">
        {rest.map((c, i) => {
          const b = data.briefs.find((x) => x.clusterId === c.id)!
          return (
            <li key={c.id} className="flex flex-col gap-2 border-b border-line py-8 last:border-b-0" style={style(i + 1)}>
              <span className="flex items-center gap-8">
                <span aria-hidden className={cn('size-8 shrink-0 rounded-full', clsDot[c.cls])} />
                <span className="text-label font-medium text-ink">{c.cls}</span>
                <span className="truncate font-mono text-micro text-muted">{c.system}</span>
                <Badge tone={sevTone[c.severity]} className="ml-auto">
                  {c.severity}
                </Badge>
              </span>
              <span className="line-clamp-1 pl-16 text-micro text-muted">{b.fix}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
