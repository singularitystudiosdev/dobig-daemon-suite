import type { Game } from '@/data/games'
import { fmtInt } from '@/lib/format'
import { buildDataset, buildVariants, LINT_RULES, type CopyVariant, type DescriptionDataset } from '@/tools/description-daemon/data'
import type { Finding, FindingsModel } from '../types'
import { clipSegments, plain, ramp, strikeSpans } from './shared'

const RULE_ORDER = LINT_RULES.map((r) => r.rule)

/** Predicted play-through lift in pp as a [lo, mid, hi] interval; null where no test is possible. */
function liftOf(v: CopyVariant, ds: DescriptionDataset): { lo: number; mid: number; hi: number } | null {
  if (v.status === 'blocked') return null
  if (v.id === 'v-a') return { lo: 0, mid: 0, hi: 0 }
  return { lo: ds.test.ci95[0], mid: ds.test.deltaPp, hi: ds.test.ci95[1] }
}

const fmtSigned = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`

/** Drafts ranked by predicted lift; blocked drafts rank last. Variant A is the live description. */
export function descriptionFindings(ds: DescriptionDataset): Finding[] {
  const ranked = ds.variants
    .map((v) => ({ v, lift: liftOf(v, ds) }))
    .sort((a, b) => Number(!!b.lift) - Number(!!a.lift) || (b.lift?.mid ?? 0) - (a.lift?.mid ?? 0))
  return ranked.map(({ v, lift }, i) => {
    const blocked = v.status === 'blocked'
    const live = v.id === 'v-a'
    const text = strikeSpans(v.description, v.lint.map((l) => l.span))
    const hit = new Set(v.lint.map((l) => l.rule))
    return {
      id: v.id,
      badge: blocked ? { label: 'Blocked by policy lint', tone: 'danger' } : { label: `Rank ${i + 1}`, tone: live ? 'muted' : 'accent' },
      title: `${v.displayName}${live ? ', the live description' : blocked ? ', held back' : ', restructured draft'}`,
      snippet: clipSegments(text, 150),
      meta: [
        { label: 'Predicted lift', value: lift ? (live ? '0.00pp, control' : `${fmtSigned(lift.lo)} to ${fmtSigned(lift.hi)}pp`) : 'Not tested' },
        { label: 'Lint', value: blocked ? `${hit.size} of 3 rules hit` : '3 of 3 passed' },
        { label: 'Length', value: `${fmtInt(v.description.length)} chars` },
      ],
      status: live ? { label: 'Live', tone: 'live' } : blocked ? { label: 'Not publishable', tone: 'danger' } : { label: 'Ready to test', tone: 'accent' },
      detail: {
        kind: 'description',
        variant: v.displayName,
        text,
        chars: v.description.length,
        lint: RULE_ORDER.map((rule) => {
          const def = LINT_RULES.find((r) => r.rule === rule)!
          return { title: def.title, passed: !hit.has(rule), flags: def.flags }
        }),
        lift,
        baseline: ds.test.baselineValue,
        live,
        blocked,
      },
    } satisfies Finding
  })
}

export function descriptionModel(game: Game): FindingsModel {
  const ds = buildDataset(game)
  const findings = descriptionFindings(ds)
  const live = buildVariants(game)[0].description
  const words = live.split(/\s+/).filter(Boolean).length
  const blocked = ds.variants.filter((v) => v.status === 'blocked').length
  const b = findings.find((f) => f.detail.kind === 'description' && f.detail.lift && !f.detail.live)
  const lo = b?.detail.kind === 'description' && b.detail.lift ? b.detail.lift.lo : 0
  const hi = b?.detail.kind === 'description' && b.detail.lift ? b.detail.lift.hi : 0
  return {
    findings,
    sortLabel: 'Sorted by predicted lift',
    steps: [
      () => `${fmtInt(live.length)} characters, ${fmtInt(words)} words, one control`,
      (p) => `${Math.max(1, Math.ceil(3 * p))} of 3 variants drafted, one change at a time`,
      (p) => `${ramp(3, p)} of 3 variants linted, ${p > 0.7 ? blocked : 0} blocked by policy`,
      (p) => (p < 0.5 ? 'Comparing against a 28 day baseline' : `Interval ${fmtSigned(lo * p)} to ${fmtSigned(hi * p)}pp for the best draft`),
    ],
    summary: () => ({
      items: [
        { label: 'Baseline play-through', value: `${ds.test.baselineValue.toFixed(2)}%` },
        { label: 'Drafts', value: '3' },
        { label: 'Blocked by lint', value: String(blocked), tone: blocked ? 'danger' : 'live' },
        { label: 'Test length', value: `${ds.daysHeld} days` },
      ],
      note: 'Sequential before-and-after test: Roblox has no native description A/B. Lifts are modelled intervals, not promises.',
    }),
    notices: [],
  }
}
