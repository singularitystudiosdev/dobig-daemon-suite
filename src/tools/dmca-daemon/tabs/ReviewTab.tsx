import type { ReactNode } from 'react'
import { Check, Inbox, X } from 'lucide-react'
import { timeAgo } from '@/lib/format'
import type { Simulation } from '@/lib/useSimulation'
import type { Game } from '@/data/games'
import { Avatar, Badge, Button, EmptyState, SkeletonRows, Table, Td, Th, useToast } from '@/components/ui'
import { Knockoff } from '../Knockoff'
import { kindIcon } from '../Stage'
import { laneCount } from '../Sorter'
import { TOTALS, type Candidate, type Dataset } from '../data'

export interface Decision {
  decision: 'approved' | 'dismissed'
  reviewer: string
  note?: string
}

export function ReviewTab({
  sim,
  data,
  game,
  decisions,
  onDecide,
}: {
  sim: Simulation
  data: Dataset
  game: Game
  decisions: Record<string, Decision>
  onDecide: (id: string, d: Decision) => void
}) {
  const toast = useToast()
  const n = sim.status === 'done' ? TOTALS.review : laneCount(sim, TOTALS.review)
  const rows = data.review.slice(0, n)
  const pending = rows.filter((c) => !decisions[c.id])
  const decided = rows.filter((c) => decisions[c.id])

  const approve = (c: Candidate) => {
    onDecide(c.id, { decision: 'approved', reviewer: 'You' })
    toast.push({ title: `Approved ${c.name}`, description: `Added to ${data.requestR}, signed per item by you. It never rides the standing attestation.`, tone: 'ok' })
  }
  const dismiss = (c: Candidate) => {
    onDecide(c.id, { decision: 'dismissed', reviewer: 'You' })
    toast.push({ title: `Dismissed ${c.name}`, description: 'Nothing is filed for this place. It returns only if a later crawl finds an exact match.', tone: 'info' })
  }

  if (rows.length === 0) {
    return sim.status === 'done' ? (
      <EmptyState icon={Inbox} sentence="Perceptual lookalikes land here for a person to decide after each crawl." actionLabel="Run the daemon" onAction={sim.start} />
    ) : (
      <SkeletonRows rows={5} />
    )
  }

  return (
    <div className="flex flex-col gap-24">
      <p className="max-w-prose text-label text-muted">
        Similar is not identical, so none of these can be filed under the standing attestation. Approving one adds it to {data.requestR}, signed per item by the reviewer.
      </p>
      {pending.length === 0 ? (
        <EmptyState icon={Inbox} sentence="Every lookalike has a decision; new perceptual matches arrive with the next crawl." actionLabel="Run the daemon again" onAction={sim.start} />
      ) : (
        <ReviewTable game={game} rows={pending} caption={`${pending.length} lookalikes waiting for a decision`}>
          {(c) => (
            <div className="flex justify-end gap-8">
              <Button size="sm" variant="primary" icon={Check} onClick={() => approve(c)}>
                Approve
              </Button>
              <Button size="sm" icon={X} onClick={() => dismiss(c)}>
                Dismiss
              </Button>
            </div>
          )}
        </ReviewTable>
      )}
      {decided.length > 0 && (
        <div>
          <h3 className="mb-8 text-label font-medium text-ink">Decided</h3>
          <ReviewTable game={game} rows={decided} caption="Decided lookalikes" decisions={decisions}>
            {(c) => {
              const d = decisions[c.id]
              return (
                <div className="flex flex-col items-end gap-4">
                  <Badge tone={d.decision === 'approved' ? 'live' : 'muted'}>{d.decision === 'approved' ? 'Approved' : 'Dismissed'}</Badge>
                  {d.note && <span className="text-micro text-muted">{d.note}</span>}
                </div>
              )
            }}
          </ReviewTable>
        </div>
      )}
    </div>
  )
}

function ReviewTable({
  game,
  rows,
  caption,
  decisions,
  children,
}: {
  game: Game
  rows: Candidate[]
  caption: string
  decisions?: Record<string, Decision>
  children: (c: Candidate) => ReactNode
}) {
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th>Candidate</Th>
          <Th>Match type</Th>
          <Th numeric>Similarity</Th>
          <Th>Toolbox / licensed check</Th>
          <Th>Reviewer</Th>
          <Th className="text-right">Decision</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const Icon = kindIcon[c.kind ?? 'image']
          const reviewer = decisions?.[c.id]?.reviewer
          return (
            <tr key={c.id}>
              <Td>
                <div className="flex items-center gap-12">
                  <Knockoff game={game} variant={c.thumbVariant} size={32} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{c.name}</div>
                    <div className="truncate text-micro text-muted">
                      <span className="font-mono">{c.placeId}</span> by {c.creator}, {timeAgo(c.detectedAt)}
                    </div>
                  </div>
                </div>
              </Td>
              <Td>
                <span className="flex items-center gap-8 text-micro">
                  <Icon aria-hidden className="size-16 text-muted" />
                  {c.kind}
                </span>
              </Td>
              <Td numeric className="font-mono text-warn">
                {c.similarity?.toFixed(2)}
              </Td>
              <Td className="text-micro">
                {c.licensed ? <span className="text-ink">Creator Store license found</span> : <span className="text-muted">Not in Toolbox or Creator Store</span>}
                {c.licenseNote && <div className="text-subtle">{c.licenseNote}</div>}
              </Td>
              <Td>
                {reviewer ? (
                  <span className="flex items-center gap-8 text-micro">
                    <Avatar name={reviewer} size={24} />
                    {reviewer}
                  </span>
                ) : (
                  <span className="text-micro text-subtle">Unassigned</span>
                )}
              </Td>
              <Td>{children(c)}</Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
