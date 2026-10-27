import { clamp } from '@/lib/format'
import type { Segment } from '../types'

/** A count that climbs with step progress, so the live line agrees with the final dataset. */
export function ramp(total: number, p: number): number {
  return Math.round(total * clamp(p))
}

export function plain(text: string): Segment[] {
  return [{ text }]
}

/** Cut `text` into segments, striking the given [start, end) spans. */
export function strikeSpans(text: string, spans: [number, number][]): Segment[] {
  const sorted = spans.slice().sort((a, b) => a[0] - b[0])
  const out: Segment[] = []
  let at = 0
  for (const [s, e] of sorted) {
    if (e <= at) continue
    const start = Math.max(s, at)
    if (start > at) out.push({ text: text.slice(at, start) })
    out.push({ text: text.slice(start, e), struck: true })
    at = e
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}

/** Keep the first `max` characters across segments, on one line. */
export function clipSegments(segments: Segment[], max: number): Segment[] {
  const out: Segment[] = []
  let left = max
  for (const seg of segments) {
    if (left <= 0) break
    const flat = seg.text.replace(/\s+/g, ' ')
    const text = flat.length > left ? flat.slice(0, left).trimEnd() + '...' : flat
    out.push({ ...seg, text })
    left -= flat.length
  }
  return out
}
