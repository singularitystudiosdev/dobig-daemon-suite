import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, History, Trash2, Zap } from 'lucide-react'
import { Button, LiveDot, Select, Skeleton, useToast } from '@/components/ui'
import type { DaemonSlug } from '@/data/daemons'
import { runCost, toolsBySlug } from '@/data/tools'
import { ApiFailure, getDaemon, patchDaemon, runDaemonNow } from '@/lib/api'
import type { Credits } from '@/lib/credits'
import { cn } from '@/lib/cn'
import { fmtInt } from '@/lib/format'
import { useOnClickOutside } from '@/lib/hooks'
import type { DaemonRecord, RunRecordSummary } from '@/lib/runTypes'
import { ago, stamp, until } from './time'

/* The daemon bar sits between a target's header and its workspace. It is the visible half of the server-side daemon:
   whether it reruns, how often, when next, how the last run went, a manual run with its real cost, the run history
   and removal. Every control writes to the server and hands the fresh record back through onUpdated. */

const INTERVALS = [6, 12, 24]
const hours = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`
const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`

function runLine(r: RunRecordSummary, now: number): string {
  if (r.status === 'failed') return `${ago(r.startedAt, now)}: failed. ${r.error ?? 'No reason was recorded.'}`
  if (r.status === 'running' || r.status === 'queued') return `${ago(r.startedAt, now)}: running`
  return `${ago(r.startedAt, now)}: ${plural(r.findings, 'finding', 'findings')}, ${fmtInt(r.newFindings)} new`
}

