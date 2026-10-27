import type { DaemonSlug } from '@/data/daemons'
import type { Finding } from '@/lib/runTypes'

/* Props every per-tool detail view receives. The view renders the expanded region of one finding row (a plain
   bordered region, never a nested card). `state` is the row's user-chosen state ("filed", "patched", ...), kept by the
   list; `act` sets it. Anything that must reach the server goes through `daemonId` and the tool's own routes. */
export interface DetailViewProps<D> {
  finding: Finding
  detail: D
  state: string | undefined
  act: (state: string) => void
  tool: DaemonSlug
  daemonId: string
}
