import type { DaemonSlug } from '@/data/daemons'
import type { Tone } from './tone'
import type { CreatorDetail } from './details/creator'
import type { DescriptionDetail } from './details/description'
import type { DmcaDetail } from './details/dmca'
import type { HackDetail } from './details/hack'
import type { PulseDetail } from './details/pulse'
import type { RankDetail } from './details/rank'
import type { ContentCreatorDetail } from './details/content-creator'
import type { SentimentDetail } from './details/sentiment'
import type { ThumbnailDetail } from './details/thumbnail'

/* The wire contract for real runs and daemons. Types and tiny constants only: nothing here may import
   runtime code, because the server (server/**) and the client (src/**) both import this file. */

export type TargetKind = 'roblox-game' | 'discord-server'

/** What each tool is pointed at. */
export const TOOL_TARGET: Record<DaemonSlug, TargetKind> = {
  'thumbnail-daemon': 'roblox-game',
  'hack-daemon': 'roblox-game',
  'dmca-daemon': 'roblox-game',
  'description-daemon': 'roblox-game',
  'creator-dox': 'roblox-game',
  'rank-daemon': 'roblox-game',
  'content-creator-daemon': 'roblox-game',
  'pulse-daemon': 'roblox-game',
  'discord-daemon': 'discord-server',
}

export interface RobloxTarget {
  kind: 'roblox-game'
  universeId: number
  placeId: number
  name: string
}

export interface DiscordTarget {
  kind: 'discord-server'
  /** The invite code the user pasted (discord.gg/<code>), kept so the server can be re-resolved. */
  invite: string
  guildId: string
  name: string
}

export type Target = RobloxTarget | DiscordTarget

/** A Discord server resolved from a public invite (no token needed). */
export interface DiscordServerInfo {
  guildId: string
  inviteCode: string
  name: string
  description: string | null
  iconUrl: string | null
  bannerUrl: string | null
  /** approximate_member_count from the invite. */
  members: number | null
  /** approximate_presence_count from the invite. */
  online: number | null
  features: string[]
  /** https://discord.gg/<code> */
  url: string
}

/* ---- findings ---- */

export interface Chip {
  label: string
  tone: Tone
}

/** A run of text; `struck` marks a span a policy lint flagged. */
export interface Segment {
  text: string
  struck?: boolean
}

export interface Meta {
  label: string
  value: string
}

export type FindingDetail = HackDetail | DmcaDetail | SentimentDetail | DescriptionDetail | CreatorDetail | ThumbnailDetail | RankDetail | ContentCreatorDetail | PulseDetail

export interface Finding {
  /** Stable across runs for the same underlying thing, so a rerun can tell what is new. */
  id: string
  /** Severity, sentiment or rank mark on the left. */
  badge: Chip
  title: string
  snippet: Segment[]
  /** Right-aligned values. */
  meta: Meta[]
  spark?: { data: number[]; tone: Tone; label: string }
  /** Status chip; `states` swaps it when the user acts on the row. */
  status: Chip
  states?: Record<string, Chip>
  /** Filter lane, when the tool has one. */
  group?: string
  /** The exact link to the thing found (a Roblox game, a YouTube video, a Discord thread). Shown as a real link. */
  url?: string
  /** Set by the run engine when this id was not in the previous run of the same daemon. */
  isNew?: boolean
  detail: FindingDetail
}

export interface SummaryItem {
  label: string
  value: string
  tone?: Tone
}

export interface Notice {
  lead: string
  body: string
}

export interface RunSummary {
  items: SummaryItem[]
  /** How the list is ordered, in words: "Sorted by severity". */
  sortLabel: string
  groups?: { id: string; label: string }[]
  notices?: Notice[]
  /** Small muted notes under the strip, e.g. what the numbers mean. */
  notes?: string[]
}

/* ---- run events (NDJSON over GET /api/runs/:runId/events) ---- */

export type RunErrorCode =
  | 'no-llm-key'
  | 'no-image-key'
  | 'no-discord-token'
  | 'discord-bot-missing'
  | 'discord-intent'
  | 'credits'
  | 'not-found'
  | 'private'
  | 'rate-limited'
  | 'upstream'
  | 'bad-input'
  | 'aborted'
  | 'internal'

export interface RunAction {
  kind: 'add-key' | 'add-discord-token' | 'open-url' | 'add-credits' | 'retry'
  label: string
  url?: string
}

export type StepState = 'active' | 'done' | 'warn' | 'failed'

export type RunEvent =
  | { type: 'start'; runId: string; daemonId: string; tool: DaemonSlug; startedAt: string; cost: number }
  /** A real piece of progress. Emit state 'active' when a step begins and the same id again with its final state. */
  | { type: 'step'; id: string; label: string; state: StepState; detail?: string; at: number }
  | { type: 'summary'; summary: RunSummary }
  | { type: 'finding'; finding: Finding }
  | { type: 'end'; status: 'done' | 'failed'; findings: number; newFindings: number; durationMs: number; refunded: number }
  | { type: 'error'; code: RunErrorCode; message: string; action?: RunAction }

export type RunStatus = 'queued' | 'running' | 'done' | 'failed'

export interface RunRecordSummary {
  runId: string
  startedAt: string
  endedAt?: string
  status: RunStatus
  findings: number
  newFindings: number
  cost: number
  /** Why it failed, when it did. */
  error?: string
  trigger: 'user' | 'schedule'
}

/* ---- daemons ---- */

export const DAEMON_INTERVAL_HOURS = 12

export interface DaemonRecord {
  id: string
  tool: DaemonSlug
  target: Target
  title: string
  /** 16:9 cover or server icon, for the right-hand list. */
  image: string | null
  intervalHours: number
  /** False while paused: no scheduled reruns, "Run now" still works. */
  enabled: boolean
  createdAt: string
  lastRunAt?: string
  /** When the scheduler will run it next; absent while paused. */
  nextRunAt?: string
  runs: number
  /** The run in progress, if any. */
  activeRunId?: string
  last?: RunRecordSummary
}

export interface DaemonDetail extends DaemonRecord {
  /** The events of the latest run (finished or in progress), for replay into the UI. */
  latest: { runId: string; events: RunEvent[] } | null
  history: RunRecordSummary[]
}

export interface CreateDaemonRequest {
  tool: DaemonSlug
  target: Target
  intervalHours?: number
}

export interface CreateDaemonResponse {
  daemon: DaemonRecord
  runId: string
}

/* ---- credits (server-side, per tool) ---- */

export interface CreditsResponse {
  balances: Record<DaemonSlug, number>
  /** What one run costs; for the thumbnail tool this is the cost of ONE variant. */
  costs: Record<DaemonSlug, number>
  /** What "Add credits" adds, per tool. */
  topUps: Record<DaemonSlug, number>
}
