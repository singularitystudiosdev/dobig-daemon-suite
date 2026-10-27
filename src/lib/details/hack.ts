/* Detail payload for one hack finding (one cluster of exploit-promo videos on one game system).
   Imported by the analyzer (server/tools/hack.ts) and the client view (src/demo/findings/details/hack.tsx), so this
   file has no imports and stays JSON-serialisable. The severity rule lives here, once, and the view prints it. */

export type HackClass = 'remote abuse' | 'auto-farm' | 'dupe' | 'speed/teleport' | 'esp/aimbot' | 'currency/item spawn' | 'other'

export type HackSeverity = 'CRIT' | 'HIGH' | 'MED' | 'LOW'

export interface HackVideo {
  id: string
  /** Always https://www.youtube.com/watch?v=<id>. */
  url: string
  title: string
  channel: string | null
  /** https://www.youtube.com/channel/<id>, or null when YouTube did not give a channel id. */
  channelId?: string | null
  channelUrl: string | null
  views: number | null
  /** What YouTube shows, e.g. "3 days ago". */
  publishedText: string | null
  /** ISO. Exact when the watch page was read, otherwise the relative text resolved against the run time (approximate). */
  publishedAt: string | null
  /** True when the watch page was read and gave an exact date and view count. */
  exact?: boolean
  /** YouTube's own "includes paid promotion" label, when the watch page was read. */
  paidPromotion?: boolean
}

export interface HackDetail {
  kind: 'hack'
  cls: HackClass
  system: string
  severity: HackSeverity
  severityReason: string
  observed: string
  cause: string
  fix: string
  /** 0 to 1: mean of the classifier's per-video confidence over this cluster. */
  confidence: number
  /** Earliest and latest publish time among the cluster's videos (ISO), inside the search window. */
  firstSeen: string | null
  latestSeen: string | null
  totalViews: number
  /** Views of the cluster's videos published in the 14 days before the run. */
  views14d: number
  videos: HackVideo[]
  /** Video ids not seen by an earlier run of this daemon. On the first run, every video. */
  newVideoIds: string[]
  firstRun: boolean
  /** 'model' when the brief came from the LLM and passed the guardrail check, 'class-template' when it fell back. */
  briefSource: 'model' | 'class-template'
}

/* ---- the severity rule: deterministic, shown in the UI ---- */

export const SEVERITY_RULES: { severity: HackSeverity; rule: string }[] = [
  { severity: 'CRIT', rule: 'The class is dupe or currency/item spawn. Those mint value, so they are critical at any reach.' },
  { severity: 'HIGH', rule: 'Remote abuse or auto-farm with more than 100,000 views over the last 14 days, or any class with more than 500,000 views over the last 14 days.' },
  { severity: 'MED', rule: 'Any other cluster with 10,000 or more views over the last 14 days, 3 or more videos in the last 14 days, or 100,000 or more views in total.' },
  { severity: 'LOW', rule: 'Everything else: small reach or no recent videos.' },
]

export interface SeverityInput {
  cls: HackClass
  totalViews: number
  views14d: number
  videos14d: number
}

const n = (v: number) => Math.round(v).toLocaleString('en-US')

export function rateSeverity(i: SeverityInput): { severity: HackSeverity; reason: string } {
  if (i.cls === 'dupe' || i.cls === 'currency/item spawn') {
    return { severity: 'CRIT', reason: `CRIT: the class is ${i.cls}, which mints value, so it is critical whatever the reach (${n(i.totalViews)} views in total).` }
  }
  if ((i.cls === 'remote abuse' || i.cls === 'auto-farm') && i.views14d > 100_000) {
    return { severity: 'HIGH', reason: `HIGH: ${i.cls} with ${n(i.views14d)} views over the last 14 days (the rule is more than 100,000).` }
  }
  if (i.views14d > 500_000) {
    return { severity: 'HIGH', reason: `HIGH: ${n(i.views14d)} views over the last 14 days (the rule is more than 500,000 for any class).` }
  }
  if (i.views14d >= 10_000 || i.videos14d >= 3 || i.totalViews >= 100_000) {
    const why =
      i.views14d >= 10_000
        ? `${n(i.views14d)} views over the last 14 days`
        : i.videos14d >= 3
          ? `${i.videos14d} videos in the last 14 days`
          : `${n(i.totalViews)} views in total`
    return { severity: 'MED', reason: `MED: ${why}, below the HIGH thresholds.` }
  }
  return { severity: 'LOW', reason: `LOW: ${n(i.views14d)} views over the last 14 days from ${i.videos14d} recent ${i.videos14d === 1 ? 'video' : 'videos'}, ${n(i.totalViews)} in total.` }
}
