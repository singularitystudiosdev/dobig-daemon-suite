import type { HackDetail } from '@/lib/details/hack'
import type { DetailViewProps } from './types'

// Placeholder until the hack tool worker builds the real detail view.
export default function HackDetailView({ finding }: DetailViewProps<HackDetail>) {
  return <p className="text-label text-muted">{finding.title}</p>
}
