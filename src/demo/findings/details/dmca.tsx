import type { DmcaDetail } from '@/lib/details/dmca'
import type { DetailViewProps } from './types'

// Placeholder until the dmca tool worker builds the real detail view.
export default function DmcaDetailView({ finding }: DetailViewProps<DmcaDetail>) {
  return <p className="text-label text-muted">{finding.title}</p>
}
