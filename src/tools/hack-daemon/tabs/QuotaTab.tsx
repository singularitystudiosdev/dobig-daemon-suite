import { fmtInt, fmtLogTime } from '@/lib/format'
import { Badge, Metric, ProgressBar, Table, Td, Th } from '@/components/ui'
import { RUN_BASE, SEARCH_CAP, VIDEOS_CAP, type ApiCall } from '../data'
import { quotaAt } from '../shared'

export function QuotaTab({ calls, t }: { calls: ApiCall[]; t: number }) {
  const shown = calls.filter((c) => c.at <= t)
  const q = quotaAt(calls, t)
  let search = 0
  let units = 0
  return (
    <div className="flex flex-col gap-24">
      <div className="grid gap-24 md:grid-cols-2">
        <div className="flex flex-col gap-8">
          <Metric label="search.list calls today" value={`${q.search} of ${SEARCH_CAP}`} hint={`${SEARCH_CAP - q.search} calls left in its own daily bucket`} />
          <ProgressBar value={q.search / SEARCH_CAP} tone="live" label={`search.list ${q.search} of ${SEARCH_CAP} calls`} />
        </div>
        <div className="flex flex-col gap-8">
          <Metric label="videos.list units today" value={`${q.units} of ${fmtInt(VIDEOS_CAP)}`} hint="1 unit per call, up to 50 video ids each" />
          <ProgressBar value={Math.max(q.units / VIDEOS_CAP, q.units ? 0.01 : 0)} tone="live" label={`videos.list ${q.units} of ${VIDEOS_CAP} units`} />
        </div>
      </div>
      <Table caption="YouTube Data API calls made by this run">
        <thead>
          <tr>
            <Th>Time</Th>
            <Th>Method</Th>
            <Th>Request</Th>
            <Th numeric>Items</Th>
            <Th numeric>Cost</Th>
            <Th numeric>Used today</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => {
            if (c.method === 'search.list') search += c.cost
            else units += c.cost
            return (
              <tr key={c.id}>
                <Td className="tabular whitespace-nowrap font-mono text-micro text-muted">{fmtLogTime(c.at, RUN_BASE)}</Td>
                <Td>
                  <Badge tone={c.method === 'search.list' ? 'data5' : 'muted'}>{c.method}</Badge>
                </Td>
                <Td className="min-w-280 break-all font-mono text-micro text-muted">{c.request}</Td>
                <Td numeric>{c.items}</Td>
                <Td numeric className="whitespace-nowrap">
                  {c.cost} {c.method === 'search.list' ? 'call' : 'unit'}
                </Td>
                <Td numeric className="whitespace-nowrap">
                  {c.method === 'search.list' ? `${search}/${SEARCH_CAP}` : `${units}/${fmtInt(VIDEOS_CAP)}`}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <p className="text-micro text-muted">Quota resets at midnight Pacific time. The next watchlist run is scheduled for 18:00 MDT.</p>
    </div>
  )
}
