import { useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, SearchX, ShieldAlert } from 'lucide-react'
import { Badge, EmptyState, Panel, Sparkline, StatPill } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/lib/hooks'
import type { Finding, FindingsModel, StateMap, Summary } from './types'

/* The ordered results: severity or rank mark, title, one-line snippet, meta, status. Rows land one by
   one (the whole reveal stays under 1.5 s) and expand into a plain bordered detail region. */

const PAGE = 12
const STAGGER_ROWS = 14
const REVEAL_MS = 1000

export function FindingsList({
  title,
  model,
  states,
  summary,
  renderDetail,
}: {
  title: string
  model: FindingsModel
  states: StateMap
  summary?: Summary
  renderDetail: (finding: Finding, state: string | undefined) => ReactNode
}) {
  const reduced = useReducedMotion()
  const [open, setOpen] = useState<string | null>(null)
  const [group, setGroup] = useState('all')
  const [showAll, setShowAll] = useState(false)
  const baseId = useId()
  // Stagger only the first paint; rows that mount later (a filter, "show more") appear without delay.
  const firstPaint = useRef(true)
  const stagger = firstPaint.current
  firstPaint.current = false

  const { findings, groups } = model
  const filtered = group === 'all' ? findings : findings.filter((f) => f.group === group)
  const visible = showAll ? filtered : filtered.slice(0, PAGE)
  const step = REVEAL_MS / Math.min(STAGGER_ROWS, Math.max(visible.length, 1))
  const stepMs = Math.min(100, step)
  // A fixed mark column keeps titles aligned; its width follows the longest label in this tool.
  const longest = Math.max(...findings.map((f) => f.badge.label.length), 0)
  const metaWidth = Math.max(...findings.map((f) => f.meta.length), 0) >= 4 ? 'min-w-88' : 'min-w-64'
  const statusLongest = Math.max(...findings.map((f) => f.status.label.length), 0)
  const statusWidth = statusLongest <= 12 ? 'md:w-104' : 'md:w-128'
  const markWidth = longest <= 5 ? 'md:w-56' : longest <= 13 ? 'md:w-104' : longest <= 16 ? 'md:w-120' : 'md:w-96'

  return (
    <div className="flex flex-col gap-16">
      {summary && (
        <div className="flex flex-col gap-8 motion-safe:animate-enter">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-4">
            {summary.items.map((s) => (
              <StatPill key={s.label} label={s.label} value={s.value} tone={s.tone} />
            ))}
          </div>
          {summary.note && <p className="max-w-prose text-micro text-subtle">{summary.note}</p>}
        </div>
      )}
      {model.notices.map((n) => (
        <div key={n.lead} className="flex items-start gap-12 rounded-8 border border-line bg-raised px-16 py-12 motion-safe:animate-enter">
          <ShieldAlert aria-hidden className="mt-2 size-16 shrink-0 text-warn" />
          <p className="max-w-prose text-label text-muted">
            <span className="font-medium text-ink">{n.lead}</span> {n.body}
          </p>
        </div>
      ))}
      <Panel
        title={title}
        description={`${findings.length} findings. ${model.sortLabel}.`}
        actions={<span className="text-micro text-subtle">Simulated demo data</span>}
        bodyClassName="px-24 pb-8 pt-16"
      >
        {groups && (
          <div role="group" aria-label="Filter by lane" className="mb-8 flex flex-wrap gap-8">
            {[{ id: 'all', label: 'All' }, ...groups].map((g) => {
              const count = g.id === 'all' ? findings.length : findings.filter((f) => f.group === g.id).length
              const on = group === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setGroup(g.id)
                    setOpen(null)
                  }}
                  className={cn('state-layer inline-flex h-32 items-center gap-6 rounded-8 px-12 text-label', on ? 'bg-accent-soft text-accent-ink' : 'text-muted')}
                >
                  {g.label}
                  <span className="tabular text-micro text-subtle">{count}</span>
                </button>
              )
            })}
          </div>
        )}
        {visible.length === 0 ? (
          <EmptyState icon={SearchX} sentence="Nothing is in this view for the game yet." actionLabel="Show every finding" onAction={() => setGroup('all')} />
        ) : (
          <ul className="flex flex-col">
            {visible.map((f, i) => {
              const state = states[f.id]
              const status = (state && f.states?.[state]) || f.status
              const expanded = open === f.id
              const panelId = `${baseId}-${f.id}`
              return (
                <li
                  key={f.id}
                  className={cn('border-b border-line last:border-b-0', !reduced && 'motion-safe:animate-rise')}
                  style={!reduced && stagger && i < STAGGER_ROWS ? { animationDelay: `${Math.round(i * stepMs)}ms` } : undefined}
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setOpen(expanded ? null : f.id)}
                    className="state-layer flex w-full flex-wrap items-center gap-x-12 gap-y-8 rounded-8 px-8 py-12 text-left"
                  >
                    <span className={cn('shrink-0', markWidth)}>
                      <Badge tone={f.badge.tone} className="whitespace-normal">
                        {f.badge.label}
                      </Badge>
                    </span>
                    <span className="flex min-w-0 flex-1 basis-160 flex-col gap-2">
                      <span className="text-body font-medium text-ink">{f.title}</span>
                      <span className="truncate text-label text-muted">
                        {f.snippet.map((seg, k) => (seg.struck ? <s key={k} className="text-danger">{seg.text}</s> : <span key={k}>{seg.text}</span>))}
                      </span>
                    </span>
                    <span className="flex w-full flex-wrap items-center gap-x-16 gap-y-8 md:w-auto md:shrink-0 md:flex-nowrap">
                      {f.meta.map((m) => (
                        <span key={m.label} className={cn('flex flex-col items-end', metaWidth)}>
                          <span className="tabular whitespace-nowrap text-label text-ink">{m.value}</span>
                          <span className="whitespace-nowrap text-micro text-subtle">{m.label}</span>
                        </span>
                      ))}
                      {f.spark && <Sparkline data={f.spark.data} tone={f.spark.tone} width={64} height={24} label={f.spark.label} />}
                      <span className={cn('flex shrink-0 justify-end max-md:ml-auto', statusWidth)}>
                        <Badge tone={status.tone} dot={status.tone === 'live'} pulse={false}>
                          {status.label}
                        </Badge>
                      </span>
                      <ChevronDown aria-hidden className={cn('size-16 text-muted transition-transform duration-200 motion-reduce:transition-none', expanded && 'rotate-180')} />
                    </span>
                  </button>
                  {expanded && (
                    <div id={panelId} role="region" aria-label={`${f.title} detail`} className="mb-12 rounded-8 border border-line p-16 motion-safe:animate-enter">
                      {renderDetail(f, state)}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {!showAll && filtered.length > PAGE && (
          <div className="flex justify-center border-t border-line py-12">
            <button type="button" onClick={() => setShowAll(true)} className="state-layer inline-flex h-32 items-center rounded-8 px-12 text-label text-muted">
              Show {filtered.length - PAGE} more
            </button>
          </div>
        )}
      </Panel>
    </div>
  )
}
