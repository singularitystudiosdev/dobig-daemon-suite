import type { GalleryThumb, VariantEvent, VariantRequest } from '@/lib/apiTypes'

/* Two calls the Thumbnail workspace makes that src/lib/api.ts does not cover: the variants POST that can answer
   402 (not enough credits, before any stream) and the read-only lookup of outputs generated earlier. The key lives on
   the server, so no key header is sent from the browser. */

export type VariantsOutcome =
  | { kind: 'streamed' }
  | { kind: 'aborted' }
  | { kind: 'credits'; needed: number; balance: number }
  | { kind: 'error'; message: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** POSTs a variants request, charged by the server. Calls `onEvent` for each NDJSON line; resolves when the stream closes. */
export async function postVariants(request: VariantRequest, onEvent: (e: VariantEvent) => void, signal: AbortSignal): Promise<VariantsOutcome> {
  let res: Response
  try {
    res = await fetch('/api/variants', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(request),
      signal,
    })
  } catch (err) {
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return { kind: 'aborted' }
    return { kind: 'error', message: 'Could not reach the local server. Check that it is running, then try again.' }
  }
  if (!res.ok || !res.body) {
    const body: unknown = await res.json().catch(() => null)
    if (res.status === 402 && isRecord(body) && body.code === 'credits') {
      return { kind: 'credits', needed: Number(body.needed) || 0, balance: Number(body.balance) || 0 }
    }
    const message = isRecord(body) && typeof body.message === 'string' ? body.message : `The variants request failed (${res.status}).`
    return { kind: 'error', message }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const flush = (line: string) => {
    const text = line.trim()
    if (!text) return
    try {
      onEvent(JSON.parse(text) as VariantEvent)
    } catch {
      /* a garbled line is skipped; later events carry the state */
    }
  }
  try {
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
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return { kind: 'aborted' }
    return { kind: 'error', message: err instanceof Error ? err.message : 'The connection broke.' }
  }
  return { kind: 'streamed' }
}

export interface ExistingVariant {
  thumbId: string
  index: number
  src: string
}

/** Outputs generated earlier for these gallery ids. Read-only: never generates and never charges. */
export async function fetchExistingVariants(thumbs: GalleryThumb[], signal: AbortSignal): Promise<ExistingVariant[]> {
  const ids = thumbs.map((t) => t.id).join(',')
  const res = await fetch(`/api/variants/existing?ids=${encodeURIComponent(ids)}`, { signal, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Could not look up earlier outputs (${res.status}).`)
  const body: unknown = await res.json().catch(() => null)
  return parseExisting(body)
}

/** Accepts the list form ({variants|items|existing: [{thumbId,index,src}]}) and the map form ({thumbId: [src, ...]}). */
export function parseExisting(body: unknown): ExistingVariant[] {
  if (!isRecord(body)) return []
  const list = [body.variants, body.items, body.existing, body.results].find(Array.isArray)
  const out: ExistingVariant[] = []
  if (Array.isArray(list)) {
    for (const v of list) {
      if (isRecord(v) && typeof v.thumbId === 'string' && typeof v.src === 'string' && Number.isInteger(v.index)) out.push({ thumbId: v.thumbId, index: v.index as number, src: v.src })
    }
    return out
  }
  const map = [body.variants, body.items, body.existing, body.results].find(isRecord) ?? body
  for (const [thumbId, value] of Object.entries(map as Record<string, unknown>)) {
    if (Array.isArray(value)) value.forEach((src, index) => typeof src === 'string' && out.push({ thumbId, index, src }))
    else if (isRecord(value)) for (const [i, src] of Object.entries(value)) if (typeof src === 'string' && Number.isInteger(Number(i))) out.push({ thumbId, index: Number(i), src })
  }
  return out
}
