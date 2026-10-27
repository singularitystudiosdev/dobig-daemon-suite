import { useState } from 'react'
import { Camera, FileCheck2, ShieldCheck } from 'lucide-react'
import type { Simulation } from '@/lib/useSimulation'
import type { Game } from '@/data/games'
import { Badge, Button, Code, EmptyState, SkeletonRows, Table, Td, Th } from '@/components/ui'
import { Knockoff } from '../Knockoff'
import { laneCount } from '../Sorter'
import { ASSET_DELIVERY, TOTALS, shortHash, type Dataset } from '../data'

export function AutoFileTab({ sim, data, game }: { sim: Simulation; data: Dataset; game: Game }) {
  const [all, setAll] = useState(false)
  const n = sim.status === 'done' ? TOTALS.auto : laneCount(sim, TOTALS.auto)
  const rows = data.auto.slice(0, n)
  const visible = all ? rows : rows.slice(0, 12)
  const evidenced = Math.round(TOTALS.auto * sim.within('evidence'))
  const submitted = sim.within('file') >= 0.85
  const assetById = new Map(data.assets.map((a) => [a.assetId, a]))
  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-center gap-12 rounded-8 bg-raised px-16 py-12 text-label">
        <ShieldCheck aria-hidden className="size-16 shrink-0 text-live" />
        <span className="min-w-0 flex-1 text-ink">Exact sha256 matches only. A perceptual match can never enter this lane, whatever its score.</span>
        <span className="flex items-center gap-8 text-micro text-muted">
          Evidence via <Code>{ASSET_DELIVERY}</Code> scope <Code>legacy-asset:manage</Code>
        </span>
      </div>
      {rows.length === 0 ? (
        sim.status === 'done' ? (
          <EmptyState icon={ShieldCheck} sentence="Exact copies of your registered assets appear here once a crawl finds them." actionLabel="Run the daemon" onAction={sim.start} />
        ) : (
          <SkeletonRows rows={5} />
        )
      ) : (
        <>
          <Table caption="Auto-file lane: exact hash matches">
            <thead>
              <tr>
                <Th>Infringing place</Th>
                <Th numeric>universeId</Th>
                <Th>Matched asset</Th>
                <Th>Hash type</Th>
                <Th>Evidence</Th>
                <Th>Request</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c, i) => {
                const a = c.matchedAssetId ? assetById.get(c.matchedAssetId) : undefined
                const ev = i < evidenced
                return (
                  <tr key={c.id}>
                    <Td>
                      <div className="flex items-center gap-12">
                        <Knockoff game={game} variant={c.thumbVariant} size={32} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">{c.name}</div>
                          <div className="truncate text-micro text-muted">
                            <span className="font-mono">{c.placeId}</span> by {c.creator}, via {c.source}
                          </div>
                        </div>
                      </div>
                    </Td>
                    <Td numeric className="font-mono text-micro">
                      {c.universeId}
                    </Td>
                    <Td>
                      <div className="font-mono text-micro text-ink">{c.matchedAssetId}</div>
                      <div className="text-micro text-muted">{a?.name}</div>
                    </Td>
                    <Td>
                      <div className="text-micro text-ink">sha256, exact</div>
                      <div className="font-mono text-micro text-live">{a ? shortHash(a.sha256) : ''}</div>
                    </Td>
                    <Td>
                      {ev ? (
                        <span className="flex items-center gap-8 text-micro text-ink">
                          <Camera aria-hidden className="size-12 text-live" /> Screenshot
                          <FileCheck2 aria-hidden className="size-12 text-live" /> asset-delivery 200
                        </span>
                      ) : (
                        <Badge tone="muted">Capturing</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="font-mono text-micro text-ink">{data.requestA}</div>
                      {submitted ? <Badge tone="warn">Pending</Badge> : <Badge tone="muted">Draft</Badge>}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          {rows.length > 12 && (
            <div className="flex items-center justify-between gap-12">
              <span className="tabular text-micro text-muted">
                Showing {visible.length} of {rows.length}
              </span>
              <Button size="sm" onClick={() => setAll((v) => !v)}>
                {all ? 'Show first 12' : `Show all ${rows.length}`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
