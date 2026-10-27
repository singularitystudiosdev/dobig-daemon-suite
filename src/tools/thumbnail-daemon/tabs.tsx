/* The five results tabs: performance, graphs, segment matrix, variants and the API log. */

import { ChartLine, CloudUpload, Crown, FlaskConical, Info, Table2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtCompact, fmtInt, fmtPct, fmtDayTime, fmtLogTime, fmtSignedPct } from '@/lib/format'
import { toneText } from '@/lib/tone'
import type { Simulation } from '@/lib/useSimulation'
import { Badge, Code, EmptyState, Panel, SkeletonRows, Table, TabPanel, Tabs, Td, Th, type TabItem } from '@/components/ui'
import { ChartLegend, MultiLineChart, type ChartSeries } from './charts'
import {
  MAX_ACTIVE_THUMBNAILS,
  NOVELTY_HOURS,
  READ_LIMIT,
  SEGMENTS,
  SHARE_FLOOR,
  WRITE_LIMIT,
  apiCallRows,
  apiPaths,
  heatRatio,
  liveImpressionsAt,
  moderationAt,
  moderationTone,
  variantTone,
  winnerOf,
  type ThumbDataset,
  type ThumbVariant,
} from './data'

export type TabId = 'performance' | 'graphs' | 'segments' | 'variants' | 'api'

export const TABS: TabItem<TabId>[] = [
  { id: 'performance', label: 'Thumbnail Performance' },
  { id: 'graphs', label: 'Graphs' },
  { id: 'segments', label: 'Segment matrix' },
  { id: 'variants', label: 'Variants' },
  { id: 'api', label: 'API log' },
]

const TAB_IDS: TabId[] = ['performance', 'graphs', 'segments', 'variants', 'api']

export function tabFromFocus(focus: string | null): TabId {
  return TAB_IDS.find((id) => id === focus) ?? 'performance'
}

function qualifiedPlays(sim: Simulation, v: ThumbVariant) {
  if (v.impressions === 0) return 0
  return Math.round((liveImpressionsAt(sim, v) / v.impressions) * v.qualifiedPlays)
}

function PreData({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-8">
      <p className="text-micro text-muted">{label}</p>
      <SkeletonRows rows={4} />
    </div>
  )
}

/* ---- Thumbnail Performance ---- */

