import { ExternalLink } from 'lucide-react'
import { daemonsBySlug, type DaemonSlug } from '@/data/daemons'
import { toolsBySlug } from '@/data/tools'
import { ExampleRun, ExampleSkeleton } from '@/components/ExampleRun'
import { useExample } from '@/lib/example'
import { REPO_URL } from '@/lib/static'
import { ToolSwitcher } from '@/demo/shell/ToolSwitcher'

/* #/demo/<slug> in the GitHub Pages build: a real, read-only example run of the tool, captured once and shipped as
   public/examples/<slug>.json. Nothing else: no instructions, no commands. */

export default function StaticPreview({ slug }: { slug: DaemonSlug }) {
  const tool = toolsBySlug[slug]
  const Icon = daemonsBySlug[slug].icon
  const { example, loading } = useExample(slug)
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas">
        <div className="mx-auto flex h-64 max-w-page items-center justify-between gap-12 px-16 sm:px-24">
          <ToolSwitcher slug={slug} />
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="state-layer inline-flex h-40 shrink-0 items-center gap-8 rounded-8 border border-line bg-raised px-16 text-label font-medium text-ink">
            <ExternalLink aria-hidden className="size-16" />
            <span className="hidden sm:inline">Source on GitHub</span>
            <span className="sm:hidden">GitHub</span>
          </a>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-page flex-col gap-32 px-16 py-32 motion-safe:animate-enter sm:px-24 sm:py-48">
        <div className="flex items-start gap-16">
          <span className="inline-flex size-48 shrink-0 items-center justify-center rounded-8 bg-accent-soft text-accent-ink">
            <Icon aria-hidden className="size-24" />
          </span>
          <div className="min-w-0">
            <h1 className="text-headline font-bold text-ink">{tool.name}</h1>
            <p className="mt-4 max-w-prose text-body text-muted">{tool.blurb}</p>
          </div>
        </div>

        {loading ? (
          <ExampleSkeleton />
        ) : example ? (
          <ExampleRun example={example} />
        ) : (
          <p className="max-w-prose text-body text-muted">No example run is available for this tool yet.</p>
        )}
      </main>
    </>
  )
}
