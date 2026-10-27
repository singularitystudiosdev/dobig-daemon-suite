import { randomUUID } from 'node:crypto'
import type { DmcaCandidate, DmcaDetail, DmcaImagePair, DmcaLane } from '../../src/lib/details/dmca.ts'
import type { Finding, Notice, RobloxTarget } from '../../src/lib/runTypes.ts'
import {
  downloadRobloxImage,
  fetchGalleryUrls,
  fetchGameDetails,
  fetchIconUrls,
  omniSearchGames,
  ResolveError,
  type GameDetails,
  type OmniGame,
} from '../roblox.ts'
import { colorSimilarity, fingerprintBytes, hamming, type Fingerprint } from './dmca-image.ts'
import {
  buildNotice,
  cleanModelText,
  descriptionSimilarity,
  distinctiveWords,
  excerpt,
  firstLine,
  isStopWord,
  nameSimilarity,
  normalise,
  sharedPhrases,
  squash,
  tokens,
} from './dmca-text.ts'
import { RunError, type RunContext, type ToolModule } from './types.ts'

/* DMCA Daemon analyzer. It fingerprints the owner's game (gallery thumbnails and icon), searches Roblox for look-alike
   games, fingerprints their images the same way and sorts every candidate into a lane. It prepares evidence and a
   notice draft. It never files anything: Roblox Rights Manager has no public API. */

// ---------------------------------------------------------------- the lane rule (the UI shows these exact words)

export const NEAR_DISTANCE = 2
export const NEAR_NAME_SIMILARITY = 0.5
export const REVIEW_DISTANCE = 10
export const REVIEW_NAME_SIMILARITY = 0.75
export const REVIEW_DESCRIPTION_SIMILARITY = 0.5
export const WEAK_DISTANCE = 16
export const WEAK_DESCRIPTION_SIMILARITY = 0.35
export const WEAK_SHOWN = 8

export const LANE_RULES = {
  identical: `Identical image: one of their images has the very same bytes as one of yours (equal sha256). That shows the same file was used, not who made it first.`,
  near: `Near-identical image: the closest image pair differs by ${NEAR_DISTANCE} or fewer of 64 hash bits and the names are at least ${NEAR_NAME_SIMILARITY * 100}% similar. This is a perceptual match, not identical bytes.`,
  review: `Needs review: the closest image pair differs by ${REVIEW_DISTANCE} or fewer of 64 hash bits, or the names are at least ${REVIEW_NAME_SIMILARITY * 100}% similar and the descriptions at least ${REVIEW_DESCRIPTION_SIMILARITY * 100}% similar.`,
  weak: `Weak signal: the closest image pair differs by ${WEAK_DISTANCE} or fewer of 64 hash bits, or the descriptions are at least ${WEAK_DESCRIPTION_SIMILARITY * 100}% similar. Only the strongest ${WEAK_SHOWN} are listed.`,
}

export const LANE_LABEL: Record<DmcaLane, string> = { identical: 'Identical image', near: 'Near-identical image', review: 'Needs review', weak: 'Weak signal' }

const MAX_CANDIDATES = 80
const OWN_GALLERY = 10
const THEIR_GALLERY = 6
const MAX_FP_ENTRIES = 520
const RIGHTS_MANAGER_URL = 'https://create.roblox.com/dashboard/ip'
const RIGHTS_MANAGER_DOCS_URL = 'https://create.roblox.com/docs/production/publishing/rights-manager'

// ------------------------------------------------------------------------------------------------- small helpers

type FpEntry = [sha: string, dhash: string, color: string, flat: 0 | 1]
type FpCache = Record<string, FpEntry>

/** The id inside a tr.rbxcdn.com URL: it changes when the picture changes, so it is the cache key. */
export function imageKey(url: string): string {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean)
    return p.slice(0, 3).join('/')
  } catch {
    return url
  }
}

function abortIfNeeded(ctx: RunContext): void {
  if (ctx.signal.aborted) throw new RunError('aborted', 'The run was cancelled.')
}

const yieldLoop = () => new Promise<void>((r) => setImmediate(r))

async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await worker(items[next++])
  })
  await Promise.all(runners)
}

