import { Bug, Images, MessagesSquare, PenLine, ShieldAlert, UserSearch, type LucideIcon } from 'lucide-react'
import type { Tone } from '@/lib/tone'

export type DaemonSlug =
  | 'creator-dox'
  | 'thumbnail-daemon'
  | 'discord-daemon'
  | 'description-daemon'
  | 'dmca-daemon'
  | 'hack-daemon'

export interface DaemonStat {
  label: string
  value: number
  format: 'int' | 'compact' | 'pct' | 'signed-pct'
  /** Live stats tick like dobig.com's green "Playing" counter. */
  live?: boolean
}

export interface DaemonMeta {
  slug: DaemonSlug
  name: string
  navLabel: string
  tagline: string
  thumb: string
  icon: LucideIcon
  /** Category color for this daemon on the shared event bus. */
  tone: Tone
  /** The green "Playing"-style pill on the hub card. */
  primary: DaemonStat
  /** The white "Plays"-style pill on the hub card. */
  secondary: DaemonStat
}

export const daemons: DaemonMeta[] = [
  {
    slug: 'creator-dox',
    name: 'Creator Dox',
    navLabel: 'Creator Dox',
    tagline: 'A partnership dossier on any creator from public channel data: reach, real audience, and whether their viewers still engage when the video is sponsored.',
    thumb: '/daemons/creator-dox.webp',
    icon: UserSearch,
    tone: 'data6',
    primary: { label: 'Tracking', value: 1284, format: 'int', live: true },
    secondary: { label: 'Dossiers', value: 312, format: 'int' },
  },
  {
    slug: 'thumbnail-daemon',
    name: 'Thumbnail Daemon',
    navLabel: 'Thumbnails',
    tagline: 'Runs Roblox thumbnail personalization as a bandit: explores every variant, shifts impressions to the winner per player segment, never zeroes the rest.',
    thumb: '/daemons/thumbnail-daemon.webp',
    icon: Images,
    tone: 'warn',
    primary: { label: 'Testing', value: 47, format: 'int', live: true },
    secondary: { label: 'QPTR', value: 0.112, format: 'signed-pct' },
  },
  {
    slug: 'discord-daemon',
    name: 'Discord Daemon',
    navLabel: 'Discord',
    tagline: 'Connect to any Discord server and get a summary of user sentiment that counts people, not messages, with staff, raids and loud repeat posters weighed out.',
    thumb: '/daemons/discord-daemon.webp',
    icon: MessagesSquare,
    tone: 'accent',
    primary: { label: 'Listening', value: 1946210, format: 'compact', live: true },
    secondary: { label: 'Servers', value: 12, format: 'int' },
  },
  {
    slug: 'description-daemon',
    name: 'Description Daemon',
    navLabel: 'Descriptions',
    tagline: 'Auto-iterates on your game description and optimizes Home Recommendation play-through rate with honest sequential tests, guardrails and rollbacks.',
    thumb: '/daemons/description-daemon.webp',
    icon: PenLine,
    tone: 'live',
    primary: { label: 'Iterating', value: 12, format: 'int', live: true },
    secondary: { label: 'Home PTR', value: 0.064, format: 'signed-pct' },
  },
  {
    slug: 'dmca-daemon',
    name: 'DMCA Daemon',
    navLabel: 'DMCA',
    tagline: 'Put it on any of your games and it instantly files takedowns on copies using your exact assets. Lookalikes go to human review first.',
    thumb: '/daemons/dmca-daemon.webp',
    icon: ShieldAlert,
    tone: 'danger',
    primary: { label: 'Guarding', value: 1840, format: 'int', live: true },
    secondary: { label: 'Takedowns', value: 4213, format: 'int' },
  },
  {
    slug: 'hack-daemon',
    name: 'Hack Daemon',
    navLabel: 'Hacks',
    tagline: 'Watches YouTube and other sources advertising live hacks for your games, filters the bait, and maps every real exploit to the system it abuses with a fix for your developers.',
    thumb: '/daemons/hack-daemon.webp',
    icon: Bug,
    tone: 'data5',
    primary: { label: 'Watching', value: 1926, format: 'int', live: true },
    secondary: { label: 'Clusters', value: 38, format: 'int' },
  },
]

export const daemonsBySlug: Record<DaemonSlug, DaemonMeta> = Object.fromEntries(daemons.map((d) => [d.slug, d])) as Record<
  DaemonSlug,
  DaemonMeta
>

export function isDaemonSlug(s: string | undefined): s is DaemonSlug {
  return !!s && s in daemonsBySlug
}
