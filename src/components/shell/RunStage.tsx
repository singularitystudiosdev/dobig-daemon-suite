import type { ReactNode } from 'react'
import { Circle, CircleCheck, CircleDot, LoaderCircle, Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtClock, timeAgo } from '@/lib/format'
import { daemonHref } from '@/lib/router'
import { toneBg } from '@/lib/tone'
import type { Simulation } from '@/lib/useSimulation'
import { busFor } from '@/data/bus'
import { daemonsBySlug, type DaemonSlug } from '@/data/daemons'
import { useActiveGame } from '@/context/ActiveGame'
import { Badge, Button, IconButton, ProgressBar } from '@/components/ui'

/* The run stage: the one bold element on every daemon page. Header with status and controls,
   the stage rail, the daemon's own visualization (children) beside an optional aside, and the
   confounder-bus strip at the bottom. */
export function RunStage({
  sim,
  daemon,
  title = 'Live run',
  subtitle,
  children,
  aside,
  className,
}: {
  sim: Simulation
  daemon: DaemonSlug
  title?: string
  subtitle?: ReactNode
  children: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <section aria-label={title} data-slot="run-stage" className={cn('min-w-0 rounded-20 border border-line bg-surface', className)}>
      <header className="flex flex-wrap items-center justify-between gap-16 border-b border-line px-24 py-16">
        <div className="flex min-w-0 items-center gap-12">
          <RunStatusBadge sim={sim} />
          <div className="min-w-0">
            <h2 className="text-title font-bold text-ink">{title}</h2>
            {subtitle && <p className="text-label text-muted">{subtitle}</p>}
          </div>
        </div>
        <RunControls sim={sim} />
      </header>
      <ProgressBar value={sim.progress} size="sm" label="Run progress" className="rounded-none bg-transparent" />
      <StageRail sim={sim} className="px-24 pt-16" />
      <div className={cn('grid gap-24 p-24', aside && 'lg:grid-cols-stage')}>
        <div className="min-w-0">{children}</div>
        {aside && <aside className="min-w-0">{aside}</aside>}
      </div>
      <EventStrip daemon={daemon} />
    </section>
  )
}

export function RunStatusBadge({ sim }: { sim: Simulation }) {
  if (sim.status === 'running')
    return (
      <Badge tone="live" dot pulse>
        Running
      </Badge>
    )
  if (sim.status === 'paused')
    return (
      <Badge tone="warn" dot pulse={false}>
        Paused
      </Badge>
    )
  if (sim.status === 'done')
    return (
      <Badge tone="accent" dot pulse={false}>
        Complete
      </Badge>
    )
  return (
    <Badge tone="muted" dot pulse={false}>
      Ready
    </Badge>
  )
}

const speeds = [1, 2, 4]

export function RunControls({ sim }: { sim: Simulation }) {
  const label = sim.status === 'running' ? 'Pause' : sim.status === 'paused' ? 'Resume' : sim.status === 'done' ? 'Run again' : 'Run daemon'
  const icon = sim.status === 'running' ? Pause : sim.status === 'done' ? RotateCcw : Play
  return (
    <div className="flex flex-wrap items-center gap-8">
      <span className="tabular font-mono text-micro text-muted" aria-label="Elapsed run time">
        {fmtClock(sim.t)} / {fmtClock(sim.total)}
      </span>
      <div role="group" aria-label="Playback speed" className="flex rounded-8 border border-line bg-raised p-2">
        {speeds.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={sim.speed === s}
            onClick={() => sim.setSpeed(s)}
            className={cn('state-layer h-28 rounded-8 px-8 font-mono text-micro transition-colors duration-150', sim.speed === s ? 'bg-accent-soft text-accent-ink' : 'text-muted')}
          >
            {s}x
          </button>
        ))}
      </div>
      <IconButton label="Restart run" icon={RotateCcw} onClick={sim.start} size="sm" />
      <IconButton label="Skip to results" icon={SkipForward} onClick={sim.skip} size="sm" disabled={sim.status === 'done'} />
      <Button variant="primary" size="sm" icon={icon} onClick={sim.toggle} className="w-112">
        {label}
      </Button>
    </div>
  )
}

