import { useState } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { clamp, fmtCompact, fmtDay, fmtDayTime } from '@/lib/format'
import { useRoute } from '@/lib/router'
import { cn } from '@/lib/cn'
import type { Simulation } from '@/lib/useSimulation'
import { Badge, Code, EmptyState, KeyValue, Panel, SkeletonRows, TabPanel, Table, Tabs, Td, Th, type TabItem } from '@/components/ui'
import { DescriptionDiff, PublishRequest } from './Diff'
import {
  fmtMetricDelta,
  fmtMetricValue,
  fmtSigned2,
  type AcquisitionRow,
  type DescriptionDataset,
  type HistoryRow,
  type MetricRow,
} from './data'

const TAB_IDS = ['test', 'metrics', 'acquisition', 'history', 'lint'] as const
type TabId = (typeof TAB_IDS)[number]

function daysReadFor(sim: Simulation) {
  return Math.floor(clamp(sim.within('hold')) * 7)
}

function partialTest(row: MetricRow, share: number) {
  return row.baseline + row.delta * share
}

export function Results({ data, sim }: { data: DescriptionDataset; sim: Simulation }) {
  const { query } = useRoute()
  const [tab, setTab] = useState<TabId>(() => {
    const focus = query.get('focus')
    return focus && (TAB_IDS as readonly string[]).includes(focus) ? (focus as TabId) : 'test'
  })
  const daysRead = daysReadFor(sim)

  const items: TabItem<TabId>[] = [
    { id: 'test', label: 'Test' },
    { id: 'metrics', label: 'Metrics', count: data.metrics.length },
    { id: 'acquisition', label: 'Acquisition', count: data.acquisition.length },
    { id: 'history', label: 'History', count: data.history.length },
    { id: 'lint', label: 'Lint rules', count: data.lintRules.length },
  ]

  return (
    <Panel
      title="Results"
      description={`Every row belongs to ${data.game.shortName}. A partial window says so, and a rate is never shown as a single number where the interval is the answer.`}
      actions={
        <Badge tone="muted">
          {sim.status === 'done' ? 'Cycle closed' : daysRead > 0 ? `day ${Math.min(daysRead, 7)} of 7 read` : 'pre read'}
        </Badge>
      }
    >
      <Tabs items={items} value={tab} onChange={setTab} idPrefix="description" ariaLabel="Description test results" />
      <div className="pt-16">
        <TabPanel idPrefix="description" id="test">
          {tab === 'test' && <TestTab data={data} sim={sim} />}
        </TabPanel>
        <TabPanel idPrefix="description" id="metrics">
          {tab === 'metrics' && <MetricsTab data={data} sim={sim} />}
        </TabPanel>
        <TabPanel idPrefix="description" id="acquisition">
          {tab === 'acquisition' && <AcquisitionTab data={data} sim={sim} />}
        </TabPanel>
        <TabPanel idPrefix="description" id="history">
          {tab === 'history' && <HistoryTab rows={data.history} onOpenTest={() => setTab('test')} />}
        </TabPanel>
        <TabPanel idPrefix="description" id="lint">
          {tab === 'lint' && <LintTab data={data} />}
        </TabPanel>
      </div>
    </Panel>
  )
}

function TestTab({ data, sim }: { data: DescriptionDataset; sim: Simulation }) {
  const daysRead = daysReadFor(sim)
  const held = sim.reached('hold')
  const published = sim.reached('publish')
  const ci = daysRead > 0 ? data.ci[Math.min(daysRead, 7) - 1] : null
  const delta = held && daysRead > 0 ? data.test.deltaPp * (daysRead / 7) : null
  const variantA = data.variants[0]
  const variantB = data.variants[1]

  return (
    <div className="flex flex-col gap-16">
      <dl className="grid gap-x-24 md:grid-cols-2">
        <KeyValue label="Primary metric" value="RFYPlayThroughRate" mono />
        <KeyValue label="Published" value={published ? fmtDayTime(data.publishAt) : 'waiting on the thumbnail hold'} />
        <KeyValue label="Minimum detectable effect" value={`${data.test.mdePp.toFixed(2)}pp, needs 7+ days`} />
        <KeyValue label="Days held" value={held ? `${daysRead} of 7, Oct 19 to Oct 25` : '7 planned, Oct 19 to Oct 25'} />
        <KeyValue label="Observed delta" value={delta === null ? 'waiting for the first read' : `${fmtSigned2(delta)}pp, ${daysRead} of 7 days`} />
        <KeyValue label="95% interval" value={ci ? `[${fmtSigned2(ci[0])}, ${fmtSigned2(ci[1])}]` : 'no interval yet'} mono />
        <KeyValue label="Power" value={`${Math.round(data.power * 100)}% at 7 days`} />
        <KeyValue label="Universe" value={data.test.universeId} mono />
      </dl>

      <p className="max-w-prose text-micro text-muted">
        The interval is a range, not a point. The run keeps the variant only when the lower edge clears zero, and a rollback is one PATCH away.
      </p>

      <h3 className="text-label font-medium text-ink">Before and after</h3>
      {sim.reached('generate') ? (
        <DescriptionDiff before={variantA.description} after={variantB.description} beforeLabel="live before Oct 19" afterLabel="variant B" />
      ) : (
        <>
          <p className="text-micro text-muted">Variant B is still being drafted from the live description.</p>
          <SkeletonRows rows={4} />
        </>
      )}

      <PublishRequest data={data} published={published} />
    </div>
  )
}

