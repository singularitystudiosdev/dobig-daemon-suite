import { useReducedMotion } from '@/lib/hooks'
import { clamp, lerp } from '@/lib/format'
import type { Simulation } from '@/lib/useSimulation'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui'
import { fmtSigned2, type DescriptionDataset } from './data'

/* The signature moment: the 28-day RFYPlayThroughRate band, seven daily hold reads, and the 95%
   interval for delta QPTR narrowing until its left edge passes zero. Every position, width and
   value is a pure function of sim.within('hold'), so pause, seek and replay are deterministic. */

const W = 920
const H = 292
const PAD_L = 48
const PAD_R = 16
const PAD_T = 26
const PLOT_H = 172
const PLOT_B = PAD_T + PLOT_H
const N = 35

export function HoldChart({ data, sim }: { data: DescriptionDataset; sim: Simulation }) {
  const reduced = useReducedMotion()
  const p = sim.within('hold') * 7
  const daysRead = Math.floor(p)
  const dayNumber = clamp(Math.ceil(p) || 1, 1, 7)
  const bandProgress = sim.within('baseline') * 28
  const drawn = clamp(Math.ceil(bandProgress), 0, 28)
  const [lo, hi] = ciAt(data.ci, p)
  const crossed = lo > 0

  const values = [...data.baseline.flatMap((b) => [b.low, b.high]), ...data.hold.map((h) => h.value), data.test.testValue]
  const yMin = Math.min(...values) - 0.14
  const yMax = Math.max(...values) + 0.2
  const span = Math.max(0.6, yMax - yMin)
  const x = (i: number) => PAD_L + (i / (N - 1)) * (W - PAD_L - PAD_R)
  const y = (v: number) => PLOT_B - ((v - yMin) / span) * PLOT_H

  const bandPoints = data.baseline.slice(0, Math.max(2, drawn))
  const ribbon = (() => {
    if (drawn < 2) return ''
    const top = bandPoints.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(b.high).toFixed(1)}`).join(' ')
    const bottom = bandPoints
      .slice()
      .reverse()
      .map((b, k) => {
        const idx = bandPoints.length - 1 - k
        return `L${x(idx).toFixed(1)} ${y(b.low).toFixed(1)}`
      })
      .join(' ')
    return `${top} ${bottom} Z`
  })()
  const meanLine = bandPoints.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(b.mean).toFixed(1)}`).join(' ')

  const thursday = data.hold[3]
  const showConfounder = p >= 3
  const saturdayIndex = data.baseline.reduce((best, b, i) => (b.weeklyPeak && (best < 0 || b.mean > data.baseline[best].mean) ? i : best), -1)
  const lastRead = data.hold[Math.max(0, daysRead - 1)]
  const deltaSoFar = data.test.deltaPp * clamp(p / 7)
  const yTicks = [yMin + span * 0.2, yMin + span * 0.55, yMin + span * 0.9]
  const axisLabels = [0, 6, 13, 20, 27, 34]

  const ciLoBound = Math.min(...data.ci.map((c) => c[0]), -0.2) - 0.08
  const ciHiBound = Math.max(...data.ci.map((c) => c[1]), 0.2) + 0.08
  const ciSpan = Math.max(0.5, ciHiBound - ciLoBound)
  const cx = (v: number) => PAD_L + ((v - ciLoBound) / ciSpan) * (W - PAD_L - PAD_R)
  const barX = cx(lo)
  const barW = Math.max(2, cx(hi) - barX)
  const zeroX = cx(0)

  return (
    <figure className="rounded-8 border border-line bg-sunken p-12" data-slot="hold-chart">
      <div className="flex flex-wrap items-center justify-between gap-8">
        <div className="flex flex-wrap items-center gap-8">
          <Badge tone={p >= 7 ? 'live' : 'accent'} dot pulse={p > 0 && p < 7}>
            Hold
          </Badge>
          <span className="text-label font-medium text-ink">Mon 19 to Sun 25</span>
          <span className="text-micro text-muted">one full weekly cycle</span>
        </div>
        <span className="tabular rounded-full bg-raised px-8 py-2 font-mono text-micro text-ink" aria-live="off">
          {sim.reached('hold') ? `day ${Math.min(dayNumber, 7)} of 7` : 'hold not started'}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="RFYPlayThroughRate: the 28-day baseline band from Sep 21 to Oct 18, seven daily hold reads from Oct 19 to Oct 25, a Thursday creator video confounder and the 95 percent interval for delta QPTR"
        className="mt-8 block w-full"
      >
        <defs>
          <clipPath id="hold-chart-clip">
            <rect x={PAD_L} y={PAD_T} width={W - PAD_L - PAD_R} height={PLOT_H} />
          </clipPath>
        </defs>

        <rect x={x(27.5)} y={PAD_T} width={x(34) - x(27.5)} height={PLOT_H} className="fill-raised" opacity={0.55} aria-hidden />
        <text x={x(30.75)} y={PLOT_B - 10} textAnchor="middle" className="fill-muted text-micro" aria-hidden>
          hold, 7 daily reads
        </text>

        {yTicks.map((v, i) => (
          <g key={i} aria-hidden>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
            <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" className="fill-subtle text-micro">
              {v.toFixed(2)}%
            </text>
          </g>
        ))}

        <g clipPath="url(#hold-chart-clip)">
          {drawn >= 2 && <path d={ribbon} className="fill-accent-soft" aria-hidden />}
          {drawn >= 2 && <path d={meanLine} fill="none" className="stroke-accent-ink" strokeWidth={2} strokeLinejoin="round" aria-hidden />}

          {data.hold.map((point, i) => {
            const complete = p >= i + 1
            if (!complete) return null
            const px = x(28 + i)
            const py = y(point.value)
            if (point.discounted) {
              return (
                <g key={point.date} aria-hidden>
                  <circle cx={px} cy={py} r={6} className="fill-surface stroke-warn" strokeWidth={2} />
                  <text x={px} y={py + 20} textAnchor="middle" className="fill-warn text-micro">
                    discounted
                  </text>
                  <text x={px} y={PLOT_B + 14} textAnchor="middle" className="fill-muted text-micro">
                    {new Date(point.date + 'T12:00:00').getDate()}
                  </text>
                </g>
              )
            }
            return (
              <g key={point.date} aria-hidden>
                <circle cx={px} cy={py} r={5} className="fill-live" />
                <text x={px} y={PLOT_B + 14} textAnchor="middle" className="fill-muted text-micro">
                  {new Date(point.date + 'T12:00:00').getDate()}
                </text>
              </g>
            )
          })}

          {p > 0 && p < 7 && (
            <line x1={x(28 + p)} x2={x(28 + p)} y1={PAD_T} y2={PLOT_B} className="stroke-line-strong" strokeWidth={1} strokeDasharray="3 4" aria-hidden />
          )}

          {showConfounder && (
            <g className={cn(!reduced && 'motion-safe:animate-enter')}>
              <line x1={x(31)} x2={x(31)} y1={y(thursday.value) - 34} y2={y(thursday.value)} className="stroke-warn" strokeWidth={1} strokeDasharray="2 3" aria-hidden />
              <line x1={x(31)} x2={x(31)} y1={PAD_T + 26} y2={y(thursday.value) - 44} className="stroke-warn" strokeWidth={1} strokeDasharray="2 3" aria-hidden />
              <circle cx={x(31)} cy={y(thursday.value) - 34} r={7} fill="none" className="stroke-warn" strokeWidth={2} aria-hidden />
              <rect x={x(31) - 176} y={PAD_T} width={172} height={34} rx={8} className="fill-surface" opacity={0.88} aria-hidden />
              <text x={x(31) - 8} y={PAD_T + 14} textAnchor="end" className="fill-ink text-micro">
                Sponsored creator video
              </text>
              <text x={x(31) - 8} y={PAD_T + 28} textAnchor="end" className="fill-warn text-micro">
                Creator Dox, dropped Thu 22
              </text>
            </g>
          )}

          {saturdayIndex >= 0 && drawn > saturdayIndex && (
            <text x={x(saturdayIndex)} y={y(data.baseline[saturdayIndex].high) - 8} textAnchor="middle" className="fill-muted text-micro" aria-hidden>
              weekly peak, every Saturday
            </text>
          )}
        </g>

        {axisLabels.map((i) => (
          <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === 34 ? 'end' : 'middle'} className="fill-subtle text-micro" aria-hidden>
            {i < 28 ? data.baseline[i].label : i === 34 ? 'Oct 25' : ''}
          </text>
        ))}

        <line x1={PAD_L} x2={W - PAD_R} y1={PLOT_B} y2={PLOT_B} className="stroke-line-strong" strokeWidth={1} aria-hidden />
      </svg>

      <div className="mt-16 border-t border-line pt-12" data-slot="ci-bar">
        <div className="flex flex-wrap items-center justify-between gap-8">
          <span className="text-label font-medium text-ink">delta QPTR, 95% interval</span>
          {p > 0 ? (
            <Badge tone={crossed ? 'live' : 'muted'}>{crossed ? 'cleared zero' : 'includes zero'}</Badge>
          ) : (
            <Badge tone="muted">no read yet</Badge>
          )}
        </div>

        <svg
          viewBox="0 0 920 92"
          role="img"
          aria-label="Horizontal 95 percent confidence interval for the delta in RFYPlayThroughRate with a zero line"
          className="mt-8 block w-full"
        >
          <line x1={zeroX} x2={zeroX} y1={8} y2={64} className="stroke-line-strong" strokeWidth={1} strokeDasharray="3 4" aria-hidden />
          <text x={zeroX} y={76} textAnchor="middle" className="fill-subtle text-micro" aria-hidden>
            0
          </text>
          {p > 0 ? (
            <>
              <rect x={barX} y={24} width={barW} height={24} rx={8} className={crossed ? 'fill-live' : 'fill-muted'} opacity={crossed ? 0.85 : 0.55} />
              <rect x={barX} y={18} width={2} height={36} className={crossed ? 'fill-live' : 'fill-muted'} />
              <rect x={cx(hi) - 2} y={18} width={2} height={36} className={crossed ? 'fill-live' : 'fill-muted'} />
              <rect x={cx(deltaSoFar) - 1} y={20} width={2} height={32} className="fill-ink" />
            </>
          ) : (
            <rect x={cx(-0.62)} y={24} width={Math.max(2, cx(1.3) - cx(-0.62))} height={24} rx={8} className="fill-raised" />
          )}
        </svg>

        <p className="mt-8 text-label text-ink">
          {p > 0 ? (
            <>
              <span className="tabular font-mono">{fmtSigned2(deltaSoFar)}pp</span> <span className="tabular font-mono">[{fmtSigned2(lo)}, {fmtSigned2(hi)}]</span> <span className="text-muted">95%</span>{' '}
              <span className="text-micro text-muted">day {dayNumber} of 7</span>
            </>
          ) : (
            <span className="text-muted">No interval yet. The first daily read opens the 95% interval.</span>
          )}
        </p>

        {p >= 4 && (
          <p className="mt-4 text-micro text-warn">
            Creator Dox: sponsored creator video landed Thu 22. That traffic is discounted, so the interval widens before it narrows again.
          </p>
        )}
        <p className="mt-4 text-micro text-muted">
          Holds always cover a full weekly cycle, so every arm sees the Saturday peak. Home Recommendations playtime is capped at 60 min per user per day.
        </p>
      </div>

      <figcaption className="sr-only">
        Baseline mean {data.test.baselineValue.toFixed(2)}% over 28 days with a wider band on Saturdays. {daysRead} daily hold reads so far, last at{' '}
        {lastRead ? lastRead.value.toFixed(2) : data.test.baselineValue.toFixed(2)}%. Delta QPTR {fmtSigned2(deltaSoFar)} percentage points, 95% interval [{fmtSigned2(lo)},{' '}
        {fmtSigned2(hi)}]. {crossed ? 'The interval has cleared zero.' : 'The interval still includes zero.'}
      </figcaption>
    </figure>
  )
}

/* The interval narrows per daily read. Interpolating between reads keeps the motion honest: the
   bar is always the interval the daemon could have reported at that moment in the hold. */
export function ciAt(series: [number, number][], p: number): [number, number] {
  const start: [number, number] = [series[0][0] - 0.18, series[0][1] + 0.14]
  if (p <= 0) return start
  if (p < 1) return [lerp(start[0], series[0][0], p), lerp(start[1], series[0][1], p)]
  const i = Math.min(Math.floor(p), series.length - 1)
  const t = Math.min(1, p - i)
  const from = series[Math.max(0, i - 1)]
  const to = series[i]
  return [round3(lerp(from[0], to[0], t)), round3(lerp(from[1], to[1], t))]
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000
}
