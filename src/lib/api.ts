import type { ApiError, GalleryThumb, ResolveResponse, StatusResponse, VariantEvent, VariantRequest } from './apiTypes'

/* Typed client for the dev-server API (server/**). Nothing here throws on an expected failure:
   resolveGame always returns ok true or an ApiError; streamVariants rejects only for transport failures. */

export async function getStatus(signal?: AbortSignal): Promise<StatusResponse> {
  const res = await fetch('/api/status', { signal, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Status request failed (${res.status})`)
  return (await res.json()) as StatusResponse
}

export async function resolveGame(link: string, signal?: AbortSignal): Promise<ResolveResponse | ApiError> {
  try {
    const res = await fetch(`/api/game?link=${encodeURIComponent(link)}`, { signal, headers: { accept: 'application/json' } })
    const body = (await res.json().catch(() => null)) as ResolveResponse | ApiError | null
    if (body && typeof body === 'object' && 'ok' in body) {
      if (body.ok) return { ...body, gallery: dedupe(body.gallery) }
      return body
    }
    return { ok: false, code: 'upstream', message: 'The demo server sent an unreadable answer. Try again in a moment.' }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return { ok: false, code: 'upstream', message: 'Could not reach the demo server. Check that it is running, then try again.' }
  }
}

function dedupe(gallery: GalleryThumb[]): GalleryThumb[] {
  const seen = new Set<string>()
  return gallery.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
}

/** POSTs a variants request and calls `onEvent` for each NDJSON line as it arrives.
    Resolves when the stream closes; an abort resolves quietly; other failures reject. */
export async function streamVariants(request: VariantRequest, key: string, onEvent: (e: VariantEvent) => void, signal: AbortSignal): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/x-ndjson' }
  if (key) headers['x-gemini-key'] = key
  try {
    const res = await fetch('/api/variants', { method: 'POST', headers, body: JSON.stringify(request), signal })
    if (!res.ok || !res.body) throw new Error(`The variants request failed (${res.status})`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const flush = (line: string) => {
      const text = line.trim()
      if (!text) return
      try {
        onEvent(JSON.parse(text) as VariantEvent)
      } catch {
        /* a partial or garbled line is skipped; the next event carries the state */
      }
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl = buffer.indexOf('\n')
      while (nl !== -1) {
        flush(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    flush(buffer)
  } catch (err) {
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
    throw err
  }
}
