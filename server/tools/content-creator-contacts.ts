/* Public contact reading for the Content Creator Daemon. An email is returned only when it appears verbatim in the text it was
   given (the creator's channel description or About text); nothing is guessed, built from a name or a pattern, or read
   from behind a sign-in. The caller says which text it was, so the view can show where the address came from. */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const BUSINESS_RE = /business|inquir|enquir|sponsor|partnership|collab|contact|e-?mail|management|promo/i
const FILE_EXT = /\.(?:png|jpe?g|gif|webp|svg|mp4|css|js)$/i

export interface PublicContact {
  email: string | null
  /** "the channel About text" or "the channel description"; null when no address was found. */
  source: string | null
  /** The line that holds the address, links removed, at most 160 characters. */
  excerpt: string | null
}

export interface ContactText {
  /** Where this text appears on YouTube, in words. */
  where: string
  text: string
}

const clean = (s: string): string => s.replace(/https?:\/\/\S+|\bwww\.\S+/gi, '').replace(/\s+/g, ' ').trim()

/** The first address that appears verbatim in one of the texts, preferring a line that talks about business or sponsors. */
export function findPublicContact(texts: ContactText[]): PublicContact {
  let best: { email: string; where: string; excerpt: string; score: number } | null = null
  for (const { where, text } of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const emails = (raw.match(EMAIL_RE) ?? []).filter((e) => !FILE_EXT.test(e))
      if (emails.length === 0) continue
      const line = clean(raw)
      const score = BUSINESS_RE.test(raw) ? 2 : 1
      if (!best || score > best.score) best = { email: emails[0], where, excerpt: line.length > 160 ? `${line.slice(0, 157)}...` : line, score }
    }
  }
  return best ? { email: best.email, source: best.where, excerpt: best.excerpt } : { email: null, source: null, excerpt: null }
}
