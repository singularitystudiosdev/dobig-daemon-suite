import { createHash, randomUUID } from 'node:crypto'
import type { DescriptionDetail, DescriptionVariant } from '../../src/lib/details/description.ts'
import type { Finding, RunSummary, SummaryItem } from '../../src/lib/runTypes.ts'
import { ResolveError, resolveGame } from '../roblox.ts'
import {
  DESCRIPTION_LIMIT,
  SHINGLE_WORDS,
  extractPatterns,
  firstLineSegments,
  lineDiffCounts,
  lintDescription,
  similarityGuard,
  textOverlap,
  wordDiff,
  type LintResult,
} from './description-lint.ts'
import { fetchBaseline, formatMetric, openCloudBase, patchDescription, type Baseline } from './description-opencloud.ts'
import { RunError, type RouteHandler, type RunContext, type ToolModule } from './types.ts'

/* Description Daemon analyzer. Everything it shows is real: the live description from Roblox, competitor descriptions read
   through omni-search, drafts written by the model from those inputs only, a deterministic policy lint and the iteration
   memory of earlier runs. No lift, click-through or any other number is predicted: a number appears only if it was
   counted or measured in this run. */

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

const VARIANTS: DescriptionVariant[] = ['A', 'B', 'C']
const VARIANT_NAME: Record<DescriptionVariant, string> = { A: 'tightened', B: 'restructured', C: 'experimental' }
const MAX_COMPETITORS = 10
const MEMORY_ITERATIONS = 3
const MAX_REPAIRS = 2

/* ------------------------------------------------------------------ memory shapes */

interface MemLive {
  hash: string
  text: string
  at: string
}
interface MemDraft {
  variant: DescriptionVariant
  text: string
  whatChanged: string
  lintPassed: number
  lintTotal: number
  blocked: boolean
}
interface MemIteration {
  iteration: number
  at: string
  liveHash: string
  drafts: MemDraft[]
}

const normalizeText = (t: string) => t.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
const hashText = (t: string) => createHash('sha256').update(normalizeText(t)).digest('hex').slice(0, 16)

/* ------------------------------------------------------------------ Roblox reads */

const UA = 'Mozilla/5.0 (compatible; description-daemon)'

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) })
    if (res.status === 429) {
      const wait = Math.min(10, Number(res.headers.get('retry-after')) || 2 ** (attempt + 1))
      await res.arrayBuffer().catch(() => undefined)
      await new Promise((r) => setTimeout(r, wait * 1000))
      continue
    }
    if (!res.ok) throw new RunError('upstream', `Roblox answered ${res.status} for a search request.`)
    return res.json()
  }
  throw new RunError('rate-limited', 'Roblox is rate limiting searches. Try again in a minute.')
}

export interface Competitor {
  universeId: number
  name: string
  url: string
  description: string
  playing: number
  /** The search query that surfaced it. */
  query: string
}

/** Games that rank for each query, from omni-search, round-robin across queries, never this universe. Descriptions come from
 *  the public games API because omni-search returns them empty. */
export async function readCompetitors(queries: string[], selfUniverseId: number, signal: AbortSignal, onQuery?: (q: string, n: number) => void): Promise<Competitor[]> {
  const sessionId = randomUUID()
  const perQuery: { universeId: number; name: string; placeId: number; playing: number; query: string }[][] = []
  for (const q of queries) {
    const url = `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&pageType=all&sessionId=${sessionId}`
    const json = obj(await getJson(url, signal))
    const rows: { universeId: number; name: string; placeId: number; playing: number; query: string }[] = []
    for (const group of Array.isArray(json.searchResults) ? json.searchResults : []) {
      const g = obj(group)
      if (g.contentGroupType !== 'Game') continue
      for (const c of Array.isArray(g.contents) ? g.contents : []) {
        const o = obj(c)
        const universeId = num(o.universeId)
        if (!universeId || universeId === selfUniverseId || o.isSponsored === true || !str(o.name)) continue
        rows.push({ universeId, name: str(o.name), placeId: num(o.rootPlaceId), playing: num(o.playerCount), query: q })
      }
    }
    onQuery?.(q, rows.length)
    perQuery.push(rows)
    await new Promise((r) => setTimeout(r, 400))
  }
  const picked: typeof perQuery[number] = []
  const seen = new Set<number>()
  for (let i = 0; picked.length < MAX_COMPETITORS + 6 && perQuery.some((r) => i < r.length); i++) {
    for (const rows of perQuery) {
      const r = rows[i]
      if (r && !seen.has(r.universeId)) {
        seen.add(r.universeId)
        picked.push(r)
      }
    }
  }
  if (picked.length === 0) return []
  const info = obj(await getJson(`https://games.roblox.com/v1/games?universeIds=${picked.map((p) => p.universeId).join(',')}`, signal))
  const byId = new Map<number, Obj>()
  for (const g of Array.isArray(info.data) ? info.data : []) byId.set(num(obj(g).id), obj(g))
  const out: Competitor[] = []
  for (const p of picked) {
    const g = byId.get(p.universeId)
    const description = normalizeText(str(g?.description))
    if (!g || description.length < 20) continue
    const placeId = num(g.rootPlaceId) || p.placeId
    out.push({ universeId: p.universeId, name: str(g.name) || p.name, url: `https://www.roblox.com/games/${placeId}`, description, playing: p.playing, query: p.query })
    if (out.length >= MAX_COMPETITORS) break
  }
  return out
}