function creatorUrl(type: string, id: number): string {
  return type === 'Group' ? `https://www.roblox.com/communities/${id}` : `https://www.roblox.com/users/${id}/profile`
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const dateOnly = (iso: string) => (iso ? iso.slice(0, 10) : 'Not available')

function mapResolveError(err: unknown): never {
  if (err instanceof RunError) throw err
  if (err instanceof ResolveError) {
    const code = err.code === 'rate-limited' ? 'rate-limited' : err.code === 'not-found' ? 'not-found' : err.code === 'private' ? 'private' : 'upstream'
    throw new RunError(code, err.message, { kind: 'retry', label: 'Run again' })
  }
  throw err
}

// ----------------------------------------------------------------------------------------- fingerprinting images

interface FpResult {
  map: Map<string, Fingerprint | null>
  cached: number
  downloaded: number
  failed: number
}

/** Fingerprints every url. Entries already in `cache` (same image key) are not downloaded or decoded again. */
async function fingerprintUrls(urls: string[], cache: FpCache, ctx: RunContext, onTick?: (done: number, total: number) => void): Promise<FpResult> {
  const map = new Map<string, Fingerprint | null>()
  const todo: string[] = []
  let cached = 0
  for (const url of [...new Set(urls)]) {
    const hit = cache[imageKey(url)]
    if (hit) {
      map.set(url, { sha: hit[0], dhash: hit[1], color: hit[2], flat: hit[3] === 1 })
      cached++
    } else todo.push(url)
  }
  let downloaded = 0
  let failed = 0
  let done = 0
  await pool(todo, 8, async (url) => {
    if (ctx.signal.aborted) return
    const bytes = await downloadRobloxImage(url, ctx.signal)
    const fp = bytes ? fingerprintBytes(bytes)?.fp ?? null : null
    await yieldLoop()
    if (fp) {
      map.set(url, fp)
      cache[imageKey(url)] = [fp.sha, fp.dhash, fp.color, fp.flat ? 1 : 0]
      downloaded++
    } else {
      map.set(url, null)
      failed++
    }
    onTick?.(++done, todo.length)
  })
  abortIfNeeded(ctx)
  return { map, cached, downloaded, failed }
}

// --------------------------------------------------------------------------------------------------- searching

interface Found extends OmniGame {
  foundBy: string
}

function cleanQuery(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s'&-]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

async function searchCandidates(ctx: RunContext, own: GameDetails): Promise<{ games: Found[]; queries: string[] }> {
  const sessionId = randomUUID()
  const seen = new Map<number, Found>()
  const queries: string[] = []
  const ran = new Set<string>()
  const ownTokens = new Set(tokens(own.name))

  async function run(query: string, maxPages: number): Promise<void> {
    const key = query.toLowerCase()
    if (!query || ran.has(key)) return
    ran.add(key)
    queries.push(query)
    let token: string | null = null
    for (let page = 0; page < maxPages; page++) {
      abortIfNeeded(ctx)
      const res = await omniSearchGames(query, sessionId, token, ctx.signal)
      for (const g of res.games) if (!seen.has(g.universeId)) seen.set(g.universeId, { ...g, foundBy: query })
      token = res.nextPageToken
      if (!token || res.games.length === 0 || seen.size >= 220) break
    }
  }

  const clean = cleanQuery(own.name) || own.name
  const words = distinctiveWords(own.name)
  const longest = [...words].sort((a, b) => b.length - a.length)[0]
  ctx.step('search', 'Searching Roblox for look-alikes', 'active', `"${clean}"`)
  await run(clean, 3)
  if (words.length > 1) await run(words.join(' '), 2)
  if (words.length > 1 && longest && longest.length >= 4) await run(longest, 2)
  const squashed = cleanQuery(own.name).replace(/\s+/g, '')
  if (squashed.length >= 4) await run(squashed, 2)
  const line = firstLine(own.description)
  if (line && normalise(line) !== normalise(own.name)) await run(line, 2)

  // Suffixes and prefixes that copycats of THIS name use are discovered in what search returned, never hard-coded.
  const extras = new Map<string, number>()
  for (const g of seen.values()) {
    const t = tokens(g.name)
    const containsName = squash(g.name).includes(squash(own.name)) || [...ownTokens].every((w) => t.includes(w))
    if (!containsName) continue
    for (const w of t) if (!ownTokens.has(w) && !isStopWord(w) && w.length >= 3 && !/^\d+$/.test(w)) extras.set(w, (extras.get(w) ?? 0) + 1)
  }
  const discovered = [...extras.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w)
  for (const w of discovered) {
    ctx.step('search', 'Searching Roblox for look-alikes', 'active', `"${clean} ${w}" (a word look-alikes of your name use)`)
    await run(`${clean} ${w}`, 1)
  }
  return { games: [...seen.values()], queries }
}

// ------------------------------------------------------------------------------------------------ the comparison

interface Compared {
  game: Found
  details: GameDetails
  imageUrls: string[]
  usable: { url: string; fp: Fingerprint }[]
  best: { distance: number; pairs: DmcaImagePair[] } | null
  identicalImages: number
  nameSim: number
  descSim: number
  phrases: string[]
  lane: DmcaLane | null
  reasons: string[]
}

function classify(c: Compared): void {
  const dist = c.best ? c.best.distance : null
  const byBytes = c.identicalImages > 0
  const nearHash = dist !== null && dist <= NEAR_DISTANCE && c.nameSim >= NEAR_NAME_SIMILARITY
  const reviewDist = dist !== null && dist <= REVIEW_DISTANCE
  const reviewText = c.nameSim >= REVIEW_NAME_SIMILARITY && c.descSim >= REVIEW_DESCRIPTION_SIMILARITY
  const weakDist = dist !== null && dist <= WEAK_DISTANCE
  const weakText = c.descSim >= WEAK_DESCRIPTION_SIMILARITY
  const reasons: string[] = []
  if (byBytes) {
    c.lane = 'identical'
    reasons.push(`${c.identicalImages} of its ${c.usable.length} compared images have exactly the same bytes (sha256) as an image of yours`)
  } else if (nearHash) {
    c.lane = 'near'
    reasons.push(`the closest image pair differs by ${dist} of 64 hash bits (rule: ${NEAR_DISTANCE} or fewer) and the names are ${pct(c.nameSim)} similar (rule: ${pct(NEAR_NAME_SIMILARITY)} or more)`)
  } else if (reviewDist || reviewText) {
    c.lane = 'review'
    if (reviewDist) reasons.push(`the closest image pair differs by ${dist} of 64 hash bits (rule: ${REVIEW_DISTANCE} or fewer)`)
    if (reviewText) reasons.push(`the names are ${pct(c.nameSim)} similar (rule: ${pct(REVIEW_NAME_SIMILARITY)} or more) and the descriptions ${pct(c.descSim)} similar (rule: ${pct(REVIEW_DESCRIPTION_SIMILARITY)} or more)`)
  } else if (weakDist || weakText) {
    c.lane = 'weak'
    if (weakDist) reasons.push(`the closest image pair differs by ${dist} of 64 hash bits (rule: ${WEAK_DISTANCE} or fewer)`)
    if (weakText) reasons.push(`the descriptions are ${pct(c.descSim)} similar (rule: ${pct(WEAK_DESCRIPTION_SIMILARITY)} or more)`)
  } else c.lane = null
  c.reasons = reasons
}

function ruleExplanation(c: Compared): string {
  const head = LANE_LABEL[c.lane as DmcaLane]
  const tail =
    c.lane === 'identical'
      ? 'Matching bytes show the same image file was used. They do not show who made it first, so review both games yourself before you file.'
      : c.lane === 'near'
        ? 'A near-identical picture plus a similar name is strong evidence of reuse, but it is a perceptual match and not identical bytes, so open both games and review them before you file.'
        : c.lane === 'review'
          ? 'A perceptual or text match is a lead, not proof. Open both games and compare them before you decide.'
          : 'This is a faint overlap and is shown only so you can rule it out.'
  return `${head}: ${c.reasons.join('; and ')}. ${tail}`
}

function evidenceSentence(c: Compared): string {
  const parts: string[] = []
  const total = c.usable.length
  if (c.identicalImages > 0) parts.push(`${c.identicalImages} of ${total} ${total === 1 ? 'image is' : 'images are'} identical to yours`)
  else if (c.best) parts.push(`closest image differs by ${c.best.distance} of 64 hash bits (${pct(1 - c.best.distance / 64)} alike)`)
  else parts.push('images not compared')
  parts.push(`name ${pct(c.nameSim)} similar`)
  if (c.descSim > 0) parts.push(`description ${pct(c.descSim)} similar`)
  return parts.join('; ')
}

function sortKey(c: Compared): number[] {
  const laneRank = c.lane === 'identical' ? 0 : c.lane === 'near' ? 1 : c.lane === 'review' ? 2 : 3
  return [laneRank, -c.identicalImages, c.best ? c.best.distance : 99, -c.descSim, -c.nameSim]
}

function compareSort(a: Compared, b: Compared): number {
  const ka = sortKey(a)
  const kb = sortKey(b)
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
  return a.game.name.localeCompare(b.game.name)
}

// -------------------------------------------------------------------------------------------- optional model note

const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'note'], properties: { id: { type: 'string' }, note: { type: 'string' } } },
    },
  },
}

