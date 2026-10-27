import { useState } from 'react'
import { ChevronRight, CircleCheck, FileText, Lock, Scale } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDay, fmtDayTime } from '@/lib/format'
import type { Simulation } from '@/lib/useSimulation'
import { Badge, Button, EmptyState, KeyValue, Table, Td, Th, useToast } from '@/components/ui'
import { ATTESTATION, CHECKLIST_512C3, LINK_CAP, RM_PATH, type Dataset, type RemovalRequest } from '../data'

const statusTone = { Pending: 'warn', Approved: 'live', Rejected: 'danger' } as const

/* What Rights Manager shows right now: this run's requests appear once submitted, and last
   week's request flips from Pending to Approved during the Track stage. */
function visibleRequests(sim: Simulation, data: Dataset): RemovalRequest[] {
  const submitted = sim.status === 'done' || sim.within('file') >= 0.85
  const flipped = sim.status === 'done' || sim.within('track') >= 0.45
  return data.requests
    .filter((r) => submitted || (r.name !== data.requestA && r.name !== data.requestR))
    .map((r) => (r.name === data.lastWeek.name && !flipped ? { ...r, status: 'Pending' as const, approved: undefined, rejected: undefined } : r))
}

export function RequestsTab({ sim, data }: { sim: Simulation; data: Dataset }) {
  const list = visibleRequests(sim, data)
  const [selected, setSelected] = useState<string>(data.requestA)
  const current = list.find((r) => r.name === selected) ?? list[0]
  if (list.length === 0) {
    return <EmptyState icon={FileText} sentence="Removal requests appear here once the daemon files its first notice." actionLabel="Run the daemon" onAction={sim.start} />
  }
  return (
    <div className="grid gap-24 xl:grid-cols-3">
      <div className="min-w-0 xl:col-span-2">
        <p className="mb-12 flex flex-wrap items-center gap-4 text-micro text-muted">
          Rights Manager:
          {RM_PATH.map((seg, i) => (
            <span key={seg} className="flex items-center gap-4">
              {i > 0 && <ChevronRight aria-hidden className="size-12 text-subtle" />}
              {seg}
            </span>
          ))}
        </p>
        <Table caption="Removal requests">
          <thead>
            <tr>
              <Th>Request name</Th>
              <Th numeric>Links</Th>
              <Th>Submitted</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.name} className={cn(current?.name === r.name && 'bg-raised')}>
                <Td>
                  <button type="button" onClick={() => setSelected(r.name)} aria-pressed={current?.name === r.name} className="state-layer -mx-6 flex flex-col items-start rounded-8 px-6 py-2 text-left">
                    <span className="font-mono text-micro font-medium text-ink">{r.name}</span>
                    <span className="text-micro text-muted">{r.basis === 'standing-attestation' ? 'Standing attestation, exact hash' : 'Manual review, signed per item'}</span>
                  </button>
                </Td>
                <Td numeric>
                  {r.links} <span className="text-micro text-muted">of {LINK_CAP}</span>
                </Td>
                <Td className="text-micro text-muted">{fmtDay(r.submittedAt)}</Td>
                <Td>
                  <div className="flex flex-col items-start gap-4">
                    <Badge tone={statusTone[r.status]}>{r.status}</Badge>
                    {r.approved !== undefined && (
                      <span className="tabular text-micro text-muted">
                        {r.approved} removed, {r.rejected} rejected
                      </span>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-12 text-micro text-subtle">A request holds at most {LINK_CAP} links. Past the cap the daemon opens -B, -C and so on with the same evidence bundle.</p>
      </div>
      {current && <RequestDetail r={current} />}
    </div>
  )
}

function RequestDetail({ r }: { r: RemovalRequest }) {
  return (
    <div className="min-w-0 rounded-8 bg-raised p-16">
      <div className="flex items-start justify-between gap-12">
        <h3 className="min-w-0 break-all font-mono text-label font-medium text-ink">{r.name}</h3>
        <Badge tone={statusTone[r.status]}>{r.status}</Badge>
      </div>
      <p className="mt-8 flex items-center gap-8 text-micro text-muted">
        <Lock aria-hidden className="size-12" /> No edits after submit. This request is read-only.
      </p>
      <dl className="mt-12">
        <KeyValue label="Links" value={`${r.links} of ${r.maxLinks}`} />
        <KeyValue label="Submitted" value={fmtDayTime(r.submittedAt)} />
        <KeyValue label="Basis" value={r.basis === 'standing-attestation' ? `Standing attestation, ${ATTESTATION.short}` : 'Manual review'} />
        {r.note && <KeyValue label="Note" value={r.note} />}
      </dl>
      <h4 className="mt-16 text-micro font-medium text-muted">512(c)(3) elements</h4>
      <ul className="mt-8 flex flex-col gap-4">
        {CHECKLIST_512C3.map((row, i) => (
          <li key={row.roman} className="flex items-start gap-8 text-micro">
            <CircleCheck aria-hidden className={cn('mt-2 size-12 shrink-0', r.checklist512c3[i] ? 'text-live' : 'text-subtle')} />
            <span className="w-36 shrink-0 font-mono text-muted">{row.roman}</span>
            <span className="text-ink">{row.label}</span>
          </li>
        ))}
      </ul>
      <Button size="sm" className="mt-16" disabled icon={Lock}>
        Edit request
      </Button>
    </div>
  )
}

export function ClaimsTab({ data }: { data: Dataset }) {
  const toast = useToast()
  const claims = [data.claim]
  const [flagged, setFlagged] = useState(false)
  if (claims.length === 0) {
    return <EmptyState icon={Scale} sentence="Counter-notices against your requests appear here with their restore deadline." actionLabel="Open Removal Requests" onAction={() => (window.location.hash = '#/d/dmca-daemon?focus=requests')} />
  }
  const c = data.claim
  return (
    <div className="grid gap-24 xl:grid-cols-3">
      <div className="min-w-0 xl:col-span-2">
        <Table caption="Claims against me">
          <thead>
            <tr>
              <Th>Counter-notice</Th>
              <Th>Against request</Th>
              <Th>Received</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>
                <div className="font-medium text-ink">{c.game}</div>
                <div className="text-micro text-muted">
                  <span className="font-mono">{c.id}</span> from {c.creator}, place <span className="font-mono">{c.placeId}</span>
                </div>
              </Td>
              <Td className="font-mono text-micro">{c.request}</Td>
              <Td className="text-micro text-muted">{fmtDayTime(c.receivedAt)}</Td>
              <Td>
                <Badge tone="warn" dot pulse={false}>
                  {flagged ? 'With counsel' : c.status}
                </Badge>
              </Td>
            </tr>
          </tbody>
        </Table>
        <p className="mt-12 max-w-prose text-label text-muted">{c.claim}</p>
      </div>
      <div className="min-w-0 rounded-8 bg-raised p-16">
        <h3 className="text-label font-medium text-ink">Restore window under 512(g)</h3>
        <p className="mt-8 text-micro text-muted">
          Roblox may restore the place 10 to 14 business days after the counter-notice, from {fmtDay(c.restoreAfter)}, unless you tell them a court action has been filed.
        </p>
        <dl className="mt-12">
          <KeyValue label="Received" value={fmtDay(c.receivedAt)} />
          <KeyValue label="Earliest restore" value={fmtDay(c.restoreAfter)} />
          <KeyValue label="Evidence on file" value="Screenshot, asset-delivery 200" />
        </dl>
        <Button
          size="sm"
          className="mt-16"
          disabled={flagged}
          onClick={() => {
            setFlagged(true)
            toast.push({ title: 'Sent to counsel', description: `${c.id} and its evidence bundle are with legal before ${fmtDay(c.restoreAfter)}.`, tone: 'ok' })
          }}
        >
          {flagged ? 'Sent to counsel' : 'Send to counsel'}
        </Button>
      </div>
    </div>
  )
}
