import type { ReactNode } from 'react'
import { Check, ExternalLink, Undo2 } from 'lucide-react'
import { Badge, Button, KeyValue, Table, Td, Th } from '@/components/ui'
import { SEVERITY_RULES, type HackDetail, type HackSeverity, type HackVideo } from '@/lib/details/hack'
import { fmtCompact, fmtInt } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import type { DetailViewProps } from './types'

/* Hack Daemon: what the cheats advertise, the likely server-trust cause, the server-side fix, the severity rule that
   was applied, and the real YouTube videos behind the cluster with their exact links. Only titles, channels, view
   counts and dates are shown; nothing from a video description is ever rendered. */

const SEV_TONE: Record<HackSeverity, Tone> = { CRIT: 'danger', HIGH: 'warn', MED: 'accent', LOW: 'muted' }

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Not available'

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-12 last:border-b-0 last:pb-0">
      <h3 className="text-label font-medium text-muted">{label}</h3>
      <p className="max-w-prose text-label text-ink">{children}</p>
    </div>
  )
}

export default function HackDetailView({ detail: d, state, act }: DetailViewProps<HackDetail>) {
  const patched = state === 'patched'
  const newIds = new Set(d.newVideoIds)
  const fresh = d.firstRun ? 0 : d.videos.filter((v) => newIds.has(v.id)).length
  return (
    <div className="flex flex-col gap-24">
      <div className="grid grid-cols-1 gap-24 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-12">
          <Block label="What the cheats advertise">{d.observed}</Block>
          <Block label="Likely cause (a hypothesis)">{d.cause}</Block>
          <Block label="Server-side fix">{d.fix}</Block>
          {d.briefSource === 'class-template' && (
            <p className="max-w-prose text-micro text-subtle">The written brief for this cluster failed the safety check twice, so this is general guidance for the class, not written from these videos.</p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-16">
          <dl>
            <KeyValue label="Class" value={d.cls} />
            <KeyValue label="Affected system" value={d.system} />
            <KeyValue label="Classifier confidence" value={<span className="tabular">{Math.round(d.confidence * 100)}%, can be wrong</span>} />
            <KeyValue label="Videos" value={<span className="tabular">{d.videos.length}</span>} />
            <KeyValue label="Total views" value={<span className="tabular">{fmtInt(d.totalViews)}</span>} />
            <KeyValue label="Views, last 14 days" value={<span className="tabular">{fmtInt(d.views14d)}</span>} />
            <KeyValue label="Earliest video" value={day(d.firstSeen)} />
            <KeyValue label="Latest video" value={day(d.latestSeen)} />
          </dl>
          <div className="flex flex-col gap-8">
            <h3 className="text-label font-medium text-muted">Severity rule</h3>
            <p className="text-label text-ink">
              <span className="text-muted">Applied here: </span>
              {d.severityReason.replace(/^(CRIT|HIGH|MED|LOW): /, '')}
            </p>
            <ul className="flex flex-col">
              {SEVERITY_RULES.map((r) => (
                <li key={r.severity} className="flex items-baseline gap-12 border-b border-line py-8 last:border-b-0">
                  <span className="w-48 shrink-0">
                    <Badge tone={SEV_TONE[r.severity]} className={r.severity === d.severity ? '' : 'opacity-60'}>
                      {r.severity}
                    </Badge>
                  </span>
                  <span className={r.severity === d.severity ? 'text-label text-ink' : 'text-label text-muted'}>{r.rule}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-16 gap-y-4">
          <h3 className="text-label font-medium text-muted">Videos in this cluster, most viewed first</h3>
          <span className="text-micro text-subtle">
            {d.firstRun ? 'First run: every video counts as new, so none is marked.' : fresh > 0 ? `${fresh} not seen in earlier runs.` : 'No video here is new since the last run.'}
          </span>
        </div>
        <Table caption={`YouTube videos advertising ${d.cls} on ${d.system}`}>
          <thead>
            <tr>
              <Th>Title</Th>
              <Th>Channel</Th>
              <Th numeric>Views</Th>
              <Th>Age</Th>
              <Th>YouTube link</Th>
            </tr>
          </thead>
          <tbody>
            {d.videos.map((v) => (
              <VideoRow key={v.id} v={v} isNew={!d.firstRun && newIds.has(v.id)} />
            ))}
          </tbody>
        </Table>
        <p className="text-micro text-subtle">Titles, channels, views and dates come from public YouTube pages read during the run. Views and dates marked exact come from the video page, the rest from search results. Only the video page link is shown, so you can verify and report the video.</p>
      </div>

      <div className="flex flex-wrap items-center gap-12 border-t border-line pt-12">
        {patched ? (
          <>
            <Badge tone="live" dot pulse={false}>
              Patched
            </Badge>
            <Button size="sm" icon={Undo2} onClick={() => act('open')}>
              Reopen
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" icon={Check} onClick={() => act('patched')}>
            Mark patched
          </Button>
        )}
        <span className="text-micro text-subtle">Marking patched is kept in this list only. Nothing is sent to your game or to YouTube.</span>
      </div>
    </div>
  )
}

function VideoRow({ v, isNew }: { v: HackVideo; isNew: boolean }) {
  return (
    <tr>
      <Td className="min-w-240 max-w-360 whitespace-normal">
        <span className="flex flex-col gap-4">
          <span className="text-ink">{v.title}</span>
          {(isNew || v.paidPromotion) && (
            <span className="flex flex-wrap items-center gap-6">
              {isNew && <Badge tone="accent">New</Badge>}
              {v.paidPromotion && <Badge tone="muted">Labelled paid promotion</Badge>}
            </span>
          )}
        </span>
      </Td>
      <Td className="whitespace-nowrap text-muted">
        {v.channelUrl ? (
          <a href={v.channelUrl} target="_blank" rel="noreferrer" title={v.channelUrl} className="hover:text-ink hover:underline">
            {v.channel ?? 'Channel'}
          </a>
        ) : (
          (v.channel ?? 'Not available')
        )}
      </Td>
      <Td numeric className="whitespace-nowrap" title={v.views === null ? undefined : fmtInt(v.views)}>
        {v.views === null ? 'Not available' : fmtCompact(v.views)}
      </Td>
      <Td className="whitespace-nowrap">
        <span className="flex flex-col">
          <span className="text-ink">{v.publishedText ?? 'Not available'}</span>
          {v.exact && v.publishedAt && <span className="text-micro text-subtle">{day(v.publishedAt)}</span>}
        </span>
      </Td>
      <Td className="min-w-240">
        <a href={v.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-6 rounded-8 font-mono text-micro text-accent-ink hover:underline">
          <ExternalLink aria-hidden className="size-12 shrink-0" />
          <span className="break-all">{v.url}</span>
        </a>
      </Td>
    </tr>
  )
}
