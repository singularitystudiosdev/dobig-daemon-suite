import type { RefObject } from 'react'
import type { DaemonSlug } from '@/data/daemons'
import type { GalleryThumb, GameInfo } from '@/lib/apiTypes'
import type { DaemonRecord, DiscordServerInfo } from '@/lib/runTypes'
import type { Tone } from '@/lib/tone'

/* The contract between the demo dashboard shell (src/pages/Demo.tsx, src/demo/shell/**), the per-tool workspaces
   (src/demo/thumbnail, src/demo/findings) and the Discord add-card (src/demo/discord). Every target a user adds is
   backed by a server-side DAEMON (see src/lib/runTypes.ts): it persists, reruns on its interval, and is listed again
   when the dashboard is reopened. */

/** A Roblox game the user is tracking with one of the game tools. */
export interface GameEntry {
  kind: 'roblox-game'
  /** `u${universeId}` */
  id: string
  info: GameInfo
  gallery: GalleryThumb[]
  addedAt: number
  /** The server-side daemon that runs this target. */
  daemonId: string
}

/** A Discord server the user is tracking with the Discord tool. */
export interface DiscordEntry {
  kind: 'discord-server'
  /** `g${guildId}` */
  id: string
  server: DiscordServerInfo
  addedAt: number
  daemonId: string
}

export type TargetEntry = GameEntry | DiscordEntry

/** What the right-hand list shows under a target's name. */
export interface EntryStatus {
  label: string
  tone: Tone
  /** 0..1, shows a thin progress bar in the rail when set. */
  progress?: number
}

export interface WorkspaceProps {
  slug: DaemonSlug
  entry: TargetEntry
  /** The live server record of this target's daemon (interval, next run, last run). The shell keeps it fresh. */
  daemon: DaemonRecord
  /** The run to show: the active run if one is going, else the latest finished one, else the one the user picked from
   *  the daemon's history. Null before the first run exists. */
  runId: string | null
  /** True while this entry is the selected one. Hidden workspaces stay mounted and keep following their run. */
  active: boolean
  /** Update the status line under this target in the right-hand list. */
  report: (status: EntryStatus) => void
  /** Call after this workspace changed something on the server (credits spent, a key saved) so the shell re-reads it. */
  onChanged: () => void
  /** Opens the shell's image/analysis key dialog (Gemini or OpenRouter). */
  openKeyDialog: () => void
  /** Opens the Discord bot token dialog (provided by src/demo/discord). */
  openDiscordToken: () => void
}

/** Props of the card that adds a target. The Roblox card is src/demo/shell/AddGameCard.tsx; the Discord card is
 *  src/demo/discord/AddServerCard.tsx. A card resolves the input, creates the daemon through createDaemon() (the server
 *  charges the first run's credits and starts it) and calls onAdd with the new entry and its first run id. */
export interface AddCardProps {
  slug: DaemonSlug
  /** Credits left for this tool, from the server. */
  balance: number
  existingIds: string[]
  inputRef: RefObject<HTMLInputElement | null>
  /** Prefill only: a link in the URL never submits by itself. */
  initialLink: string
  focusOnMount: boolean
  onAdd: (entry: TargetEntry, runId: string) => void
  /** The target is already in the list: select it instead of adding it again. */
  onExisting: (id: string) => void
  onTopUp: () => void
}
