import type { Game } from '@/data/games'
import { fmtDayTime, fmtInt } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import { ATTESTATION, buildDataset, LINK_CAP, TOTALS, type Candidate, type Dataset } from '@/tools/dmca-daemon/data'
import type { Chip, Finding, FindingsModel } from '../types'
import { plain, ramp } from './shared'

type Level = 'CRIT' | 'HIGH' | 'MED' | 'LOW'
const LEVEL_ORDER: Record<Level, number> = { CRIT: 0, HIGH: 1, MED: 2, LOW: 3 }
const LEVEL_BADGE: Record<Level, { label: string; tone: Tone }> = {
  CRIT: { label: 'Exact match', tone: 'danger' },
  HIGH: { label: 'High similarity', tone: 'warn' },
  MED: { label: 'Lower similarity', tone: 'accent' },
  LOW: { label: 'Licensed', tone: 'muted' },
}

/** Perceptual matches at or above this similarity read as high. Modelled, not a legal threshold. */
const HIGH_SIMILARITY = 0.9

function levelOf(c: Candidate): Level {
  if (c.lane === 'auto-file') return 'CRIT'
  if (c.lane === 'cleared') return 'LOW'
  return (c.similarity ?? 0) >= HIGH_SIMILARITY ? 'HIGH' : 'MED'
}

const hashType = (c: Candidate) => (c.match === 'exact' ? 'sha256, byte-identical' : c.kind === 'audio' ? 'Audio fingerprint, perceptual' : 'Perceptual hash (phash)')
const kindWord = (c: Candidate) => c.kind ?? 'asset'

const STATES: Record<string, Chip> = {
  filed: { label: 'Filed', tone: 'live' },
  dismissed: { label: 'Dismissed', tone: 'muted' },
}

/** Auto-file, then review by similarity, then cleared. */
export function dmcaFindings(ds: Dataset): Finding[] {
  const assetById = new Map(ds.assets.map((a) => [a.assetId, a]))
  const all = [...ds.auto, ...ds.review, ...ds.cleared]
  const sorted = all
    .map((c) => ({ c, level: levelOf(c) }))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (b.c.similarity ?? 1) - (a.c.similarity ?? 1) || a.c.detectedAt.localeCompare(b.c.detectedAt))
  return sorted.map(({ c, level }) => {
    const asset = c.matchedAssetId ? assetById.get(c.matchedAssetId) : undefined
    const lane = c.lane as 'auto-file' | 'review' | 'cleared'
    const simPct = c.similarity !== undefined ? `${Math.round(c.similarity * 100)}%` : '100%'
    const snippet =
      lane === 'auto-file'
        ? `By ${c.creator}. Byte-identical to ${asset?.name ?? 'a registered asset'} (${kindWord(c)}).`
        : lane === 'review'
          ? `By ${c.creator}. Looks like ${asset?.name ?? 'a registered asset'} (${kindWord(c)}), a person decides.`
          : `By ${c.creator}. ${c.licenseNote ?? 'Matches a licensed Creator Store asset.'}`
    const status: Chip = lane === 'auto-file' ? { label: 'Filed', tone: 'live' } : lane === 'review' ? { label: 'Awaiting review', tone: 'warn' } : { label: 'Cleared', tone: 'muted' }
    return {
      id: c.id,
      badge: LEVEL_BADGE[level],
      title: c.name,
      snippet: plain(snippet),
      meta: [
        { label: 'Asset', value: kindWord(c) },
        { label: 'Similarity', value: simPct },
        { label: 'Found via', value: c.source },
        { label: 'Detected', value: fmtDayTime(c.detectedAt) },
      ],
      status,
      states: lane === 'review' ? STATES : undefined,
      group: lane,
      detail: {
        kind: 'dmca',
        lane,
        assetName: asset?.name,
        assetId: c.matchedAssetId,
        assetKind: kindWord(c),
        hashType: hashType(c),
        similarity: c.similarity,
        evidence: c.evidenceUrl ?? (lane === 'review' ? 'Side-by-side comparison captured for the reviewer' : 'No evidence file: nothing is filed for licensed assets'),
        placeId: c.placeId,
        creator: c.creator,
        source: c.source,
        detectedAt: fmtDayTime(c.detectedAt),
        note: c.licenseNote,
      },
    } satisfies Finding
  })
}

export function dmcaModel(game: Game): FindingsModel {
  const ds = buildDataset(game)
  const findings = dmcaFindings(ds)
  const exact = ds.auto.length
  const review = ds.review.length
  const cleared = ds.cleared.length
  const requestA = ds.requests.find((r) => r.name === ds.requestA)
  return {
    findings,
    sortLabel: 'Sorted by severity',
    groups: [
      { id: 'auto-file', label: 'Exact match' },
      { id: 'review', label: 'Review' },
      { id: 'cleared', label: 'Cleared' },
    ],
    steps: [
      () => `${ds.assets.length} registered assets hashed with sha256 and perceptual hashes`,
      (p) => `${ramp(TOTALS.crawled, p)} of ${TOTALS.crawled} candidate experiences crawled`,
      (p) => `${ramp(exact, p)} exact, ${ramp(review + cleared, p)} perceptual matches found`,
      (p) => `${ramp(exact + review, p)} of ${exact + review} evidence captures saved`,
      (p) => `${ramp(exact, p)} to auto-file, ${ramp(review, p)} to review, ${ramp(cleared, p)} cleared`,
    ],
    summary: (states) => {
      const approved = Object.values(states).filter((s) => s === 'filed').length
      const dismissed = Object.values(states).filter((s) => s === 'dismissed').length
      const links = (requestA?.links ?? exact) + approved
      return {
        items: [
          { label: 'Links filed', value: `${fmtInt(links)} of ${LINK_CAP}` },
          { label: 'Request status', value: 'Pending', tone: 'warn' },
          { label: 'Awaiting review', value: fmtInt(review - approved - dismissed), tone: 'warn' },
          { label: 'Cleared as licensed', value: fmtInt(cleared) },
        ],
        note: `Request ${ds.requestA} was filed under ${ATTESTATION.short}'s standing attestation signed ${ATTESTATION.signedAt}. Approved lookalikes go on ${ds.requestR}, signed per item.`,
      }
    },
    notices: [
      {
        lead: 'A wrong takedown is a legal risk: 17 U.S.C. 512(f) penalises knowing misrepresentation.',
        body: 'Only exact sha256 matches file automatically, under the owner\'s standing good-faith attestation. Perceptual matches always go to a person, and licensed Creator Store assets are cleared.',
      },
    ],
  }
}
