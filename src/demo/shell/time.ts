/* Small, honest time phrases for the daemon bar and the history menu. All inputs are ISO strings from the server. */

/** "just now", "5 min ago", "2 h ago", "3 days ago". */
export function ago(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'at an unknown time'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.floor(h / 24)} days ago`
}

/** "11h 42m", "42m", "less than a minute", or "due now" once the time has passed. */
export function until(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms)) return 'at an unknown time'
  if (ms <= 0) return 'due now'
  const totalMin = Math.ceil(ms / 60_000)
  if (totalMin < 1) return 'less than a minute'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h ${String(m).padStart(2, '0')}m`
}

/** "Oct 27, 2:41 PM" for the history list, where an exact moment helps. */
export function stamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
