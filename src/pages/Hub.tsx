import { useEffect, useState, ViewTransition } from 'react'
import { markNav, toolHref } from '@/lib/router'
import { cn } from '@/lib/cn'
import { tools, type ToolMeta } from '@/data/tools'

/* The front door: the toolkit's name and six 16:9 tiles, nothing else. The entrance is one
   orchestrated sequence (title, lede, then the tiles in order) and plays once per page load, so
   coming back from a tool lands on a still hub and the card's morph is the only motion. Each
   tile's art carries the shared name `tool-<slug>`, which the detail page's card repeats so the
   tile becomes the card. */

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
  return (
    <a
      href={toolHref(tool.slug)}
      onClick={() => markNav('forward')}
      className="group flex h-full flex-col rounded-20 border border-line bg-surface p-16 transition-[transform,border-color] duration-200 ease-standard hover:-translate-y-8 hover:border-line-strong motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <ViewTransition name={`tool-${tool.slug}`} share="tool-morph" default="none">
        <div className="aspect-video overflow-hidden rounded-8 bg-raised">
          <img
            src={tool.art}
            alt=""
            width={960}
            height={540}
            decoding="async"
            className="size-full object-cover transition-transform duration-200 ease-standard group-hover:scale-102 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        </div>
      </ViewTransition>
      <h2 className="mt-16 text-center text-title font-bold text-ink transition-colors duration-150 group-hover:text-accent-ink">{tool.name}</h2>
    </a>
  )
}
