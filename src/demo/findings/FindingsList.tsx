import { useId, useState } from 'react'
import { ChevronDown, ExternalLink, SearchX, ShieldAlert } from 'lucide-react'
import { Badge, EmptyState, Panel, Sparkline, StatPill } from '@/components/ui'
import type { DaemonSlug } from '@/data/daemons'
import { cn } from '@/lib/cn'
import type { Finding, RunSummary } from '@/lib/runTypes'
import { detailViews } from './details/index'

/* The findings of one run, in the order the server sent them (it sends display order; the summary says how it is
   sorted). Each row is a button that expands into a plain bordered detail region rendered by the tool's detail view.
   The first 12 rows show, the rest sit behind "Show more". Row state (what the user marked) is local UI state. */

const PAGE = 12

export function FindingsList({
  title,
  findings,
  summary,
  running,
  tool,
  daemonId,
  onEmpty,
}: {
  title: string
  findings: Finding[]
  summary: RunSummary | null
  /** The run is still streaming: the count reads "so far" and an empty list is not yet a result. */
  running: boolean
  tool: DaemonSlug
  daemonId: string
  /** The action of the empty result: run the daemon again. */
  onEmpty?: { label: string; run: () => void }
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [group, setGroup] = useState('all')
  const [showAll, setShowAll] = useState(false)
  const [states, setStates] = useState<Record<string, string>>({})
  const baseId = useId()

  const groups = summary?.groups
  const filtered = group === 'all' ? findings : findings.filter((f) => f.group === group)
  const visible = showAll ? filtered : filtered.slice(0, PAGE)
  // A fixed mark column keeps titles aligned; its width follows the longest label in this run.
  const longest = Math.max(...findings.map((f) => f.badge.label.length), 0)
  const mark = longest <= 5 ? { w: 'md:w-56', indent: 'md:pl-76' } : longest <= 13 ? { w: 'md:w-104', indent: 'md:pl-124' } : longest <= 16 ? { w: 'md:w-120', indent: 'md:pl-140' } : { w: 'md:w-96', indent: 'md:pl-116' }
  const metaWidth = Math.max(...findings.map((f) => f.meta.length), 0) >= 4 ? 'min-w-88' : 'min-w-64'
  const statusLongest = Math.max(...findings.map((f) => f.status.label.length), 0)
  const statusWidth = statusLongest <= 12 ? 'md:w-104' : 'md:w-128'

  const sort = summary?.sortLabel.replace(/\.$/, '')
  const count = `${findings.length.toLocaleString('en-US')} ${findings.length === 1 ? 'finding' : 'findings'}${running ? ' so far' : ''}`

  return (
    <div className="flex flex-col gap-16">
      {summary && summary.items.length > 0 && (
        <div className="flex flex-wrap gap-8">
          {summary.items.map((s) => (
            <StatPill key={s.label} label={s.label} value={s.value} tone={s.tone} className="min-w-200 flex-1" />
          ))}
        </div>
      )}
      {summary?.notes && summary.notes.length > 0 && (
        <details className="group max-w-prose rounded-8 border border-line px-16 py-8 text-label text-muted">
          <summary className="state-layer flex cursor-pointer list-none items-center gap-8 rounded-8 py-4 font-medium text-ink [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden className="size-16 text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
            How this run was counted
          </summary>
          <ul className="mt-8 flex list-disc flex-col gap-8 pb-4 pl-20 text-micro text-subtle marker:text-subtle">
            {summary.notes.flatMap((n) => n.split(/(?<=\.)\s+(?=[A-Z])/)).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      )}
      {summary?.notices?.map((n) => (
        <div key={n.lead} role="note" className="flex items-start gap-12 rounded-8 border border-line bg-raised px-16 py-12">
          <ShieldAlert aria-hidden className="mt-2 size-16 shrink-0 text-warn" />
          <p className="max-w-prose text-label text-muted">
            <span className="font-medium text-ink">{/[.!?:]$/.test(n.lead.trim()) ? n.lead : `${n.lead}.`}</span> {n.body}
          </p>
        </div>
      ))}
      <Panel title={title} description={sort ? `${count}. ${sort}.` : `${count}.`} bodyClassName="px-24 pb-8 pt-16">
        {groups && groups.length > 0 && (
          <div role="group" aria-label="Filter by group" className="mb-8 flex flex-wrap gap-8">
            {[{ id: 'all', label: 'All' }, ...groups].map((g) => {
              const n = g.id === 'all' ? findings.length : findings.filter((f) => f.group === g.id).length
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
                  <span className="tabular text-micro text-subtle">{n}</span>
                </button>
              )
            })}
          </div>
        )}
        {visible.length === 0 ? (
          group !== 'all' ? (
            <EmptyState icon={SearchX} sentence="Nothing in this group for this run." actionLabel="Show every finding" onAction={() => setGroup('all')} />
          ) : running ? null : onEmpty ? (
            <EmptyState icon={SearchX} sentence="This run found nothing. The steps above list what was searched." actionLabel={onEmpty.label} onAction={onEmpty.run} />
          ) : null
        ) : (
          <ul className="flex flex-col">
            {visible.map((f) => {
              const state = states[f.id]
              const status = (state && f.states?.[state]) || f.status
              const expanded = open === f.id
              const panelId = `${baseId}-${f.id}`
              const View = detailViews[f.detail.kind]
              return (
                <li key={f.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setOpen(expanded ? null : f.id)}
                    className="state-layer flex w-full flex-wrap items-center gap-x-12 gap-y-8 rounded-8 px-8 py-12 text-left"
                  >
                    <span className={cn('shrink-0', mark.w)}>
                      <Badge tone={f.badge.tone} className="whitespace-normal">
                        {f.badge.label}
                      </Badge>
                    </span>
                    <span className="flex min-w-0 flex-1 basis-160 flex-col gap-2">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 text-body font-medium text-ink">
                        {f.title}
                        {f.isNew && <Badge tone="accent">New</Badge>}
                      </span>
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
                  {f.url && (
                    <div className={cn('flex min-w-0 px-8 pb-12', mark.indent)}>
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        title={f.url}
                        className="inline-flex min-w-0 items-center gap-6 rounded-8 text-micro text-accent-ink hover:underline"
                      >
                        <ExternalLink aria-hidden className="size-12 shrink-0" />
                        <span className="min-w-0 truncate">{f.url}</span>
                      </a>
                    </div>
                  )}
                  {expanded && (
                    <div id={panelId} role="region" aria-label={`${f.title} detail`} className="mb-12 rounded-8 border border-line p-16">
                      <View finding={f} detail={f.detail} state={state} act={(next) => setStates((prev) => ({ ...prev, [f.id]: next }))} tool={tool} daemonId={daemonId} />
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
