import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { Avatar, Badge, Table, Td, Th } from '@/components/ui'
import type { ExploitCluster, SellerProfile } from '../data'
import { clsDot } from '../ExploitMap'
import { Withheld } from '../shared'

export function ProfilesTab({ profiles, clusters }: { profiles: SellerProfile[]; clusters: ExploitCluster[] }) {
  const byId = new Map(clusters.map((c) => [c.id, c]))
  return (
    <div className="flex flex-col gap-12">
      <Table caption="Seller personas behind the surviving videos">
        <thead>
          <tr>
            <Th>Persona</Th>
            <Th numeric>Channels</Th>
            <Th numeric>Videos</Th>
            <Th>Pushes</Th>
            <Th>Storefront</Th>
            <Th>Discord invite</Th>
            <Th>Discord members, est.</Th>
            <Th>Last seen</Th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}>
              <Td className="min-w-280">
                <span className="flex items-start gap-12">
                  <Avatar name={p.persona} />
                  <span className="flex min-w-0 flex-col gap-2">
                    <span className="flex items-center gap-8 font-medium">
                      {p.persona}
                      <Badge tone={p.status === 'active' ? 'warn' : 'muted'}>{p.status}</Badge>
                    </span>
                    <span className="text-micro text-muted">{p.pitch}</span>
                  </span>
                </span>
              </Td>
              <Td numeric>{p.channels}</Td>
              <Td numeric>{p.videos}</Td>
              <Td>
                <span className="flex flex-col gap-4">
                  {p.clusterIds.map((id) => {
                    const c = byId.get(id)
                    if (!c) return null
                    return (
                      <span key={id} className="flex items-center gap-6 whitespace-nowrap text-micro text-muted">
                        <span aria-hidden className={cn('size-6 rounded-full', clsDot[c.cls])} />
                        {c.cls}
                      </span>
                    )
                  })}
                </span>
              </Td>
              <Td>
                <span className="flex flex-col gap-2">
                  <span className="whitespace-nowrap text-micro text-muted">{p.storefront}</span>
                  <Withheld />
                </span>
              </Td>
              <Td>
                <Withheld />
              </Td>
              <Td className="hatch tabular whitespace-nowrap rounded-8">{p.discordMembers}</Td>
              <Td className="whitespace-nowrap text-muted">{timeAgo(p.lastSeen)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="max-w-prose text-micro text-muted">
        Personas are fictional and grouped from shared descriptions, watermarks and invite codes. Member counts are estimated from invite previews, so they show as ranges. Hatched cells are estimates.
      </p>
    </div>
  )
}
