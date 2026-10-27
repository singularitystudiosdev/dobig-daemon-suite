import { ViewTransition } from 'react'
import { ArrowLeft, Play, SearchX } from 'lucide-react'
import { demoHref, markNav, navigate } from '@/lib/router'
import { isDaemonSlug, type DaemonSlug } from '@/data/daemons'
import { daemonsBySlug } from '@/data/daemons'
import { toolsBySlug } from '@/data/tools'
import { EmptyState, Skeleton } from '@/components/ui'
import { ToolHero } from '@/components/ToolHero'
import { useExample } from '@/lib/example'

/* Facts are a local pill pair (same look as StatPill) because StatPill never wraps and some values
   are a full phrase that must fit a 390px card.

   A tool's detail page: the hub card's icon lands in a card on the left under the same shared name
   the hub gave it, with a real picture from the game's world under it, then the description rises in on the right once
   the morph is under way. */

const DESC_DELAY = 200

function Picture({ slug }: { slug: DaemonSlug }) {
  const { example, loading } = useExample(slug)
  if (loading) return <Skeleton className="mt-16 aspect-video w-full" />
  if (!example || example.hero.length === 0) return null
  return (
    <figure className="mt-16">
      <ToolHero images={example.hero} />
      <figcaption className="mt-8 text-micro text-muted">{example.heroNote}</figcaption>
    </figure>
  )
}

export default function ToolDetail({ slug }: { slug: string }) {
  const tool = isDaemonSlug(slug) ? toolsBySlug[slug] : null

  if (!tool) {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-page px-24 py-96">
        <EmptyState icon={SearchX} sentence="That tool is not in the toolkit." actionLabel="Back to toolkit" onAction={() => navigate('/', 'back')} />
      </main>
    )
  }

  const Icon = daemonsBySlug[tool.slug].icon

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-page px-24 pb-96 pt-32">
      <div className="grid grid-cols-1 items-start gap-32 lg:grid-cols-2 lg:gap-48">
        <div className="rounded-20 border border-line bg-surface p-24 lg:sticky lg:top-96">
          <div className="flex items-center gap-16">
            <ViewTransition name={`tool-${tool.slug}`} share="tool-morph" default="none">
              <div className="flex size-48 shrink-0 items-center justify-center rounded-8 bg-raised text-accent-ink">
                <Icon aria-hidden className="size-24" />
              </div>
            </ViewTransition>
            <div className="min-w-0">
              <p className="text-title font-bold text-ink">{tool.name}</p>
              <p className="text-label text-muted">{tool.blurb}</p>
            </div>
          </div>
          <Picture slug={tool.slug} />
          <div className="mt-16 flex flex-col gap-8">
            {tool.facts.map((f) => (
              <div key={f.label} className="flex flex-col gap-4 rounded-8 bg-raised px-12 py-8 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                <span className="text-label text-muted">{f.label}</span>
                <span className="text-stat font-bold text-ink sm:text-right">{f.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-32">
          <div className="motion-safe:animate-rise" style={{ animationDelay: `${DESC_DELAY}ms` }}>
            <h1 className="text-display text-ink">{tool.name}</h1>
            <div className="mt-16 flex max-w-prose flex-col gap-12">
              {tool.description.map((p) => (
                <p key={p} className="text-body text-muted">
                  {p}
                </p>
              ))}
            </div>
          </div>

          <div className="motion-safe:animate-rise" style={{ animationDelay: `${DESC_DELAY + 70}ms` }}>
            <h2 className="text-title font-bold text-ink">What a run does</h2>
            <ol className="mt-12 flex max-w-prose list-decimal flex-col gap-8 pl-24 text-body text-muted marker:text-subtle">
              {tool.steps.map((s) => (
                <li key={s} className="pl-4">
                  {s}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col items-start gap-16 motion-safe:animate-rise" style={{ animationDelay: `${DESC_DELAY + 140}ms` }}>
            <div className="flex flex-wrap items-center gap-12">
              <a
                href={demoHref(tool.slug)}
                onClick={() => markNav('forward')}
                className="state-layer inline-flex h-48 items-center justify-center gap-8 whitespace-nowrap rounded-8 bg-accent px-24 text-body font-medium text-ink transition-colors duration-150"
              >
                <Play aria-hidden className="size-20" />
                Try Demo
              </a>
              <a
                href="#/"
                onClick={() => markNav('back')}
                className="state-layer inline-flex h-48 items-center justify-center gap-8 whitespace-nowrap rounded-8 px-16 text-body font-medium text-muted transition-colors duration-150 hover:text-ink"
              >
                <ArrowLeft aria-hidden className="size-20" />
                Back to toolkit
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
