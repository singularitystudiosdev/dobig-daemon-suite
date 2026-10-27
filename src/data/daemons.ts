import { Bug, Images, MessagesSquare, PenLine, ShieldAlert, UserSearch, type LucideIcon } from 'lucide-react'
import type { Tone } from '@/lib/tone'

export type DaemonSlug =
  | 'creator-dox'
  | 'thumbnail-daemon'
  | 'discord-daemon'
  | 'description-daemon'
  | 'dmca-daemon'
  | 'hack-daemon'

export interface DaemonMeta {
  slug: DaemonSlug
  name: string
  navLabel: string
  icon: LucideIcon
  /** Category color for this daemon on the shared event bus. */
  tone: Tone
}

export const daemons: DaemonMeta[] = [
  {
    slug: 'creator-dox',
    name: 'Creator Dox',
    navLabel: 'Creator Dox',
    icon: UserSearch,
    tone: 'data6',
  },
  {
    slug: 'thumbnail-daemon',
    name: 'Thumbnail Daemon',
    navLabel: 'Thumbnails',
    icon: Images,
    tone: 'warn',
  },
  {
    slug: 'discord-daemon',
    name: 'Discord Daemon',
    navLabel: 'Discord',
    icon: MessagesSquare,
    tone: 'accent',
  },
  {
    slug: 'description-daemon',
    name: 'Description Daemon',
    navLabel: 'Descriptions',
    icon: PenLine,
    tone: 'live',
  },
  {
    slug: 'dmca-daemon',
    name: 'DMCA Daemon',
    navLabel: 'DMCA',
    icon: ShieldAlert,
    tone: 'danger',
  },
  {
    slug: 'hack-daemon',
    name: 'Hack Daemon',
    navLabel: 'Hacks',
    icon: Bug,
    tone: 'data5',
  },
]

export const daemonsBySlug: Record<DaemonSlug, DaemonMeta> = Object.fromEntries(daemons.map((d) => [d.slug, d])) as Record<
  DaemonSlug,
  DaemonMeta
>

export function isDaemonSlug(s: string | undefined): s is DaemonSlug {
  return !!s && s in daemonsBySlug
}
