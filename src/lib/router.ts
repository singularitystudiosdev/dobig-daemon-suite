import { addTransitionType, startTransition, useEffect, useState } from 'react'

/* Hash router: `#/` is the hub, `#/t/<slug>` a tool's detail page, `#/demo/<slug>` its demo dashboard,
   `#/d/<slug>` the full simulated run. `?key=value` after the path is query.
   Hashes that do not start with `#/` (in-page anchors) leave the route alone.

   React 19.3 animates <ViewTransition> only for updates made inside startTransition, and the hashchange
   event fires outside one, so the handler wraps setRoute itself. `markNav(type)` tags the next change
   ('forward' into a tool, 'back' out of it) so a ViewTransition can pick an animation per direction.
   The browser Back button fires popstate, which React skips: it swaps without animating. */

export type NavType = 'forward' | 'back' | 'swap'

let pendingType: NavType | null = null

export function markNav(type: NavType) {
  pendingType = type
}

function parse(hash: string): { segments: string[]; query: URLSearchParams } | null {
  if (!hash.startsWith('#/')) return null
  const [path, search = ''] = hash.slice(2).split('?')
  return { segments: path.split('/').filter(Boolean), query: new URLSearchParams(search) }
}

export function useRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash) ?? { segments: [], query: new URLSearchParams() })
  useEffect(() => {
    const onChange = () => {
      const next = parse(window.location.hash)
      if (!next) return
      const type = pendingType ?? 'swap'
      pendingType = null
      startTransition(() => {
        addTransitionType(type)
        setRoute((prev) => {
          if (prev.segments.join('/') !== next.segments.join('/')) window.scrollTo({ top: 0 })
          return next
        })
      })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function hrefFor(path: string) {
  return '#' + (path.startsWith('/') ? path : '/' + path)
}

export function navigate(path: string, type: NavType = 'swap') {
  markNav(type)
  window.location.hash = hrefFor(path).slice(1)
}

export function daemonHref(slug: string, query?: Record<string, string>) {
  const q = query ? '?' + new URLSearchParams(query).toString() : ''
  return `#/d/${slug}${q}`
}

export const toolHref = (slug: string) => `#/t/${slug}`
export const demoHref = (slug: string) => `#/demo/${slug}`
