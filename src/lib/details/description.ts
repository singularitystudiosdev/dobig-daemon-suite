import type { Segment } from '../runTypes'

/* Detail payload for one description draft. Owned by the Description Daemon.
   Both the server analyzer (server/tools/description.ts) and the client detail view
   (src/demo/findings/details/description.tsx) import it. JSON-serialisable: types and plain data only.

   Every number in here was counted or computed from real data in the run that produced it. There is no predicted
   lift, click-through or any other modelled metric. Offsets are UTF-16 code unit offsets into the draft text, so
   `text.slice(start, end)` is exactly the flagged span. */

export type DescriptionVariant = 'A' | 'B' | 'C'

/** One span of the draft that a lint check flagged. */
export interface DescriptionLintFlag {
  start: number
  end: number
  /** The exact flagged text, `text.slice(start, end)`. */
  text: string
  /** Why this span was flagged, in one short sentence. */
  reason: string
}

export interface DescriptionLintCheck {
  id: string
  title: string
  passed: boolean
  /** What was tested and what was found, in one sentence. */
  reason: string
  /** A failed blocking check stops "Publish to Roblox"; a failed advisory check only lowers the lint score. */
  blocking: boolean
  flags: DescriptionLintFlag[]
}

export interface DescriptionDiffPart {
  text: string
  kind: 'same' | 'added' | 'removed'
}

export interface DescriptionDetail {
  kind: 'description'
  /** The daemon's iteration that wrote this draft (1 on the first run). */
  iteration: number
  variant: DescriptionVariant
  /** The draft, split into runs; spans a lint check flagged carry `struck: true`. */
  text: Segment[]
  chars: number
  /** Roblox's description limit in characters, as verified for this build. */
  limit: number
  /** One line from the model: what changed against the live copy and why. */
  whatChanged: string
  lint: DescriptionLintCheck[]
  lintScore: { passed: number; total: number }
  /** True when a blocking check failed: the draft cannot be published from here. */
  blocked: boolean
  /** Claims in the draft that the live description and the game's facts do not support. Suggestions to confirm. */
  unverifiedClaims: string[]
  /** Word-level diff, live description to this draft. */
  diffAgainstLive: DescriptionDiffPart[]
  liveText: string
  /** Real games whose descriptions were read for phrasing patterns (never copied: see `guard`). */
  competitorsUsed: { name: string; url: string }[]
  /** The similarity guard: no 7-word phrase of this draft appears in any competitor description. */
  guard: { competitorsChecked: number; sharedPhrases: number; attempts: number }
  universeId: number
}
