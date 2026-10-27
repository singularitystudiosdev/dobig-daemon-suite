import type { HackClass } from '../../src/lib/details/hack.ts'

/* Pure helpers for the Hack Daemon: name cleaning, query building, text sanitising, the guardrail check that every
   brief must pass, and the class-level fallback table. Nothing here touches the network. */

/* ---- game name ---- */

const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍⃣]/gu
const LEADING_TAG_WORDS = /^(?:(?:new|update|updated|beta|alpha|event|sale|soon|hot)\b[\s:!-]*)+/i
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'at', 'by'])

/** "[UPDATE] 🥚 Steal An Egg!" -> "Steal An Egg". Strips [tags], (tags), emoji, punctuation and leading event words. */
export function cleanGameName(raw: string): string {
  let s = raw.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|【[^】]*】/g, ' ').replace(EMOJI, ' ')
  const clean = (x: string) => x.replace(/[^\p{L}\p{N}\s'&]/gu, ' ').replace(/\s+/g, ' ').trim()
  const segments = s.split(/[|•\u00B7—–:]| - /).map((x) => clean(x).replace(LEADING_TAG_WORDS, '').trim())
  s = segments.find((x) => /[\p{L}\p{N}]/u.test(x)) ?? clean(s)
  return s
}

export function nameTokens(clean: string): string[] {
  return normalize(clean)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t))
}

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(EMOJI, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cheap relevance check: the title holds the whole clean name, or all (about 70% of long names) of its significant tokens. */
export function titleMentionsGame(title: string, clean: string): boolean {
  const t = normalize(title)
  const tokens = nameTokens(clean)
  if (tokens.length === 0) return true
  if (t.replace(/ /g, '').includes(normalize(clean).replace(/ /g, ''))) return true
  const words = new Set(t.split(' '))
  const hit = tokens.filter((tok) => words.has(tok) || t.includes(tok)).length
  const need = tokens.length <= 3 ? tokens.length : Math.ceil(tokens.length * 0.7)
  return hit >= need
}

/* ---- search queries ---- */

export interface PlannedQuery {
  q: string
  sort: 'date' | 'relevance'
}

export const MAX_QUERIES = 11

/** Other ways people write the game name, each built only from its real words: joined, initials. */
export function nameVariants(clean: string): string[] {
  const words = clean.split(/\s+/).filter(Boolean)
  const out: string[] = []
  if (words.length >= 2) out.push(words.join(''))
  const initials = words.map((w) => w.match(/\p{L}/u)?.[0] ?? '').join('').toUpperCase()
  if (words.length >= 3 && initials.length >= 3) out.push(initials)
  const seen = new Set([clean.toLowerCase()])
  return out.filter((v) => !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase())).slice(0, 3)
}

/** Six newest-first queries (where a cheat release shows up first) and two by relevance (the ones with lasting reach),
    then up to two name-variant queries (mixed sorts), 10 at most. */
export function buildQueries(clean: string): PlannedQuery[] {
  const date = ['script', 'hack', 'auto farm', 'dupe', 'executor no key', 'mod menu'].map((w) => ({ q: `${clean} ${w} roblox`, sort: 'date' as const }))
  const rel = ['script hack exploit', 'exploit god mode tp'].map((w) => ({ q: `${clean} ${w} roblox`, sort: 'relevance' as const }))
  const variants = nameVariants(clean).map((v, i): PlannedQuery => (i % 2 === 0 ? { q: `${v} script roblox`, sort: 'date' } : { q: `${v} exploit roblox`, sort: 'relevance' }))
  const seen = new Set<string>()
  return [...date, ...rel, ...variants].filter((p) => !seen.has(p.q.toLowerCase()) && seen.add(p.q.toLowerCase())).slice(0, MAX_QUERIES)
}

/* ---- sanitising ---- */

/* Executor, injector and bypass-tool names. Matching is by whole word, case-insensitive. The names below are real
   words in English too (delta, wave, swift, ...), so those are only denied next to a tool word. Maintain this list. */
