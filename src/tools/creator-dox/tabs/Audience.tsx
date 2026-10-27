import { Globe, Users } from 'lucide-react'
import { Avatar, Badge, EmptyState, Table, Td, Th } from '@/components/ui'
import { fmtCompact, fmtPct } from '@/lib/format'
import { ModelledTag } from '../bits'
import { AS_OF, fmtReach, realReach } from '../data'
import type { TabProps } from './Overview'

export function Audience({ creator, onNavigate }: TabProps) {
  const d = creator.dossier
  const topAge = creator.ageBands[0]
  const topCountry = creator.countries[0]

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <p className="max-w-prose text-label text-muted">
          Aggregate audience estimates only. Country level only: no city, region, IP, device or account data is collected, inferred or stored.
        </p>
        <ModelledTag />
      </div>

      <div className="grid gap-24 md:grid-cols-2">
        <div className="min-w-0" title={`Modelled audience, as of ${AS_OF}`}>
          <h3 className="text-title font-bold text-ink">Age bands</h3>
          <p className="mt-4 text-label text-muted">
            {topAge.band} is the largest band at {topAge.pct}%, which is why the brief should lead with a format that band already watches.
          </p>
          {creator.ageBands.length > 0 ? (
            <div className="mt-12 flex flex-col gap-8">
              {creator.ageBands.map((band) => (
                <div key={band.band} className="flex items-center gap-8">
                  <span className="w-96 shrink-0 text-label text-muted">{band.band}</span>
                  <span className="block h-8 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
                    <span className="block h-full rounded-full bg-data-5-soft text-data-5 hatch" style={{ width: `${band.pct}%` }} />
                  </span>
                  <span className="tabular w-48 shrink-0 text-right font-mono text-micro text-ink">{band.pct}%</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Users} sentence="No age estimate survived the sample, so there is no band chart to show." actionLabel="Open the game fit tab" onAction={() => onNavigate('game-fit')} />
          )}
        </div>

        <div className="min-w-0" title={`Modelled audience, as of ${AS_OF}`}>
          <h3 className="text-title font-bold text-ink">Top countries</h3>
          <p className="mt-4 text-label text-muted">
            {topCountry.name} leads at {topCountry.pct}%. Country is the finest location this tool ever reports.
          </p>
          {creator.countries.length > 0 ? (
            <div className="mt-12 flex flex-col gap-8">
              {creator.countries.map((c) => (
                <div key={c.code} className="flex items-center gap-8">
                  <span className="w-96 shrink-0 truncate text-label text-muted">{c.name}</span>
                  <span className="block h-8 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
                    <span className="block h-full rounded-full bg-data-6-soft text-data-6 hatch" style={{ width: `${c.pct}%` }} />
                  </span>
                  <span className="tabular w-48 shrink-0 text-right font-mono text-micro text-ink">{c.pct}%</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Globe} sentence="No country mix cleared the sample size, so there is no country chart to show." actionLabel="Open the overview tab" onAction={() => onNavigate('overview')} />
          )}
        </div>
      </div>

      <div className="grid gap-16 rounded-8 border border-line bg-raised p-16 md:grid-cols-3">
        <div className="min-w-0 md:col-span-2">
          <div className="flex items-center justify-between gap-8">
            <h3 className="text-title font-bold text-ink">Credibility</h3>
            <Badge tone={d.credibilityPct >= 85 ? 'live' : d.credibilityPct >= 75 ? 'accent' : 'warn'}>{d.credibilityPct}% real</Badge>
          </div>
          <p className="mt-4 max-w-prose text-label text-muted">
            {d.credibilityPct}% of the subscriber field reads as real, so reach is about {fmtReach(realReach(d))} rather than the headline {fmtReach(d.subscribers)}. The gap is what a sponsor actually buys.
          </p>
          <p className="mt-8 text-micro text-muted">
            Estimated from watch history and public interaction patterns. It is a modelled share, never a list of accounts.
          </p>
        </div>
        <dl className="flex flex-col gap-6 text-micro">
          <div className="flex items-baseline justify-between gap-8">
            <dt className="text-muted">Headline reach</dt>
            <dd className="tabular font-mono text-ink">{fmtReach(d.subscribers)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-8">
            <dt className="text-muted">Real reach</dt>
            <dd className="tabular font-mono text-live">about {fmtReach(realReach(d))}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-8">
            <dt className="text-muted">Estimated non-human</dt>
            <dd className="tabular font-mono text-warn">{fmtPct(1 - d.credibilityPct / 100, 0)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-8">
            <dt className="text-muted">Sample error</dt>
            <dd className="tabular font-mono text-muted">2.1pp</dd>
          </div>
        </dl>
      </div>

      <div className="min-w-0">
        <h3 className="text-title font-bold text-ink">Lookalike creators</h3>
        <p className="mt-4 max-w-prose text-label text-muted">
          Five fictional channels built to match this audience. They are invented for the demo, not real accounts.
        </p>
        {creator.lookalikes.length > 0 ? (
          <Table caption="Five lookalike creators for this audience" className="mt-12">
            <thead>
              <tr>
                <Th>Creator</Th>
                <Th numeric>Subscribers</Th>
                <Th numeric>Organic ER</Th>
                <Th numeric>Game fit</Th>
                <Th>Audience overlap</Th>
              </tr>
            </thead>
            <tbody>
              {creator.lookalikes.map((l) => (
                <tr key={l.handle}>
                  <Td>
                    <div className="flex items-center gap-8">
                      <Avatar name={l.handle} size={24} />
                      <span className="font-mono text-ink">{l.handle}</span>
                    </div>
                    <span className="mt-2 block text-micro text-muted">Same age band as {creator.handle}</span>
                  </Td>
                  <Td numeric>{fmtCompact(l.subscribers)}</Td>
                  <Td numeric>{fmtPct(l.erOrganic)}</Td>
                  <Td numeric>{l.fitPct}%</Td>
                  <Td>
                    <Badge tone="muted">{l.overlapPct}% overlap</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={Users} sentence="No lookalike cleared the overlap bar for this audience." actionLabel="Open the overview tab" onAction={() => onNavigate('overview')} />
        )}
      </div>
    </div>
  )
}
