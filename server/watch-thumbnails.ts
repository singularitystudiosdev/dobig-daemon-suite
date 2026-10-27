import type { Finding, RunSummary } from '../src/lib/runTypes.ts'
import type { ThumbnailDetail } from '../src/lib/details/thumbnail.ts'
import { ResolveError, resolveGame } from './roblox.ts'
import { RunError, type Analyzer } from './tools/types.ts'

/* The Thumbnail Daemon's scheduled analyzer: a free gallery WATCHER. Every run re-reads the game's current gallery
   from Roblox and flags thumbnails that were not there at the last check. It generates no images and spends no
   credits; generation is the button's own stream (POST /api/variants).
   Memory key 'thumbs' = { [thumbId]: ISO time the watcher first saw it }. */

const MEMORY_KEY = 'thumbs'

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

export const watchThumbnails: Analyzer = async (ctx) => {
  const target = ctx.target
  if (target.kind !== 'roblox-game') throw new RunError('bad-input', 'The Thumbnail Daemon watches a Roblox game.')

  ctx.step('gallery', 'Reading the gallery', 'active')
  let gallery: { id: string; url: string }[]
  try {
    gallery = (await resolveGame(String(target.placeId))).gallery
  } catch (err) {
    ctx.step('gallery', 'Reading the gallery', 'failed')
    if (ctx.signal.aborted) throw new RunError('aborted', 'The run was cancelled.')
    if (err instanceof ResolveError) {
      const code = err.code === 'rate-limited' ? 'rate-limited' : err.code === 'upstream' ? 'upstream' : err.code === 'private' ? 'private' : 'not-found'
      throw new RunError(code, err.message, code === 'rate-limited' || code === 'upstream' ? { kind: 'retry', label: 'Try again' } : undefined)
    }
    throw err
  }
  if (ctx.signal.aborted) throw new RunError('aborted', 'The run was cancelled.')
  ctx.step('gallery', 'Reading the gallery', 'done', `${gallery.length} ${gallery.length === 1 ? 'thumbnail' : 'thumbnails'} on the game page`)

  ctx.step('compare', 'Comparing with the last check', 'active')
  const known = ctx.memory.get<Record<string, string>>(MEMORY_KEY)
  const baseline = !known || typeof known !== 'object'
  const before: Record<string, string> = baseline ? {} : known
  const nowIso = ctx.now.toISOString()
  const after: Record<string, string> = {}
  const fresh = new Set<string>()
  for (const g of gallery) {
    if (before[g.id]) after[g.id] = before[g.id]
    else {
      after[g.id] = nowIso
      if (!baseline) fresh.add(g.id)
    }
  }
  const removed = baseline ? 0 : Object.keys(before).filter((id) => !(id in after)).length
  ctx.step('compare', 'Comparing with the last check', 'done', baseline ? 'First check: recorded the gallery as the baseline' : `${fresh.size} new, ${removed} removed`)

  const summary: RunSummary = {
    items: [
      { label: 'Thumbnails now', value: String(gallery.length) },
      { label: 'New since last check', value: baseline ? 'First check' : String(fresh.size), tone: fresh.size > 0 ? 'accent' : undefined },
      { label: 'Removed since last check', value: baseline ? 'First check' : String(removed), tone: removed > 0 ? 'warn' : undefined },
      { label: 'Last checked', value: when(nowIso) },
    ],
    sortLabel: 'Newest first',
    ...(baseline ? { notes: ['This is the first check, so every thumbnail is marked Known and becomes the baseline for the next one.'] } : {}),
    ...(gallery.length === 0 ? { notices: [{ lead: 'No gallery thumbnails.', body: 'Roblox returned no screenshots for this game, so there is nothing to watch yet.' }] } : {}),
  }
  ctx.summary(summary)

  // Newest first: thumbnails first seen at the latest check lead, then older ones by when they were first seen, gallery order breaking ties.
  const rows = gallery.map((g, i) => ({ g, position: i + 1, firstSeen: after[g.id], isNew: fresh.has(g.id) }))
  rows.sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : a.position - b.position))
  for (const r of rows) {
    const detail: ThumbnailDetail = { kind: 'thumbnail', thumbId: r.g.id, url: r.g.url, isNew: r.isNew, firstSeen: r.firstSeen, position: r.position }
    const finding: Finding = {
      id: `thumb:${r.g.id}`,
      badge: r.isNew ? { label: 'New', tone: 'accent' } : { label: 'Known', tone: 'muted' },
      title: `Gallery thumbnail ${r.position}`,
      snippet: [{ text: `First seen ${when(r.firstSeen)}` }],
      meta: [
        { label: 'Position', value: String(r.position) },
        { label: 'First seen', value: when(r.firstSeen) },
      ],
      status: r.isNew ? { label: 'Added since last check', tone: 'accent' } : { label: 'Unchanged', tone: 'muted' },
      url: r.g.url,
      detail,
    }
    ctx.finding(finding)
  }

  ctx.memory.set(MEMORY_KEY, after)
}