function PerformanceTab({ sim, dataset }: { sim: Simulation; dataset: ThumbDataset }) {
  if (sim.status === 'idle')
    return <EmptyState icon={Table2} sentence="Performance appears once the run starts exploring variants." actionLabel="Start the run" onAction={sim.start} />
  if (!sim.reached('exploit')) return <PreData label="Metrics publish when the exploit stage starts." />

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-center gap-12 rounded-8 bg-live-soft px-16 py-12">
        <Badge tone="live" dot>
          {fmtSignedPct(dataset.baselineLift)} QPTR
        </Badge>
        <p className="min-w-0 flex-1 text-label text-ink">
          Against the pre-test baseline for {dataset.game.shortName}. Roblox reports {fmtSignedPct(dataset.platformLift)} on average across personalized thumbnail tests.
        </p>
      </div>
      <p className="flex items-start gap-8 text-micro text-muted">
        <Info aria-hidden className="mt-2 size-12 shrink-0 text-warn" />
        Novelty effect: early lift often decays. The first {NOVELTY_HOURS} hours overstate the result, so treat this QPTR as provisional until the test holds for a full week.
      </p>
      <Table caption={`Thumbnail performance for ${dataset.game.shortName}, cumulative from the current run`}>
        <thead>
          <tr>
            <Th>Status</Th>
            <Th numeric>Impressions</Th>
            <Th numeric>Qualified Plays</Th>
            <Th numeric>Average Playtime</Th>
            <Th numeric>QPTR</Th>
            <Th>Winning Segment</Th>
          </tr>
        </thead>
        <tbody>
          {dataset.variants.map((v) => {
            const rejected = moderationAt(sim, v) === 'Rejected'
            return (
              <tr key={v.id}>
                <Td>
                  <div className="flex min-w-0 items-center gap-8">
                    <Badge tone={rejected ? 'danger' : v.status === 'Winner' ? 'live' : v.status === 'Minimum traffic' ? 'warn' : 'accent'}>
                      {rejected ? 'Rejected' : v.status}
                    </Badge>
                    <span className="min-w-0">
                      <span className="block truncate text-label text-ink">
                        <span className={cn('mr-6 font-mono text-micro', toneText[variantTone[v.id]])}>{v.id}</span>
                        {v.label}
                      </span>
                      <span className="block font-mono text-micro text-subtle">asset {v.assetId}</span>
                    </span>
                  </div>
                </Td>
                <Td numeric>{rejected ? '0' : fmtInt(liveImpressionsAt(sim, v))}</Td>
                <Td numeric>{rejected ? '0' : fmtInt(qualifiedPlays(sim, v))}</Td>
                <Td numeric>{rejected ? 'None' : `${v.avgPlaytimeMin.toFixed(1)} min`}</Td>
                <Td numeric>{rejected ? 'None' : fmtPct(v.qptr, 1)}</Td>
                <Td className="text-muted">{rejected ? 'No segment, no traffic' : (v.winningSegment ?? 'No segment win')}</Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <p className="text-micro text-subtle">
        Impressions are cumulative for this run. Every arm keeps a {fmtPct(SHARE_FLOOR, 0)} floor, so the losing creative still collects data instead of going dark.
      </p>
    </div>
  )
}

/* ---- Graphs ---- */

function GraphsTab({ sim, dataset }: { sim: Simulation; dataset: ThumbDataset }) {
  if (sim.status === 'idle')
    return <EmptyState icon={ChartLine} sentence="The 14 day series appears once the exploit stage runs." actionLabel="Start the run" onAction={sim.start} />
  if (!sim.reached('exploit')) return <PreData label="The daily series builds during the exploit stage." />

  const impressionSeries: ChartSeries[] = dataset.variants.map((v) => ({
    id: v.id,
    label: `${v.id} ${v.label}`,
    tone: variantTone[v.id],
    values: dataset.series[dataset.variants.indexOf(v)].map((p) => p.impressions),
    muted: v.moderationStatus === 'Rejected',
  }))
  const qptrSeries: ChartSeries[] = dataset.variants.map((v) => ({
    id: v.id,
    label: `${v.id} ${v.label}`,
    tone: variantTone[v.id],
    values: dataset.series[dataset.variants.indexOf(v)].map((p) => p.qptr),
    muted: v.moderationStatus === 'Rejected',
  }))
  const topImpression = dataset.series[1]?.at(-1)?.impressions ?? 0

  return (
    <div className="flex flex-col gap-24">
      <p className="text-micro text-muted">
        Simulated series from the current run, 14 days. These are modelled, not measured, so read the shape and not the last decimal.
      </p>
      <figure>
        <figcaption className="mb-8 flex flex-wrap items-baseline justify-between gap-8">
          <h3 className="text-label font-medium text-ink">Impressions by thumbnail</h3>
          <span className="text-micro text-subtle">simulated, 14 days</span>
        </figcaption>
        <MultiLineChart
          series={impressionSeries}
          format={fmtCompact}
          ariaLabel={`Impressions by thumbnail over 14 simulated days. ${dataset.variants[1]?.id ?? 'T2'} leads at about ${fmtCompact(topImpression)} impressions on day 14.`}
        />
        <ChartLegend series={impressionSeries} format={fmtCompact} />
        <p className="mt-8 max-w-prose text-micro text-muted">
          T2 takes most of the traffic once the bandit exploits. T4 stops on day 2, the day moderation rejected it.
        </p>
      </figure>
      <figure>
        <figcaption className="mb-8 flex flex-wrap items-baseline justify-between gap-8">
          <h3 className="text-label font-medium text-ink">Qualified play through rate by thumbnail</h3>
          <span className="text-micro text-subtle">simulated, 14 days</span>
        </figcaption>
        <MultiLineChart
          series={qptrSeries}
          format={(n) => fmtPct(n, 1)}
          maxValue={0.06}
          ariaLabel="Qualified play through rate by thumbnail over 14 simulated days. T2 rises to 4.6 percent and T3 to 4.1 percent while T1 stays near 3.7 percent."
        />
        <ChartLegend series={qptrSeries} format={(n) => fmtPct(n, 1)} />
        <p className="mt-8 max-w-prose text-micro text-muted">
          The QPTR gap between T2 and T1 is what moves traffic. A 0.9 pp gap is enough for the bandit to starve T1 down to the {fmtPct(SHARE_FLOOR, 0)} floor.
        </p>
      </figure>
    </div>
  )
}

/* ---- Segment matrix ---- */

function SegmentsTab({ sim, dataset }: { sim: Simulation; dataset: ThumbDataset }) {
  if (sim.status === 'idle')
    return <EmptyState icon={Table2} sentence="The segment matrix appears once the segment stage runs." actionLabel="Start the run" onAction={sim.start} />
  if (!sim.reached('segment')) return <PreData label="The matrix builds during the segment stage." />

  const maxQptr = Math.max(...dataset.cells.map((c) => c.qptr))
  const mobileWinner = winnerOf(dataset.cells, '9-12 Mobile')

  return (
    <div className="flex flex-col gap-16">
      <Table caption={`Modelled qualified play through rate by player segment and thumbnail for ${dataset.game.shortName}`}>
        <thead>
          <tr>
            <Th>Segment</Th>
            {dataset.variants.map((v) => (
              <Th key={v.id} numeric>
                <span className={cn('font-mono', toneText[variantTone[v.id]])}>{v.id}</span>
              </Th>
            ))}
            <Th>Winner</Th>
          </tr>
        </thead>
        <tbody>
          {SEGMENTS.map((segment) => {
            const winner = winnerOf(dataset.cells, segment)
            return (
              <tr key={segment}>
                <th scope="row" className="border-b border-line px-12 py-12 text-left text-label font-normal text-ink first:pl-0">
                  {segment}
                </th>
                {dataset.variants.map((v) => {
                  const cell = dataset.cells.find((c) => c.segment === segment && c.variantId === v.id)
                  const isWinner = cell?.variantId === winner.variantId
                  const rejected = v.moderationStatus === 'Rejected'
                  return (
                    <Td key={v.id} className="px-4 py-6">
                      <div className={cn('relative flex h-48 items-center justify-center gap-4 rounded-8 bg-raised', isWinner && 'ring-2 ring-live')}>
                        <span aria-hidden className="absolute inset-0 rounded-8 bg-accent" style={{ opacity: rejected ? 0 : 0.06 + heatRatio(cell?.qptr ?? 0, maxQptr) * 0.46 }} />
                        <span className={cn('relative tabular font-mono text-micro', rejected ? 'text-subtle' : 'text-ink')}>
                          {rejected ? 'rejected' : fmtPct(cell?.qptr ?? 0, 1)}
                        </span>
                        {isWinner && <Crown aria-hidden className="relative size-12 text-live" />}
                        {isWinner && <span className="sr-only">winner in this segment</span>}
                      </div>
                    </Td>
                  )
                })}
                <Td>
                  <span className="flex items-center gap-4 text-micro">
                    <Crown aria-hidden className="size-12 text-warn" />
                    <span className="font-mono text-ink">{winner.variantId}</span>
                    <span className="text-muted">leads</span>
                  </span>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <p className="max-w-prose text-label text-muted">
        Modelled QPTR by segment and thumbnail. T3 takes 9-12 Mobile at {fmtPct(mobileWinner.qptr, 1)} while T2 wins the other three segments, so a single global thumbnail would trade one audience for another.
      </p>
      <p className="text-micro text-subtle">Cells shade with QPTR and every winner also carries a crown, so rank never rides on colour alone. T4 has no traffic, moderation rejected it.</p>
    </div>
  )
}

/* ---- Variants ---- */

function VariantsTab({ sim, dataset }: { sim: Simulation; dataset: ThumbDataset }) {
  if (sim.status === 'idle')
    return <EmptyState icon={CloudUpload} sentence="Uploaded variants appear here once the run posts them." actionLabel="Start the run" onAction={sim.start} />
  if (!sim.reached('lint')) return <PreData label="Moderation resolves during the upload stage." />

  return (
    <div className="flex flex-col gap-12">
      <p className="text-micro text-muted">
        {dataset.variants.filter((v) => moderationAt(sim, v) !== 'Rejected').length} of {MAX_ACTIVE_THUMBNAILS} active thumbnails allowed. Rejected assets keep their record so the next test can learn from the reason.
      </p>
      <Table caption={`Uploaded variants for ${dataset.game.shortName}`}>
        <thead>
          <tr>
            <Th>Variant</Th>
            <Th>Asset ID</Th>
            <Th>Moderation</Th>
            <Th>Personalized config</Th>
            <Th>Uploaded</Th>
            <Th>Safe-zone lint</Th>
          </tr>
        </thead>
        <tbody>
          {dataset.variants.map((v) => {
            const meta = dataset.meta[v.id]
            const moderation = moderationAt(sim, v)
            return (
              <tr key={v.id}>
                <Td>
                  <span className="block truncate text-label text-ink">
                    <span className={cn('mr-6 font-mono text-micro', toneText[variantTone[v.id]])}>{v.id}</span>
                    {v.label}
                  </span>
                  <span className="block text-micro text-subtle">{meta.creative.note}</span>
                </Td>
                <Td>
                  <span className="font-mono text-micro text-ink">{fmtInt(v.assetId)}</span>
                </Td>
                <Td>
                  <Badge tone={moderationTone[moderation]}>{moderation}</Badge>
                  {moderation === 'Rejected' && <span className="mt-4 block max-w-160 text-micro text-muted">{meta.moderationReason}</span>}
                </Td>
                <Td>
                  <Badge tone={moderationAt(sim, v) === 'Rejected' ? 'muted' : meta.configStatus === 'Active' ? 'live' : 'muted'}>{meta.configStatus}</Badge>
                </Td>
                <Td>
                  <span className="font-mono text-micro text-muted">{fmtDayTime(meta.uploadedAt)}</span>
                </Td>
                <Td>
                  <span className={cn('flex items-start gap-4 text-micro', meta.lint.ok ? 'text-muted' : 'text-warn')}>
                    <TriangleAlert aria-hidden className="mt-2 size-12 shrink-0" />
                    <span className="max-w-200">{meta.lint.label}</span>
                  </span>
                  <span className="mt-4 block font-mono text-micro text-subtle">1920x1080, 16:9, 2.1 MB</span>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}

/* ---- API log ---- */

function ApiTab({ sim, dataset }: { sim: Simulation; dataset: ThumbDataset }) {
  const p = apiPaths(dataset.universeId)
  const rows = apiCallRows(dataset.universeId)
  const shown = sim.status === 'idle' ? [] : rows.filter((r) => r.at <= sim.t)
  const endpoints = [
    { label: 'List thumbnails and their status', method: 'GET', path: p.thumbnails, limit: 'read' },
    { label: 'Upload thumbnail assets', method: 'POST', path: p.uploads, limit: 'write' },
    { label: 'Update the personalization config', method: 'PATCH', path: p.update, limit: 'write' },
    { label: 'Create a config from scratch', method: 'POST', path: p.create, limit: 'write' },
  ]

  return (
    <div className="flex flex-col gap-24">
      <section aria-label="Open Cloud thumbnail personalization" className="rounded-8 border border-line bg-sunken px-16 py-12">
        <div className="flex flex-wrap items-center gap-8">
          <FlaskConical aria-hidden className="size-16 text-warn" />
          <h3 className="text-label font-medium text-ink">Open Cloud thumbnail personalization</h3>
          <Badge tone="warn">Experimental API</Badge>
        </div>
        <p className="mt-8 max-w-prose text-micro text-muted">
          Every path below is experimental and can change shape without a deprecation window. Scopes: <Code>universe.thumbnail:read</Code> and{' '}
          <Code>universe.thumbnail:write</Code>. Limits: {READ_LIMIT} requests per minute on reads, {WRITE_LIMIT} on writes.
        </p>
        <p className="mt-8 max-w-prose text-micro text-muted">
          <span className="text-ink">Update keeps the impression stats. Create resets them.</span> Attach variants with create once, then post every later config through update.
        </p>
        <ul className="mt-12 flex flex-col gap-12">
          {endpoints.map((e) => (
            <li key={e.path} className="flex min-w-0 flex-col gap-4 border-t border-line pt-8">
              <div className="flex min-w-0 flex-wrap items-center gap-8">
                <span className="w-48 shrink-0 font-mono text-micro text-muted">{e.method}</span>
                <code className="min-w-0 flex-1 break-all font-mono text-micro text-ink">{e.path}</code>
                <Badge tone="warn">Experimental API</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-8 pl-48 text-micro">
                <span className="text-muted">{e.label}</span>
                <span className="font-mono text-subtle">{e.limit} {e.limit === 'read' ? READ_LIMIT : WRITE_LIMIT}/min</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {sim.status === 'idle' ? (
        <EmptyState icon={CloudUpload} sentence="The call log fills as the run talks to Open Cloud." actionLabel="Start the run" onAction={sim.start} />
      ) : shown.length === 0 ? (
        <SkeletonRows rows={4} />
      ) : (
        <>
          <Table caption="Open Cloud calls made by this run, with the rate limit remaining after each call">
            <thead>
              <tr>
                <Th>Method</Th>
                <Th>Path</Th>
                <Th>Status</Th>
                <Th>Rate limit remaining</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <span className="font-mono text-micro text-ink">{row.method}</span>
                    <span className="mt-2 block font-mono text-micro text-subtle">{row.kind}</span>
                  </Td>
                  <Td>
                    <code className="break-all font-mono text-micro text-ink">{row.path}</code>
                    <span className="mt-4 flex flex-wrap items-center gap-6">
                      <span className="font-mono text-micro text-subtle">{fmtLogTime(row.at)}</span>
                      <Badge tone="warn">Experimental API</Badge>
                      {row.note && <span className="text-micro text-danger">{row.note}</span>}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={row.status === 429 ? 'danger' : row.status === 202 ? 'warn' : 'live'}>{row.status}</Badge>
                  </Td>
                  <Td>
                    <span className={cn('tabular font-mono text-micro', row.remaining === 0 ? 'text-danger' : 'text-ink')}>
                      {row.remaining} / {row.limit} {row.kind}
                    </span>
                    <span className="mt-2 block text-micro text-subtle">{row.kind === 'read' ? 'read limit 100 per min' : 'write limit 50 per min'}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="flex items-start gap-8 text-micro text-muted">
            <TriangleAlert aria-hidden className="mt-2 size-12 shrink-0 text-danger" />
            The 429 row backs off 1 of 5 retries with retry-after 1.2s and succeeds on the retry. Writes sit at 7 of 50 per minute, so a burst of uploads is the usual way to hit the limit.
          </p>
        </>
      )}
    </div>
  )
}

/* ---- shell ---- */

export function Results({ sim, dataset, tab, onTabChange }: { sim: Simulation; dataset: ThumbDataset; tab: TabId; onTabChange: (t: TabId) => void }) {
  return (
    <Panel title="Results" description={`Every number below belongs to the ${dataset.game.shortName} run and updates with it.`}>
      <Tabs items={TABS} value={tab} onChange={onTabChange} idPrefix="thumbnail" ariaLabel="Thumbnail results" />
      <div className="mt-16">
        <TabPanel idPrefix="thumbnail" id="performance">
          {tab === 'performance' && <PerformanceTab sim={sim} dataset={dataset} />}
        </TabPanel>
        <TabPanel idPrefix="thumbnail" id="graphs">
          {tab === 'graphs' && <GraphsTab sim={sim} dataset={dataset} />}
        </TabPanel>
        <TabPanel idPrefix="thumbnail" id="segments">
          {tab === 'segments' && <SegmentsTab sim={sim} dataset={dataset} />}
        </TabPanel>
        <TabPanel idPrefix="thumbnail" id="variants">
          {tab === 'variants' && <VariantsTab sim={sim} dataset={dataset} />}
        </TabPanel>
        <TabPanel idPrefix="thumbnail" id="api">
          {tab === 'api' && <ApiTab sim={sim} dataset={dataset} />}
        </TabPanel>
      </div>
    </Panel>
  )
}
