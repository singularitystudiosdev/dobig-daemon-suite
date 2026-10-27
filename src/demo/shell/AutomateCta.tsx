import { Wand2 } from 'lucide-react'
import { automation } from '@/data/tools'
import type { DaemonSlug } from '@/data/daemons'
import { openNewTool } from './newTool'

/* "Set it up for me": opens the contact-us panel with a request for this tool already written. Two looks: a quiet
   button for a toolbar, and a bordered line with the pitch for the bottom of a result. */

export function AutomateCta({ slug, game, variant = 'button' }: { slug: DaemonSlug; game?: string; variant?: 'button' | 'line' }) {
  const a = automation[slug]
  const open = () => openNewTool({ kind: 'automation', tool: slug, game, message: a.template.replace('{game}', game || 'my game') })
  if (variant === 'line') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-12 rounded-8 border border-line px-16 py-12">
        <p className="min-w-0 max-w-prose text-label text-muted">
          <span className="font-medium text-ink">{a.label}.</span> {a.pitch}
        </p>
        <button type="button" onClick={open} className="state-layer inline-flex h-32 shrink-0 items-center gap-6 whitespace-nowrap rounded-8 border border-line bg-raised px-12 text-label font-medium text-ink">
          <Wand2 aria-hidden className="size-16 text-accent-ink" />
          Contact us
        </button>
      </div>
    )
  }
  return (
    <button type="button" onClick={open} className="state-layer inline-flex h-32 shrink-0 items-center gap-6 whitespace-nowrap rounded-8 px-12 text-label font-medium text-accent-ink">
      <Wand2 aria-hidden className="size-16" />
      {a.label}
    </button>
  )
}
