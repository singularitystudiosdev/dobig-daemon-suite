import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, LoaderCircle } from 'lucide-react'
import { Panel, ProgressBar } from '@/components/ui'
import { cn } from '@/lib/cn'
import { clamp } from '@/lib/format'
import { useReducedMotion } from '@/lib/hooks'

/* The visible thinking phase: a live header, the tool's steps revealing one after another, a slim
   progress bar, then a one-line summary that expands back into the steps. */

const REDUCED_MS = 700

/** Total thinking time: 5 to 8 seconds, scaled by step count, with a small per-game jitter. */
export function thinkingMs(stepCount: number, seed: string): number {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const jitter = ((h % 5) - 2) * 0.1
  return Math.round(clamp(5.2 + (stepCount - 4) * 1.3 + jitter, 5, 8) * 1000)
}

export interface ThinkingState {
  elapsedMs: number
  totalMs: number
  progress: number
  done: boolean
  /** Index of the step in progress; steps.length once finished. */
  active: number
  /** 0 to 1 within the active step. */
  stepProgress: number
  reduced: boolean
  /** Per-step [start, end] in ms. */
  spans: [number, number][]
}

/** Runs once per mounted component. The start time lives in a ref, so a StrictMode remount resumes instead of restarting. */
export function useThinking(stepCount: number, seed: string): ThinkingState {
  const reduced = useReducedMotion()
  const totalMs = reduced ? REDUCED_MS : thinkingMs(stepCount, seed)
  const startRef = useRef<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (done) return
    startRef.current ??= performance.now()
    const id = window.setInterval(() => {
      const e = performance.now() - (startRef.current ?? 0)
      if (e >= totalMs) {
        window.clearInterval(id)
        setElapsedMs(totalMs)
        setDone(true)
      } else setElapsedMs(e)
    }, 100)
    return () => window.clearInterval(id)
  }, [done, totalMs])

  // Uneven but deterministic step lengths, so the narration does not tick like a metronome.
  const weights = Array.from({ length: stepCount }, (_, i) => 1 + 0.4 * Math.sin(i * 2.3 + 1))
  const sum = weights.reduce((a, w) => a + w, 0) || 1
  let at = 0
  const spans: [number, number][] = weights.map((w) => {
    const start = at
    at += (w / sum) * totalMs
    return [start, at]
  })
  const active = done ? stepCount : Math.max(0, spans.findIndex(([, end]) => elapsedMs < end))
  const [s, e] = spans[Math.min(active, stepCount - 1)] ?? [0, 1]
  return {
    elapsedMs,
    totalMs,
    progress: done ? 1 : clamp(elapsedMs / totalMs),
    done,
    active,
    stepProgress: done ? 1 : clamp((elapsedMs - s) / (e - s || 1)),
    reduced,
    spans,
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

export function ThinkingPanel({
  name,
  steps,
  details,
  state,
  findingCount,
}: {
  name: string
  steps: string[]
  details: ((p: number) => string)[]
  state: ThinkingState
  findingCount: number
}) {
  const [open, setOpen] = useState(false)
  const { done, active, reduced } = state

  if (done) {
    return (
      <Panel bodyClassName="px-16 py-12 md:px-24">
        <div className="flex items-center gap-12">
          <Check aria-hidden className="size-16 shrink-0 text-live" />
          <p role="status" className="min-w-0 flex-1 text-label text-ink">
            <span className="tabular">Analysed in {seconds(state.totalMs)}, {findingCount} findings</span>
          </p>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="thinking-steps"
            onClick={() => setOpen((v) => !v)}
            className="state-layer inline-flex h-32 items-center gap-6 rounded-8 px-8 text-label text-muted"
          >
            {open ? 'Hide steps' : 'Show steps'}
            <ChevronDown aria-hidden className={cn('size-16 transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} />
          </button>
        </div>
        {open && (
          <ol id="thinking-steps" className="mt-12 flex flex-col gap-8 border-t border-line pt-12 motion-safe:animate-enter">
            {steps.map((label, i) => (
              <li key={label} className="flex items-start gap-12">
                <Check aria-hidden className="mt-2 size-16 shrink-0 text-live" />
                <StepText label={label} detail={details[i]?.(1)} done />
              </li>
            ))}
          </ol>
        )}
      </Panel>
    )
  }

  return (
    <Panel bodyClassName="p-16 md:p-24">
      <div className="flex items-center gap-12">
        <LoaderCircle aria-hidden className="size-20 shrink-0 text-accent-ink motion-safe:animate-spin" />
        <h2 role="status" className="min-w-0 flex-1 truncate text-stat font-bold text-ink">
          {name} is thinking
        </h2>
        <span className="tabular shrink-0 text-label text-muted">{seconds(state.elapsedMs)}</span>
      </div>
      <ProgressBar value={state.progress} size="sm" label={`${name} progress`} className="mt-12" />
      {!reduced && (
        <ol className="mt-16 flex flex-col gap-12">
          {steps.slice(0, active + 1).map((label, i) => {
            const current = i === active
            return (
              <li key={label} className="flex items-start gap-12 motion-safe:animate-enter">
                {current ? <LoaderCircle aria-hidden className="mt-2 size-16 shrink-0 text-accent-ink motion-safe:animate-spin" /> : <Check aria-hidden className="mt-2 size-16 shrink-0 text-live" />}
                <StepText label={label} detail={details[i]?.(current ? state.stepProgress : 1)} done={!current} caret={current} />
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}

function StepText({ label, detail, done, caret }: { label: string; detail?: string; done?: boolean; caret?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-baseline md:justify-between md:gap-16">
      <span className={cn('text-label', done ? 'text-muted' : 'text-ink')}>
        {label}
        {caret && <span aria-hidden className="ml-4 inline-block h-12 w-2 translate-y-2 bg-ink motion-safe:animate-blink" />}
      </span>
      {detail && <span className="tabular font-mono text-micro text-subtle md:text-right">{detail}</span>}
    </div>
  )
}
