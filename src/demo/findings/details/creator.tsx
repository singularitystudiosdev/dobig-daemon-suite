import type { CreatorDetail } from '@/lib/details/creator'
import type { DetailViewProps } from './types'

// Placeholder until the creator tool worker builds the real detail view.
export default function CreatorDetailView({ finding }: DetailViewProps<CreatorDetail>) {
  return <p className="text-label text-muted">{finding.title}</p>
}
