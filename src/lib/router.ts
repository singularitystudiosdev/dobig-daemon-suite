import { useEffect, useState } from 'react'

/* Hash router: `#/` is the hub, `#/d/<slug>` a daemon, `?key=value` after the path is query.
   Hashes that do not start with `#/` (in-page anchors) leave the route alone. */

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
      setRoute((prev) => {
        if (prev.segments.join('/') !== next.segments.join('/')) window.scrollTo({ top: 0 })
        return next
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

export function navigate(path: string) {
  window.location.hash = hrefFor(path).slice(1)
}

export function daemonHref(slug: string, query?: Record<string, string>) {
  const q = query ? '?' + new URLSearchParams(query).toString() : ''
  return `#/d/${slug}${q}`
}
