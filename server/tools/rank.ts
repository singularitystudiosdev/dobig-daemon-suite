import {
  RANK_DEPTH,
  type RankDetail,
  type RankHistoryPoint,
  type RankPasser,
  type RankStatus,
} from '../../src/lib/details/rank.ts'
import type { Finding, RobloxTarget, SummaryItem } from '../../src/lib/runTypes.ts'
import { ResolveError } from '../roblox.ts'
import { aroundWindow, fetchGameFacts, gameUrl, readPhrase, searchUrl, type PhraseRead, type SearchHit } from './rank-search.ts'
import { assemblePhrases, cleanModelPhrases, deterministicPhrases, DETERMINISTIC_WITH_MODEL, MAX_PHRASES, phraseKey, type GameFacts, type PhraseSpec } from './rank-phrases.ts'
import { RunError, type RunContext, type ToolModule } from './types.ts'

/* Rank Daemon analyzer. It builds the phrases a player would type to find the game, searches Roblox for each through
   the public omni-search endpoint, finds the game's organic position (ads never count), compares with the previous
   run kept in ctx.memory, and emits one finding per phrase, the ones that need attention first. */

const HISTORY_KEPT = 10
const SEARCH_POOL = 3
const MODEL_ASKED = 10

// ----------------------------------------------------------------------------------------------- memory

export interface PhraseMemory {
  /** Oldest first, at most 10 runs. */
  hist: RankHistoryPoint[]
  /** Organic place ids of the last run's results in order, so the next run can tell who passed the game. */
  ids: number[]
}

export interface RankMemory {
  v: 1
  universeId: number
  /** The model's phrases from the first run with a key, kept so the tracked set stays the same between runs. */
  llm: string[] | null
  phrases: Record<string, PhraseMemory>
}

const emptyMemory = (universeId: number): RankMemory => ({ v: 1, universeId, llm: null, phrases: {} })

function readMemory(ctx: RunContext, universeId: number): RankMemory {
  const m = ctx.memory.get<RankMemory>('rank')
  if (!m || m.v !== 1 || m.universeId !== universeId || typeof m.phrases !== 'object' || m.phrases === null) return emptyMemory(universeId)
  return m
}

// ------------------------------------------------------------------------------------------------ the diff

export interface Verdict {
  status: RankStatus
  previous: number | null
  hadPrevious: boolean
  everFound: boolean
  /** previous - position when both exist; positive means climbed. */
  change: number | null
}

/** The comparison rule. `position` is this run's organic position or null; `prev` is what memory holds for the phrase.
 *  With no earlier read of the phrase the answer is always 'first': there is no baseline to compare with. */
export function classify(position: number | null, prev: PhraseMemory | undefined): Verdict {
  const hist = prev?.hist ?? []
  if (hist.length === 0) return { status: 'first', previous: null, hadPrevious: false, everFound: false, change: null }
  const previous = hist[hist.length - 1].position
  const everFound = hist.some((h) => h.position !== null)
  if (previous === null) {
    return position === null
      ? { status: 'absent', previous, hadPrevious: true, everFound, change: null }
      : { status: 'new', previous, hadPrevious: true, everFound, change: null }
  }
  if (position === null) return { status: 'lost', previous, hadPrevious: true, everFound, change: null }
  const change = previous - position
  return { status: change > 0 ? 'climbed' : change < 0 ? 'dropped' : 'steady', previous, hadPrevious: true, everFound, change }
}

/** Games that were below the game last run and are above it now. Null when the earlier order is not known. */
export function passersOf(prev: PhraseMemory | undefined, myPlaceId: number, organic: SearchHit[], position: number | null): RankPasser[] | null {
  if (!prev || position === null || prev.hist.length === 0) return null
  const before = prev.hist[prev.hist.length - 1].position
  if (before === null || !Array.isArray(prev.ids) || prev.ids.length < before || prev.ids[before - 1] !== myPlaceId) return null
  const wasBelow = new Map<number, number>()
  prev.ids.forEach((id, i) => {
    if (i >= before) wasBelow.set(id, i + 1)
  })
  const out: RankPasser[] = []
  organic.slice(0, position - 1).forEach((h, i) => {
    const was = wasBelow.get(h.placeId)
    if (was !== undefined) out.push({ placeId: h.placeId, name: h.name, url: gameUrl(h.placeId), playing: h.playing, was, now: i + 1 })
  })
  return out
}

const ORDER: Record<RankStatus, number> = { lost: 0, dropped: 1, new: 2, climbed: 3, first: 4, steady: 5, absent: 6 }

