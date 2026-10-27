import { ShieldCheck, UserMinus } from 'lucide-react'
import { fmtInt, fmtPct } from '@/lib/format'
import { Badge, EmptyState, Table, Td, Th } from '@/components/ui'
import { EXCLUSION_LABEL, exclusionTotals, type DiscordDataset } from '../data'

/* Excluded: the accounts the sentiment read leaves out, and why. This is the credibility tab:
   every number on the other tabs is people-weighted after these rows are removed. */

const why: Record<'staff' | 'raid' | 'bot', string> = {
  staff: 'Moderators answer more than they opine, so their messages would pull sentiment toward the team line.',
  raid: 'All 82 accounts joined inside one window and posted in bursts. No profile history is kept; the cluster is matched on join time and posting pattern.',
  bot: 'Webhooks and bots post announcements, timestamps and embeds, which carry no sentiment.',
}

export function ExcludedTab({ dataset }: { dataset: DiscordDataset }) {
  const totals = exclusionTotals(dataset.exclusions)
  const ordered = [...dataset.exclusions].sort((a, b) => b.accounts - a.accounts)
  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-end justify-between gap-16">
        <div>
          <h3 className="text-title font-bold text-ink">Weighed out before counting</h3>
          <p className="mt-4 max-w-prose text-label text-muted">
            {fmtInt(totals.accounts)} accounts and {fmtInt(totals.messages)} messages leave the read, which is {fmtPct(totals.messages / dataset.window.messages, 0)} of the window. What remains is{' '}
            {fmtInt(dataset.window.people)} people, one vote each.
          </p>
        </div>
        <Badge tone="muted" dot pulse={false}>
          {fmtInt(dataset.window.accounts)} accounts in, {fmtInt(dataset.window.people)} people out
        </Badge>
      </div>

      {ordered.length === 0 ? (
        <EmptyState icon={UserMinus} sentence="No staff, raid or bot accounts were detected in this window, so every author counted." actionLabel="Review the raid rule" onAction={() => undefined} />
      ) : (
        <Table caption="Excluded accounts by kind, with accounts, messages, share of the window and reason">
          <thead>
            <tr>
              <Th>Kind</Th>
              <Th numeric>Accounts</Th>
              <Th numeric>Messages</Th>
              <Th numeric>Share of window</Th>
              <Th>Window</Th>
              <Th>Why it is excluded</Th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((exclusion) => (
              <tr key={exclusion.kind}>
                <Td>
                  <span className="flex items-center gap-8 text-label font-medium text-ink">
                    <ShieldCheck aria-hidden className="size-14 text-muted" />
                    {EXCLUSION_LABEL[exclusion.kind]}
                  </span>
                </Td>
                <Td numeric>{fmtInt(exclusion.accounts)}</Td>
                <Td numeric>{fmtInt(exclusion.messages)}</Td>
                <Td numeric>{fmtPct(exclusion.messages / dataset.window.messages, 1)}</Td>
                <Td>{exclusion.window ? <span className="tabular font-mono text-micro text-warn">{exclusion.window}</span> : <span className="text-micro text-subtle">all day</span>}</Td>
                <Td>
                  <p className="max-w-320 text-micro text-muted">{why[exclusion.kind]}</p>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="flex flex-col gap-8 rounded-8 border border-line bg-raised px-16 py-12">
        <h4 className="text-label font-medium text-ink">What stays private</h4>
        <p className="max-w-prose text-micro text-muted">
          The daemon stores message ids, authors, channels and timestamps for the 7-day window. It never stores profile history, join dates, locations or a per-member sentiment trail. The raid cluster is described as one number because that is the only thing the exclusion needs.
        </p>
      </div>
    </div>
  )
}
