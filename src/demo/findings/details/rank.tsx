import type { RankDetail } from '@/lib/details/rank'
import type { DetailViewProps } from './types'

/* Expanded row for one rank finding. Owned by the Rank Daemon worker: replace this skeleton. */
export default function RankDetailView({ detail }: DetailViewProps<RankDetail>) {
  return <p className="text-label text-muted">Read {detail.fetchedAt}</p>
}