/* ------------------------------------------------------------------ search queries */

const STOP = new Set('the and for you your with that this are from have has not but can all any out get one more will they them their its was were been into over than then there what when who how why our his her she him about also just like make made play game games new now only some such very much many each other these those would could should while where which being because after before again here still every own both same too off per via welcome how'.split(' '))

function heuristicQueries(name: string, genre: string, subgenre: string, description: string): string[] {
  const nameWords = new Set(name.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  const freq = new Map<string, number>()
  for (const w of description.toLowerCase().match(/[a-z]{4,}/g) ?? []) if (!STOP.has(w) && !nameWords.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1)
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 5)
  const g = (subgenre || genre).toLowerCase()
  const out = [`${top[0] ?? ''} ${g}`.trim(), `${top[1] ?? ''} ${top[2] ?? ''}`.trim(), `${g} ${top[3] ?? ''}`.trim()].filter((q) => q.length > 3)
  return out
}

function cleanQueries(raw: unknown, name: string): string[] {
  const nm = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const out: string[] = []
  for (const q of Array.isArray(raw) ? raw : []) {
    const s = str(q).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
    if (s.length < 3 || s.split(' ').length > 5 || s === nm || out.includes(s)) continue
    out.push(s)
  }
  return out.slice(0, 3)
}

async function deriveQueries(ctx: RunContext, game: { name: string; genre: string; subgenre: string; description: string }): Promise<{ queries: string[]; by: 'model' | 'heuristic' }> {
  let queries: string[] = []
  try {
    const { data } = await ctx.llm.json<{ queries?: unknown }>(
      {
        name: 'description_search_queries',
        system:
          'You help a Roblox developer find the games that compete with theirs. From the real game facts, write exactly 3 short search queries (2 to 4 words each) that a player would type into Roblox search to find games like this one. Use the genre and the core nouns of the game. Never include the game\'s own name. Return JSON only.',
        user: JSON.stringify({ name: game.name, genre: game.genre, subgenre: game.subgenre, description: game.description.slice(0, 1500) }),
        schema: { type: 'object', additionalProperties: false, required: ['queries'], properties: { queries: { type: 'array', items: { type: 'string' } } } },
        temperature: 0.2,
        maxTokens: 300,
      },
      ctx.signal,
    )
    queries = cleanQueries(data.queries, game.name)
  } catch (err) {
    if (err instanceof RunError && (err.code === 'no-llm-key' || err.code === 'credits' || err.code === 'aborted')) throw err
  }
  if (queries.length >= 3) return { queries, by: 'model' }
  for (const q of cleanQueries(heuristicQueries(game.name, game.genre, game.subgenre, game.description), game.name)) if (queries.length < 3 && !queries.includes(q)) queries.push(q)
  return { queries, by: 'heuristic' }
}

/* ------------------------------------------------------------------ drafting */

/** Structure hints for variant B and angle hints for variant C, rotated by iteration so reruns differ on purpose. */
const B_STRUCTURES = [
  'a one-sentence summary, a blank line, then 4 to 6 short feature lines, one per line, each starting with a different verb',
  'a one-sentence summary, then a "How to play:" line followed by 3 to 5 numbered steps (1. 2. 3.)',
  'two short paragraphs: first what the player does, then what they collect, unlock or upgrade',
  'a one-sentence summary, then three short labelled lines such as "Play:", "Collect:" and "Compete:" (use labels that fit the game)',
  'a one-sentence summary, then a short "What you can do:" line with 4 to 6 plain bullet lines starting with "- "',
]
const C_ANGLES = [
  'lead with what the player does in their first minute, then the long-term loop',
  'lead with the social or competitive side (other players), but only if the live description mentions other players',
  'lead with the collecting and rarity hook, but only if the live description describes collecting or rarity',
  'lead with progression: what the player upgrades and unlocks over time',
  'open with a short second-person invitation built on the single most distinctive mechanic, then the rest',
  'lead with the most distinctive mechanic as a one-sentence hook, then explain how a session flows',
]

