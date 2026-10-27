import { Siren } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDayTime, fmtInt, fmtPct } from '@/lib/format'
import { Badge, EmptyState, Table, Td, Th } from '@/components/ui'
import type { DiscordDataset } from '../data'
import { Unavailable } from '../parts'

/* Drama alerts: one check every 15 minutes comparing the last 3 hours against the same hours
   last week. Volume is the primary signal so the check still works without message content. */

const verdictMeta = {
  alert: { tone: 'danger' as const, label: 'Alert' },
  watch: { tone: 'warn' as const, label: 'Watch' },
  clear: { tone: 'live' as const, label: 'Clear' },
}

function DeltaBar({ ratio }: { ratio: number }) {
  const width = Math.min(1, ratio / 3)
  return (
    <span className="inline-flex w-64 items-center gap-6">
      <span className="h-6 flex-1 overflow-hidden rounded-full bg-raised">
        <span className={cn('block h-full origin-left rounded-full', ratio >= 2 ? 'bg-danger' : ratio >= 1.2 ? 'bg-warn' : 'bg-live')} style={{ transform: `scaleX(${width})` }} />
      </span>
      <span className="tabular w-40 shrink-0 text-right font-mono text-micro text-muted">{ratio.toFixed(1)}x</span>
    </span>
  )
}

export function DramaTab({ dataset, onRecheck }: { dataset: DiscordDataset; onRecheck: () => void }) {
  const alerts = dataset.drama.checks.filter((c) => c.verdict === 'alert')
  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-end justify-between gap-16">
        <div>
          <h3 className="text-title font-bold text-ink">Drama watch</h3>
          <p className="mt-4 max-w-prose text-label text-muted">
            Every 15 minutes the daemon compares the last 3 hours against the same hours last week. {dataset.drama.baseline}. Last check {fmtDayTime(dataset.drama.lastCheckAt)}, next check {fmtDayTime(dataset.drama.nextCheckAt)}.
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-8">
          <Badge tone={alerts.length > 0 ? 'danger' : 'live'}>{alerts.length} alert{alerts.length === 1 ? '' : 's'} now</Badge>
        </span>
      </div>

      {dataset.drama.checks.length === 0 ? (
        <EmptyState icon={Siren} sentence="No topic moved enough in the last three hours to trigger a comparison, so the check has nothing to report." actionLabel="Run the check again" onAction={onRecheck} />
      ) : (
        <Table caption="Drama checks comparing the last three hours with the same hours last week">
          <thead>
            <tr>
              <Th>Topic</Th>
              <Th numeric>People, last 3h</Th>
              <Th numeric>Same hours last week</Th>
              <Th numeric>Change</Th>
              <Th numeric>{dataset.metadataOnly ? 'Negative now (unavailable)' : 'Negative now'}</Th>
              <Th numeric>Negative last week</Th>
              <Th>Verdict</Th>
            </tr>
          </thead>
          <tbody>
            {dataset.drama.checks.map((check) => {
              const ratio = check.lastWeekPeople ? check.last3hPeople / check.lastWeekPeople : 0
              const meta = verdictMeta[check.verdict]
              return (
                <tr key={check.id}>
                  <Td>
                    <div className="flex min-w-0 max-w-320 flex-col gap-4">
                      <span className="text-label font-medium text-ink">{check.topicLabel}</span>
                      <span className="text-micro text-muted">{check.note}</span>
                    </div>
                  </Td>
                  <Td numeric>{fmtInt(check.last3hPeople)}</Td>
                  <Td numeric>{fmtInt(check.lastWeekPeople)}</Td>
                  <Td numeric>
                    <DeltaBar ratio={ratio} />
                  </Td>
                  <Td numeric>{check.last3hNegative === null ? <Unavailable label="No content" /> : <span className={cn('tabular font-mono text-label', check.last3hNegative >= 0.5 ? 'text-danger' : check.last3hNegative >= 0.3 ? 'text-warn' : 'text-live')}>{fmtPct(check.last3hNegative, 0)}</span>}</Td>
                  <Td numeric>{check.lastWeekNegative === null ? <Unavailable label="No content" /> : <span className="tabular font-mono text-label text-muted">{fmtPct(check.lastWeekNegative, 0)}</span>}</Td>
                  <Td>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      <div className="grid gap-16 rounded-8 border border-line bg-raised px-16 py-12 md:grid-cols-2">
        <div>
          <h4 className="text-label font-medium text-ink">When a check fires</h4>
          <ul className="mt-8 flex flex-col gap-6 text-micro text-muted">
            <li>Alert: at least 2x the people of last week and a sentiment move of 0.15 or more.</li>
            <li>Watch: 1.2x to 2x the people, or a sentiment move between 0.08 and 0.15.</li>
            <li>Clear: volume and sentiment both inside last week's range.</li>
          </ul>
        </div>
        <div>
          <h4 className="text-label font-medium text-ink">Why this is not a vibe check</h4>
          <p className="mt-8 text-micro text-muted">
            {dataset.metadataOnly
              ? 'Volume thresholds still work without MESSAGE_CONTENT. Sentiment thresholds are skipped, so this run can only flag a surge in people.'
              : 'People are de-duplicated before the comparison, and the raid cluster is dropped, so a burst of bots cannot look like an argument. Sentiment is only one of the two signals.'}
          </p>
        </div>
      </div>
    </div>
  )
}
