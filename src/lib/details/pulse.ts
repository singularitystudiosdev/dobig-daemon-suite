/* Detail payload for one pulse finding (one vital of a game). Imported by the analyzer (server/tools/pulse.ts) and the
   client view (src/demo/findings/details/pulse.tsx), so this file has no imports and stays JSON-serialisable. */

export type PulseVital = 'players' | 'likes' | 'fps' | 'ping' | 'fill' | 'update'

/** Regressed and Improved come from a stated rule; First read means there is no earlier reading to compare with. */
export type PulseState = 'regressed' | 'improved' | 'steady' | 'first'

export interface PulseFigure {
  label: string
  value: string
  /** The same figure at the previous reading, or null when there is none. */
  before: string | null
}

export interface PulsePoint {
  /** ISO time of the reading. */
  t: string
  /** The number this vital plots, or null when that reading could not measure it. */
  v: number | null
}

export interface PulseDetail {
  kind: 'pulse'
  vital: PulseVital
  state: PulseState
  gameName: string
  /** ISO time the public data was read. */
  fetchedAt: string
  /** ISO time of the previous reading, or null on the first read. */
  previousAt: string | null
  /** The headline value now and at the previous reading, as shown in the row. */
  now: string
  before: string | null
  change: string
  /** The rule that flags this vital, in words with its threshold. */
  rule: string
  /** What the rule said on this run, with the numbers and the time gap. */
  verdict: string
  /** When the game was updated after the previous reading: "updated 3 hours ago". Otherwise null. */
  updatedNote: string | null
  figures: PulseFigure[]
  /** Server vitals only: how many public servers the numbers come from. */
  sample: { servers: number; fullest: number; emptiest: number } | null
  /** What the plotted number is, e.g. "Median server fps". */
  historyLabel: string
  /** Stored readings, oldest first, the current one last (at most 12). */
  history: PulsePoint[]
  /** Unit appended to the plotted numbers: "%", " fps", " ms", "". */
  unit: string
  /** One or two plain sentences on what to check. Never claims a cause. */
  check: string
}
