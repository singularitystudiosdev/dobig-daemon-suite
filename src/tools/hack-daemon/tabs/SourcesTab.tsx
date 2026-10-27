import { useState } from 'react'
import { ListFilter } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDayTime, fmtInt } from '@/lib/format'
import { Badge, Button, EmptyState, Field, Select, Table, Td, Th } from '@/components/ui'
import { verdictLabel, type ExploitCluster, type SourceVideo, type Verdict } from '../data'
import { clsDot } from '../ExploitMap'
import { Withheld, verdictTone } from '../shared'

const PAGE = 20
const VERDICTS: Verdict[] = ['real', 'key-system bait', 'malware', 'fake', 're-upload']

export function SourcesTab({ sources, clusters }: { sources: SourceVideo[]; clusters: ExploitCluster[] }) {
  const [verdict, setVerdict] = useState<Verdict | 'all'>('all')
  const [all, setAll] = useState(false)
  const byId = new Map(clusters.map((c) => [c.id, c]))
  const filtered = verdict === 'all' ? sources : sources.filter((v) => v.verdict === verdict)
  const rows = all ? filtered : filtered.slice(0, PAGE)
  const count = (v: Verdict) => sources.filter((s) => s.verdict === v).length

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-end justify-between gap-16">
        <Field label="Verdict" className="w-240">
          {(id) => (
            <Select id={id} value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict | 'all')}>
              <option value="all">All verdicts ({sources.length})</option>
              {VERDICTS.map((v) => (
                <option key={v} value={v}>
                  {verdictLabel[v]} ({count(v)})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="max-w-prose text-micro text-muted">Titles and channels are fictional stand-ins. Source links are withheld so this page never routes anyone to a seller or a download.</p>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={ListFilter} sentence="No videos carry this verdict in this run." actionLabel="Show all verdicts" onAction={() => setVerdict('all')} />
      ) : (
        <>
          <Table caption="Crawled videos and their verdicts">
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Channel</Th>
                <Th>Published</Th>
                <Th numeric>Views</Th>
                <Th>Verdict</Th>
                <Th>Link</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const c = v.clusterId ? byId.get(v.clusterId) : undefined
                return (
                  <tr key={v.videoId}>
                    <Td className="min-w-280">
                      <span className="flex flex-col gap-2">
                        <span className={cn('line-clamp-1', v.verdict !== 'real' && 'text-muted line-through decoration-danger')}>{v.title}</span>
                        <span className="flex items-center gap-8 text-micro text-subtle">
                          <span className="font-mono">{v.videoId}</span>
                          {c && (
                            <span className="flex items-center gap-4 text-muted">
                              <span aria-hidden className={cn('size-6 rounded-full', clsDot[c.cls])} />
                              {c.cls}
                            </span>
                          )}
                        </span>
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{v.channel}</Td>
                    <Td className="tabular whitespace-nowrap text-muted">{fmtDayTime(v.publishedAt)}</Td>
                    <Td numeric>{fmtInt(v.viewCount)}</Td>
                    <Td>
                      <Badge tone={verdictTone[v.verdict]}>{verdictLabel[v.verdict]}</Badge>
                    </Td>
                    <Td>
                      <Withheld />
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          {filtered.length > PAGE && (
            <Button size="sm" className="self-start" onClick={() => setAll((a) => !a)}>
              {all ? `Show first ${PAGE}` : `Show all ${filtered.length}`}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
