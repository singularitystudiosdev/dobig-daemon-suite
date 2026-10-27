import { cn } from '@/lib/cn'
import { fmtCompact, fmtDay, fmtInt } from '@/lib/format'
import { daemonHref } from '@/lib/router'
import type { BusEvent } from '@/data/bus'
import { Badge, Sparkline, Table, Td, Th } from '@/components/ui'
import type { ExploitCluster } from '../data'
import { clsDot } from '../ExploitMap'
import { confTone, sevTone, trendTone } from '../shared'

export function ClustersTab({ clusters, moodDrop }: { clusters: ExploitCluster[]; moodDrop?: BusEvent }) {
  const rows = clusters.slice().sort((a, b) => b.totalViews - a.totalViews)
  return (
    <div className="flex flex-col gap-12">
      <Table caption="Exploit clusters for the active game">
        <thead>
          <tr>
            <Th>Class</Th>
            <Th>System</Th>
            <Th numeric>Videos</Th>
            <Th numeric>Total views</Th>
            <Th>First seen</Th>
            <Th>Trend, 14 days</Th>
            <Th>Confidence</Th>
            <Th>Severity</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <Td>
                <span className="flex flex-col gap-2">
                  <span className="flex items-center gap-8 font-medium">
                    <span aria-hidden className={cn('size-8 shrink-0 rounded-full', clsDot[c.cls])} />
                    {c.cls}
                  </span>
                  {c.cls === 'dupe' && moodDrop && (
                    <a href={daemonHref(moodDrop.daemon, moodDrop.focus ? { focus: moodDrop.focus } : undefined)} className="pl-16 text-micro text-accent-ink underline-offset-2 hover:underline">
                      Linked to Discord Daemon {moodDrop.title.toLowerCase()}
                    </a>
                  )}
                </span>
              </Td>
              <Td>
                <span className="flex flex-col gap-2">
                  <span className={cn('text-label', c.side === 'server' ? 'font-mono' : '')}>{c.system}</span>
                  <span className="text-micro text-muted">{c.side}</span>
                </span>
              </Td>
              <Td numeric>{c.videos}</Td>
              <Td numeric title={fmtInt(c.totalViews)}>
                {fmtCompact(c.totalViews)}
              </Td>
              <Td className="whitespace-nowrap text-muted">{fmtDay(c.firstSeen)}</Td>
              <Td>
                <span className="flex items-center gap-8">
                  <Sparkline data={c.daily} tone={trendTone[c.trend]} width={72} height={20} label={`${c.cls} daily views, ${c.trend}`} />
                  <span className={cn('text-micro', c.trend === 'rising' ? 'text-danger' : 'text-muted')}>{c.trend}</span>
                </span>
              </Td>
              <Td>
                <Badge tone={confTone[c.confidence]}>{c.confidence}</Badge>
              </Td>
              <Td>
                <Badge tone={sevTone[c.severity]} dot={c.severity === 'CRIT' || c.severity === 'HIGH'} pulse={false}>
                  {c.severity}
                </Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="max-w-prose text-micro text-muted">
        Confirmed means the behaviour shows in unedited footage from at least two channels. Likely means one clean source. Unverified means the footage could be edited; treat it as a lead.
      </p>
    </div>
  )
}
