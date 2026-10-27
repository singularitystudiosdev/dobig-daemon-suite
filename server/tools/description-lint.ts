import type { DescriptionDiffPart, DescriptionLintCheck, DescriptionLintFlag } from '../../src/lib/details/description.ts'
import type { Segment } from '../../src/lib/runTypes.ts'

/* Deterministic policy lint, word diff and similarity guard for game descriptions. Pure code: no network, no model.
   Rules come from Roblox's own guidance (https://create.roblox.com/docs/discovery and the metadata best practices in
   https://create.roblox.com/docs/production/publishing/publish-games-and-places): be accurate, no giveaway or Robux
   rewards, avoid repeating keywords, summarise the game in the first sentence, decorate cautiously. Offsets are
   UTF-16 code unit offsets, so `text.slice(start, end)` is exactly the flagged span. */

/** Roblox's experience description limit in characters. The Open Cloud reference does not print a number (its only
 *  hint is "too long"); 1000 is the figure Roblox staff and the DevForum give for the description field, and every
 *  live description read in the tests is at or under it. Counted in UTF-16 code units, like JavaScript's .length. */
export const DESCRIPTION_LIMIT = 1000

/* ---------------------------------------------------------------- word lists (documented, exported) */

/** Phrases that imply a monetary or Robux reward. Matched case-insensitively on whole words. */
export const GIVEAWAY_PHRASES: readonly string[] = [
  'free robux',
  'free rbx',
  'robux giveaway',
  'rbx giveaway',
  'giveaway',
  'giveaways',
  'give away',
  'gift card',
  'gift cards',
  'giftcard',
  'giftcards',
  'win robux',
  'win rbx',
  'win real money',
  'free money',
  'real money',
  'robux code',
  'robux codes',
  'robux prize',
  'robux reward',
  'robux rewards',
]

/** "Robux" promised as a reward: a reward verb within 4 words before it, or a reward noun within 4 words after it.
 *  Plain mentions such as "spend Robux on boosts" do not match. */
const ROBUX_PROMISE_BEFORE = /\b(?:free|win|wins|winning|earn|earns|get|gets|getting|claim|claims|receive|receives|gift|gifts|gifted|giving|give|gives|reward(?:s|ed)?|prizes?|payout|payouts)\b(?:\W+\w+){0,4}?\W+(?:robux|rbx)\b/gi
const ROBUX_PROMISE_AFTER = /\b(?:robux|rbx)\b(?:\W+\w+){0,4}?\W+(?:giveaways?|rewards?|prizes?|for\s+free|every\s+\d+\s*(?:min|mins|minutes|hours?)|payouts?)\b/gi

/** Words in capitals that are normal (acronyms and game terms) and do not count as shouting. */
export const CAPS_ALLOWLIST: readonly string[] = [
  'PVP', 'PVE', 'NPC', 'NPCS', 'FPS', 'RPG', 'XP', 'VIP', 'UGC', 'PC', 'UTC', 'AFK', 'OP', 'AI', 'UI', 'HP', 'DPS', 'MMO', 'RNG',
  'OBBY', 'TD', 'CTF', 'USA', 'UK', 'EU', 'GMT', 'AM', 'PM', 'HD', 'FOV', 'ESP', 'DLC', 'QA', 'FAQ', 'TV', 'ID', 'II', 'III', 'IV', 'VR',
]

export const LINT_THRESHOLDS = {
  /** A content word repeated at least stuffMinCount times AND making up at least stuffShare of the content words is stuffing.
   *  A game about eggs may say "eggs" five times in a feature list; seven times, or a 12% share, is spam. */
  stuffMinCount: 7,
  stuffShare: 0.12,
  /** The same word this many times in a row ("obby obby obby") is stuffing at any share. */
  stuffAdjacent: 3,
  /** A line of at least this many short comma-separated items is a keyword list. */
  commaRunItems: 7,
  /** Items in a keyword list are at most this many words. */
  commaItemMaxWords: 3,
  /** Hashtags on one line that make it a tag list. */
  hashtagsPerLine: 4,
  capsRatio: 0.2,
  capsRunWords: 3,
  capsLooseWords: 3,
  ellipsisRun: 4,
  exclamationTotal: 10,
  longLine: 180,
  firstLineMinWords: 6,
  emojiPerChars: 20,
  emojiMinBudget: 4,
  emojiRun: 4,
} as const

