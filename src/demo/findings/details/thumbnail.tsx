import type { ThumbnailDetail } from '@/lib/details/thumbnail'
import { fmtDayTime } from '@/lib/format'
import { Badge } from '@/components/ui'
import type { DetailViewProps } from './types'

/* One gallery thumbnail the watcher reported: the 16:9 image as Roblox serves it, where it sits in the gallery,
   when the watcher first saw it, and whether it is new since the previous check. */
export default function ThumbnailDetailView({ detail }: DetailViewProps<ThumbnailDetail>) {
  return (
    <div className="flex flex-col gap-16 md:flex-row md:items-start">
      <img src={detail.url} alt={`Gallery thumbnail ${detail.position}`} loading="lazy" decoding="async" className="aspect-video w-full rounded-8 bg-raised object-cover md:w-320 md:shrink-0" />
      <dl className="flex min-w-0 flex-1 flex-col">
        <Row label="Position in gallery" value={<span className="tabular">{detail.position}</span>} />
        <Row label="First seen" value={<time dateTime={detail.firstSeen} className="tabular">{fmtDayTime(detail.firstSeen)}</time>} />
        <Row label="Since the last check" value={detail.isNew ? <Badge tone="accent">New</Badge> : <Badge tone="muted">Known</Badge>} />
        <Row label="Image id" value={<span className="tabular font-mono text-micro">{detail.thumbId}</span>} />
      </dl>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-16 border-b border-line py-8 last:border-b-0">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-label text-ink">{value}</dd>
    </div>
  )
}
