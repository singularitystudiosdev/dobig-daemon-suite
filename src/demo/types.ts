import type { DaemonSlug } from '@/data/daemons'
import type { GalleryThumb, GameInfo } from '@/lib/apiTypes'
import type { Tone } from '@/lib/tone'

/* The contract between the demo dashboard shell (src/pages/Demo.tsx, src/demo/Shell*) and the
   per-tool workspaces (src/demo/thumbnail, src/demo/findings). */

/** A game the user added to the dashboard's right-hand list. */
export interface GameEntry {
  /** `u${universeId}` */
  id: string
  info: GameInfo
  gallery: GalleryThumb[]
  addedAt: number
}

/** What the right-hand list shows under a game's name. */
export interface EntryStatus {
  label: string
  tone: Tone
  /** 0..1, shows a thin progress bar in the rail when set. */
  progress?: number
}

export interface WorkspaceProps {
  slug: DaemonSlug
  entry: GameEntry
  /** True while this entry is the selected one. Hidden workspaces stay mounted and keep running. */
  active: boolean
  /** Give credits back when a run fails; the shell owns the balance. */
  refund: (credits: number) => void
  /** Spend more credits mid-life (Regenerate all, a retry). Returns false, and spends nothing, when the balance is short. The shell always passes it; test harnesses may omit it. */
  charge?: (credits: number) => boolean
  /** Opens the shell's Gemini key dialog. Only the thumbnail workspace needs it. */
  openGemini?: () => void
  /** Update the status line under this game in the right-hand list. */
  report: (status: EntryStatus) => void
}
