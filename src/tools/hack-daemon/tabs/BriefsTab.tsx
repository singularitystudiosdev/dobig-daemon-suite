import { CircleCheck, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { daemonHref } from '@/lib/router'
import type { BusEvent } from '@/data/bus'
import { Badge, Button, Table, Td, Th } from '@/components/ui'
import type { DevBrief, ExploitCluster } from '../data'
import { clsDot } from '../ExploitMap'
import { sevTone, statusTone } from '../shared'

export function BriefsTab({
  clusters,
  briefs,
  statusOf,
  onPatched,
  moodDrop,
}: {
  clusters: ExploitCluster[]
  briefs: DevBrief[]
  statusOf: (b: DevBrief) => DevBrief['status']
  onPatched: (b: DevBrief) => void
  moodDrop?: BusEvent
}) {
  const byId = new Map(clusters.map((c) => [c.id, c]))
  const rank = { CRIT: 0, HIGH: 1, MED: 2, LOW: 3 }
  const rows = briefs.slice().sort((a, b) => rank[byId.get(a.clusterId)!.severity] - rank[byId.get(b.clusterId)!.severity])
  return (
    <div className="flex flex-col gap-16">
      <div className="flex items-start gap-12 rounded-8 border border-line bg-raised px-16 py-12">
        <ShieldAlert aria-hidden className="mt-2 size-16 shrink-0 text-warn" />
        <p className="max-w-prose text-label text-muted">
          <span className="font-medium text-ink">Client anti-tamper does not fix server trust: never trust the client.</span> Hyperion raises the cost of injecting code, but every fix below is server-side: validate RemoteEvent and
          RemoteFunction arguments, distance, cooldowns and ownership on the server, per Roblox security guidance.
        </p>
      </div>
      <Table caption="Developer briefs, one per exploit cluster">
        <thead>
          <tr>
            <Th>Cluster</Th>
            <Th>Observed behaviour</Th>
            <Th>Likely cause</Th>
            <Th>Fix</Th>
            <Th>Patch status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const c = byId.get(b.clusterId)!
            const status = statusOf(b)
            return (
              <tr key={b.clusterId} className="align-top">
                <Td className="w-176 align-top">
                  <span className="flex flex-col gap-4">
                    <span className="flex items-center gap-8 font-medium">
                      <span aria-hidden className={cn('size-8 shrink-0 rounded-full', clsDot[c.cls])} />
                      {c.cls}
                    </span>
                    <span className="font-mono text-micro text-muted">{c.system}</span>
                    <Badge tone={sevTone[c.severity]} className="self-start">
                      {c.severity}
                    </Badge>
                  </span>
                </Td>
                <Td className="min-w-200 align-top text-muted">{b.observed}</Td>
                <Td className="min-w-200 align-top text-muted">
                  {b.cause}
                  {c.cls === 'dupe' && moodDrop && (
                    <a href={daemonHref(moodDrop.daemon, moodDrop.focus ? { focus: moodDrop.focus } : undefined)} className="mt-4 block text-micro text-accent-ink underline-offset-2 hover:underline">
                      Discord Daemon mood drop cites this cluster
                    </a>
                  )}
                </Td>
                <Td className="min-w-240 align-top">{b.fix}</Td>
                <Td className="w-144 align-top">
                  <span className="flex flex-col items-start gap-8">
                    <Badge tone={statusTone[status]} dot pulse={false}>
                      {status}
                    </Badge>
                    {status !== 'patched' && (
                      <Button size="sm" icon={CircleCheck} onClick={() => onPatched(b)} aria-label={`Mark ${c.cls} on ${c.system} patched`}>
                        Mark patched
                      </Button>
                    )}
                  </span>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}
