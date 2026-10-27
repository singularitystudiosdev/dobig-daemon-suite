import { useEffect, useState, ViewTransition } from 'react'
import { markNav, toolHref } from '@/lib/router'
import { cn } from '@/lib/cn'
import { daemonsBySlug } from '@/data/daemons'
import { tools, type ToolMeta } from '@/data/tools'

/* The front door: the toolkit's name and one card per tool, nothing else. A card is an icon, the tool's name and what it
   does, in the dobig.com style (black canvas, surface cards, one accent). The entrance is one orchestrated sequence
   (title, then the cards in order) and plays once per page load, so coming back from a tool lands on a still hub and
   the card's morph is the only motion. Each card's icon carries the shared name `tool-<slug>`, which the detail page's
   card repeats so the icon becomes the card. */

let entrancePlayed = false

const TILE_START = 200
const TILE_STEP = 90

export default function Hub() {
  const [animate] = useState(() => !entrancePlayed)
  useEffect(() => {
    entrancePlayed = true
  }, [])
  const rise = animate ? 'motion-safe:animate-rise' : ''

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-page px-24 pb-96 pt-48">
      <h1 className={cn('text-display text-ink md:text-mega', rise)}>Roblox Daemon Toolkit</h1>

      <ul className="mt-48 grid grid-cols-1 gap-24 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool, i) => (
          <li key={tool.slug} className={rise} style={animate ? { animationDelay: `${TILE_START + i * TILE_STEP}ms` } : undefined}>
            <Tile tool={tool} />
          </li>
        ))}
      </ul>
    </main>
  )
}

function Tile({ tool }: { tool: ToolMeta }) {
  const Icon = daemonsBySlug[tool.slug].icon
  const fact = tool.facts[0]
  return (
    <a
      href={toolHref(tool.slug)}
      onClick={() => markNav('forward')}
      className="group flex h-full flex-col rounded-20 border border-line bg-surface p-24 transition-[transform,border-color] duration-200 ease-standard hover:-translate-y-4 hover:border-line-strong motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <ViewTransition name={`tool-${tool.slug}`} share="tool-morph" default="none">
        <div className="flex size-48 items-center justify-center rounded-8 bg-raised text-accent-ink">
          <Icon aria-hidden className="size-24" />
        </div>
      </ViewTransition>
      <h2 className="mt-16 text-title font-bold text-ink transition-colors duration-150 group-hover:text-accent-ink">{tool.name}</h2>
      <p className="mt-8 text-body text-muted">{tool.description[0]}</p>
      {fact && (
        <p className="mt-auto pt-16 text-label text-subtle">
          <span className="text-muted">{fact.label}:</span> {fact.value}
        </p>
      )}
    </a>
  )
}
