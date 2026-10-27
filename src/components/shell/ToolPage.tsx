import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { DaemonMeta } from '@/data/daemons'
import { GamePicker } from './GamePicker'

/* Frame for every daemon page: dobig.com's "Back to Home" link, the daemon's art, name and
   tagline, the shared game picker, then the page body. */
export function ToolPage({ daemon, actions, children }: { daemon: DaemonMeta; actions?: ReactNode; children: ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-page px-24 pb-96 pt-24">
      <a href="#/" className="group inline-flex items-center gap-8 rounded-8 text-body text-muted transition-colors duration-150 hover:text-ink">
        <ArrowLeft aria-hidden className="size-20 transition-transform duration-150 group-hover:-translate-x-4 motion-reduce:transition-none" />
        Back to toolkit
      </a>
      <header className="mt-24 flex flex-wrap items-end justify-between gap-24">
        <div className="flex min-w-0 flex-col items-start gap-16 sm:flex-row sm:items-center sm:gap-20">
          <img src={daemon.thumb} alt="" width={96} height={96} className="size-72 shrink-0 rounded-8 sm:size-96" />
          <div className="min-w-0">
            <h1 className="text-display text-ink">{daemon.name}</h1>
            <p className="mt-8 max-w-prose text-stat text-muted">{daemon.tagline}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-12">
          {actions}
          <GamePicker />
        </div>
      </header>
      <div className="mt-32 flex flex-col gap-24">{children}</div>
    </main>
  )
}
