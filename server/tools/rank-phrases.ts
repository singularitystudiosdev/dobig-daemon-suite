import type { RankPhraseSource } from '../../src/lib/details/rank.ts'

/* The search phrases the Rank Daemon types into Roblox search. Pure functions, no network. Everything here comes from
   the game's own facts (name, genre words, description) or from the model's suggestions; nothing is invented. A phrase
   is stored and shown exactly as it is searched. */

export const MAX_PHRASES = 14
/** With a model, the facts-only phrases stop here so the model can add at least six more. */
export const DETERMINISTIC_WITH_MODEL = 8
export const DETERMINISTIC_ALONE = 12
const MAX_PHRASE_CHARS = 40
const MAX_PHRASE_WORDS = 6

export interface PhraseSpec {
  phrase: string
  source: RankPhraseSource
}

const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu
const DASHES = /[‒-―−]/g

/** Removes emoji and zero-width joiners. */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI, ' ')
}

export function hasEmoji(text: string): boolean {
  return /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}]/u.test(text)
}

/** Lower-case, letters and digits only: the identity of a phrase for dedupe and memory. */
export function phraseKey(phrase: string): string {
  return phrase.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The game name without [brackets], (parentheses), emoji and decorative symbols. Keeps ordinary punctuation. */
export function cleanName(name: string): string {
  const withoutBrackets = name.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|<[^>]*>/g, ' ')
  const out = squash(stripEmoji(withoutBrackets).replace(DASHES, '-').replace(/[^\p{L}\p{N}\s'’&:.!?,+-]/gu, ' '))
  if (out) return out
  // The whole name was inside brackets: keep the words and drop only the brackets and symbols.
  return squash(stripEmoji(name).replace(DASHES, '-').replace(/[^\p{L}\p{N}\s'’&:.!?,+-]/gu, ' '))
}

const STOP = new Set(
  `a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours
   roblox game games play playing played player players join joined update updates updated new like likes favorite favourite follow group groups code codes welcome enjoy best fun free make made get got will can also one two three lot lots many much really every always never still ever even yet soon today make makes use using used via see check out more enjoy thanks thank please hello hey hi let lets let's don't dont it's its you'll youll we'll our`
    .split(/\s+/)
    .filter(Boolean),
)

export const isStopWord = (w: string) => STOP.has(w.toLowerCase())

/** Whole-word tokens of a phrase, lower-case. */
function words(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).map((w) => w.replace(/['’]/g, "'"))
}

/** A few ways a player might type the name: as shown (cleaned), without punctuation, without a leading article, and
 *  without filler words. Only words that are already in the name. At most 3. */
export function nameVariants(name: string): string[] {
  const base = cleanName(name)
  if (!base) return []
  const out: string[] = [base]
  const plain = squash(base.replace(/[^\p{L}\p{N}\s]+/gu, ' '))
  const noArticle = squash(plain.replace(/^(the|a|an)\s+/i, ''))
  const noFiller = words(plain).filter((w) => !isStopWord(w)).join(' ')
  for (const v of [plain, noArticle, noFiller]) {
    if (!v || out.length >= 3) continue
    if (v.split(' ').length < 1 || v.length < 3) continue
    if (!out.some((o) => phraseKey(o) === phraseKey(v))) out.push(v)
  }
  return out.slice(0, 3)
}

/** The genre words Roblox lists, lower-case. 'All' is Roblox's "no genre" and is skipped. */
export function genrePhrases(genre: string, subgenre: string, genreL1: string): string[] {
  const out: string[] = []
  for (const g of [subgenre, genreL1, genre]) {
    const w = squash(stripEmoji(g || '')).toLowerCase()
    if (!w || w === 'all' || w === 'default' || w === 'null') continue
    if (!out.includes(w)) out.push(w)
  }
  return out.slice(0, 3)
}

/** The strongest content words and word pairs of a description: stop words removed, counted by how often the
 *  description itself uses them, words of the game name left out (the name phrase already covers them).
 *  Returns at most `max` phrases, pairs first because they search better. */
export function descriptionPhrases(description: string, name: string, max: number): string[] {
  if (max <= 0) return []
  const nameWords = new Set(words(cleanName(name)))
  const text = stripEmoji(description || '')
  const units = text.split(/[\n\r.!?:;|\u2022\u00B7*#>]+/).map((u) => u.trim()).filter(Boolean)
  const uni = new Map<string, { n: number; first: number }>()
  const bi = new Map<string, { n: number; first: number }>()
  let order = 0
  for (const unit of units) {
    const toks = words(unit)
    // A run of content words: stop words break it, so a pair is two words the writer really put side by side.
    let prev: string | null = null
    for (const t of toks) {
      order++
      const content = t.length >= 4 && !isStopWord(t) && !/^\d+$/.test(t)
      if (!content) {
        prev = null
        continue
      }
      if (!nameWords.has(t)) {
        const u = uni.get(t)
        u ? u.n++ : uni.set(t, { n: 1, first: order })
      }
      if (prev && !(nameWords.has(prev) && nameWords.has(t))) {
        const k = `${prev} ${t}`
        const b = bi.get(k)
        b ? b.n++ : bi.set(k, { n: 1, first: order })
      }
      prev = t
    }
  }
  const rank = (m: Map<string, { n: number; first: number }>, minCount: number) =>
    [...m.entries()].filter(([, v]) => v.n >= minCount).sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).map(([k]) => k)
  const pairs = rank(bi, 2).slice(0, Math.min(2, Math.floor(max / 2)))
  const used = new Set(pairs.flatMap((p) => p.split(' ')))
  let singles = rank(uni, 2).filter((w) => !used.has(w))
  if (singles.length + pairs.length < max) {
    // Short descriptions repeat nothing: fall back to the words of the first line, in the order they were written.
    const early = [...uni.entries()].sort((a, b) => a[1].first - b[1].first).map(([k]) => k).filter((w) => !used.has(w) && !singles.includes(w))
    singles = singles.concat(early)
  }
  return [...pairs, ...singles].slice(0, max)
}

/** Cleans model suggestions: strings only, no emoji, no brackets, lower-case, 1 to 6 words, no repeats of `taken`. */
export function cleanModelPhrases(raw: unknown, taken: Iterable<string>, max: number): string[] {
  const seen = new Set([...taken].map(phraseKey))
  const out: string[] = []
  if (!Array.isArray(raw)) return out
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const p = squash(stripEmoji(item).replace(DASHES, ' ').replace(/[\[\](){}<>"“”]/g, ' ').replace(/[^\p{L}\p{N}\s'’&+-]/gu, ' ')).toLowerCase()
    const key = phraseKey(p)
    if (!key || p.length > MAX_PHRASE_CHARS || p.split(' ').length > MAX_PHRASE_WORDS || seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= max) break
  }
  return out
}

export interface GameFacts {
  name: string
  description: string
  genre: string
  genreL1: string
  genreL2: string
}

/** The facts-only phrases, in priority order, capped at `cap`. */
export function deterministicPhrases(game: GameFacts, cap: number): PhraseSpec[] {
  const out: PhraseSpec[] = []
  const seen = new Set<string>()
  const add = (phrase: string, source: RankPhraseSource) => {
    const p = squash(phrase)
    const k = phraseKey(p)
    if (!p || !k || hasEmoji(p) || seen.has(k) || out.length >= cap) return
    seen.add(k)
    out.push({ phrase: p, source })
  }
  const variants = nameVariants(game.name)
  variants.forEach((v, i) => add(v, i === 0 ? 'name' : 'name-variant'))
  const genres = genrePhrases(game.genre, game.genreL2, game.genreL1)
  const genreRoom = cap >= DETERMINISTIC_ALONE ? 3 : 2
  genres.slice(0, genreRoom).forEach((g) => add(g, 'genre'))
  const room = Math.max(0, cap - out.length)
  descriptionPhrases(game.description, game.name, cap >= DETERMINISTIC_ALONE ? Math.min(room, 6) : Math.min(room, 3)).forEach((d) => add(d, 'description'))
  return out
}

/** Facts-only phrases plus the model's, capped at 14 in total. */
export function assemblePhrases(game: GameFacts, modelPhrases: string[] | null): PhraseSpec[] {
  const det = deterministicPhrases(game, modelPhrases && modelPhrases.length > 0 ? DETERMINISTIC_WITH_MODEL : DETERMINISTIC_ALONE)
  const seen = new Set(det.map((d) => phraseKey(d.phrase)))
  const out = [...det]
  for (const m of modelPhrases ?? []) {
    const k = phraseKey(m)
    if (!k || seen.has(k) || out.length >= MAX_PHRASES) continue
    seen.add(k)
    out.push({ phrase: m, source: 'model' })
  }
  return out
}