async function modelNotes(ctx: RunContext, own: GameDetails, list: Compared[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const cache = ctx.memory.get<Record<string, { h: string; t: string }>>('notes') ?? {}
  const fresh: Compared[] = []
  for (const c of list) {
    const h = `${normalise(c.details.name)}|${squash(c.details.description).slice(0, 400).length}|${squash(own.description).length}`
    const hit = cache[String(c.details.universeId)]
    if (hit && hit.h === h) out.set(c.details.universeId, hit.t)
    else fresh.push(c)
  }
  for (let i = 0; i < fresh.length; i += 4) {
    abortIfNeeded(ctx)
    const batch = fresh.slice(i, i + 4)
    const user = [
      `ORIGINAL GAME\nName: ${own.name}\nDescription: ${excerpt(own.description, 700)}`,
      ...batch.map((c) => `CANDIDATE id=${c.details.universeId}\nName: ${c.details.name}\nDescription: ${excerpt(c.details.description, 700)}`),
    ].join('\n\n')
    try {
      const res = await ctx.llm.json<{ notes: { id: string; note: string }[] }>(
        {
          name: 'dmca_model_notes',
          system:
            'You compare Roblox game listings. For each CANDIDATE write exactly one plain sentence (at most 25 words) saying which parts of its name or description look reused from the ORIGINAL GAME, quoting the shared words, or saying that nothing obviously looks reused. Never say whether anything is illegal, infringing or stolen, and never suggest an action. No em dashes.',
          user,
          schema: NOTE_SCHEMA,
          maxTokens: 600,
          temperature: 0,
        },
        ctx.signal,
      )
      for (const n of res.data.notes ?? []) {
        const c = batch.find((b) => String(b.details.universeId) === String(n.id))
        if (!c || typeof n.note !== 'string' || !n.note.trim()) continue
        const text = cleanModelText(n.note)
        out.set(c.details.universeId, text)
        cache[String(c.details.universeId)] = { h: `${normalise(c.details.name)}|${squash(c.details.description).slice(0, 400).length}|${squash(own.description).length}`, t: text }
      }
    } catch (err) {
      if (err instanceof RunError && err.code === 'aborted') throw err
      ctx.step('notes', 'Asking a model to describe what looks reused', 'warn', err instanceof RunError ? err.message : 'The model note could not be made.')
      break
    }
  }
  ctx.memory.set('notes', cache)
  return out
}

// ----------------------------------------------------------------------------------------------------- the run

async function analyze(ctx: RunContext): Promise<void> {
  const target = ctx.target
  if (target.kind !== 'roblox-game') throw new RunError('bad-input', 'The DMCA Daemon watches a Roblox game. Point it at a game link.')
  try {
    await run(ctx, target)
  } catch (err) {
    mapResolveError(err)
  }
}

async function run(ctx: RunContext, target: RobloxTarget): Promise<void> {
  const checked = ctx.now.toISOString()
  const fpCache: FpCache = ctx.memory.get<FpCache>('fp') ?? {}
  const usedKeys = new Set<string>()

  // 1. Our game and its fingerprints.
  ctx.step('fingerprint', 'Fingerprinting your game', 'active', 'Reading your game details and thumbnails')
  const ownMap = await fetchGameDetails([target.universeId], ctx.signal)
  const own = ownMap.get(target.universeId)
  if (!own) throw new RunError('not-found', 'Roblox has no public game with that id any more. Check the game link.')
  const ownPlaceId = own.placeId || target.placeId
  const ownUrl = `https://www.roblox.com/games/${ownPlaceId}`
  const ownKey = `${own.creatorType}:${own.creatorId}`
  const [ownGallery, ownIcon] = await Promise.all([fetchGalleryUrls([own.universeId], OWN_GALLERY, ctx.signal), fetchIconUrls([own.universeId], ctx.signal)])
  const ownUrls = [...(ownGallery.get(own.universeId) ?? []), ...(ownIcon.get(own.universeId) ? [ownIcon.get(own.universeId) as string] : [])]
  const ownFp = await fingerprintUrls(ownUrls, fpCache, ctx)
  const ours = ownUrls.flatMap((url) => {
    const fp = ownFp.map.get(url)
    if (fp) usedKeys.add(imageKey(url))
    return fp && !fp.flat ? [{ url, fp }] : []
  })
  const ourShas = new Set(ours.map((o) => o.fp.sha))
  ctx.step(
    'fingerprint',
    'Fingerprinting your game',
    ours.length ? 'done' : 'warn',
    ours.length
      ? `${ours.length} images hashed (${ownFp.cached} from the last run, ${ownFp.downloaded} new)`
      : 'None of your thumbnails could be fetched, so images cannot be compared this run. Text is still compared.',
  )

  // 2. Candidates.
  const found = await searchCandidates(ctx, own)
  const others = found.games.filter((g) => g.universeId !== own.universeId)
  const ownOmniSkipped: Found[] = []
  const toDetail: Found[] = []
  for (const g of others) {
    if (g.creatorId === own.creatorId && g.creatorId > 0 && g.creatorName.toLowerCase() === own.creatorName.toLowerCase()) ownOmniSkipped.push(g)
    else toDetail.push(g)
  }
  ctx.step('search', 'Searching Roblox for look-alikes', 'done', `${found.games.length} games found with ${found.queries.length} searches`)

  ctx.step('details', 'Loading creator and game details', 'active', `${Math.min(toDetail.length, 100)} games`)
  const detailMap = await fetchGameDetails(
    toDetail.slice(0, 100).map((g) => g.universeId),
    ctx.signal,
  )
  const ownSkipped: string[] = ownOmniSkipped.map((g) => g.name)
  const pool80: { game: Found; details: GameDetails }[] = []
  for (const g of toDetail.slice(0, 100)) {
    const d = detailMap.get(g.universeId)
    if (!d || !d.placeId) continue
    const sameOwner = `${d.creatorType}:${d.creatorId}` === ownKey || (d.creatorId === own.creatorId && d.creatorName.toLowerCase() === own.creatorName.toLowerCase())
    if (sameOwner) {
      ownSkipped.push(d.name)
      continue
    }
    if (pool80.length < MAX_CANDIDATES) pool80.push({ game: g, details: d })
  }
  ctx.step('details', 'Loading creator and game details', 'done', `${pool80.length} games by other creators; ${ownSkipped.length} of your own skipped`)

  // 3. Their images.
  ctx.step('images', 'Fetching and hashing their thumbnails', 'active', `${pool80.length} games`)
  const ids = pool80.map((p) => p.details.universeId)
  const [gallery, icons] = await Promise.all([fetchGalleryUrls(ids, THEIR_GALLERY, ctx.signal), fetchIconUrls(ids, ctx.signal)])
  const urlsByUniverse = new Map<number, string[]>()
  for (const id of ids) {
    const list = [...(gallery.get(id) ?? [])]
    const icon = icons.get(id)
    if (icon && !list.includes(icon)) list.push(icon)
    urlsByUniverse.set(id, list)
  }
  const allUrls = [...urlsByUniverse.values()].flat()
  const theirFp = await fingerprintUrls(allUrls, fpCache, ctx, (done, total) => {
    if (done % 40 === 0 || done === total) ctx.step('images', 'Fetching and hashing their thumbnails', 'active', `${done} of ${total} new images hashed`)
  })
  for (const url of allUrls) if (theirFp.map.get(url)) usedKeys.add(imageKey(url))

  // Roblox's default placeholder shows up on many unrelated games; an image shared by 3 or more candidates that
  // is not also one of ours is a placeholder and is never evidence.
  const shaGames = new Map<string, Set<number>>()
  for (const [id, urls] of urlsByUniverse) {
    for (const url of urls) {
      const fp = theirFp.map.get(url)
      if (!fp) continue
      const s = shaGames.get(fp.sha) ?? new Set<number>()
      s.add(id)
      shaGames.set(fp.sha, s)
    }
  }
  const placeholder = new Set([...shaGames.entries()].filter(([sha, g]) => g.size >= 3 && !ourShas.has(sha)).map(([sha]) => sha))

  // 4. Compare.
  ctx.step('compare', 'Comparing images, names and descriptions', 'active', `${ours.length} of your images against ${pool80.length} games`)
  const compared: Compared[] = []
  let imagesCompared = 0
  for (const p of pool80) {
    const urls = urlsByUniverse.get(p.details.universeId) ?? []
    const usable = urls.flatMap((url) => {
      const fp = theirFp.map.get(url)
      return fp && !fp.flat && !placeholder.has(fp.sha) ? [{ url, fp }] : []
    })
    imagesCompared += usable.length
    const pairs: DmcaImagePair[] = []
    let identicalImages = 0
    for (const t of usable) {
      let bestForImage: DmcaImagePair | null = null
      let isIdentical = false
      for (const o of ours) {
        const identical = o.fp.sha === t.fp.sha
        const distance = hamming(o.fp.dhash, t.fp.dhash)
        const pair: DmcaImagePair = { ours: o.url, theirs: t.url, distance: identical ? 0 : distance, identical, colorSimilarity: Math.round(colorSimilarity(o.fp.color, t.fp.color) * 100) / 100 }
        if (identical) isIdentical = true
        if (!bestForImage || (pair.identical && !bestForImage.identical) || (pair.identical === bestForImage.identical && pair.distance < bestForImage.distance)) bestForImage = pair
      }
      if (isIdentical) identicalImages++
      if (bestForImage) pairs.push(bestForImage)
    }
    pairs.sort((a, b) => Number(b.identical) - Number(a.identical) || a.distance - b.distance)
    // Show the pairs that matter: identical or within the weak threshold; when none are, only the single closest pair.
    const shown = pairs.filter((x) => x.identical || x.distance <= WEAK_DISTANCE).slice(0, 4)
    const best = pairs.length ? { distance: pairs[0].distance, pairs: shown.length ? shown : pairs.slice(0, 1) } : null
    const c: Compared = {
      game: p.game,
      details: p.details,
      imageUrls: urls,
      usable,
      best,
      identicalImages,
      nameSim: nameSimilarity(own.name, p.details.name),
      descSim: descriptionSimilarity(own.description, p.details.description),
      phrases: sharedPhrases(own.description, p.details.description),
      lane: null,
      reasons: [],
    }
    classify(c)
    compared.push(c)
  }
  abortIfNeeded(ctx)
  const notCompared = compared.filter((c) => c.usable.length === 0 || ours.length === 0)
  const hits = compared.filter((c) => c.lane !== null).sort(compareSort)
  const identical = hits.filter((c) => c.lane === 'identical')
  const near = hits.filter((c) => c.lane === 'near')
  const review = hits.filter((c) => c.lane === 'review')
  const weakAll = hits.filter((c) => c.lane === 'weak')
  const weak = weakAll.slice(0, WEAK_SHOWN)
  ctx.step('compare', 'Comparing images, names and descriptions', 'done', `${imagesCompared} images compared, ${identical.length} identical, ${near.length} near-identical, ${review.length} to review, ${weakAll.length} weak`)

  // 5. Optional model notes for review candidates.
  let notes = new Map<number, string>()
  const noteTargets = review.slice(0, 6)
  if (noteTargets.length && ctx.llm.available) {
    ctx.step('notes', 'Asking a model to describe what looks reused', 'active', `${noteTargets.length} games to review`)
    notes = await modelNotes(ctx, own, noteTargets)
    ctx.step('notes', 'Asking a model to describe what looks reused', notes.size ? 'done' : 'warn', `${notes.size} notes written (shown as model notes, never as a verdict)`)
  }

  // 6. Memory: fingerprints (only what this run used) and which copies were seen.
  const keep: FpCache = {}
  let kept = 0
  for (const k of usedKeys) {
    if (cache(fpCache, k) && kept++ < MAX_FP_ENTRIES) keep[k] = fpCache[k]
  }
  ctx.memory.set('fp', keep)
  const seenBefore = new Set(ctx.memory.get<string[]>('seen') ?? [])
  const hadPrior = ctx.memory.get<boolean>('ran') === true
  const ordered = [...identical, ...near, ...review, ...weak]
  ctx.memory.set('seen', [...new Set([...seenBefore, ...ordered.map((c) => `dmca:${c.details.universeId}`)])].slice(-400))
  ctx.memory.set('ran', true)

  // 7. Summary and findings.
  const summaryNotes = [LANE_RULES.identical, LANE_RULES.near, LANE_RULES.review, LANE_RULES.weak]
  summaryNotes.push(`Searched Roblox for: ${found.queries.map((q) => `"${q}"`).join(', ')}.`)
  summaryNotes.push(`Roblox search returned ${found.games.length} games. The first ${pool80.length} by other creators, in search rank order, were compared (the cap is ${MAX_CANDIDATES}).`)
  if (weakAll.length > weak.length) summaryNotes.push(`Weak signals: showing the strongest ${weak.length} of ${weakAll.length}.`)
  if (ownSkipped.length) summaryNotes.push(`Your own games skipped (same creator as yours): ${[...new Set(ownSkipped)].slice(0, 6).join(', ')}${new Set(ownSkipped).size > 6 ? ', and more' : ''}.`)
  if (notCompared.length)
    summaryNotes.push(`${notCompared.length} games had no image that could be fetched and hashed, so they were not compared. That is not the same as clean.${ours.length === 0 ? ' Your own thumbnails could not be fetched, so no game was compared by image.' : ''}`)
  if (hits.length === 0) summaryNotes.unshift(`Searched ${pool80.length} games, compared ${imagesCompared} images, no match above the weak threshold.`)
  const items = [
    { label: 'Games searched', value: String(pool80.length) },
    { label: 'Images compared', value: String(imagesCompared) },
    { label: 'Identical images', value: String(identical.length), tone: identical.length ? ('danger' as const) : undefined },
    { label: 'Near-identical images', value: String(near.length), tone: near.length ? ('danger' as const) : undefined },
    { label: 'Need review', value: String(review.length), tone: review.length ? ('warn' as const) : undefined },
    { label: 'Weak signals', value: String(weakAll.length) },
    { label: 'Your own games skipped', value: String(new Set(ownSkipped).size) },
  ]
  if (notCompared.length) items.push({ label: 'Not compared', value: String(notCompared.length), tone: 'warn' as const })
  const notices: Notice[] = [
    {
      lead: 'A wrong takedown has a price.',
      body: 'Under 17 U.S.C. 512(f), anyone who knowingly files a false takedown claim is liable for the damages and legal fees the other side suffers. File only for work you own, and only after you have looked at both games yourself.',
    },
    {
      lead: 'Filing is a human step:',
      body: 'Roblox Rights Manager has no public API. DMCA Daemon prepares the evidence and the notice; you file it in Creator Hub under Intellectual Property.',
    },
  ]
  if (hits.length === 0) {
    // An empty list is a result: say it plainly, with what was compared, and never imply that skipped games are cleared.
    const skipped = notCompared.length ? ` ${notCompared.length} of them had no image that could be fetched, so they are not cleared.` : ''
    notices.unshift({
      lead: 'No copies found. Nothing to file.',
      body: `Compared ${imagesCompared} images across ${pool80.length} games.${skipped} A game with many look-alikes is a better first try.`,
    })
  }
  ctx.summary({
    items,
    sortLabel: hits.length === 0 ? 'No copies found. Nothing to file' : 'Identical images first, then near-identical, then by similarity',
    groups: [
      { id: 'identical', label: 'Identical image' },
      { id: 'near', label: 'Near-identical image' },
      { id: 'review', label: 'Needs review' },
      { id: 'weak', label: 'Weak signals' },
    ],
    notices,
    notes: summaryNotes,
  })

  ctx.step('write', 'Preparing evidence and notice drafts', 'active')
  for (const c of ordered) {
    const lane = c.lane as DmcaLane
    const d = c.details
    const gameUrl = `https://www.roblox.com/games/${d.placeId}`
    const evidence = evidenceSentence(c)
    const candidate: DmcaCandidate = {
      universeId: d.universeId,
      placeId: d.placeId,
      url: gameUrl,
      name: d.name,
      creatorName: d.creatorName,
      creatorId: d.creatorId,
      creatorType: d.creatorType,
      creatorUrl: creatorUrl(d.creatorType, d.creatorId),
      playing: d.playing,
      visits: d.visits,
      created: d.created,
      descriptionExcerpt: excerpt(d.description, 320),
    }
    const detail: DmcaDetail = {
      kind: 'dmca',
      lane,
      ruleExplanation: ruleExplanation(c),
      laneRules: LANE_RULES,
      ours: { universeId: own.universeId, placeId: ownPlaceId, name: own.name, url: ownUrl },
      candidate,
      imagePairs: c.best ? c.best.pairs : [],
      imagesCompared: { theirs: c.usable.length, ours: ours.length, identical: c.identicalImages },
      bestDistance: c.best ? c.best.distance : null,
      nameSimilarity: Math.round(c.nameSim * 100) / 100,
      descriptionSimilarity: Math.round(c.descSim * 100) / 100,
      sharedPhrases: c.phrases,
      modelNote: notes.get(d.universeId),
      notice: buildNotice({
        ownName: own.name,
        ownUrl,
        theirName: d.name,
        theirUrl: gameUrl,
        theirCreatorName: d.creatorName,
        theirCreatorUrl: candidate.creatorUrl,
        evidence,
        checkedISO: checked.slice(0, 10),
      }),
      rightsManagerUrl: RIGHTS_MANAGER_URL,
      rightsManagerDocsUrl: RIGHTS_MANAGER_DOCS_URL,
      checked,
    }
    const id = `dmca:${d.universeId}`
    const badge = { label: LANE_LABEL[lane], tone: lane === 'identical' || lane === 'near' ? ('danger' as const) : lane === 'review' ? ('warn' as const) : ('muted' as const) }
    const status = lane === 'identical' || lane === 'near' ? { label: 'Review, then file', tone: 'accent' as const } : lane === 'review' ? { label: 'Review', tone: 'warn' as const } : { label: 'Weak', tone: 'muted' as const }
    const similarity = c.identicalImages > 0 ? 'Identical image' : c.best ? `${pct(1 - c.best.distance / 64)} image` : `${pct(c.descSim)} text`
    const finding: Finding = {
      id,
      badge,
      title: d.name,
      snippet: [{ text: `${evidence}.` }],
      meta: [
        { label: 'Link', value: `roblox.com/games/${d.placeId}` },
        { label: 'Creator', value: d.creatorName || 'Unknown' },
        { label: 'Playing', value: d.playing.toLocaleString('en-US') },
        { label: 'Created', value: dateOnly(d.created) },
        { label: 'Similarity', value: similarity },
      ],
      status,
      states: { open: status, dismissed: { label: 'Dismissed', tone: 'muted' }, filed: { label: 'Filed', tone: 'live' } },
      group: lane,
      url: gameUrl,
      detail,
    }
    if (hadPrior) finding.isNew = !seenBefore.has(id)
    ctx.finding(finding)
  }
  ctx.step('write', 'Preparing evidence and notice drafts', 'done', hits.length ? `${ordered.length} candidates listed. Nothing is filed; filing is yours to do in Creator Hub.` : `Searched ${pool80.length} games, compared ${imagesCompared} images, no match above the weak threshold. Nothing to file.`)
}

function cache(c: FpCache, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(c, k)
}

export const tool: ToolModule = { analyze }
