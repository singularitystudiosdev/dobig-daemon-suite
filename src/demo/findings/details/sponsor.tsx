import type { SponsorDetail } from '@/lib/details/sponsor'
import type { DetailViewProps } from './types'

/* Expanded row for one sponsor finding. Owned by the Sponsor Daemon worker: replace this skeleton. */
export default function SponsorDetailView({ detail }: DetailViewProps<SponsorDetail>) {
  return <p className="text-label text-muted">Read {detail.fetchedAt}</p>
}