const DENY_NAMES = [
  'synapse', 'krnl', 'fluxus', 'solara', 'xeno', 'jjsploit', 'wearedevs', 'scriptware', 'script-ware', 'arceus', 'macsploit',
  'evon', 'nihon', 'seliware', 'ronix', 'nezur', 'sirhurt', 'valex', 'comet', 'vegax', 'vega x', 'hydrogen', 'oxygen u', 'trigon',
  'bunni', 'zorara', 'awp', 'celery', 'cryptic', 'electron', 'codex', 'potassium', 'volcano', 'velocity', 'swift', 'wave', 'delta',
  'argon', 'sentinel', 'madium', 'luna', 'visual', 'cheat engine', 'cheatengine', 'bloxstrap', 'ronin', 'nexus',
]
/* Names that are ordinary English words: only denied beside an executor-ish word. */
const AMBIGUOUS = new Set(['electron', 'codex', 'potassium', 'volcano', 'velocity', 'swift', 'wave', 'delta', 'argon', 'sentinel', 'luna', 'visual', 'comet', 'ronin', 'nexus', 'oxygen u', 'hydrogen', 'cryptic'])
const TOOLISH = '(?:executor|exploit|injector|loader|ios|android|mobile|pc|apk|download|free|v\\d+|x|key)'
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const strong = DENY_NAMES.filter((w) => !AMBIGUOUS.has(w)).map(esc).join('|')
const weak = [...AMBIGUOUS].map(esc).join('|')
const DENY_RE = new RegExp(
  `\\b(?:${strong})\\b|\\b(?:${weak})\\s+${TOOLISH}\\b|\\b${TOOLISH}\\s+(?:${weak})\\b|\\b(?:loadstring|getgenv|getrenv|hookfunction|setclipboard|pastebin|linkvertise|mediafire|lootlabs|work\\.ink|workink|injector|loader)\\b`,
  'i',
)
const URL_RE = /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|gg|xyz|to|me|ly|cc|app|dev|ru|tv|co|link|site|top|club|vip)\b/i
const STEPS_RE = /\bstep\s*\d|\bstep[- ]by[- ]step\b|\b(?:first|then|next),?\s+(?:paste|copy|download|open the executor|inject|run the script)\b/i
const CODE_RE = /```|~~~|`|<script|\bfunction\s*\(|\blocal\s+\w+\s*=|\bgame:GetService|\bFireServer\s*\(|\bInvokeServer\s*\(|=>|;\s*$/m

export type GuardFailure = 'url' | 'code' | 'denylist' | 'steps' | 'shape'

/** What a brief field may never contain. Returns the first rule it breaks, or null when clean. */
export function guardText(text: string): GuardFailure | null {
  if (URL_RE.test(text)) return 'url'
  if (CODE_RE.test(text)) return 'code'
  if (DENY_RE.test(text)) return 'denylist'
  if (STEPS_RE.test(text)) return 'steps'
  return null
}

/** Remove what must not travel: URLs, long code-like runs and denied names, from untrusted text before it is sent to a model. */
export function scrubUntrusted(text: string, max: number): string {
  return text
    .replace(/https?:\/\/\S+|\bwww\.\S+/gi, ' ')
    .replace(/\b\S+\.(?:com|net|org|io|gg|xyz|to|me|ly|cc|app|dev|ru|tv|co|link|site)\S*/gi, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(new RegExp(DENY_RE.source, 'gi'), '...')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Tidy model prose for the product's copy rules: no em dashes, no middle dots, no emoji, one line. */
export function tidyProse(text: string): string {
  return text
    .replace(EMOJI, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*[\u00B7•]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function slug(s: string): string {
  return normalize(s).replace(/ /g, '-').slice(0, 48) || 'general'
}

/* ---- classes ---- */

export const CLASSES: HackClass[] = ['remote abuse', 'auto-farm', 'dupe', 'speed/teleport', 'esp/aimbot', 'currency/item spawn', 'other']

export const classSlug = (c: HackClass): string => c.replace('/', '-').replace(/ /g, '-')

export interface ClassTemplate {
  observed: (system: string) => string
  cause: string
  fix: string
}

/* Class-level fallback used when a model brief fails the guardrail check twice. Written to be true of the class in general,
   and says so; it names no tool and carries no instructions. */
export const CLASS_TEMPLATES: Record<HackClass, ClassTemplate> = {
  'remote abuse': {
    observed: (s) => `Videos advertise cheats that trigger ${s} actions directly instead of playing normally, which usually means calling the game's own server remotes with values it should not accept.`,
    cause: 'Hypothesis: a RemoteEvent or RemoteFunction handler trusts what the client sends (an item id, an amount, a target, a position) and applies it without checking who may do it, when, or how often.',
    fix: 'Treat every RemoteEvent and RemoteFunction argument as untrusted. On the server, check the argument types and ranges, that the player owns or is allowed to use the target, that they are close enough to it, and that a per-player cooldown and rate limit have passed. Keep the authoritative state on the server and have the client only request actions.',
  },
  'auto-farm': {
    observed: (s) => `Videos advertise automation that repeats ${s} actions without a player at the controls and collects the rewards.`,
    cause: 'Hypothesis: the server grants rewards for requests that arrive with no proof of real play, so a script can send them in a loop faster or longer than a person could, or from far away.',
    fix: 'Validate on the server that the player is physically near the objective (distance check against the server-side position) and that the action is possible now. Add cooldowns and a per-player rate limit on the RemoteEvent, cap rewards per minute, and flag accounts whose gains are far above the median for session time.',
  },
  dupe: {
    observed: (s) => `Videos advertise duplicating items or currency through ${s}, which is the most damaging kind of claim for a game economy.`,
    cause: 'Hypothesis: a trade, save or purchase path updates inventory and data in more than one step without a lock, so two overlapping requests are both honoured, or the client can resend a request the server already counted.',
    fix: 'Make every item and currency change a single atomic server-side transaction. Use a per-player lock or session lock around trades and saves, reject a request that is already in flight, key each transaction with a unique id so a replay is ignored, and log inventory totals so impossible jumps can be found and rolled back.',
  },
  'speed/teleport': {
    observed: (s) => `Videos advertise moving faster than normal or jumping across the map around ${s}.`,
    cause: 'Hypothesis: the client owns the character, so its position and speed are accepted as sent, and the server does not compare them with what is possible.',
    fix: 'Check player movement on the server: compare each position update with the last one against the maximum speed, reject or reset impossible jumps, and gate teleports and area entry behind server-side conditions. Where gameplay allows, set network ownership of important parts to the server.',
  },
  'esp/aimbot': {
    observed: (s) => `Videos advertise seeing other players or hidden things, or aiming automatically, in ${s}.`,
    cause: 'Hypothesis: the server replicates more than each client needs (hidden objects and other players are sent to everyone), and hit or aim checks are decided by the client.',
    fix: 'Do not replicate information a player should not have: stream or hide distant and hidden objects, and keep secrets on the server. Decide hits and damage on the server, with line of sight and rate checks, and treat client-reported aim or hits as claims to verify.',
  },
  'currency/item spawn': {
    observed: (s) => `Videos advertise giving yourself money, items or pets in ${s} without earning them.`,
    cause: 'Hypothesis: a server handler creates currency or items from a request the client controls, or a purchase or reward path does not check that the condition was met.',
    fix: 'Only the server may create currency or items. Validate every grant request against server-side state (did the player earn it, own the product, pass the cooldown), ignore any amount or item id the client supplies, and write grants through one audited function that logs who received what and why.',
  },
  other: {
    observed: (s) => `Videos advertise cheats for ${s} that the titles do not describe more precisely.`,
    cause: 'Hypothesis: some game logic lives on the client or in a RemoteEvent that trusts the client, so the cheat can change the outcome.',
    fix: 'Review the RemoteEvents and RemoteFunctions that touch this system. Validate arguments, ownership, distance and cooldowns on the server, and keep the authoritative game state there rather than on the client.',
  },
}
