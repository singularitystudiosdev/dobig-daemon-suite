import type { DescriptionDetail } from '@/lib/details/description'
import type { DetailViewProps } from './types'

// Placeholder until the description tool worker builds the real detail view.
export default function DescriptionDetailView({ finding }: DetailViewProps<DescriptionDetail>) {
  return <p className="text-label text-muted">{finding.title}</p>
}