const POLICY = `Roblox metadata policy (https://create.roblox.com/docs/discovery) that every draft must obey:
- Be accurate. Say only what the live description and the facts support. Never invent features, numbers, codes, updates, events, rewards, ranks, collaborations or guarantees. Do not put player counts, visit counts or dates in the text.
- No giveaway or reward wording: never "free Robux", "giveaway", "gift card", "win Robux", "real money" or any promise of Robux.
- No keyword stuffing: no repeated keywords, no comma-separated keyword lists, no "Tags:" lines. Use each important keyword naturally, at most 3 times.
- No ALL CAPS shouting (acronyms such as PvP or XP are fine). No runs of "!!!" or "???". At most 3 exclamation marks in total.
- No fake update or news claims ("NEW UPDATE", "just released", "huge update") unless the live description says so.
- Emoji: sparing. At most one per line, at most one per 25 characters, never several in a row.
- The first line is a plain-language summary of what the game is (genre and core loop), at least 6 words. Do not open with "Welcome to", a greeting or a call to like or follow.
- At most ${DESCRIPTION_LIMIT} characters in total including spaces and line breaks (aim for 300 to 900). Keep every line under 180 characters.
- Plain text only. Line breaks are fine. No markdown, no HTML.
- Write original sentences. Never reuse a sentence from another game's description.`

interface DraftOut {
  text: string
  whatChanged: string
}

const draftItem = { type: 'object', additionalProperties: false, required: ['text', 'whatChanged'], properties: { text: { type: 'string' }, whatChanged: { type: 'string' } } }

function cleanDraft(raw: unknown): DraftOut | null {
  const o = obj(raw)
  const text = normalizeText(str(o.text))
  const whatChanged = str(o.whatChanged).replace(/\s+/g, ' ').trim().slice(0, 240)
  if (text.length < 20) return null
  return { text, whatChanged: whatChanged || 'Rewritten from the live copy.' }
}

interface DraftInputs {
  game: { name: string; genre: string; subgenre: string; maxPlayers: number; created: string; updated: string }
  live: string
  patterns: string[]
  competitorNames: string[]
  iteration: number
  liveChange: string | null
  keptNote: string | null
  earlier: { iteration: number; variant: string; text: string; whatChanged: string }[]
}

function userPayload(i: DraftInputs, extra?: Obj): string {
  return JSON.stringify({
    liveDescription: i.live,
    gameFacts: { name: i.game.name, genre: i.game.genre, subgenre: i.game.subgenre || null, maxPlayersPerServer: i.game.maxPlayers || null, createdOnRoblox: i.game.created.slice(0, 10), lastUpdatedOnRoblox: i.game.updated.slice(0, 10) },
    howCompetingGamesDescribeThemselves: i.patterns,
    competingGameNames: i.competitorNames,
    iteration: i.iteration,
    changeSinceLastRun: i.liveChange,
    keptFromLastRun: i.keptNote,
    earlierDrafts: i.earlier,
    ...extra,
  })
}

async function writeDrafts(ctx: RunContext, i: DraftInputs): Promise<Partial<Record<DescriptionVariant, DraftOut>>> {
  const bStruct = B_STRUCTURES[(i.iteration - 1) % B_STRUCTURES.length]
  const cAngle = C_ANGLES[(i.iteration - 1) % C_ANGLES.length]
  const { data } = await ctx.llm.json<Obj>(
    {
      name: 'description_drafts',
      system: `You write Roblox experience descriptions for the game's owner. Return JSON only.

${POLICY}

Write three variants of the description from ONLY the real inputs provided:
A, conservative tighten: keep exactly the same facts as the live description, in clearer and shorter words, summary first. Add no new facts and drop none.
B, scannable restructure: the same facts, restructured for fast scanning on a phone. Use this structure: ${bStruct}.
C, experimental angle: ${cAngle}. Use only facts already in the live description or the game facts.

If earlierDrafts is not empty, every new draft must be clearly different in wording and structure from each earlier draft; if keptFromLastRun names a draft, build on it instead of starting over. If changeSinceLastRun is set, the live copy changed: treat the current live description as the baseline.
howCompetingGamesDescribeThemselves are counted patterns, not text to copy.
For each variant return "text" and "whatChanged": one plain sentence saying what changed against the live description and why, in a neutral voice (never "I"). No em dashes.`,
      user: userPayload(i),
      schema: { type: 'object', additionalProperties: false, required: VARIANTS, properties: { A: draftItem, B: draftItem, C: draftItem } },
      temperature: 0.7,
      maxTokens: 3500,
    },
    ctx.signal,
  )
  const out: Partial<Record<DescriptionVariant, DraftOut>> = {}
  for (const v of VARIANTS) {
    const d = cleanDraft(data[v])
    if (d) out[v] = d
  }
  return out
}

