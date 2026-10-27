import { fmtLogTime } from '@/lib/format'
import { revealed, type Simulation } from '@/lib/useSimulation'
import { LogStream, StatPill, type LogLine } from '@/components/ui'
import { laneCounts } from './Sorter'
import { LINK_CAP, RUN_BASE, TOTALS, type Dataset } from './data'

/* Aside: live lane counters over the daemon log, both driven by the script clock. */
export function Aside({ sim, data }: { sim: Simulation; data: Dataset }) {
  const n = laneCounts(sim)
  const crawled = Math.round(TOTALS.crawled * sim.within('crawl'))
  const lines: LogLine[] = revealed(data.log, sim).map((l, i) => ({ id: i, ts: fmtLogTime(l.at, RUN_BASE), level: l.level, text: l.text }))
  return (
    <div className="flex flex-col gap-12">
      <h3 className="text-label font-medium text-ink">Lane counters</h3>
      <div className="grid grid-cols-2 gap-8" aria-live="off">
        <StatPill label="Auto-file" value={n.auto} tone="live" />
        <StatPill label="Review" value={n.review} tone="warn" />
        <StatPill label="Cleared" value={n.cleared} tone="muted" />
        <StatPill label="No match" value={n.none} tone="ink" />
      </div>
      <div className="flex items-center justify-between gap-8 text-micro text-muted">
        <span className="tabular">
          Crawled {crawled} of {TOTALS.crawled}
        </span>
        <span className="tabular">
          {data.requestA}: {n.auto} of {LINK_CAP}
        </span>
      </div>
      <LogStream lines={lines} title="dmca-daemon log" heightClass="h-512" />
    </div>
  )
}