/** Lost, dropped (largest first), new, climbed (largest first), first reads, steady, not found. Ties by position. */
export function orderFindings<T extends { detail: unknown }>(items: T[]): T[] {
  const mag = (d: RankDetail) => Math.abs(d.change ?? 0)
  return [...items].sort((a, b) => {
    const A = a.detail as RankDetail
    const B = b.detail as RankDetail
    if (ORDER[A.status] !== ORDER[B.status]) return ORDER[A.status] - ORDER[B.status]
    if ((A.status === 'dropped' || A.status === 'climbed') && mag(A) !== mag(B)) return mag(B) - mag(A)
    if (A.status === 'lost' && (A.previous ?? 0) !== (B.previous ?? 0)) return (A.previous ?? 0) - (B.previous ?? 0)
    const pa = A.position ?? Infinity
    const pb = B.position ?? Infinity
    return pa === pb ? A.phrase.localeCompare(B.phrase) : pa - pb
  })
}

// ------------------------------------------------------------------------------------------ small helpers

function abortIfNeeded(ctx: RunContext): void {
  if (ctx.signal.aborted) throw new RunError('aborted', 'The run was cancelled.')
}

const plain = (s: string) => s.replace(/[‒-―−]/g, '-').replace(/\s+/g, ' ').trim()

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`
  return String(n)
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function mapError(err: unknown): never {
  if (err instanceof RunError) throw err
  if (err instanceof ResolveError) {
    const code = err.code === 'rate-limited' ? 'rate-limited' : err.code === 'not-found' ? 'not-found' : err.code === 'private' ? 'private' : 'upstream'
    throw new RunError(code, err.message, { kind: 'retry', label: 'Run again' })
  }
  throw err
}

async function pool<T>(items: T[], size: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        await worker(items[i], i)
      }
    }),
  )
}

// ----------------------------------------------------------------------------------- the model's phrases

async function modelPhrases(ctx: RunContext, game: GameFacts, taken: PhraseSpec[]): Promise<string[]> {
  const { data } = await ctx.llm.json<{ phrases?: unknown }>(
    {
      name: 'rank_search_phrases',
      system:
        'You help a Roblox developer see where their game shows up in Roblox search. Given the real facts of one game, write 10 short search phrases (1 to 4 words each) that a player would type into Roblox search to find a game like this one: its genre, what you do in it, its theme, and what players call it. Use only what the facts support. Lower case, no emoji, no punctuation, no quotes. Do not repeat the phrases already listed. Return JSON only.',
      user: JSON.stringify({ name: game.name, genre: game.genreL1 || game.genre, subgenre: game.genreL2, description: game.description.slice(0, 1200), alreadyListed: taken.map((t) => t.phrase) }),
      schema: { type: 'object', additionalProperties: false, required: ['phrases'], properties: { phrases: { type: 'array', items: { type: 'string' } } } },
      temperature: 0.4,
      maxTokens: 400,
    },
    ctx.signal,
  )
  return cleanModelPhrases(data.phrases, taken.map((t) => t.phrase), MODEL_ASKED)
}

// ---------------------------------------------------------------------------------------- finding build

function badgeFor(v: Verdict): Finding['badge'] {
  switch (v.status) {
    case 'lost':
      return { label: 'Lost', tone: 'danger' }
    case 'dropped':
      return { label: `Dropped ${Math.abs(v.change ?? 0)}`, tone: 'warn' }
    case 'new':
      return { label: 'New', tone: 'accent' }
    case 'climbed':
      return { label: `Up ${v.change}`, tone: 'live' }
    case 'steady':
      return { label: 'Steady', tone: 'muted' }
    case 'first':
      return { label: 'First read', tone: 'muted' }
    default:
      return { label: 'Not found', tone: 'muted' }
  }
}

function snippetFor(v: Verdict, position: number | null, passed: RankPasser[] | null): string {
  const named = passed && passed.length > 0 ? ` ${passed.length === 1 ? `${plain(passed[0].name)} passed you.` : `${plain(passed[0].name)} and ${passed.length - 1} more passed you.`}` : ''
  switch (v.status) {
    case 'lost':
      return `Was position ${v.previous} last run, not in the first ${RANK_DEPTH} now.`
    case 'dropped':
      return `Down from ${v.previous} to ${position}.${named}`
    case 'new':
      return `Not in the first ${RANK_DEPTH} last run, position ${position} now.`
    case 'climbed':
      return `Up from ${v.previous} to ${position}.`
    case 'steady':
      return `Still position ${position}.`
    case 'first':
      return position === null ? `First read. Not in the first ${RANK_DEPTH} results.` : `First read. Position ${position} in the first ${RANK_DEPTH} results.`
    default:
      return `Not in the first ${RANK_DEPTH} results.`
  }
}

function tierChip(position: number | null): Finding['status'] {
  if (position === null) return { label: `Not in top ${RANK_DEPTH}`, tone: 'muted' }
  if (position <= 3) return { label: 'Top 3', tone: 'live' }
  if (position <= 10) return { label: 'Top 10', tone: 'accent' }
  return { label: `Top ${RANK_DEPTH}`, tone: 'muted' }
}

const posText = (p: number | null) => (p === null ? `${RANK_DEPTH}+` : String(p))

function buildFinding(ctx: RunContext, game: GameFacts & { universeId: number; placeId: number }, spec: PhraseSpec, read: PhraseRead, prev: PhraseMemory | undefined): { finding: Finding; mem: PhraseMemory } {
  const position = read.position
  const verdict = classify(position, prev)
  const passedList = verdict.status === 'lost' ? null : passersOf(prev, game.placeId, read.organic, position)
  const fetchedAt = ctx.now.toISOString()
  const history: RankHistoryPoint[] = [...(prev?.hist ?? []), { at: fetchedAt, position }].slice(-HISTORY_KEPT)
  const { rows, kind } = aroundWindow(read, game.universeId)
  const above = position !== null && position > 1 ? read.organic[position - 2] : null

  const detail: RankDetail = {
    kind: 'rank',
    phrase: spec.phrase,
    source: spec.source,
    status: verdict.status,
    gameName: game.name,
    position,
    previous: verdict.previous,
    hadPrevious: verdict.hadPrevious,
    everFound: verdict.everFound,
    change: verdict.change,
    around: rows,
    aroundKind: kind,
    passed: passedList ?? [],
    passedKnown: passedList !== null,
    history,
    scanned: read.organic.length,
    adsSeen: read.adsSeen,
    pages: read.pages,
    fetchedAt,
    searchUrl: searchUrl(spec.phrase),
  }

  const sparkData = history.map((h) => RANK_DEPTH + 1 - (h.position ?? RANK_DEPTH + 1))
  const sparkTone = verdict.status === 'lost' ? 'danger' : verdict.status === 'dropped' ? 'warn' : verdict.status === 'climbed' ? 'live' : verdict.status === 'new' ? 'accent' : 'muted'
  const finding: Finding = {
    id: `rank:${phraseKey(spec.phrase)}`,
    badge: badgeFor(verdict),
    title: spec.phrase,
    snippet: [{ text: snippetFor(verdict, position, passedList) }],
    meta: [
      { label: 'Position', value: posText(position) },
      { label: 'Before', value: verdict.hadPrevious ? posText(verdict.previous) : 'None' },
      { label: 'Players above', value: position === 1 ? 'You lead' : above ? compact(above.playing) : 'Not available' },
    ],
    status: tierChip(position),
    url: searchUrl(spec.phrase),
    detail,
  }
  if (history.length >= 2) {
    finding.spark = { data: sparkData, tone: sparkTone, label: `Position history, oldest to newest: ${history.map((h) => posText(h.position)).join(', ')}. A higher line is a better position.` }
  }
  return { finding, mem: { hist: history, ids: read.organic.map((h) => h.placeId) } }
}

// --------------------------------------------------------------------------------------------- analyzer

export const tool: ToolModule = {
  async analyze(ctx) {
    const target = ctx.target
    if (target.kind !== 'roblox-game') throw new RunError('bad-input', 'Rank Daemon needs a Roblox game.')
    const t: RobloxTarget = target
    const mem = readMemory(ctx, t.universeId)
    const firstRun = Object.keys(mem.phrases).length === 0

    // 1. the game's own facts
    ctx.step('game', 'Reading the game', 'active')
    let game: Awaited<ReturnType<typeof fetchGameFacts>>
    try {
      game = await fetchGameFacts(t.universeId, ctx.signal)
    } catch (err) {
      ctx.step('game', 'Reading the game', 'failed')
      mapError(err)
    }
    ctx.step('game', 'Reading the game', 'done', game.name)
    abortIfNeeded(ctx)

    // 2. the phrases
    ctx.step('phrases', 'Building the search phrases', 'active')
    let model: string[] | null = mem.llm && mem.llm.length > 0 ? mem.llm : null
    let modelNote: string | null = null
    if (!model) {
      if (ctx.llm.available) {
        try {
          const facts = deterministicPhrases(game, DETERMINISTIC_WITH_MODEL)
          const got = await modelPhrases(ctx, game, facts)
          if (got.length > 0) model = got
          else modelNote = 'The model returned no usable phrases.'
        } catch (err) {
          if (err instanceof RunError && (err.code === 'aborted' || err.code === 'credits')) throw err
          modelNote = 'The model did not answer.'
        }
      } else {
        modelNote = 'No AI key is set.'
      }
    }
    const specs = assemblePhrases(game, model).slice(0, MAX_PHRASES)
    const fromModel = specs.filter((s) => s.source === 'model').length
    ctx.step(
      'phrases',
      'Building the search phrases',
      modelNote && fromModel === 0 ? 'warn' : 'done',
      `${plural(specs.length, 'phrase')}: ${specs.length - fromModel} from the game itself${fromModel ? `, ${fromModel} suggested by the model` : modelNote ? `. ${modelNote} Only phrases from the game's own name, genre and description were used` : ''}`,
    )
    abortIfNeeded(ctx)

    // 3. search every phrase
    const reads: (PhraseRead | null)[] = specs.map(() => null)
    let done = 0
    ctx.step('search', 'Searching Roblox', 'active', `0 of ${specs.length} phrases`)
    try {
      await pool(specs, SEARCH_POOL, async (spec, i) => {
        abortIfNeeded(ctx)
        reads[i] = await readPhrase(spec.phrase, game, ctx.signal)
        done++
        ctx.step('search', 'Searching Roblox', 'active', `${done} of ${specs.length} phrases`)
      })
    } catch (err) {
      ctx.step('search', 'Searching Roblox', 'failed')
      mapError(err)
    }
    const requests = reads.reduce((n, r) => n + (r?.pages ?? 0), 0)
    ctx.step('search', 'Searching Roblox', 'done', `${plural(specs.length, 'phrase')}, ${plural(requests, 'search page')} read`)

    // 4. compare with the last run
    ctx.step('compare', 'Comparing with the last run', 'active')
    const built = specs.map((spec, i) => buildFinding(ctx, game, spec, reads[i] as PhraseRead, mem.phrases[phraseKey(spec.phrase)]))
    const ordered = orderFindings(built.map((b) => b.finding))
    const details = ordered.map((f) => f.detail as RankDetail)
    const count = (fn: (d: RankDetail) => boolean) => details.filter(fn).length
    const inTop = (n: number) => count((d) => d.position !== null && d.position <= n)
    const dropped = count((d) => d.status === 'dropped' || d.status === 'lost')
    const climbed = count((d) => d.status === 'climbed')
    const notFound = count((d) => d.position === null)
    ctx.step('compare', 'Comparing with the last run', 'done', firstRun ? 'First read, nothing to compare with yet' : `${dropped} dropped, ${climbed} climbed`)

    const items: SummaryItem[] = [
      { label: 'Phrases searched', value: String(specs.length), tone: 'ink' },
      { label: 'In the top 3', value: String(inTop(3)), tone: inTop(3) > 0 ? 'live' : 'ink' },
      { label: 'In the top 10', value: String(inTop(10)), tone: inTop(10) > 0 ? 'accent' : 'ink' },
      { label: 'Dropped', value: String(dropped), tone: dropped > 0 ? 'danger' : 'ink' },
      { label: 'Climbed', value: String(climbed), tone: climbed > 0 ? 'live' : 'ink' },
      { label: 'Not found', value: String(notFound), tone: 'ink' },
    ]
    const notes = [
      'Roblox search results can differ by player (device, country, personalisation). Positions are read without a login, so they show what a visitor who is not signed in sees.',
      `A position counts regular results only. Sponsored results are shown where they sat but never counted, and each phrase is read up to the first ${RANK_DEPTH} games.`,
      'Dropped counts phrases that fell or left the first 100.',
      firstRun ? 'This is the first read of this game, so there is nothing to compare with yet. The next run shows what moved.' : 'Each phrase is compared with its position in the previous run, kept for up to 10 runs.',
    ]
    if (fromModel === 0 && modelNote) notes.push(`${modelNote} Only phrases taken from the game's own name, genre and description were searched.`)
    ctx.summary({ items, sortLabel: 'Biggest drops first', notes })
    for (const f of ordered) ctx.finding(f)

    // memory is written last, so a run that failed halfway leaves the old baseline in place
    const next: RankMemory = { v: 1, universeId: t.universeId, llm: model, phrases: {} }
    built.forEach((b, i) => {
      next.phrases[phraseKey(specs[i].phrase)] = b.mem
    })
    ctx.memory.set('rank', next)
  },
}