function MetricLabel({ row }: { row: MetricRow }) {
  const role = row.role === 'primary' ? 'Primary metric' : row.role === 'guardrail' ? 'Guardrail, no regression allowed' : 'Watched, no gate'
  return (
    <span className="flex flex-col">
      <span className="font-mono text-micro text-ink">{row.metric}</span>
      <span className="text-micro text-muted">{role}</span>
    </span>
  )
}

function deltaTone(row: MetricRow) {
  const good = row.lowerIsBetter ? row.delta <= 0 : row.delta >= 0
  if (Math.abs(row.delta) < 0.001) return 'text-muted'
  return good ? 'text-live' : 'text-danger'
}

function MetricsTab({ data, sim }: { data: DescriptionDataset; sim: Simulation }) {
  const daysRead = daysReadFor(sim)
  if (!sim.reached('hold') || daysRead === 0) {
    return (
      <div className="flex flex-col gap-12">
        <p className="text-micro text-muted">The baseline column lands when the analytics job returns. The test column waits for the first daily read.</p>
        <SkeletonRows rows={6} />
      </div>
    )
  }
  const share = daysRead / 7
  return (
    <div className="flex flex-col gap-12">
      <Table caption={`Metrics for ${data.game.shortName}, 28 day baseline against ${daysRead} days of the test window, with the benchmark p50 from 50 or more similar experiences`}>
        <thead>
          <tr>
            <Th>Metric</Th>
            <Th numeric>Baseline (28d)</Th>
            <Th numeric>Test ({daysRead}d)</Th>
            <Th numeric>Delta</Th>
            <Th numeric>Benchmark p50</Th>
            <Th>Guardrail</Th>
          </tr>
        </thead>
        <tbody>
          {data.metrics.map((row) => (
            <tr key={row.metric} className={row.role === 'primary' ? 'bg-accent-soft' : undefined}>
              <Td>
                <MetricLabel row={row} />
              </Td>
              <Td numeric>{fmtMetricValue(row.baseline, row.unit)}</Td>
              <Td numeric>{fmtMetricValue(partialTest(row, share), row.unit)}</Td>
              <Td numeric className={deltaTone(row)}>
                {fmtMetricDelta(row.delta * share, row.unit)}
              </Td>
              <Td numeric>{fmtMetricValue(row.benchmark, row.unit)}</Td>
              <Td>
                {row.role === 'guardrail' ? (
                  <Badge tone="live">pass</Badge>
                ) : row.role === 'primary' ? (
                  <Badge tone="accent">primary</Badge>
                ) : (
                  <span className="text-micro text-subtle">watch</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="max-w-prose text-micro text-muted">
        Home Recommendations playtime is capped at 60 min per user per day, so RFYD1Playtime cannot climb past the cap. Roblox warns of a temporary play-through-rate drop when impressions rise, which is why the test window is a full weekly cycle.
      </p>
    </div>
  )
}

function AcquisitionTab({ data, sim }: { data: DescriptionDataset; sim: Simulation }) {
  const daysRead = daysReadFor(sim)
  if (!sim.reached('hold') || daysRead === 0) {
    return (
      <div className="flex flex-col gap-12">
        <p className="text-micro text-muted">Source rows land after the first daily read of the test window.</p>
        <SkeletonRows rows={5} />
      </div>
    )
  }
  const share = daysRead / 7
  const home = data.acquisition.find((r) => r.isolated)
  return (
    <div className="flex flex-col gap-12">
      {home && (
        <div className="rounded-8 border border-accent-ink bg-accent-soft px-12 py-8">
          <div className="flex flex-wrap items-center gap-8">
            <Badge tone="accent">Home recommendations isolated</Badge>
            <span className="text-label text-ink">
              {home.share.toFixed(1)}% of impressions, {fmtSigned2(home.change)}pp QPTR
            </span>
          </div>
          <p className="mt-4 text-micro text-muted">The test reads Home recommendations on their own, because a wider Home surface can lift impressions while it dips play-through, and that is expected.</p>
        </div>
      )}
      <Table caption={`Impressions and QPTR by source for ${data.game.shortName} over ${daysRead} days of the test window`}>
        <thead>
          <tr>
            <Th>Source</Th>
            <Th numeric>Impressions to date</Th>
            <Th numeric>Share</Th>
            <Th numeric>QPTR</Th>
            <Th numeric>Change vs baseline</Th>
          </tr>
        </thead>
        <tbody>
          {data.acquisition.map((row) => (
            <AcquisitionRowView key={row.source} row={row} share={share} />
          ))}
        </tbody>
      </Table>
      <p className="max-w-prose text-micro text-muted">
        Home Recommendations playtime is capped at 60 min per user per day. Impressions are counted to date, so a partial window is labelled with its day count rather than filled out to seven.
      </p>
    </div>
  )
}

function AcquisitionRowView({ row, share }: { row: AcquisitionRow; share: number }) {
  return (
    <tr className={row.isolated ? 'bg-accent-soft' : undefined}>
      <Td>
        <span className="flex items-center gap-8">
          <span className="text-label text-ink">{row.source}</span>
          {row.isolated && <Badge tone="accent">isolated</Badge>}
        </span>
      </Td>
      <Td numeric>{fmtCompact(Math.round(row.impressions * share))}</Td>
      <Td numeric>{row.share.toFixed(1)}%</Td>
      <Td numeric>{row.qptr.toFixed(2)}%</Td>
      <Td numeric className={row.change >= 0 ? 'text-live' : 'text-danger'}>
        {`${row.change >= 0 ? '+' : ''}${row.change.toFixed(2)}pp`}
      </Td>
    </tr>
  )
}

function verdictTone(verdict: HistoryRow['verdict']): 'live' | 'danger' | 'warn' | 'muted' {
  if (verdict === 'keep') return 'live'
  if (verdict === 'roll back' || verdict === 'blocked') return 'danger'
  if (verdict === 'extend') return 'warn'
  return 'muted'
}

function HistoryTab({ rows, onOpenTest }: { rows: HistoryRow[]; onOpenTest: () => void }) {
  if (rows.length === 0) {
    return <EmptyState icon={HistoryIcon} sentence="No description version has run on this universe yet." actionLabel="Open the test tab" onAction={onOpenTest} />
  }
  return (
    <Table caption="Every description version on this universe with its live window, verdict and primary delta">
      <thead>
        <tr>
          <Th>Version</Th>
          <Th>Live from</Th>
          <Th>To</Th>
          <Th>Verdict</Th>
          <Th numeric>delta QPTR</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.version}>
            <Td>
              <span className="flex flex-col">
                <span className="font-mono text-micro text-ink">{row.version}</span>
                <span className="max-w-320 text-micro text-muted">{row.note}</span>
              </span>
            </Td>
            <Td className="whitespace-nowrap font-mono text-micro">{dateLabel(row.from)}</Td>
            <Td className="whitespace-nowrap font-mono text-micro">{dateLabel(row.to)}</Td>
            <Td>
              <Badge tone={verdictTone(row.verdict)}>{row.verdict === 'roll back' ? 'rolled back' : row.verdict}</Badge>
            </Td>
            <Td numeric>{row.deltaPp === null ? 'n/a' : `${fmtSigned2(row.deltaPp)}pp`}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function dateLabel(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? fmtDay(value + 'T12:00:00') : value
}

function LintTab({ data }: { data: DescriptionDataset }) {
  return (
    <div className="flex flex-col gap-12">
      <p className="max-w-prose text-micro text-muted">
        Roblox demotes misleading metadata, giveaway or Robux wording and keyword spam. The daemon runs every draft through all three rules before it publishes anything.
      </p>
      <ul className="divide-y divide-line rounded-8 border border-line">
        {data.lintRules.map((rule, index) => (
          <li key={rule.rule} className="flex flex-col gap-4 px-12 py-12 md:flex-row md:items-start md:gap-16">
            <div className="md:w-1/3">
              <span className="flex items-center gap-8">
                <Badge tone="danger">{rule.rule}</Badge>
                <span className="text-micro text-subtle">rule {index + 1}</span>
              </span>
              <p className="mt-4 text-label font-medium text-ink">{rule.title}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-micro text-muted">
                <span className="text-ink">Flags:</span> {rule.flags}
              </p>
              <p className="mt-2 text-micro text-muted">
                <span className="text-ink">Why:</span> {rule.policy}
              </p>
              <p className="mt-4">
                <Code>span check</Code> <span className="text-micro text-muted">runs on the rendered draft text, and a failed span blocks the draft.</span>
              </p>
            </div>
            <Badge tone="live">active</Badge>
          </li>
        ))}
      </ul>
      <p className="max-w-prose text-micro text-muted">
        A blocked draft never reaches the universe. Its span and rule land in the run log, and the history tab keeps the blocked version beside the ones that shipped.
      </p>
      <p className={cn('text-micro', 'text-muted')}>
        The current draft under test is {data.variants[1].displayName}, which passed all three rules. {data.variants[2].displayName} failed {data.variants[2].lint.length}.
      </p>
    </div>
  )
}
