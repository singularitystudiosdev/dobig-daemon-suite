import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Badge, StatPill } from '@/components/ui'
import { fmtInt } from '@/lib/format'
import { getBotStatus, initials, type BotStatus } from './api'
import type { DiscordEntry } from '../types'

/* The server at the top of the Discord workspace: icon, name, description, counts and where the bot stands. */

export function ServerIcon({ name, url, size = 64 }: { name: string; url: string | null; size?: 40 | 64 }) {
  const [broken, setBroken] = useState(false)
  const box = size === 64 ? 'size-64 text-title' : 'size-40 text-label'
  return url && !broken ? (
    <img src={url} alt="" width={size} height={size} onError={() => setBroken(true)} className={`${box} shrink-0 rounded-8 bg-raised object-cover`} />
  ) : (
    <span aria-hidden className={`${box} inline-flex shrink-0 select-none items-center justify-center rounded-8 bg-accent-soft font-bold text-accent-ink`}>
      {initials(name)}
    </span>
  )
}

function botChip(status: BotStatus | null): { label: string; tone: 'live' | 'warn' | 'danger' | 'muted' } {
  if (!status) return { label: 'Checking the bot', tone: 'muted' }
  if (!status.tokenSet) return { label: 'No token', tone: 'warn' }
  if (status.tokenValid === false) return { label: 'Token rejected', tone: 'danger' }
  if (status.inGuild === true) return { label: 'Bot in server', tone: 'live' }
  if (status.inGuild === false) return { label: 'Bot not in server', tone: 'warn' }
  return { label: 'Bot unchecked', tone: 'muted' }
}

export function ServerHeader({ entry }: { entry: DiscordEntry }) {
  const s = entry.server
  const [status, setStatus] = useState<BotStatus | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    getBotStatus(s.guildId, ac.signal).then(setStatus, () => undefined)
    return () => ac.abort()
  }, [s.guildId])
  const chip = botChip(status)
  return (
    <section aria-label={`${s.name} server`} className="rounded-20 border border-line bg-surface p-24">
      <div className="flex flex-wrap items-start gap-16">
        <ServerIcon name={s.name} url={s.iconUrl} />
        <div className="min-w-0 flex-1 basis-240">
          <div className="flex flex-wrap items-center gap-12">
            <h1 className="text-headline text-ink">{s.name}</h1>
            <Badge tone={chip.tone} dot={chip.tone === 'live'} pulse={false}>
              {chip.label}
            </Badge>
          </div>
          <a href={s.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-6 text-label text-accent-ink">
            {s.url}
            <ExternalLink aria-hidden className="size-12" />
          </a>
          {s.description && <p className="mt-12 max-w-prose text-label text-muted">{s.description}</p>}
        </div>
      </div>
      <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:max-w-560">
        <StatPill label="Members" value={s.members === null ? 'Not available' : fmtInt(s.members)} />
        <StatPill label="Online now" value={s.online === null ? 'Not available' : fmtInt(s.online)} tone="live" />
      </div>
    </section>
  )
}