async function repairDraft(ctx: RunContext, i: DraftInputs, variant: DescriptionVariant, previous: string, problems: string[]): Promise<DraftOut | null> {
  const brief =
    variant === 'A'
      ? 'A, conservative tighten: the same facts as the live description in clearer and shorter words, summary first; add no new facts.'
      : variant === 'B'
        ? `B, scannable restructure of the same facts. Structure: ${B_STRUCTURES[(i.iteration - 1) % B_STRUCTURES.length]}.`
        : `C, experimental angle: ${C_ANGLES[(i.iteration - 1) % C_ANGLES.length]}. Use only facts already in the live description or the game facts.`
  const { data } = await ctx.llm.json<Obj>(
    {
      name: 'description_draft_repair',
      system: `You write Roblox experience descriptions for the game's owner. Return JSON only.

${POLICY}

Rewrite one variant. ${brief}
Your previous attempt was rejected: ${problems.join(' ')} Write it again with clearly different wording, and keep the same facts. Return "text" and "whatChanged" (one plain sentence, neutral voice, never "I"). No em dashes.`,
      user: userPayload(i, { rejectedAttempt: previous }),
      schema: draftItem,
      temperature: 0.9,
      maxTokens: 1500,
    },
    ctx.signal,
  )
  return cleanDraft(data)
}

interface Accepted {
  variant: DescriptionVariant
  text: string
  whatChanged: string
  attempts: number
}

/* ------------------------------------------------------------------ unverified claims */

async function findUnverifiedClaims(ctx: RunContext, i: DraftInputs, drafts: Accepted[]): Promise<Record<DescriptionVariant, string[]>> {
  const empty: Record<DescriptionVariant, string[]> = { A: [], B: [], C: [] }
  if (!drafts.length) return empty
  const arr = { type: 'array', items: { type: 'string' } }
  const { data } = await ctx.llm.json<Obj>(
    {
      name: 'description_unverified_claims',
      system:
        'You fact-check Roblox game description drafts for the game\'s owner. For each draft, list the claims a player could check that the draft makes but that are NOT supported by the live description or the game facts: invented features, numbers, events, updates, rewards, modes or guarantees. Each claim is one short plain sentence quoting or paraphrasing the draft. Do not list opinions or generic enthusiasm. Rewording of something the live description already says is supported, not a claim. If nothing is unsupported, return an empty array. At most 5 per draft. Return JSON only.',
      user: JSON.stringify({ liveDescription: i.live, gameFacts: { name: i.game.name, genre: i.game.genre, subgenre: i.game.subgenre || null, maxPlayersPerServer: i.game.maxPlayers || null }, drafts: Object.fromEntries(drafts.map((d) => [d.variant, d.text])) }),
      schema: { type: 'object', additionalProperties: false, required: VARIANTS, properties: { A: arr, B: arr, C: arr } },
      temperature: 0,
      maxTokens: 1200,
    },
    ctx.signal,
  )
  const out = { ...empty }
  for (const v of VARIANTS) out[v] = (Array.isArray(data[v]) ? (data[v] as unknown[]) : []).map((c) => str(c).replace(/\s+/g, ' ').trim().slice(0, 220)).filter(Boolean).slice(0, 5)
  return out
}

/* ------------------------------------------------------------------ ranking */

export interface Rankable {
  lint: LintResult
  unverified: number
  chars: number
  variant: DescriptionVariant
}

/** The transparent order: blocked last; then passed lint checks (more first); then fewer unverified claims; then length fit
 *  (within 200 to the limit is a fit; otherwise the distance to that band); then variant letter. */
export function rankKey(r: Rankable): [number, number, number, number, string] {
  const fit = r.chars > DESCRIPTION_LIMIT ? r.chars - DESCRIPTION_LIMIT : r.chars < 200 ? 200 - r.chars : 0
  return [r.lint.blocked ? 1 : 0, -r.lint.passed, r.unverified, fit, r.variant]
}

export function compareRank(a: Rankable, b: Rankable): number {
  const ka = rankKey(a)
  const kb = rankKey(b)
  for (let n = 0; n < 4; n++) if (ka[n] !== kb[n]) return (ka[n] as number) - (kb[n] as number)
  return ka[4] < kb[4] ? -1 : 1
}

/* ------------------------------------------------------------------ the run */

const NO_KEY = () => new RunError('no-llm-key', 'The Description Daemon needs an OpenRouter key to write drafts. Add one in the key dialog.', { kind: 'add-key', label: 'Add a key' })

function resolveFailure(err: unknown): never {
  if (err instanceof ResolveError) {
    const code = err.code === 'not-found' ? 'not-found' : err.code === 'private' ? 'private' : err.code === 'rate-limited' ? 'rate-limited' : err.code === 'bad-link' ? 'bad-input' : 'upstream'
    throw new RunError(code, err.message, code === 'rate-limited' || code === 'upstream' ? { kind: 'retry', label: 'Try again' } : undefined)
  }
  throw err
}

function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