export function DaemonBar({
  slug,
  daemon,
  credits,
  viewingRunId,
  onPickRun,
  onUpdated,
  onRunStarted,
  onRemove,
  onTopUp,
}: {
  slug: DaemonSlug
  daemon: DaemonRecord
  credits: Credits
  /** The run the user picked from history, or null for the latest. */
  viewingRunId: string | null
  onPickRun: (runId: string | null) => void
  onUpdated: (d: DaemonRecord) => void
  onRunStarted: (runId: string) => void
  onRemove: () => void
  onTopUp: () => void
}) {
  const tool = toolsBySlug[slug]
  const toast = useToast()
  const free = slug === 'thumbnail-daemon'
  const cost = free ? 0 : credits.cost || runCost(slug)
  const [now, setNow] = useState(() => Date.now())
  const [pending, setPending] = useState<'toggle' | 'interval' | 'run' | null>(null)
  const [message, setMessage] = useState<{ text: string; credits?: boolean } | null>(null)
  const switchId = useId()
  const selectId = useId()

  useEffect(() => {
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [daemon.nextRunAt])

  const running = Boolean(daemon.activeRunId)
  const short = !free && !credits.loading && credits.balance < cost

  const fail = (err: unknown, fallback: string) => {
    setMessage({ text: err instanceof ApiFailure ? err.message : fallback })
  }

  const setEnabled = async (enabled: boolean) => {
    setPending('toggle')
    setMessage(null)
    try {
      onUpdated(await patchDaemon(daemon.id, { enabled }))
    } catch (err) {
      fail(err, 'The daemon could not be updated. Try again.')
    } finally {
      setPending(null)
    }
  }
  const setInterval_ = async (intervalHours: number) => {
    setPending('interval')
    setMessage(null)
    try {
      onUpdated(await patchDaemon(daemon.id, { intervalHours }))
      toast.push({ title: `Now watching every ${hours(intervalHours)}`, tone: 'info' })
    } catch (err) {
      fail(err, 'The interval could not be changed. Try again.')
    } finally {
      setPending(null)
    }
  }
  const runNow = async () => {
    setPending('run')
    setMessage(null)
    try {
      const { runId } = await runDaemonNow(daemon.id)
      onRunStarted(runId)
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'credits') setMessage({ text: `This run needs ${fmtInt(cost)} credits, you have ${fmtInt(credits.balance)}.`, credits: true })
      else fail(err, 'The run could not start. Try again.')
      void credits.refresh()
    } finally {
      setPending(null)
    }
  }

  const intervals = INTERVALS.includes(daemon.intervalHours) ? INTERVALS : [...INTERVALS, daemon.intervalHours].sort((a, b) => a - b)

  const status = running ? (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-12 gap-y-4 text-label font-medium text-live">
      <span className="inline-flex items-center gap-8">
        <LiveDot />
        Running now
      </span>
      {!daemon.enabled && <span className="text-warn">Paused after this run</span>}
    </span>
  ) : !daemon.enabled ? (
    <span className="text-label font-medium text-warn">Paused</span>
  ) : daemon.nextRunAt ? (
    <span className="tabular text-label font-medium text-ink">{until(daemon.nextRunAt, now) === 'due now' ? 'Next run is due now' : `Next run in ${until(daemon.nextRunAt, now)}`}</span>
  ) : (
    <span className="text-label text-muted">Next run not scheduled</span>
  )

  const last = daemon.last
  const lastLine = last ? (
    last.status === 'failed' ? (
      <span className="text-danger">Last run {ago(last.startedAt, now)} failed: {last.error ?? 'no reason was recorded'}</span>
    ) : last.status === 'running' || last.status === 'queued' ? (
      <span>Last run started {ago(last.startedAt, now)}</span>
    ) : (
      <span className="tabular">
        Last run {ago(last.startedAt, now)}: {plural(last.findings, 'finding', 'findings')}, {fmtInt(last.newFindings)} new
      </span>
    )
  ) : (
    <span>No run has finished yet.</span>
  )

  const runLabel = free ? 'Check gallery now' : `Run now, ${fmtInt(cost)} credits`

  return (
    <section aria-label={`${daemon.title} daemon`} className="flex flex-col gap-16 rounded-20 border border-line bg-surface p-16 sm:p-20">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <div className="flex flex-wrap items-center gap-12">
          <button
            id={switchId}
            type="button"
            role="switch"
            aria-checked={daemon.enabled}
            aria-label="Watch this target on a schedule"
            disabled={pending === 'toggle'}
            onClick={() => void setEnabled(!daemon.enabled)}
            className={cn('relative inline-flex h-24 w-44 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-50 motion-reduce:transition-none', daemon.enabled ? 'bg-accent' : 'bg-line-strong')}
          >
            <span aria-hidden className={cn('inline-block size-18 rounded-full bg-ink transition-transform duration-150 ease-standard motion-reduce:transition-none', daemon.enabled ? 'translate-x-22' : 'translate-x-4')} />
          </button>
          <label htmlFor={selectId} className="text-label font-medium text-ink">
            Watch this every
          </label>
          <Select
            id={selectId}
            value={daemon.intervalHours}
            disabled={pending === 'interval'}
            onChange={(e) => void setInterval_(Number(e.target.value))}
            className="h-32 w-auto pr-8 text-label"
          >
            {intervals.map((n) => (
              <option key={n} value={n}>
                {hours(n)}
              </option>
            ))}
          </Select>
        </div>
        <div aria-live="polite">{status}</div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-12">
        <p className="min-w-0 text-label text-muted">{lastLine}</p>
        <div className="flex flex-wrap items-center gap-8">
          <Button variant="primary" icon={Zap} loading={pending === 'run' || running} disabled={short} onClick={() => void runNow()}>
            {running ? 'Running' : runLabel}
          </Button>
          {short && (
            <Button onClick={onTopUp}>
              Add credits
            </Button>
          )}
          <HistoryMenu daemon={daemon} viewingRunId={viewingRunId} onPick={onPickRun} now={now} />
          <Button variant="ghost" icon={Trash2} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>

      {viewingRunId && (
        <p className="flex flex-wrap items-center gap-8 text-label text-ink">
          <span>Showing an earlier run from the history.</span>
          <button type="button" onClick={() => onPickRun(null)} className="rounded-8 font-medium text-accent-ink hover:text-ink">
            Back to the latest
          </button>
        </p>
      )}
      {short && (
        <p role="status" className="tabular text-label text-warn">
          A run needs {fmtInt(cost)} credits and this tool has {fmtInt(credits.balance)}.
        </p>
      )}
      {message && (
        <div role="alert" className="flex flex-wrap items-center gap-12 rounded-8 bg-danger-soft p-12 text-label text-danger">
          <p className="tabular min-w-0 flex-1">{message.text}</p>
          {message.credits && (
            <Button size="sm" variant="primary" onClick={onTopUp}>
              Add credits
            </Button>
          )}
        </div>
      )}
      <p className="text-micro text-muted">{tool.daemonNote}</p>
    </section>
  )
}

