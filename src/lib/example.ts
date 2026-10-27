import { useEffect, useState } from 'react'
import type { DaemonSlug } from '@/data/daemons'
import type { Finding, RunSummary } from './runTypes'
import { asset } from './static'

/* A real example run per tool, captured once from a live run on a real game and shipped as a static file
   (public/examples/<slug>.json, written by scripts/capture-example.mjs). The GitHub Pages preview shows it read-only,
   and each tool's page uses its `hero` images as the card's picture: real images from the game's world (the original
   and a copy found, a creator's real video of the game, the game's own thumbnail). Nothing here is invented: it is the
   output of a real run, labelled with when it was captured. */

export interface ExampleHeroImage {
  /** An https image URL (Roblox CDN, YouTube thumbnail) or a path under /examples/. */
  url: string
  /** A few words under or on the image: 'Original', 'A copy found', 'Creator video'. */
  caption: string
}

export interface ToolExample {
  tool: DaemonSlug
  /** ISO time the run was captured. */
  capturedAt: string
  game: { name: string; placeId: number; url: string; cover: string | null }
  /** One or two images that picture this tool on this game. */
  hero: ExampleHeroImage[]
  /** One plain sentence on what the hero shows, with the real numbers (for example the hash distance of the copy). */
  heroNote: string
  summary: RunSummary | null
  findings: Finding[]
  /** Set when a tool cannot show a run publicly (Discord needs the owner's own bot): why, in one sentence. */
  note?: string
  /** Thumbnail Daemon only: a real original and the variants generated from it, as small static files under /examples/. */
  variants?: { original: string; items: string[]; prompt: string }
  /** Discord Daemon only: the public invite lookup of the game's own server (real, no token needed). */
  server?: { name: string; members: number | null; online: number | null; iconUrl: string | null; inviteUrl: string }
}

const cache = new Map<DaemonSlug, Promise<ToolExample | null>>()

/** Fetches public/examples/<slug>.json once. Resolves null when it is missing or unreadable. */
export function loadExample(slug: DaemonSlug): Promise<ToolExample | null> {
  let p = cache.get(slug)
  if (!p) {
    p = fetch(asset(`/examples/${slug}.json`), { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<ToolExample>) : null))
      .catch(() => null)
    cache.set(slug, p)
  }
  return p
}

export function useExample(slug: DaemonSlug | null): { example: ToolExample | null; loading: boolean } {
  const [state, setState] = useState<{ slug: DaemonSlug; example: ToolExample | null } | null>(null)
  useEffect(() => {
    if (!slug) return
    let live = true
    void loadExample(slug).then((example) => live && setState({ slug, example }))
    return () => {
      live = false
    }
  }, [slug])
  if (!slug) return { example: null, loading: false }
  const ready = state?.slug === slug
  return { example: ready ? state.example : null, loading: !ready }
}

/** A hero path under /examples/ needs the deploy base; an absolute URL is used as it is. */
export function heroSrc(url: string): string {
  return /^https?:\/\//.test(url) ? url : asset(url)
}
