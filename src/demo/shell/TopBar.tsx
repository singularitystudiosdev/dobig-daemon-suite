import { KeyRound, Plus, Zap } from 'lucide-react'
import { Button, Skeleton } from '@/components/ui'
import type { DaemonSlug } from '@/data/daemons'
import { fmtInt } from '@/lib/format'
import { toolReady, useKeys } from '@/lib/gemini'
import { ToolSwitcher } from './ToolSwitcher'

/* The dashboard's own top bar: the tool switcher on the left; Keys, the credits chip and Add credits on the right.
   Keys is on every tool, and its dot says whether this tool has the keys it needs (green) or is missing one (amber). */

export function TopBar({
  slug,
  balance,
  loading,
  onTopUp,
  onOpenKeys,
}: {
  slug: DaemonSlug
  balance: number
  loading: boolean
  onTopUp: () => void
  onOpenKeys: () => void
}) {
  const ready = toolReady(slug, useKeys())
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas">
      <div className="mx-auto flex h-64 max-w-page items-center justify-between gap-12 px-16 sm:px-24">
        <ToolSwitcher slug={slug} />
        <div className="flex shrink-0 items-center gap-8">
          <Button icon={KeyRound} onClick={onOpenKeys} aria-label={ready === null ? 'Keys' : ready ? 'Keys, this tool has what it needs' : 'Keys, this tool needs a key'}>
            <span className="hidden sm:inline">Keys</span>
            {ready !== null && <span aria-hidden className={ready ? 'size-8 rounded-full bg-live' : 'size-8 rounded-full bg-warn'} />}
          </Button>
          <div aria-live="polite" className="inline-flex h-40 items-center gap-8 rounded-8 bg-raised px-12 text-label">
            <Zap aria-hidden className="size-16 text-accent-ink" />
            {loading ? <Skeleton className="h-16 w-48" /> : <span className="tabular font-bold text-ink">{fmtInt(balance)}</span>}
            <span className="hidden text-muted sm:inline">credits</span>
          </div>
          <Button variant="primary" icon={Plus} onClick={onTopUp} aria-label="Add credits">
            <span className="hidden sm:inline">Add credits</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
