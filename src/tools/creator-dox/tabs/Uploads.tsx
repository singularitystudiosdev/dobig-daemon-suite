import { Upload } from 'lucide-react'
import { Badge, EmptyState, Table, Td, Th } from '@/components/ui'
import { daemonHref } from '@/lib/router'
import { fmtCompact, fmtDay, fmtMinSec, fmtPct } from '@/lib/format'
import { apiTitle } from '../bits'
import { AS_OF, isSponsored, uploadEr, type UploadRow } from '../data'
import type { TabProps } from './Overview'

/** The Oct 22 sponsored upload is the confounder Description Daemon reads on the bus. */
function isConfounder(row: UploadRow): boolean {
  return row.hasPaidProductPlacement && row.publishedAt.startsWith('2026-10-22')
}

export function Uploads({ creator, onNavigate }: TabProps) {
  const rows = creator.uploads
  const sponsored = rows.filter(isSponsored).length

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Upload}
        sentence="No public uploads were read for this creator, so there is no upload table to show."
        actionLabel="Open the Outreach tab"
        onAction={() => onNavigate('outreach')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <p className="max-w-prose text-label text-muted">
          The last {rows.length} public uploads, newest first. {sponsored} carry a paid-placement flag or a brand named in the description. Every counter is read from the YouTube Data API.
        </p>
        <Badge tone="muted">as of {AS_OF}</Badge>
      </div>

      <Table caption="Last 48 public uploads with counters, paid status and the game each one features">
        <thead>
          <tr>
            <Th>Published</Th>
            <Th>Title</Th>
            <Th numeric>Duration</Th>
            <Th numeric>ViewCount</Th>
            <Th numeric>LikeCount</Th>
            <Th numeric>CommentCount</Th>
            <Th numeric>ER</Th>
            <Th>Paid</Th>
            <Th>Brand partner</Th>
            <Th>Game featured</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.videoId}>
              <Td title={`publishedAt, as of ${AS_OF}`}>
                <span className="whitespace-nowrap text-muted">{fmtDay(row.publishedAt)}</span>
              </Td>
              <Td className="min-w-240">
                <div className="max-w-prose font-medium text-ink">{row.title}</div>
                <div className="mt-2 flex flex-wrap items-center gap-8 text-micro text-muted">
                  <span className="font-mono">{row.videoId}</span>
                  {isConfounder(row) && (
                    <a href={daemonHref('description-daemon', { focus: 'test' })} className="rounded-8 text-accent-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent-ink">
                      Read by Description Daemon as a confounder
                    </a>
                  )}
                </div>
              </Td>
              <Td numeric title={apiTitle('contentDetails.duration')}>
                {fmtMinSec(row.durationSec)}
              </Td>
              <Td numeric title={apiTitle('statistics.viewCount')}>
                {fmtCompact(row.viewCount)}
              </Td>
              <Td numeric title={apiTitle('statistics.likeCount')}>
                {fmtCompact(row.likeCount)}
              </Td>
              <Td numeric title={apiTitle('statistics.commentCount')}>
                {fmtCompact(row.commentCount)}
              </Td>
              <Td numeric title="(statistics.likeCount + statistics.commentCount) / statistics.viewCount">
                {fmtPct(uploadEr(row))}
              </Td>
              <Td title={apiTitle('paidProductPlacementDetails.hasPaidProductPlacement')}>
                {row.hasPaidProductPlacement ? (
                  <Badge tone="warn">Paid</Badge>
                ) : row.brandHandle ? (
                  <Badge tone="warn">Mention</Badge>
                ) : (
                  <span className="text-muted">No</span>
                )}
              </Td>
              <Td>
                {row.brandHandle ? <span className="font-mono text-micro text-ink">{row.brandHandle}</span> : <span className="text-muted">None</span>}
              </Td>
              <Td>
                <span className={row.game ? 'text-ink' : 'text-muted'}>{row.game ?? 'None'}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <p className="text-micro text-muted">
        The Oct 22 sponsored upload is the video Description Daemon reads as a confounder on the shared bus. It is linked above so a partnership lead can see what the description test inherited. Made-for-kids status comes from {`status.madeForKids`}.
      </p>
    </div>
  )
}
