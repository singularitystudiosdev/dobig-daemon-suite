/* Number and time formatting. Compact numbers follow dobig.com: 9.6B, 432.4M, 2B. */

/** The demo clock. Mock records are dated relative to this instant so relative times are stable. */
export const DEMO_NOW = new Date('2026-10-26T15:00:00-06:00')

export function fmtInt(n: number) {
  return Math.round(n).toLocaleString('en-US')
}

export function fmtCompact(n: number, digits = 1) {
  const abs = Math.abs(n)
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [value, unit] of units) {
    if (abs >= value) {
      const x = n / value
      return x.toFixed(Math.abs(x) >= 100 ? 0 : digits).replace(/\.0+$/, '') + unit
    }
  }
  return fmtInt(n)
}

/** Ratio to percent: 0.0412 becomes "4.1%". */
export function fmtPct(ratio: number, digits = 1) {
  return `${(ratio * 100).toFixed(digits)}%`
}

/** Signed ratio to percent: 0.112 becomes "+11.2%". */
export function fmtSignedPct(ratio: number, digits = 1) {
  const v = (ratio * 100).toFixed(digits)
  return ratio >= 0 ? `+${v}%` : `${v}%`
}

/** Percentage points: 0.41 becomes "+0.41pp". */
export function fmtPp(pp: number, digits = 2) {
  return `${pp >= 0 ? '+' : ''}${pp.toFixed(digits)}pp`
}

export function fmtUsd(n: number) {
  return '$' + fmtCompact(n)
}

export function fmtUsdRange(lo: number, hi: number) {
  return `${fmtUsd(lo)} to ${fmtUsd(hi)}`
}

/** 134000 ms becomes "2m 14s". */
export function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

/** Run clock: 14230 ms becomes "00:14.2". */
export function fmtClock(ms: number) {
  const total = Math.max(0, ms) / 1000
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

/** Seconds of video or session length: 852 becomes "14:12". */
export function fmtMinSec(seconds: number) {
  const m = Math.floor(seconds / 60)
  return `${m}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

export function timeAgo(iso: string | Date, now: Date = DEMO_NOW) {
  const then = typeof iso === 'string' ? new Date(iso) : iso
  const mins = Math.round((now.getTime() - then.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/** "2026-10-22T17:00" style ISO to "Oct 22". */
export function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "Oct 22, 17:04". */
export function fmtDayTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Log timestamp from a run offset: base time plus ms, "14:02:07.310". */
export function fmtLogTime(offsetMs: number, base: Date = DEMO_NOW) {
  const d = new Date(base.getTime() + offsetMs)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export function clamp(n: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, n))
}

/** Linear interpolation between a and b by p (0..1). */
export function lerp(a: number, b: number, p: number) {
  return a + (b - a) * clamp(p)
}

/** Ease-out cubic for scripted values driven by a 0..1 progress. */
export function easeOut(p: number) {
  return 1 - Math.pow(1 - clamp(p), 3)
}
