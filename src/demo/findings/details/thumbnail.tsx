import type { ThumbnailDetail } from '@/lib/details/thumbnail'
import type { DetailViewProps } from './types'

// Placeholder until the findings-core worker builds the real detail view.
export default function ThumbnailDetailView({ finding }: DetailViewProps<ThumbnailDetail>) {
  return <p className="text-label text-muted">{finding.title}</p>
}
