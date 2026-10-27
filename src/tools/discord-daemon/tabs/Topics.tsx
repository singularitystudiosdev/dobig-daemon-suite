import { useMemo, useState } from 'react'
import { MessagesSquare, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtInt } from '@/lib/format'
import { Badge, Button, EmptyState, Select, Table, Td, Th } from '@/components/ui'
import { CATEGORIES, quotesFor, type Category, type DiscordDataset } from '../data'
import { CategoryChip, ConfidenceChip, SentimentValue, TrendBadge, Unavailable } from '../parts'

/* Topics: the cluster table. Sentiment is people-weighted; rating is modelled, so it is labelled
   as an estimate rather than printed as if it were a vote count. */

export function TopicsTab({ dataset, onOpenQuotes }: { dataset: DiscordDataset; onOpenQuotes: (topicId: string | null, title: string, total: number) => void }) {
  const [category, setCategory] = useState<'all' | Category>('all')
  const filtered = useMemo(() => (category === 'all' ? dataset.topics : dataset.topics.filter((t) => t.category === category)), [dataset, category])
  const totals = useMemo(
    () => ({
      people: dataset.topics.reduce((a, t) => a + t.people, 0),
      messages: dataset.topics.reduce((a, t) => a + t.messages, 0),
    }),
    [dataset],
  )
  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-end justify-between gap-16">
        <div>
          <h3 className="text-title font-bold text-ink">Topic clusters</h3>
          <p className="mt-4 max-w-prose text-label text-muted">
            {dataset.metadataOnly
              ? 'Clusters are built from channel and author metadata, so the topic labels describe where people posted, not what they said.'
              : `${dataset.topics.length} clusters from ${fmtInt(totals.people)} people and ${fmtInt(totals.messages)} messages. Each row links back to its source messages.`}
          </p>
        </div>
        <label className="flex items-center gap-8 text-micro text-muted">
          <SlidersHorizontal aria-hidden className="size-14" />
          Category
          <Select value={category} onChange={(e) => setCategory(e.target.value as 'all' | Category)} className="w-180" aria-label="Filter topics by category">
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          sentence={`No topic in ${category} cleared the volume bar this window, so there is nothing to compare.`}
          actionLabel="Show all categories"
          onAction={() => setCategory('all')}
        />
      ) : (
        <Table caption="Topic clusters, people, messages, sentiment, estimated rating and trend">
          <thead>
            <tr>
              <Th>Topic</Th>
              <Th>Category</Th>
              <Th numeric>People</Th>
              <Th numeric>Messages</Th>
              <Th numeric>Sentiment</Th>
              <Th numeric>Rating, est.</Th>
              <Th>Trend</Th>
              <Th>Sample</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((topic) => {
              const sample = quotesFor(dataset, topic.id, 1)[0]
              return (
                <tr key={topic.id}>
                  <Td>
                    <div className="flex min-w-0 flex-col gap-4">
                      <span className="text-label font-medium text-ink">{topic.label}</span>
                      <span className="font-mono text-micro text-subtle">{topic.channel}</span>
                      {topic.confidence !== 'high' && <ConfidenceChip confidence={topic.confidence} />}
                    </div>
                  </Td>
                  <Td>
                    <CategoryChip category={topic.category} />
                  </Td>
                  <Td numeric>{fmtInt(topic.people)}</Td>
                  <Td numeric>{fmtInt(topic.messages)}</Td>
                  <Td numeric>
                    <SentimentValue value={topic.sentiment} available={!dataset.metadataOnly} />
                  </Td>
                  <Td numeric>
                    {dataset.metadataOnly ? (
                      <Unavailable />
                    ) : (
                      <span className="inline-flex items-baseline justify-end gap-4">
                        <span className="tabular font-mono text-label text-ink">{topic.rating.toFixed(1)}</span>
                        <span className="text-micro text-subtle">est.</span>
                      </span>
                    )}
                  </Td>
                  <Td>
                    <TrendBadge trend={topic.trend} />
                  </Td>
                  <Td>
                    <div className="flex max-w-240 items-start gap-8">
                      <p className={cn('min-w-0 flex-1 truncate text-micro', dataset.metadataOnly ? 'text-subtle' : 'text-muted')}>
                        {dataset.metadataOnly ? 'Content unreadable (4014)' : sample?.text ? `"${sample.text}" ${sample.author}` : 'No quote in this window'}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Open messages behind ${topic.label}`}
                        onClick={() => onOpenQuotes(topic.id, topic.label, topic.messages)}
                        className="shrink-0"
                      >
                        Open
                      </Button>
                    </div>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      <div className="flex flex-wrap items-center justify-between gap-8 border-t border-line pt-12">
        <p className="text-micro text-muted">Sentiment runs from -1 to +1 and is people-weighted. Rating is modelled from sentiment and volume, not a star vote.</p>
        <Badge tone={dataset.metadataOnly ? 'warn' : 'muted'}>
          {dataset.metadataOnly ? 'Sentiment needs MESSAGE_CONTENT' : 'Every row links to source messages'}
        </Badge>
      </div>
    </div>
  )
}
