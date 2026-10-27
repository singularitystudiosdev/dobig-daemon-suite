import { KeyRound, Plus, Zap } from 'lucide-react'
import { Button } from '@/components/ui'
import type { DaemonSlug } from '@/data/daemons'
import { useGeminiKey } from '@/lib/gemini'
import { ToolSwitcher } from './ToolSwitcher'

/* The dashboard's own top bar: tool frame on the left; credits, top-up and (thumbnail only) Gemini on the right. */

export function TopBar({ slug, balance, onTopUp, onOpenGemini }: { slug: DaemonSlug; balance: number; onTopUp: () => void; onOpenGemini: () => void }) {
  const hasKey = useGeminiKey() !== ''
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas">
      <div className="mx-auto flex h-64 max-w-page items-center justify-between gap-12 px-16 sm:px-24">
        <ToolSwitcher slug={slug} />
        <div className="flex shrink-0 items-center gap-8">
          {slug === 'thumbnail-daemon' && (
            <Button icon={KeyRound} onClick={onOpenGemini}>
              <span className="sr-only sm:not-sr-only">Gemini</span>
              {hasKey && <span role="img" aria-label="key saved" className="size-8 rounded-full bg-live" />}
            </Button>
          )}
          <div aria-live="polite" className="inline-flex h-40 items-center gap-8 rounded-8 bg-raised px-12 text-label">
            <Zap aria-hidden className="size-16 text-accent-ink" />
            <span className="tabular font-bold text-ink">{balance}</span>
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
