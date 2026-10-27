/* Text evidence for the DMCA Daemon: name similarity, description similarity, shared phrases, and the notice draft.
   Everything here is plain arithmetic on the strings Roblox returned. */

export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokens(text: string): string[] {
  const n = normalise(text)
  return n ? n.split(' ') : []
}

export function squash(text: string): string {
  return normalise(text).replace(/\s+/g, '')
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

export function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  return max === 0 ? 0 : 1 - levenshtein(a, b) / max
}

/** Name similarity, 0 to 1: the mean of the token Jaccard and the Levenshtein ratio of the squashed names.
 *  Names that differ only in spaces, case or punctuation are 1. */
export function nameSimilarity(a: string, b: string): number {
  const sa = squash(a)
  const sb = squash(b)
  if (!sa || !sb) return 0
  if (sa === sb) return 1
  const jac = jaccard(new Set(tokens(a)), new Set(tokens(b)))
  return (jac + levenshteinRatio(sa, sb)) / 2
}

const SHINGLE = 5

function shingles(words: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i + SHINGLE <= words.length; i++) out.push(words.slice(i, i + SHINGLE).join(' '))
  return out
}

/** Description similarity, 0 to 1: Jaccard of the 5-word shingles. A description under 5 words has no shingles (0). */
export function descriptionSimilarity(a: string, b: string): number {
  return jaccard(new Set(shingles(tokens(a))), new Set(shingles(tokens(b))))
}

/** Up to `limit` real overlapping phrases: consecutive shared 5-word shingles are merged into one longer phrase. */
export function sharedPhrases(a: string, b: string, limit = 4): string[] {
  const wa = tokens(a)
  const wb = new Set(shingles(tokens(b)))
  const phrases: string[] = []
  let run: string[] = []
  for (let i = 0; i + SHINGLE <= wa.length; i++) {
    if (wb.has(wa.slice(i, i + SHINGLE).join(' '))) {
      run = run.length ? [...run, wa[i + SHINGLE - 1]] : wa.slice(i, i + SHINGLE)
    } else if (run.length) {
      phrases.push(run.join(' '))
      run = []
    }
  }
  if (run.length) phrases.push(run.join(' '))
  return [...new Set(phrases)].sort((x, y) => y.length - x.length).slice(0, limit)
}

/** The first non-empty line of a description with emoji and symbols removed, capped for use as a search query. */
export function firstLine(description: string): string {
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.replace(/[^\p{L}\p{N}\s'!?.,&-]+/gu, ' ').replace(/\s+/g, ' ').trim()
    if (line.length >= 6) return line.slice(0, 70)
  }
  return ''
}

const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'is', 'my', 'your', 'by', 'at', 'it', 'new', 'game'])

export const isStopWord = (w: string): boolean => STOP.has(w)

/** The words of a name that carry its identity (stop words dropped). */
export function distinctiveWords(name: string): string[] {
  return tokens(name).filter((w) => !STOP.has(w) && w.length > 1)
}

/** Collapses whitespace and cuts at a word boundary. */
export function excerpt(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trimEnd() + '...'
}

/** Model text is shown as typed by a model: keep it to one plain sentence with no em dashes or middle dots. */
export function cleanModelText(text: string, max = 300): string {
  const t = text.replace(/\s+/g, ' ').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\u00B7/g, ',').trim()
  return t.length <= max ? t : excerpt(t, max)
}

export interface NoticeFields {
  ownName: string
  ownUrl: string
  theirName: string
  theirUrl: string
  theirCreatorName: string
  theirCreatorUrl: string
  evidence: string
  checkedISO: string
}

/** A draft takedown notice that lists the 17 U.S.C. 512(c)(3)(A) elements. The facts come from this run; the owner's
 *  identity, belief and sworn statements are placeholders the owner must complete. Nothing is invented. */
export function buildNotice(f: NoticeFields): string {
  return [
    'DRAFT ONLY. DMCA Daemon has not filed this and cannot. Complete every [BRACKETED] item yourself, then file it in Roblox Creator Hub under Intellectual Property.',
    '',
    'Notice of claimed infringement under 17 U.S.C. 512(c)(3)',
    '',
    `1. Copyrighted work: ${f.ownName}, ${f.ownUrl}`,
    '   [Describe which of your assets or works are protected and that you own or may act for the owner. Only you can state this.]',
    '',
    `2. Material claimed to infringe, and where to find it: ${f.theirName}, ${f.theirUrl}`,
    `   Creator shown by Roblox: ${f.theirCreatorName} (${f.theirCreatorUrl})`,
    `   What the automated comparison found on ${f.checkedISO}: ${f.evidence}`,
    '   [Add what you personally verified in the game, and the exact assets copied. A match score alone is not proof of copying.]',
    '',
    '3. Contact information of the complaining party: [YOUR FULL NAME, POSTAL ADDRESS, EMAIL, PHONE]',
    '',
    '4. Good-faith statement: [YOUR STATEMENT that you have a good faith belief the use described above is not authorized by the copyright owner, its agent, or the law. Write this only if you hold that belief.]',
    '',
    '5. Accuracy and authority statement: [YOUR STATEMENT that the information in this notice is accurate and, under penalty of perjury, that you are the owner of the exclusive right allegedly infringed or are authorized to act on the owner\'s behalf.]',
    '',
    '6. Signature: [YOUR PHYSICAL OR ELECTRONIC SIGNATURE: your full legal name]',
    '',
    'Reminder: under 17 U.S.C. 512(f), a person who knowingly materially misrepresents that material is infringing is liable for the resulting damages, including costs and attorneys\' fees.',
  ].join('\n')
}