/* ---------------------------------------------------------------- helpers */

const PICTO = '(?![\\u00A9\\u00AE\\u2122])\\p{Extended_Pictographic}'
const EMOJI = new RegExp(`${PICTO}(?:\\uFE0F|\\u200D${PICTO}|[\\u{1F3FB}-\\u{1F3FF}])*\\uFE0F?`, 'gu')
const STOPWORDS = new Set(
  'the and for you your with that this are from have has not but can all any out get one more will they them their its was were been into over than then there what when who how why our his her she him about also just like make made play game games new now only some such very much many each other these those would could should while where which being because after before again here still every own both same too off per via'.split(' '),
)

interface Line {
  text: string
  start: number
  end: number
}

function linesOf(text: string): Line[] {
  const out: Line[] = []
  let pos = 0
  for (const raw of text.split('\n')) {
    out.push({ text: raw, start: pos, end: pos + raw.length })
    pos += raw.length + 1
  }
  return out
}

function flag(text: string, start: number, end: number, reason: string): DescriptionLintFlag {
  return { start, end, text: text.slice(start, end), reason }
}

function stripEmoji(s: string): string {
  return s.replace(EMOJI, ' ').replace(/[\uFE0F\u200D]/g, '')
}

function countWords(s: string): number {
  return (stripEmoji(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length
}

function emojiMatches(text: string): { start: number; end: number }[] {
  return [...text.matchAll(EMOJI)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
}

/* ---------------------------------------------------------------- the checks */

function checkGiveaway(text: string): DescriptionLintCheck {
  const flags: DescriptionLintFlag[] = []
  for (const phrase of GIVEAWAY_PHRASES) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${phrase.replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu')
    for (const m of text.matchAll(re)) flags.push(flag(text, m.index ?? 0, (m.index ?? 0) + m[0].length, `"${m[0]}" implies a monetary or Robux reward`))
  }
  for (const re of [ROBUX_PROMISE_BEFORE, ROBUX_PROMISE_AFTER]) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) flags.push(flag(text, m.index ?? 0, (m.index ?? 0) + m[0].length, `Robux promised as a reward: "${m[0]}"`))
  }
  const merged = mergeFlags(flags)
  return {
    id: 'giveaway',
    title: 'No giveaway or Robux reward wording',
    passed: merged.length === 0,
    blocking: true,
    flags: merged,
    reason: merged.length === 0 ? 'No giveaway, gift card or Robux-reward phrases found.' : `${merged.length} phrase${merged.length === 1 ? '' : 's'} imply a monetary reward. Roblox deprioritises metadata that leads with giveaways.`,
  }
}

function checkStuffing(text: string): DescriptionLintCheck {
  const T = LINT_THRESHOLDS
  const flags: DescriptionLintFlag[] = []
  // 1. Repeated content words.
  const words = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)].map((m) => ({ w: m[0].toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
  const content = words.filter((x) => x.w.length >= 3 && !STOPWORDS.has(x.w))
  const counts = new Map<string, number>()
  for (const x of content) counts.set(x.w, (counts.get(x.w) ?? 0) + 1)
  const repeated: string[] = []
  for (const [w, n] of counts) {
    if (n >= T.stuffMinCount && n / Math.max(1, content.length) >= T.stuffShare) {
      repeated.push(`${w} x${n}`)
      let seen = 0
      for (const x of content) {
        if (x.w !== w) continue
        seen++
        if (seen > 2) flags.push(flag(text, x.start, x.end, `"${w}" is repeated ${n} times (${Math.round((n / content.length) * 100)}% of the content words)`))
      }
    }
  }
  // 1b. The same word several times in a row.
  for (let i = 0; i < words.length; ) {
    let j = i
    while (j + 1 < words.length && words[j + 1].w === words[i].w && words[i].w.length >= 3) j++
    if (j - i + 1 >= T.stuffAdjacent) {
      flags.push(flag(text, words[i].start, words[j].end, `"${words[i].w}" repeated ${j - i + 1} times in a row`))
      repeated.push(`${words[i].w} x${j - i + 1} in a row`)
    }
    i = j + 1
  }
  // 2. Comma-run keyword lists and tag lines.
  const ls = linesOf(text)
  for (const line of ls) {
    const items = line.text.split(',')
    if (items.length >= T.commaRunItems) {
      const short = items.filter((it) => countWords(it) >= 1 && countWords(it) <= T.commaItemMaxWords).length
      if (short >= T.commaRunItems) flags.push(flag(text, line.start, line.end, `A run of ${short} short comma-separated items reads as a keyword list`))
    }
    if (/^\s*(?:tags?|keywords?|search terms|hashtags?)\s*(?:\([^)]*\))?\s*[:\-=]/i.test(line.text) && line.text.trim().length > 0) {
      flags.push(flag(text, line.start, line.end, 'A tag or keyword list line'))
    }
    const tags = line.text.match(/(?:^|\s)#[\p{L}\p{N}_]+/gu) ?? []
    if (tags.length >= T.hashtagsPerLine) flags.push(flag(text, line.start, line.end, `${tags.length} hashtags on one line`))
  }
  const merged = mergeFlags(flags)
  const bits: string[] = []
  if (repeated.length) bits.push(`repeated words (${repeated.join(', ')})`)
  if (merged.some((f) => /comma-separated|tag or keyword|hashtags/.test(f.reason))) bits.push('a keyword or tag list')
  return {
    id: 'stuffing',
    title: 'No keyword stuffing',
    passed: merged.length === 0,
    blocking: true,
    flags: merged,
    reason: merged.length === 0 ? 'No repeated-word runs, comma-stuffed lines or tag lists found.' : `Found ${bits.join(' and ')}. Roblox may demote metadata that repeats keywords.`,
  }
}

function checkCaps(text: string): DescriptionLintCheck {
  const T = LINT_THRESHOLDS
  const allow = new Set(CAPS_ALLOWLIST)
  const flags: DescriptionLintFlag[] = []
  const letters = (text.match(/\p{L}/gu) ?? []).length
  const upper = (text.match(/\p{Lu}/gu) ?? []).length
  const ratio = letters ? upper / letters : 0
  const words = [...text.matchAll(/[\p{L}][\p{L}'’]*/gu)].map((m) => ({ w: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
  const isShout = (w: string) => w.length >= 2 && w === w.toUpperCase() && w !== w.toLowerCase() && !allow.has(w.toUpperCase())
  // Runs of shouted words.
  let run: typeof words = []
  const flushRun = () => {
    if (run.length >= T.capsRunWords) flags.push(flag(text, run[0].start, run[run.length - 1].end, `${run.length} words in a row in capitals`))
    run = []
  }
  for (const w of words) {
    if (isShout(w.w)) run.push(w)
    else flushRun()
  }
  flushRun()
  const loose = words.filter((w) => isShout(w.w) && w.w.length >= 4)
  if (loose.length >= T.capsLooseWords) for (const w of loose) flags.push(flag(text, w.start, w.end, `"${w.w}" is shouted in capitals`))
  const lettersEnough = letters >= 40
  const ratioFail = lettersEnough && ratio > T.capsRatio
  const merged = mergeFlags(flags)
  const passed = merged.length === 0 && !ratioFail
  if (ratioFail && merged.length === 0) {
    // Whole-text ratio problem with no single span: flag the shouted words so the view can show them.
    for (const w of words.filter((x) => isShout(x.w))) merged.push(flag(text, w.start, w.end, 'Contributes to the capitals ratio'))
  }
  return {
    id: 'caps',
    title: 'No ALL CAPS shouting',
    passed,
    blocking: true,
    flags: merged,
    reason: passed ? `${Math.round(ratio * 100)}% of letters are capitals (limit ${Math.round(T.capsRatio * 100)}%), no shouted runs.` : `${Math.round(ratio * 100)}% of letters are capitals (limit ${Math.round(T.capsRatio * 100)}%) and ${merged.length} shouted span${merged.length === 1 ? '' : 's'} found.`,
  }
}

function checkPunctuation(text: string): DescriptionLintCheck {
  const T = LINT_THRESHOLDS
  const flags: DescriptionLintFlag[] = []
  for (const m of text.matchAll(/[!?]{3,}/g)) flags.push(flag(text, m.index ?? 0, (m.index ?? 0) + m[0].length, `Repeated punctuation "${m[0].slice(0, 12)}"`))
  for (const m of text.matchAll(/([*~=_#+-])\1{4,}/g)) flags.push(flag(text, m.index ?? 0, (m.index ?? 0) + m[0].length, `Decorative run "${m[0].slice(0, 12)}"`))
  for (const m of text.matchAll(/\.{4,}/g)) flags.push(flag(text, m.index ?? 0, (m.index ?? 0) + m[0].length, 'Long run of dots'))
  const bangs = (text.match(/!/g) ?? []).length
  const merged = mergeFlags(flags)
  const spamBangs = bangs > T.exclamationTotal
  if (spamBangs && merged.length === 0) for (const m of text.matchAll(/!/g)) merged.push(flag(text, m.index ?? 0, (m.index ?? 0) + 1, `${bangs} exclamation marks in one description`))
  const passed = merged.length === 0
  return {
    id: 'punctuation',
    title: 'No punctuation spam',
    passed,
    blocking: true,
    flags: merged,
    reason: passed ? `No runs of repeated punctuation; ${bangs} exclamation mark${bangs === 1 ? '' : 's'} in total.` : `${merged.length} span${merged.length === 1 ? '' : 's'} of repeated punctuation or too many exclamation marks (${bangs}).`,
  }
}

function checkLongLines(text: string): DescriptionLintCheck {
  const T = LINT_THRESHOLDS
  const flags = linesOf(text)
    .filter((l) => l.text.length > T.longLine)
    .map((l) => flag(text, l.start + (l.text.lastIndexOf(' ', T.longLine) > 0 ? l.text.lastIndexOf(' ', T.longLine) + 1 : T.longLine), l.end, `Line is ${l.text.length} characters; lines over ${T.longLine} are hard to scan on a phone`))
  const longest = Math.max(0, ...linesOf(text).map((l) => l.text.length))
  return {
    id: 'long-lines',
    title: 'No over-long lines',
    passed: flags.length === 0,
    blocking: false,
    flags,
    reason: flags.length === 0 ? `Longest line is ${longest} characters (limit ${T.longLine}).` : `${flags.length} line${flags.length === 1 ? '' : 's'} run past ${T.longLine} characters; the overflow is marked.`,
  }
}

function checkLimit(text: string, limit: number): DescriptionLintCheck {
  const over = text.length - limit
  return {
    id: 'limit',
    title: `Within the ${limit.toLocaleString('en-US')} character limit`,
    passed: over <= 0,
    blocking: true,
    flags: over > 0 ? [flag(text, limit, text.length, `${over} characters over the limit`)] : [],
    reason: over <= 0 ? `${text.length.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')} characters used.` : `${text.length.toLocaleString('en-US')} characters, ${over} over the ${limit.toLocaleString('en-US')} limit; the overflow is marked.`,
  }
}

const OPENER_WORDS = /^(?:welcome|hello|hi|hey|greetings|thanks|thank you|like|favorite|favourite|follow|update|new update|tags?|keywords?)\b/i

function checkFirstLine(text: string): DescriptionLintCheck {
  const T = LINT_THRESHOLDS
  const first = linesOf(text).find((l) => l.text.trim().length > 0)
  if (!first) return { id: 'first-line', title: 'First line summarises the game', passed: false, blocking: false, flags: [], reason: 'The description is empty.' }
  const words = countWords(first.text)
  const plain = stripEmoji(first.text).trim()
  const problems: string[] = []
  if (words < T.firstLineMinWords) problems.push(`only ${words} words (at least ${T.firstLineMinWords}) so it reads as a title, not a summary`)
  if (OPENER_WORDS.test(plain)) problems.push('it opens with a greeting or call to action instead of what the game is')
  if (/:\s*$/.test(plain)) problems.push('it ends with a colon, so it is a heading')
  const passed = problems.length === 0
  return {
    id: 'first-line',
    title: 'First line summarises the game',
    passed,
    blocking: false,
    flags: passed ? [] : [flag(text, first.start, first.end, problems.join('; '))],
    reason: passed ? `The first line is ${words} words and states what the game is.` : `First line: ${problems.join('; ')}.`,
  }
}

function checkEmoji(text: string): DescriptionLintCheck {
  const T = LINT_THRESHOLDS
  const ems = emojiMatches(text)
  const budget = Math.max(T.emojiMinBudget, Math.floor(text.length / T.emojiPerChars))
  const flags: DescriptionLintFlag[] = []
  // Runs of adjacent emoji.
  let i = 0
  while (i < ems.length) {
    let j = i
    while (j + 1 < ems.length && ems[j + 1].start - ems[j].end <= 1) j++
    if (j - i + 1 >= T.emojiRun) flags.push(flag(text, ems[i].start, ems[j].end, `${j - i + 1} emoji in a row`))
    i = j + 1
  }
  if (ems.length > budget) {
    for (const e of ems.slice(budget)) flags.push(flag(text, e.start, e.end, `Emoji beyond the budget of ${budget} for ${text.length} characters`))
  }
  const merged = mergeFlags(flags)
  const passed = merged.length === 0
  return {
    id: 'emoji',
    title: 'Sensible emoji use',
    passed,
    blocking: false,
    flags: merged,
    reason: passed ? `${ems.length} emoji in ${text.length} characters (budget ${budget}), none in runs of ${T.emojiRun} or more.` : `${ems.length} emoji against a budget of ${budget}, or runs of ${T.emojiRun}+ in a row; the excess is marked.`,
  }
}

function mergeFlags(flags: DescriptionLintFlag[]): DescriptionLintFlag[] {
  const sorted = [...flags].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: DescriptionLintFlag[] = []
  for (const f of sorted) {
    const last = out[out.length - 1]
    if (last && f.start < last.end) {
      if (f.end > last.end) {
        last.text += f.text.slice(last.end - f.start)
        last.end = f.end
      }
      continue
    }
    out.push({ ...f })
  }
  return out
}

export interface LintResult {
  checks: DescriptionLintCheck[]
  passed: number
  total: number
  /** A blocking check failed. */
  blocked: boolean
  segments: Segment[]
}

/** Runs all eight checks. Pure and deterministic: the same text always gives the same result. */
export function lintDescription(text: string, limit = DESCRIPTION_LIMIT): LintResult {
  const checks = [checkGiveaway(text), checkStuffing(text), checkCaps(text), checkPunctuation(text), checkLongLines(text), checkLimit(text, limit), checkFirstLine(text), checkEmoji(text)]
  const passed = checks.filter((c) => c.passed).length
  const blocked = checks.some((c) => !c.passed && c.blocking)
  return { checks, passed, total: checks.length, blocked, segments: struckSegments(text, checks.flatMap((c) => c.flags)) }
}

/** Splits `text` into runs; any span covered by a flag is `struck`. */
export function struckSegments(text: string, flags: { start: number; end: number }[]): Segment[] {
  const spans = [...flags].filter((f) => f.end > f.start).sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const f of spans) {
    const last = merged[merged.length - 1]
    if (last && f.start <= last.end) last.end = Math.max(last.end, f.end)
    else merged.push({ start: Math.max(0, f.start), end: Math.min(text.length, f.end) })
  }
  const out: Segment[] = []
  let pos = 0
  for (const m of merged) {
    if (m.start > pos) out.push({ text: text.slice(pos, m.start) })
    out.push({ text: text.slice(m.start, m.end), struck: true })
    pos = m.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  return out.length ? out : [{ text }]
}

/** The segments of the first line of `text` only (for a row snippet), keeping struck spans. */
export function firstLineSegments(segments: Segment[]): Segment[] {
  const out: Segment[] = []
  let started = false
  for (const s of segments) {
    let t = s.text
    if (!started) {
      t = t.replace(/^\s+/, '')
      if (!t) continue
      started = true
    }
    const nl = t.indexOf('\n')
    if (nl >= 0) {
      if (nl > 0) out.push(s.struck ? { text: t.slice(0, nl), struck: true } : { text: t.slice(0, nl) })
      break
    }
    out.push(s.struck ? { text: t, struck: true } : { text: t })
  }
  return out.length ? out : [{ text: '' }]
}

/* ---------------------------------------------------------------- word diff */

interface Tok {
  w: string
  /** Whitespace that follows the word. */
  ws: string
}

function tokens(text: string): Tok[] {
  const out: Tok[] = []
  for (const m of text.matchAll(/(\S+)(\s*)/g)) out.push({ w: m[1], ws: m[2] })
  return out
}

/** Word-level diff from `live` to `draft` (longest common subsequence over whitespace-separated words). */
export function wordDiff(live: string, draft: string): DescriptionDiffPart[] {
  const a = tokens(live)
  const b = tokens(draft)
  const n = a.length
  const m = b.length
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i].w === b[j].w ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const parts: DescriptionDiffPart[] = []
  const push = (text: string, kind: DescriptionDiffPart['kind']) => {
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += text
    else parts.push({ text, kind })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i].w === b[j].w) {
      push(b[j].w + b[j].ws, 'same')
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(a[i].w + a[i].ws, 'removed')
      i++
    } else {
      push(b[j].w + b[j].ws, 'added')
      j++
    }
  }
  while (i < n) push(a[i].w + a[i++].ws, 'removed')
  while (j < m) push(b[j].w + b[j++].ws, 'added')
  return tidyDiff(parts)
}

const wordsIn = (t: string) => (t.match(/\S+/g) ?? []).length

/** Readability pass: a run of one or two unchanged words wedged between two changes is folded into them (it was matched by
 *  chance, e.g. "eggs from"), then each block of consecutive changes shows all removed text first and all added text second.
 *  Same + added still rebuilds the draft exactly and same + removed still rebuilds the live text. */
function tidyDiff(parts: DescriptionDiffPart[]): DescriptionDiffPart[] {
  const folded: DescriptionDiffPart[] = []
  parts.forEach((p, idx) => {
    const between = idx > 0 && idx < parts.length - 1 && parts[idx - 1].kind !== 'same' && parts[idx + 1].kind !== 'same'
    if (p.kind === 'same' && between && wordsIn(p.text) <= 2) {
      folded.push({ text: p.text, kind: 'removed' }, { text: p.text, kind: 'added' })
    } else folded.push(p)
  })
  const out: DescriptionDiffPart[] = []
  for (let k = 0; k < folded.length; ) {
    if (folded[k].kind === 'same') {
      const last = out[out.length - 1]
      if (last && last.kind === 'same') last.text += folded[k].text
      else out.push({ ...folded[k] })
      k++
      continue
    }
    let removed = ''
    let added = ''
    while (k < folded.length && folded[k].kind !== 'same') {
      if (folded[k].kind === 'removed') removed += folded[k].text
      else added += folded[k].text
      k++
    }
    if (removed) out.push({ text: removed, kind: 'removed' })
    if (added) out.push({ text: added, kind: 'added' })
  }
  return out
}

/** Line-level change counts between two texts (blank lines ignored): {added, removed}. */
export function lineDiffCounts(before: string, after: string): { added: number; removed: number } {
  const a = before.split('\n').map((l) => l.trim()).filter(Boolean)
  const b = after.split('\n').map((l) => l.trim()).filter(Boolean)
  const lcs: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const common = lcs[0][0]
  return { added: b.length - common, removed: a.length - common }
}

/* ---------------------------------------------------------------- similarity guard */

export const SHINGLE_WORDS = 7

/** Normalised words: lower case, letters and digits only, emoji and punctuation dropped. */
export function normWords(text: string): string[] {
  return (stripEmoji(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice()
}

export function shingles(text: string, n = SHINGLE_WORDS): Set<string> {
  const w = normWords(text)
  const out = new Set<string>()
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '))
  return out
}

export interface SimilarityHit {
  phrase: string
  competitor: string
}

/** Every 7-word phrase of `draft` that also appears in a competitor description. Phrases that the live description
 *  itself already contains are the owner's own words and are not counted. */
export function similarityGuard(draft: string, competitors: { name: string; description: string }[], live: string, n = SHINGLE_WORDS): SimilarityHit[] {
  const own = shingles(live, n)
  const mine = shingles(draft, n)
  const hits: SimilarityHit[] = []
  for (const c of competitors) {
    const theirs = shingles(c.description, n)
    for (const s of mine) if (theirs.has(s) && !own.has(s)) hits.push({ phrase: s, competitor: c.name })
  }
  return hits
}

/** How alike two texts are, 0 to 1 (Jaccard over 3-word shingles). Used to refuse a draft that repeats an earlier one. */
export function textOverlap(a: string, b: string): number {
  const sa = shingles(a, 3)
  const sb = shingles(b, 3)
  if (!sa.size || !sb.size) return normWords(a).join(' ') === normWords(b).join(' ') ? 1 : 0
  let inter = 0
  for (const s of sa) if (sb.has(s)) inter++
  return inter / (sa.size + sb.size - inter)
}

/* ---------------------------------------------------------------- phrasing patterns */

export interface PatternFact {
  /** One sentence, counted over the competitor descriptions actually read. */
  fact: string
}

/** Counts how real competitor descriptions open and are structured. Pure counting, no model. */
export function extractPatterns(descriptions: { name: string; description: string }[]): PatternFact[] {
  const ds = descriptions.filter((d) => d.description.trim().length > 0)
  const n = ds.length
  if (n === 0) return []
  const firstLine = (s: string) => s.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  const count = (pred: (d: string) => boolean) => ds.filter((d) => pred(d.description)).length
  const lengths = ds.map((d) => d.description.length).sort((a, b) => a - b)
  const median = lengths[Math.floor(lengths.length / 2)]
  const facts: PatternFact[] = []
  facts.push({ fact: `Length: median ${median} characters (shortest ${lengths[0]}, longest ${lengths[lengths.length - 1]}) across ${n} descriptions.` })
  const emojiOpen = count((d) => new RegExp(`^\\s*${EMOJI.source}`, 'u').test(d))
  facts.push({ fact: `${emojiOpen} of ${n} open with an emoji.` })
  const welcome = count((d) => /^[^\p{L}]*(?:welcome|hello|hi|hey)\b/iu.test(stripEmoji(firstLine(d))))
  facts.push({ fact: `${welcome} of ${n} open with a greeting such as "Welcome to".` })
  const question = count((d) => /\?/.test(firstLine(d)))
  if (question > 0) facts.push({ fact: `${question} of ${n} open with a question.` })
  const bullets = count((d) => d.split('\n').filter((l) => new RegExp(`^\\s*(?:[-*•]|${EMOJI.source})\\s*\\S`, 'u').test(l)).length >= 3)
  facts.push({ fact: `${bullets} of ${n} use a list of three or more short lines (bullets or one emoji per line).` })
  const howTo = count((d) => /how to play|controls?:|features?:/i.test(d))
  facts.push({ fact: `${howTo} of ${n} have a labelled section such as "How to Play", "Controls" or "Features".` })
  const lines = ds.map((d) => d.description.split('\n').filter((l) => l.trim()).length).sort((a, b) => a - b)
  facts.push({ fact: `Structure: median ${lines[Math.floor(lines.length / 2)]} non-empty lines.` })
  const caps = count((d) => /\b[A-Z]{4,}(?:\s+[A-Z]{3,})+\b/.test(d))
  if (caps > 0) facts.push({ fact: `${caps} of ${n} use runs of capital letters, which the metadata guidance warns against.` })
  const tagLists = count((d) => d.split('\n').some((l) => /^\s*(?:tags?|keywords?)\b/i.test(l)))
  if (tagLists > 0) facts.push({ fact: `${tagLists} of ${n} end with a tag or keyword list, which the metadata guidance warns against.` })
  const reward = count((d) => lintDescription(d).checks.find((c) => c.id === 'giveaway')?.passed === false)
  if (reward > 0) facts.push({ fact: `${reward} of ${n} use giveaway or Robux-reward wording, which Roblox deprioritises.` })
  return facts
}
