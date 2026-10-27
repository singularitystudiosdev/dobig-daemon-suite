import { Megaphone } from 'lucide-react'
import { Badge, EmptyState, Table, Td, Th } from '@/components/ui'
import { fmtPct } from '@/lib/format'
import { DeltaValue, apiTitle } from '../bits'
import { collabFlagText, isSponsored, type CollabFlag } from '../data'
import type { TabProps } from './Overview'

const flagTone: Record<CollabFlag, 'danger' | 'live' | 'muted'> = {
  'tunes-out': 'danger',
  holds: 'live',
  'low-sample': 'muted',
}

export function BrandCollabs({ creator, onNavigate }: TabProps) {
  const collabs = creator.brandCollabs
  const paidUploads = creator.uploads.filter(isSponsored).length

  if (collabs.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        sentence="No paid placement or brand mention turned up in the last 48 uploads, so there is no collab history to price."
        actionLabel="Review the upload table"
        onAction={() => onNavigate('uploads')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-16">
      <p className="max-w-prose text-label text-muted">
        {collabs.length} brand partners across {paidUploads} paid uploads. A brand with fewer than 3 videos is greyed as a low sample, because one weak video is not a signal.
      </p>

      <Table caption="Brand partners with sponsored engagement, the change against organic and a flag">
        <thead>
          <tr>
            <Th>brandPartner.channelHandle</Th>
            <Th numeric>Videos</Th>
            <Th numeric>Sponsored ER</Th>
            <Th numeric>Delta vs organic</Th>
            <Th>Flag</Th>
          </tr>
        </thead>
        <tbody>
          {collabs.map((c) => {
            const low = c.videos < 3
            return (
              <tr key={c.handle}>
                <Td>
                  <div className="font-mono text-label text-ink">{c.handle}</div>
                  <div className="text-micro text-muted">{c.label}</div>
                </Td>
                <Td numeric>{c.videos}</Td>
                <Td numeric title={apiTitle('paidProductPlacementDetails.hasPaidProductPlacement')}>
                  <span className={low ? 'text-subtle' : 'text-ink'}>{fmtPct(c.er)}</span>
                  <span className="block text-micro text-muted">{c.videos === 1 ? '1 video' : `${c.videos} videos`}</span>
                </Td>
                <Td numeric>
                  <DeltaValue delta={c.delta} />
                </Td>
                <Td>
                  <Badge tone={flagTone[c.flag]}>{collabFlagText(c.flag)}</Badge>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      <div className="rounded-8 border border-line bg-raised p-16">
        <h3 className="text-title font-bold text-ink">What to do with this</h3>
        <ul className="mt-8 flex list-disc flex-col gap-4 pl-16 text-label text-muted">
          <li>Price the deal on the sponsored ER, not the channel average. The average hides the drop.</li>
          <li>Ask for a brand-free first 30 seconds so the hook still works for the organic audience.</li>
          <li>Offer a flat fee when a brand sits in the tunes-out flag, and a performance bonus only when it holds.</li>
        </ul>
      </div>
    </div>
  )
}