/* The run history: a popup list loaded from getDaemon(id) when it opens. Arrows, Home, End, Enter, Escape and Tab work. */
function HistoryMenu({ daemon, viewingRunId, onPick, now }: { daemon: DaemonRecord; viewingRunId: string | null; onPick: (runId: string | null) => void; now: number }) {
  const [open, setOpen] = useState(false)
  const [runs, setRuns] = useState<RunRecordSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  useOnClickOutside(wrapRef, () => setOpen(false), open)

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
    let stale = false
    setFailed(false)
    getDaemon(daemon.id)
      .then((d) => {
        if (!stale) setRuns([...d.history].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)))
      })
      .catch(() => {
        if (!stale) setFailed(true)
      })
    return () => {
      stale = true
    }
  }, [open, daemon.id, daemon.last?.runId])

  // Row 0 is "Latest"; the runs follow.
  const rows: { id: string | null; label: string; detail?: string }[] = [
    { id: null, label: 'Latest', detail: 'The newest run, followed as it happens' },
    ...(runs ?? []).map((r) => ({ id: r.runId, label: stamp(r.startedAt), detail: runLine(r, now) })),
  ]

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) wrapRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus()
  }
  const pick = (i: number) => {
    onPick(rows[i].id)
    close(true)
  }
  const onKey = (e: KeyboardEvent) => {
    const last = rows.length - 1
    if (e.key === 'ArrowDown') setActive((i) => (i >= last ? 0 : i + 1))
    else if (e.key === 'ArrowUp') setActive((i) => (i <= 0 ? last : i - 1))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(last)
    else if (e.key === 'Enter' || e.key === ' ') pick(active)
    else if (e.key === 'Escape') close(true)
    else if (e.key === 'Tab') close(false)
    else return
    e.preventDefault()
  }

  return (
    <div ref={wrapRef} className="relative">
      <Button
        icon={History}
        iconRight={ChevronDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          if (open) close(false)
          else {
            setActive(Math.max(0, rows.findIndex((r) => r.id === viewingRunId)))
            setOpen(true)
          }
        }}
      >
        History
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-8 w-280 sm:w-360 rounded-20 border border-line-strong bg-surface p-8 motion-safe:animate-enter">
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label="Run history"
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onKey}
            className="flex max-h-320 flex-col gap-2 overflow-y-auto outline-none focus-visible:outline-none"
          >
            {rows.map((r, i) => (
              <li
                key={r.id ?? 'latest'}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={r.id === viewingRunId}
                onClick={() => pick(i)}
                onPointerMove={() => setActive(i)}
                className={cn('flex cursor-pointer flex-col rounded-8 p-8', i === active && 'bg-raised')}
              >
                <span className={cn('text-label font-medium', r.id === viewingRunId ? 'text-accent-ink' : 'text-ink')}>{r.label}</span>
                {r.detail && <span className="tabular text-micro text-muted">{r.detail}</span>}
              </li>
            ))}
          </ul>
          {runs === null && !failed && (
            <div aria-busy className="flex flex-col gap-8 p-8">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-2/3" />
            </div>
          )}
          {failed && <p className="p-8 text-label text-danger">The history did not load. Close this menu and open it again.</p>}
          {runs?.length === 0 && <p className="p-8 text-label text-muted">No earlier runs yet.</p>}
        </div>
      )}
    </div>
  )
}
