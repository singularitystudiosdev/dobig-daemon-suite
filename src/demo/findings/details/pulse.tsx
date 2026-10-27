import type { ReactNode } from 'react'
import { KeyValue, Sparkline, Table, Td, Th } from '@/components/ui'
import { AutomateCta } from '@/demo/shell/AutomateCta'
import type { PulseDetail, PulseState } from '@/lib/details/pulse'
import { fmtInt } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import type { DetailViewProps } from './types'

/* Pulse Daemon: one vital of the game. It shows what the rule said on this run, the rule in words with its threshold,
   the stored readings as a small line with the numbers beside it, the figures behind the row, the sample size for server
   vitals, and what to check. Nothing here claims a cause. */

const SPARK_TONE: Record<PulseState, Tone> = { regressed: 'danger', improved: 'live', steady: 'muted', first: 'muted' }

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'None yet'
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-12 last:border-b-0 last:pb-0">
      <h3 className="text-label font-medium text-muted">{label}</h3>
      <p className="max-w-prose text-label text-ink">{children}</p>
    </div>
  )
}

export default function PulseDetailView({ detail: d }: DetailViewProps<PulseDetail>) {
  const pts = d.history.filter((p): p is { t: string; v: number } => p.v !== null)
  const show = (v: number) => (d.unit === '' ? fmtInt(v) : d.unit === ' ms' ? `${Math.round(v)}${d.unit}` : `${v.toFixed(1)}${d.unit}`)
  const low = pts.length ? Math.min(...pts.map((p) => p.v)) : 0
  const high = pts.length ? Math.max(...pts.map((p) => p.v)) : 0
  const label = `${d.historyLabel}, ${pts.length} stored readings from ${pts.length ? day(pts[0].t) : 'none'} to ${pts.length ? day(pts[pts.length - 1].t) : 'none'}`
  return (
    <div className="flex flex-col gap-24">
      <div className="grid grid-cols-1 gap-24 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-12">
          <Block label="What the rule said on this run">{d.verdict}</Block>
          <Block label="The rule">{d.rule}</Block>
          <Block label="What to check">{d.check}</Block>
        </div>
        <div className="flex min-w-0 flex-col gap-16">
          <div className="flex flex-col gap-8">
            <h3 className="text-label font-medium text-muted">{d.historyLabel}, stored readings</h3>
            {pts.length >= 2 ? (
              <div className="flex flex-wrap items-center gap-x-24 gap-y-12">
                <Sparkline data={pts.map((p) => p.v)} tone={SPARK_TONE[d.state]} width={200} height={48} label={label} />
                <dl className="flex flex-wrap gap-x-24 gap-y-8">
                  {[
                    ['Now', show(pts[pts.length - 1].v)],
                    ['Oldest stored', show(pts[0].v)],
                    ['Lowest', show(low)],
                    ['Highest', show(high)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex flex-col">
                      <dt className="text-micro text-subtle">{k}</dt>
                      <dd className="tabular text-label text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <p className="max-w-prose text-label text-muted">One reading is stored so far ({pts[0] ? show(pts[0].v) : 'none'}). The line appears after the next run.</p>
            )}
            <p className="text-micro text-subtle">
              {pts.length} stored {pts.length === 1 ? 'reading' : 'readings'}, up to 12 are kept.
            </p>
          </div>
          <Table caption={`${d.gameName}: ${d.vital} figures now and at the previous reading`}>
            <thead>
              <tr>
                <Th>Measure</Th>
                <Th numeric>Now</Th>
                <Th numeric>Previous</Th>
              </tr>
            </thead>
            <tbody>
              {d.figures.map((f) => (
                <tr key={f.label}>
                  <Td className="py-8 text-muted">{f.label}</Td>
                  <Td numeric className="py-8">{f.value}</Td>
                  <Td numeric className="py-8 text-muted">{f.before ?? 'None yet'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <dl>
            <KeyValue label="Read at" value={<span className="tabular">{when(d.fetchedAt)}</span>} />
            <KeyValue label="Previous reading" value={<span className="tabular">{when(d.previousAt)}</span>} />
            {d.sample && <KeyValue label="Servers sampled" value={<span className="tabular">{fmtInt(d.sample.servers)}</span>} />}
          </dl>
          {d.sample && (
            <p className="max-w-prose text-micro text-subtle">
              {fmtInt(d.sample.fullest)} servers came from the fullest end of the public list and {fmtInt(d.sample.emptiest)} from the emptiest end. This is a sample, not every server, and private servers are not included.
            </p>
          )}
        </div>
      </div>
      <AutomateCta slug="pulse-daemon" game={d.gameName} variant="line" />
    </div>
  )
}
