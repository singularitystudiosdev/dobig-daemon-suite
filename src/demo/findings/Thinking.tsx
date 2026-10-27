import { useEffect, useState } from 'react'
import { Check, ChevronDown, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { Panel } from '@/components/ui'
import { cn } from '@/lib/cn'
import { fmtInt } from '@/lib/format'
import type { StepState } from '@/lib/runTypes'
import { isEnded, plural, useNow, type RunState } from './runState'

/* The run's real steps, as the server reports them. While the run is going the panel shows each step with a spinner
   (active), check (done), warning mark (warn) or x (failed) and its detail line, and an elapsed clock counted from the
   start event. When the run ends it collapses to one line that expands back into the steps. Nothing is scripted. */

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

const STEP_ICON: Record<StepState, { Icon: typeof Check; className: string; label: string }> = {
  active: { Icon: LoaderCircle, className: 'text-accent-ink motion-safe:animate-spin', label: 'In progress' },
  done: { Icon: Check, className: 'text-live', label: 'Done' },
  warn: { Icon: TriangleAlert, className: 'text-warn', label: 'Finished with a warning' },
  failed: { Icon: X, className: 'text-danger', label: 'Failed' },
}

function StepList({ steps, id }: { steps: RunState['steps']; id?: string }) {
  return (
    <ol id={id} className="flex flex-col gap-12">
      {steps.map((s) => {
        const { Icon, className, label } = STEP_ICON[s.state]
        return (
          <li key={s.id} className="flex items-start gap-12">
            <Icon role="img" aria-label={label} className={cn('mt-2 size-16 shrink-0', className)} />
            <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-baseline md:justify-between md:gap-16">
              <span className={cn('text-label', s.state === 'active' ? 'text-ink' : 'text-muted')}>{s.label}</span>
              {s.detail && <span className="tabular text-micro text-subtle md:text-right">{s.detail}</span>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function ThinkingPanel({ name, state }: { name: string; state: RunState }) {
  const ended = isEnded(state)
  const [override, setOverride] = useState<boolean | null>(null)
  // The panel closes itself when the run ends, and a replay of a finished run (which arrives already ended) starts closed.
  useEffect(() => setOverride(null), [ended, state.runId])
  const open = override ?? !ended
  const now = useNow(!ended && state.started)

  if (!state.runId) return null

  if (ended) {
    const failed = state.end?.status === 'failed' || (state.error !== null && state.end === null)
    const count = state.findings.length
    const took = state.end ? seconds(state.end.durationMs) : null
    const text = failed
      ? `${took ? `Stopped after ${took}` : 'Stopped'}, ${plural(count, 'finding', 'findings')}`
      : `Analysed in ${took}, ${plural(count, 'finding', 'findings')}`
    const refunded = state.end?.refunded ?? 0
    return (
      <Panel bodyClassName="px-16 py-12 md:px-24">
        <div className="flex items-center gap-12">
          {failed ? <X role="img" aria-label="Failed" className="size-16 shrink-0 text-danger" /> : <Check role="img" aria-label="Done" className="size-16 shrink-0 text-live" />}
          <p role="status" className="min-w-0 flex-1 text-label text-ink">
            <span className="tabular">{text}</span>
            {refunded > 0 && <span className="tabular text-muted">. {fmtInt(refunded)} credits refunded</span>}
          </p>
          {state.steps.length > 0 && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls="run-steps"
              onClick={() => setOverride(!open)}
              className="state-layer inline-flex h-32 items-center gap-6 rounded-8 px-8 text-label text-muted"
            >
              {open ? 'Hide steps' : 'Show steps'}
              <ChevronDown aria-hidden className={cn('size-16 transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} />
            </button>
          )}
        </div>
        {open && state.steps.length > 0 && (
          <div className="mt-12 border-t border-line pt-12">
            <StepList steps={state.steps} id="run-steps" />
          </div>
        )}
      </Panel>
    )
  }

  const elapsed = state.startedAt !== null ? Math.max(0, now - state.startedAt) : 0
  return (
    <Panel bodyClassName="p-16 md:p-24">
      <div className="flex items-center gap-12">
        <LoaderCircle aria-hidden className="size-20 shrink-0 text-accent-ink motion-safe:animate-spin" />
        <h2 role="status" className="min-w-0 flex-1 truncate text-stat font-bold text-ink">
          {state.started ? `${name} is running` : 'Connecting to the run'}
        </h2>
        {state.cost > 0 && <span className="tabular shrink-0 text-label text-subtle">{fmtInt(state.cost)} credits</span>}
        {state.started && <span className="tabular shrink-0 text-label text-muted">{seconds(elapsed)}</span>}
      </div>
      {state.steps.length > 0 && (
        <div className="mt-16">
          <StepList steps={state.steps} />
        </div>
      )}
    </Panel>
  )
}
