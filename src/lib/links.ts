/* Client-side pre-check for a pasted Roblox game link, before any request is made.
   Accepts roblox.com/games/<id>, locale prefixes (roblox.com/de/games/<id>), games/start?placeId=<id>
   and a bare numeric place id. The server does the real resolve; this only rejects obvious garbage. */

export type LinkCheck = { ok: true; value: string } | { ok: false; message: string }

export const LINK_EXAMPLE = 'https://www.roblox.com/games/920587237'
const FIX = `Paste a roblox.com/games link or a place id, for example ${LINK_EXAMPLE}.`

export function checkGameLink(raw: string): LinkCheck {
  const text = raw.trim()
  if (!text) return { ok: false, message: `Enter a game link first. ${FIX}` }
  if (/^\d{3,15}$/.test(text)) return { ok: true, value: text }

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return { ok: false, message: `That does not look like a link. ${FIX}` }
  }
  const host = url.hostname.toLowerCase()
  if (host !== 'roblox.com' && !host.endsWith('.roblox.com')) {
    return { ok: false, message: `That link is not on roblox.com. ${FIX}` }
  }
  const path = url.pathname.replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  const gamesAt = parts.indexOf('games')
  if (gamesAt === -1 || gamesAt > 1) return { ok: false, message: `That is a Roblox page, but not a game page. ${FIX}` }
  const next = parts[gamesAt + 1]
  if (next === 'start') {
    const place = url.searchParams.get('placeId')
    if (place && /^\d{3,15}$/.test(place)) return { ok: true, value: url.toString() }
    return { ok: false, message: 'This games/start link has no placeId. Copy the link from the game page instead.' }
  }
  if (next && /^\d{3,15}$/.test(next)) return { ok: true, value: url.toString() }
  return { ok: false, message: `The link has no game id after /games/. ${FIX}` }
}
