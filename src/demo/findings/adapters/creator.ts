import type { Game } from '@/data/games'
import { fmtInt, fmtPct } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import { creatorsFor, fmtReach, isSponsored, sponsorDelta, sponsorHeadline, summaryLine, type Creator, type Grade } from '@/tools/creator-dox/data'
import type { Finding, FindingsModel } from '../types'
import { plain, ramp } from './shared'

const GRADE_TONE: Record<Grade, Tone> = { 'A++': 'live', 'A+': 'live', A: 'accent', 'B+': 'accent', B: 'warn', C: 'muted' }

/** Creators by partnership fit: CQS, then fit with this game. */
export function creatorFindings(creators: Creator[], game: Game): Finding[] {
  const sorted = creators.slice().sort((a, b) => b.dossier.cqs.total - a.dossier.cqs.total || (b.dossier.gameFitPct[game.id] ?? 0) - (a.dossier.gameFitPct[game.id] ?? 0))
  return sorted.map((c) => {
    const d = c.dossier
    const tunes = sponsorDelta(d) <= -0.25
    return {
      id: d.channelId,
      badge: { label: d.grade, tone: GRADE_TONE[d.grade] },
      title: d.handle,
      snippet: plain(summaryLine(c, game)),
      meta: [
        { label: 'Subscribers', value: fmtReach(d.subscribers) },
        { label: 'Engagement', value: `${fmtPct(d.erOrganic)} organic, ${fmtPct(d.erSponsored)} sponsored` },
        { label: 'Credibility', value: `${d.credibilityPct}%` },
      ],
      spark: { data: c.growth90, tone: 'accent', label: 'Subscriber growth over 90 days' },
      status: tunes ? { label: 'Tunes out ads', tone: 'warn' } : { label: 'Holds on ads', tone: 'live' },
      detail: {
        kind: 'creator',
        handle: d.handle,
        sponsorLine: sponsorHeadline(d),
        erOrganic: d.erOrganic,
        erSponsored: d.erSponsored,
        earnings: d.earningsRangeUsd,
        email: d.publicBusinessEmail,
        cqs: d.cqs,
        talking: c.talkingPoints.slice(0, 2),
      },
    } satisfies Finding
  })
}

export function creatorModel(game: Game): FindingsModel {
  const creators = creatorsFor(game)
  const findings = creatorFindings(creators, game)
  const k = creators.length
  const uploads = creators.reduce((a, c) => a + c.uploads.length, 0)
  const paid = creators.reduce((a, c) => a + c.uploads.filter(isSponsored).length, 0)
  return {
    findings,
    sortLabel: 'Sorted by partnership fit',
    steps: [
      (p) => `${fmtInt(ramp(uploads, p))} public videos read across ${k} channels`,
      (p) => `${ramp(k, p)} of ${k} channels with public statistics`,
      (p) => `${ramp(paid, p)} paid placements found in the last 48 uploads`,
      (p) => `${ramp(k, p)} of ${k} audiences scored for credibility`,
      (p) => `${ramp(k, p)} of ${k} creators ranked by quality score, then game fit`,
    ],
    notices: [],
  }
}
