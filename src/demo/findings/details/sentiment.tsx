import type { SentimentDetail } from '@/lib/details/sentiment'
import type { DetailViewProps } from './types'

// Placeholder until the sentiment tool worker builds the real detail view.
export default function SentimentDetailView({ finding }: DetailViewProps<SentimentDetail>) {
  return <p className="text-label text-muted">{finding.title}</p>
}