async function analyze(ctx: RunContext): Promise<void> {
  if (ctx.target.kind !== 'roblox-game') throw new RunError('bad-input', 'The Description Daemon needs a Roblox game.')
  const target = ctx.target
  if (!ctx.llm.available) throw NO_KEY()
  const sig = ctx.signal

  /* 1. The live game. */
  ctx.step('live', 'Reading the live game from Roblox', 'active')
  let game
  try {
    const r = await resolveGame(String(target.placeId || target.universeId))
    if (!r.ok) throw new RunError('not-found', 'Roblox has no public game with that id.')
    game = r.game
  } catch (err) {
    ctx.step('live', 'Reading the live game from Roblox', 'failed', err instanceof Error ? err.message : undefined)
    resolveFailure(err)
  }
  const liveText = normalizeText(game.description)
  const liveLint = lintDescription(liveText)
  ctx.step('live', 'Reading the live game from Roblox', 'done', `${game.name}: ${liveText.length} characters, ${game.genre}${game.subgenre ? ` / ${game.subgenre}` : ''}, ${game.playing.toLocaleString('en-US')} playing`)
  if (!liveText) throw new RunError('bad-input', `${game.name} has no description on Roblox yet, so there is nothing to tighten or restructure. Write a first description, then run again.`)

  /* 2. Memory: what changed since last time, and what earlier iterations produced. */
  ctx.step('memory', 'Comparing with the last run', 'active')
  const prevLive = ctx.memory.get<MemLive>('desc.live')
  const history = (ctx.memory.get<MemIteration[]>('desc.history') ?? []).filter((h) => h && Array.isArray(h.drafts))
  const prevFindingIter = Math.max(0, ...ctx.previous.map((f) => (f.detail.kind === 'description' ? f.detail.iteration : 0)))
  const iteration = Math.max(num(ctx.memory.get<number>('desc.iteration')), prevFindingIter, ...history.map((h) => num(h.iteration))) + 1
  const liveHash = hashText(liveText)
  let liveChange: string | null = null
  let keptNote: string | null = null
  let changedLine: string | null = null
  if (prevLive && prevLive.hash !== liveHash) {
    const { added, removed } = lineDiffCounts(prevLive.text, liveText)
    changedLine = `The live description changed since the last run: +${pluralize(added, 'line')}, -${pluralize(removed, 'line')} (${prevLive.text.length} to ${liveText.length} characters).`
    liveChange = `${changedLine} The new text is the baseline.`
    // Did the owner publish one of our drafts?
    let best: { it: number; v: string; o: number } | null = null
    for (const h of history) for (const d of h.drafts) {
      const o = textOverlap(d.text, liveText)
      if (o >= 0.85 && (!best || o > best.o)) best = { it: h.iteration, v: d.variant, o }
    }
    if (best) keptNote = `The live description now matches Variant ${best.v} from iteration ${best.it} (${Math.round(best.o * 100)}% of its 3-word phrases), so it was most likely published. Build on it.`
    else if (history.length) {
      const last = history[history.length - 1]
      const top = last.drafts.find((d) => !d.blocked)
      if (top) keptNote = `No earlier draft was published as written; Variant ${top.variant} ranked first last time.`
    }
  } else if (prevLive) {
    changedLine = 'The live description is unchanged since the last run.'
    const last = history[history.length - 1]
    const top = last?.drafts.find((d) => !d.blocked)
    if (top) keptNote = `The live description did not change, so no draft was published; Variant ${top.variant} ranked first last time.`
  } else {
    changedLine = 'First run: this live description is the baseline for every later comparison.'
  }
  const earlier: DraftInputs['earlier'] = history.flatMap((h) => h.drafts.map((d) => ({ iteration: h.iteration, variant: d.variant, text: d.text, whatChanged: d.whatChanged })))
  if (!earlier.length) for (const f of ctx.previous) if (f.detail.kind === 'description') earlier.push({ iteration: f.detail.iteration, variant: f.detail.variant, text: f.detail.text.map((s) => s.text).join(''), whatChanged: f.detail.whatChanged })
  ctx.step('memory', 'Comparing with the last run', 'done', `Iteration ${iteration}. ${changedLine}${earlier.length ? ` ${pluralize(earlier.length, 'earlier draft')} remembered.` : ''}`)

  /* 3. Real market context. */
  ctx.step('queries', 'Choosing search queries from the genre and core nouns', 'active')
  const { queries, by } = await deriveQueries(ctx, { name: game.name, genre: game.genre, subgenre: game.subgenre, description: liveText })
  if (!queries.length) throw new RunError('bad-input', 'Could not derive a search from this game description. Add a few sentences to the description and run again.')
  ctx.step('queries', 'Choosing search queries from the genre and core nouns', 'done', `${queries.map((q) => `"${q}"`).join(', ')} (${by === 'model' ? 'derived by the model from the description' : 'derived from the most frequent nouns'})`)

  ctx.step('competitors', 'Reading how competing games describe themselves', 'active')
  let competitors: Competitor[] = []
  try {
    competitors = await readCompetitors(queries, game.universeId, sig)
  } catch (err) {
    if (sig.aborted) throw new RunError('aborted', 'The run was cancelled.')
    ctx.step('competitors', 'Reading how competing games describe themselves', 'warn', `${err instanceof Error ? err.message : 'Search failed'} Drafting without competitor context.`)
  }
  if (competitors.length) ctx.step('competitors', 'Reading how competing games describe themselves', 'done', `${competitors.length} real descriptions read, none from ${game.name}`)
  else if (!sig.aborted) ctx.step('competitors', 'Reading how competing games describe themselves', 'warn', 'No competing descriptions could be read. The similarity guard has nothing to compare against this run.')

  const patternFacts = extractPatterns(competitors).map((p) => p.fact)
  const inputs: DraftInputs = {
    game: { name: game.name, genre: game.genre, subgenre: game.subgenre, maxPlayers: game.maxPlayers, created: game.created, updated: game.updated },
    live: liveText,
    patterns: patternFacts,
    competitorNames: competitors.map((c) => c.name),
    iteration,
    liveChange,
    keptNote,
    earlier,
  }

  /* 4. Drafts, guarded: no shared 7-word phrase with a competitor, never a repeat of an earlier draft or of the live text. */
  ctx.step('drafts', 'Writing three variants from the live copy and the market patterns', 'active')
  const written = await writeDrafts(ctx, inputs)
  const guardPool = competitors.map((c) => ({ name: c.name, description: c.description }))
  const accepted: Accepted[] = []
  const rejected: string[] = []
  const repeatProblem = (text: string): string | null => {
    if (textOverlap(text, liveText) >= 0.95) return 'It is identical or nearly identical to the live description.'
    const dup = earlier.find((e) => textOverlap(e.text, text) >= 0.8)
    return dup ? `It repeats Variant ${dup.variant} from iteration ${dup.iteration}.` : null
  }
  for (const v of VARIANTS) {
    let draft: DraftOut | null = written[v] ?? null
    let attempts = 1
    for (;;) {
      const problems: string[] = []
      if (!draft) problems.push('The model returned no usable text.')
      else {
        const hits = similarityGuard(draft.text, guardPool, liveText)
        if (hits.length) problems.push(`It shares ${SHINGLE_WORDS}-word phrases with other games' descriptions (for example "${hits[0].phrase}" from ${hits[0].competitor}).`)
        const rep = repeatProblem(draft.text)
        if (rep) problems.push(rep)
      }
      if (!problems.length && draft) {
        accepted.push({ variant: v, text: draft.text, whatChanged: draft.whatChanged, attempts })
        break
      }
      if (attempts > MAX_REPAIRS) {
        rejected.push(`Variant ${v}: ${problems.join(' ')}`)
        break
      }
      attempts++
      try {
        draft = await repairDraft(ctx, inputs, v, draft?.text ?? '', problems)
      } catch (err) {
        if (err instanceof RunError && ['no-llm-key', 'credits', 'aborted'].includes(err.code)) throw err
        draft = null
      }
    }
  }
  ctx.step('drafts', 'Writing three variants from the live copy and the market patterns', rejected.length ? 'warn' : 'done', `${accepted.length} of 3 drafts accepted${accepted.some((a) => a.attempts > 1) ? ` (${accepted.filter((a) => a.attempts > 1).length} rewritten after the guard)` : ''}${rejected.length ? `; rejected: ${rejected.join(' ')}` : ''}`)
  if (!accepted.length) throw new RunError('upstream', 'The model could not produce a draft that passed the similarity guard. Try again.', { kind: 'retry', label: 'Try again' })

  /* 5. Deterministic lint. */
  ctx.step('lint', 'Linting every draft against the metadata policy', 'active')
  const lints = new Map(accepted.map((a) => [a.variant, lintDescription(a.text)]))
  ctx.step('lint', 'Linting every draft against the metadata policy', 'done', accepted.map((a) => `${a.variant}: ${lints.get(a.variant)!.passed} of ${lints.get(a.variant)!.total}`).join(', '))

  ctx.step('claims', 'Checking each draft for claims the live copy does not support', 'active')
  let claims: Record<DescriptionVariant, string[]> = { A: [], B: [], C: [] }
  try {
    claims = await findUnverifiedClaims(ctx, inputs, accepted)
    ctx.step('claims', 'Checking each draft for claims the live copy does not support', 'done', accepted.map((a) => `${a.variant}: ${claims[a.variant].length}`).join(', '))
  } catch (err) {
    if (err instanceof RunError && ['no-llm-key', 'credits', 'aborted'].includes(err.code)) throw err
    ctx.step('claims', 'Checking each draft for claims the live copy does not support', 'warn', 'The claim check failed, so unverified claims are not shown this run.')
  }

  /* 6. Optional measured baseline from the owner's Open Cloud key. */
  const key = ctx.secrets.get('roblox-open-cloud-key')
  let baseline: Baseline | null = null
  if (key) {
    ctx.step('measured', 'Reading your last 14 days of Home play-through from Roblox', 'active')
    baseline = await fetchBaseline(key, game.universeId, ctx.now, sig)
    const ok = baseline.metrics.filter((m) => m.mean !== null).length
    ctx.step('measured', 'Reading your last 14 days of Home play-through from Roblox', ok ? 'done' : 'warn', ok ? `${ok} of ${baseline.metrics.length} metrics, ${baseline.from} to ${baseline.to}` : baseline.metrics[0]?.unavailable ?? 'Roblox returned no data.')
  }

  /* 7. Findings, ranked by the transparent score. */
  const ranked = accepted
    .map((a) => ({ a, lint: lints.get(a.variant)!, unverified: claims[a.variant].length }))
    .sort((x, y) => compareRank({ lint: x.lint, unverified: x.unverified, chars: x.a.text.length, variant: x.a.variant }, { lint: y.lint, unverified: y.unverified, chars: y.a.text.length, variant: y.a.variant }))
  const competitorsUsed = competitors.map((c) => ({ name: c.name, url: c.url }))
  const bestIdx = ranked.findIndex((r) => !r.lint.blocked && r.lint.passed === r.lint.total)
  const findings: Finding[] = ranked.map((r, idx) => {
    const { a, lint } = r
    const detail: DescriptionDetail = {
      kind: 'description',
      iteration,
      variant: a.variant,
      text: lint.segments,
      chars: a.text.length,
      limit: DESCRIPTION_LIMIT,
      whatChanged: a.whatChanged,
      lint: lint.checks,
      lintScore: { passed: lint.passed, total: lint.total },
      blocked: lint.blocked,
      unverifiedClaims: claims[a.variant],
      diffAgainstLive: wordDiff(liveText, a.text),
      liveText,
      competitorsUsed,
      guard: { competitorsChecked: competitors.length, sharedPhrases: 0, attempts: a.attempts },
      universeId: game.universeId,
    }
    const badge = lint.blocked
      ? { label: 'Blocked by lint', tone: 'danger' as const }
      : idx === bestIdx
        ? { label: 'Best draft', tone: 'live' as const }
        : lint.passed === lint.total
          ? { label: 'Passes lint', tone: 'accent' as const }
          : { label: 'Lint warnings', tone: 'warn' as const }
    return {
      id: `desc:${iteration}:${a.variant}`,
      badge,
      title: `Variant ${a.variant}: ${VARIANT_NAME[a.variant]}`,
      snippet: firstLineSegments(lint.segments),
      meta: [
        { label: 'Characters', value: String(a.text.length) },
        { label: 'Lint score', value: `${lint.passed} of ${lint.total}` },
        { label: 'Unverified claims', value: String(claims[a.variant].length) },
        { label: 'Iteration', value: String(iteration) },
      ],
      status: { label: 'Draft', tone: 'muted' },
      states: { published: { label: 'Published', tone: 'live' } },
      url: game.url,
      detail,
    }
  })

  const passedAll = ranked.filter((r) => !r.lint.blocked && r.lint.passed === r.lint.total).length
  const items: SummaryItem[] = [
    { label: 'Live description', value: `${liveText.length.toLocaleString('en-US')} characters` },
    { label: 'Drafts', value: String(ranked.length) },
    { label: 'Passed lint', value: `${passedAll} of ${ranked.length}`, tone: passedAll === ranked.length ? 'live' : passedAll === 0 ? 'danger' : 'warn' },
    { label: 'Competitors read', value: String(competitors.length) },
    { label: 'Iteration', value: String(iteration) },
  ]
  const primary = baseline?.metrics.find((m) => m.mean !== null)
  if (baseline && primary && primary.mean !== null) {
    items.push({ label: 'Measured', value: `${primary.label}: ${formatMetric(primary.mean)} (mean of ${primary.days} days)`, tone: 'accent' })
  } else if (baseline) {
    items.push({ label: 'Measured', value: 'Not available', tone: 'warn' })
  } else {
    items.push({ label: 'Measured', value: 'Not connected', tone: 'muted' })
  }

  const notes: string[] = ['Roblox has no description A/B test: publish one draft, measure over a full week, then compare.']
  if (baseline) {
    for (const m of baseline.metrics) {
      notes.push(m.mean !== null ? `Measured by Roblox, ${baseline.from} to ${baseline.to}: ${m.label} ${formatMetric(m.mean)} over ${m.days} days${m.lastWeek !== null && m.firstWeek !== null ? ` (first week ${formatMetric(m.firstWeek)}, last week ${formatMetric(m.lastWeek)})` : ''}, as Roblox returns it.` : `${m.label}: not available (${m.unavailable ?? 'no data'}).`)
    }
  } else {
    notes.push('Measured is not connected: an Open Cloud key with analytics read access adds your real last 14 days of Home play-through and enables Publish to Roblox. Everything else here works without it.')
  }
  notes.push(`The live description scores ${liveLint.passed} of ${liveLint.total} on the same lint. A lint score counts passed checks and does not predict play-through or clicks.`)
  if (patternFacts.length) notes.push(`Competitor phrasing, counted over ${competitors.length} real descriptions: ${patternFacts.filter((f) => !f.startsWith('Structure')).slice(0, 3).join(' ')}`)
  if (rejected.length) notes.push(`Similarity guard: ${rejected.length === 1 ? 'one draft was' : `${rejected.length} drafts were`} refused for copying or repeating text. ${rejected.join(' ')}`)
  const summary: RunSummary = {
    items,
    sortLabel: 'Best lint score first',
    notices: [{ lead: 'Metadata policy', body: 'Roblox demotes misleading metadata, giveaway or Robux promises and keyword spam, so every draft is linted for those before you see it.' }],
    notes,
  }
  if (liveChange) summary.notices!.unshift({ lead: 'Live description changed', body: liveChange })
  ctx.summary(summary)
  for (const f of findings) ctx.finding(f)

  /* Memory for the next iteration: at most the last 3 iterations of draft texts. */
  const entry: MemIteration = {
    iteration,
    at: ctx.now.toISOString(),
    liveHash,
    drafts: ranked.map((r) => ({ variant: r.a.variant, text: r.a.text, whatChanged: r.a.whatChanged, lintPassed: r.lint.passed, lintTotal: r.lint.total, blocked: r.lint.blocked })),
  }
  ctx.memory.set('desc.history', [...history, entry].slice(-MEMORY_ITERATIONS))
  ctx.memory.set('desc.live', { hash: liveHash, text: liveText, at: ctx.now.toISOString() } satisfies MemLive)
  ctx.memory.set('desc.iteration', iteration)
}

