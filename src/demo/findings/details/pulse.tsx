import type { PulseDetail } from '@/lib/details/pulse'
import type { DetailViewProps } from './types'

/* Expanded row for one pulse finding. Owned by the Pulse Daemon worker: replace this skeleton. */
export default function PulseDetailView({ detail }: DetailViewProps<PulseDetail>) {
  return <p className="text-label text-muted">Read {detail.fetchedAt}</p>
}