/* Stage rail: one cell per stage; click a cell to seek to it. */
export function StageRail({ sim, className }: { sim: Simulation; className?: string }) {
  return (
    <ol data-slot="stage-rail" className={cn('scroll-thin grid auto-cols-stage grid-flow-col gap-8 overflow-x-auto pb-4', className)}>
      {sim.stages.map((stage, i) => {
        const state = sim.stageState(i)
        const progress = state === 'done' ? 1 : state === 'active' ? sim.stageProgress : 0
        const Icon = state === 'done' ? CircleCheck : state === 'active' ? (sim.status === 'running' ? LoaderCircle : CircleDot) : Circle
        return (
          <li key={stage.id} className="min-w-0">
            <button
              type="button"
              onClick={() => sim.seek(sim.stageStart(stage.id) + 1)}
              aria-current={state === 'active' ? 'step' : undefined}
              aria-label={`${stage.label}, ${state}. Jump to this stage.`}
              className="state-layer flex w-full flex-col gap-6 rounded-8 px-8 py-8 text-left"
            >
              <span className="flex items-center gap-8">
                <Icon
                  aria-hidden
                  className={cn(
                    'size-16 shrink-0',
                    state === 'done' && 'text-live',
                    state === 'active' && 'text-accent-ink',
                    state === 'active' && sim.status === 'running' && 'motion-safe:animate-spin',
                    state === 'pending' && 'text-subtle',
                  )}
                />
                <span className={cn('truncate text-label font-medium', state === 'pending' ? 'text-subtle' : 'text-ink')}>{stage.label}</span>
              </span>
              {stage.detail && <span className="truncate pl-24 text-micro text-muted">{stage.detail}</span>}
              <span className="ml-24 h-4 overflow-hidden rounded-full bg-raised">
                <span
                  className={cn('block h-full w-full origin-left rounded-full transition-transform duration-100 ease-linear motion-reduce:transition-none', state === 'done' ? 'bg-live' : 'bg-accent')}
                  style={{ transform: `scaleX(${progress})` }}
                />
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/* The confounder bus for the active game: the last five events any daemon emitted. */
export function EventStrip({ daemon, limit = 5 }: { daemon: DaemonSlug; limit?: number }) {
  const { game } = useActiveGame()
  const events = busFor(game).slice(0, limit)
  return (
    <div data-slot="event-strip" className="border-t border-line px-24 py-16">
      <div className="mb-8 flex items-center justify-between gap-12">
        <h3 className="text-label font-medium text-ink">Confounder bus</h3>
        <span className="text-micro text-muted">What the other daemons saw on {game.shortName} this week</span>
      </div>
      <ul className="scroll-thin flex gap-8 overflow-x-auto pb-4">
        {events.map((e) => {
          const meta = daemonsBySlug[e.daemon]
          const self = e.daemon === daemon
          return (
            <li key={e.id} className="w-264 shrink-0">
              <a
                href={daemonHref(e.daemon, e.focus ? { focus: e.focus } : undefined)}
                className={cn('state-layer flex h-full flex-col gap-4 rounded-8 border px-12 py-8', self ? 'border-line-strong bg-raised' : 'border-line')}
              >
                <span className="flex items-center gap-8 text-micro text-muted">
                  <span aria-hidden className={cn('size-8 shrink-0 rounded-full', toneBg[meta.tone])} />
                  <span className="truncate">{meta.name}</span>
                  <span className="ml-auto shrink-0">{timeAgo(e.at)}</span>
                </span>
                <span className="truncate text-label font-medium text-ink">{e.title}</span>
                <span className="line-clamp-2 text-micro text-muted">{e.detail}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
