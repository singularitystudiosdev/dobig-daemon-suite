import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Panel, StatPill } from '@/components/ui'
import { fmtCompact, fmtInt } from '@/lib/format'
import type { GameEntry } from '../types'

/* The selected game above its workspace: cover, the real title and description, stats, creator and genre. */

export function GameHeader({ entry }: { entry: GameEntry }) {
  const { info, gallery } = entry
  const [expanded, setExpanded] = useState(false)
  const cover = gallery[0]?.url ?? info.cover
  const long = info.description.length > 260 || info.description.split('\n').length > 4
  return (
    <Panel bodyClassName="flex flex-col gap-24 p-24 md:flex-row">
      <div className="aspect-video w-full shrink-0 self-start overflow-hidden rounded-8 bg-raised md:w-320">
        {cover && <img src={cover} alt={`${info.name} cover`} width={320} height={180} className="size-full object-cover" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-16">
        <div className="min-w-0">
          <h1 className="text-headline text-ink break-words">{info.name}</h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-12 text-label text-muted">
            <span>Creator: {info.creator}</span>
            {info.genre && <span>{info.genre}</span>}
            <a
              href={info.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-4 text-accent-ink hover:text-ink"
              aria-label={`Open ${info.name} on Roblox`}
            >
              <ExternalLink aria-hidden className="size-12" />
              roblox.com
            </a>
          </p>
        </div>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          <StatPill label="Playing" value={fmtInt(info.playing)} tone="live" />
          <StatPill label="Plays" value={fmtCompact(info.visits)} />
          <StatPill label="Favorites" value={fmtCompact(info.favorites)} />
        </div>
        {info.description && (
          <div className="min-w-0">
            <p className={expanded ? 'whitespace-pre-line text-label text-muted break-words' : 'line-clamp-4 whitespace-pre-line text-label text-muted break-words'}>{info.description}</p>
            {long && (
              <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className="mt-8 rounded-8 text-label font-medium text-accent-ink hover:text-ink">
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}
