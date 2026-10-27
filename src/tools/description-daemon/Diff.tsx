import { cn } from '@/lib/cn'
import { Badge, Code } from '@/components/ui'
import type { DescriptionDataset } from './data'

type DiffLine = { type: 'same' | 'removed' | 'added'; text: string }

/* A line diff from the live description to the surviving variant. Removed lines carry a minus, a
   danger left border and danger text; added lines carry a plus, a live left border and live text,
   so the sign and the colour both report the change. */
function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'removed', text: a[i] })
      i++
    } else {
      rows.push({ type: 'added', text: b[j] })
      j++
    }
  }
  while (i < m) rows.push({ type: 'removed', text: a[i++] })
  while (j < n) rows.push({ type: 'added', text: b[j++] })
  return rows.slice(0, 44)
}

export function DescriptionDiff({ before, after, beforeLabel, afterLabel }: { before: string; after: string; beforeLabel: string; afterLabel: string }) {
  const rows = diffLines(before, after)
  return (
    <div data-slot="description-diff" className="overflow-hidden rounded-8 border border-line bg-sunken">
      <div className="flex flex-wrap items-center justify-between gap-8 border-b border-line px-12 py-8">
        <span className="text-label font-medium text-ink">Description diff</span>
        <span className="text-micro text-muted">{beforeLabel} to {afterLabel}</span>
      </div>
      <div className="max-h-320 overflow-auto">
        {rows.map((row, index) => (
          <div
            key={index}
            className={cn(
              'flex gap-8 border-l-2 px-8 py-2 font-mono text-micro',
              row.type === 'removed' && 'border-danger bg-danger-soft text-danger',
              row.type === 'added' && 'border-live bg-live-soft text-live',
              row.type === 'same' && 'border-transparent text-muted',
            )}
          >
            <span aria-hidden className="w-8 shrink-0 select-none">
              {row.type === 'removed' ? '-' : row.type === 'added' ? '+' : ' '}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words">
              <span className="sr-only">{row.type === 'removed' ? 'Removed: ' : row.type === 'added' ? 'Added: ' : 'Unchanged: '}</span>
              {row.text || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PublishRequest({ data, published }: { data: DescriptionDataset; published: boolean }) {
  return (
    <div data-slot="publish-request" className="rounded-8 border border-line bg-sunken p-12">
      <div className="flex flex-wrap items-center gap-8">
        <Badge tone="accent">PATCH</Badge>
        <Code>/cloud/v2/universes/{data.test.universeId}</Code>
        <Badge tone={published ? 'live' : 'muted'}>{published ? '200' : 'not sent'}</Badge>
        <Badge tone="muted">Experimental API</Badge>
      </div>
      <p className="mt-8 text-micro text-muted">Request body carries displayName and description. Roblox has no native description A/B test, so this is an Open Cloud universe update.</p>
      <pre className="scroll-thin mt-8 max-h-160 overflow-auto rounded-8 bg-raised p-8 font-mono text-micro text-ink">{data.publishBody}</pre>
    </div>
  )
}

export function OneChangeNotice({ data }: { data: DescriptionDataset }) {
  const detail = data.thumbnailEvent?.detail ?? 'A segment winner is settling across the mobile range.'
  return (
    <div data-slot="one-change-notice" className="rounded-8 border border-warn bg-warn-soft px-12 py-8">
      <div className="flex flex-wrap items-center gap-8">
        <Badge tone="warn">One change at a time</Badge>
        <span className="text-label text-ink">This test locks the universe: no new thumbnail test starts until the hold ends.</span>
      </div>
      <p className="mt-4 text-micro text-muted">
        The live thumbnail config keeps serving unchanged, so its shares are steady background, not a second change. Thumbnail Daemon: {detail}{' '}
        <a href="#/d/thumbnail-daemon" className="text-accent-ink underline underline-offset-2">Open Thumbnail Daemon</a>
      </p>
    </div>
  )
}