/* ------------------------------------------------------------------ routes */

const status: RouteHandler = async (c) => {
  c.json(200, { ok: true, connected: c.secrets.has('roblox-open-cloud-key'), limit: DESCRIPTION_LIMIT })
}

/** POST /api/description/publish { daemonId?, universeId, text, confirm: true }
 *  PATCHes the universe description with the owner's Open Cloud key, only when confirm is true and the text passes the
 *  blocking lint checks. Answers with what Roblox answered and never with the key. */
const publish: RouteHandler = async (c) => {
  const raw = obj(await c.body().catch(() => undefined))
  if (raw.confirm !== true) return c.json(400, { ok: false, code: 'confirm-required', message: 'Publishing changes the live description on Roblox. Send confirm: true after the owner has confirmed.' })
  const universeId = typeof raw.universeId === 'number' ? raw.universeId : Number(raw.universeId)
  if (!Number.isInteger(universeId) || universeId <= 0) return c.json(400, { ok: false, code: 'bad-input', message: 'universeId must be a positive integer.' })
  if (typeof raw.text !== 'string' || !raw.text.trim()) return c.json(400, { ok: false, code: 'bad-input', message: 'text must be the description to publish.' })
  const text = normalizeText(raw.text)
  const lint = lintDescription(text)
  if (lint.blocked) {
    const failed = lint.checks.filter((k) => !k.passed && k.blocking)
    return c.json(422, { ok: false, code: 'lint-failed', message: `The text fails ${pluralize(failed.length, 'policy check')}: ${failed.map((k) => k.title).join('; ')}. Nothing was sent to Roblox.`, lint: failed.map((k) => ({ id: k.id, title: k.title, reason: k.reason, flags: k.flags })) })
  }
  const key = c.secrets.get('roblox-open-cloud-key')
  if (!key) return c.json(409, { ok: false, code: 'no-key', message: 'No Roblox Open Cloud key is connected. Add one with universe write access to publish from here.' })
  const result = await patchDescription(key, universeId, text)
  if (!result.ok) return c.json(502, { ok: false, code: 'roblox-rejected', robloxStatus: result.robloxStatus, message: result.message })
  c.json(200, {
    ok: true,
    robloxStatus: result.robloxStatus,
    message: result.message,
    updateTime: result.updateTime ?? null,
    chars: result.description?.length ?? text.length,
    lintPassed: lint.passed,
    lintTotal: lint.total,
    endpoint: `PATCH ${openCloudBase()}/cloud/v2/universes/${universeId}?updateMask=description`,
  })
}

export const tool: ToolModule = {
  analyze,
  routes: {
    'GET /api/description/status': status,
    'POST /api/description/publish': publish,
  },
}
