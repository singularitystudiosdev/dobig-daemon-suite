import type { ReactNode } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { Badge, Button, KeyValue, useToast } from '@/components/ui'
import type { CreatorDetail, CreatorFitComponent, CreatorTier } from '@/lib/details/creator'
import { fmtCompact, fmtInt } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import { cn } from '@/lib/cn'
import type { DetailViewProps } from './types'

/* Creator Dox detail: one real YouTube creator. Every figure here was read from public pages or computed in
   server/tools/creator-score.ts from those figures; the fit formula shown is the formula in that file. */

const tierTone: Record<CreatorTier, Tone> = { 'Strong fit': 'live', 'Good fit': 'accent', 'Weak fit': 'muted', Risky: 'danger' }
const confTone: Record<string, Tone> = { high: 'danger', medium: 'warn', low: 'muted' }

function Section({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-8', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-12 gap-y-2">
        <h3 className="text-label font-medium text-muted">{label}</h3>
        {hint && <span className="text-micro text-subtle">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function ExactLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" title={href} className="inline-flex min-w-0 max-w-full items-center gap-6 rounded-8 text-micro text-accent-ink hover:underline">
      <ExternalLink aria-hidden className="size-12 shrink-0" />
      <span className="min-w-0 truncate">{children ?? href}</span>
    </a>
  )
}

const views = (n: number | null): string => (n === null ? 'Not available' : fmtInt(n))
const pct = (r: number | null, d = 1): string => (r === null ? 'Not available' : `${(r * 100).toFixed(d)}%`)

function FitRow({ c }: { c: CreatorFitComponent }) {
  const ratio = c.max ? c.points / c.max : 0
  return (
    <li className="flex flex-col gap-4 border-b border-line py-8 last:border-b-0">
      <div className="flex items-baseline justify-between gap-12">
        <span className="text-label font-medium text-ink">{c.label}</span>
        <span className="tabular whitespace-nowrap text-label text-ink">
          {c.points} <span className="text-muted">of {c.max}</span>
        </span>
      </div>
      <div className="h-4 overflow-hidden rounded-full bg-raised" aria-hidden>
        <div className={cn('h-full rounded-full', ratio >= 0.7 ? 'bg-live' : ratio >= 0.35 ? 'bg-accent' : 'bg-line-strong')} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <p className="text-micro text-muted">{c.basis}</p>
    </li>
  )
}

export default function CreatorDetailView({ detail: d, state, act }: DetailViewProps<CreatorDetail>) {
  const toast = useToast()
  const contacted = state === 'contacted'
  const sp = d.sponsorship
  const bs = d.brandSafety
  const fetched = d.fetchedAt.slice(0, 16).replace('T', ' ')

  const copy = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email)
      toast.push({ title: 'Address copied', description: email, tone: 'ok' })
    } catch {
      toast.push({ title: 'Could not copy', description: 'Select the address and copy it by hand.', tone: 'warn' })
    }
  }

  return (
    <div className="flex flex-col gap-16">
      <header className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-center gap-x-12 gap-y-6">
          <h3 className="text-title font-medium text-ink">{d.channel.name}</h3>
          {d.channel.handle && <span className="text-label text-muted">@{d.channel.handle}</span>}
          <Badge tone={tierTone[d.fit.tier]}>{d.fit.tier}</Badge>
          {contacted && (
            <Badge tone="live" dot pulse={false}>
              Contacted
            </Badge>
          )}
        </div>
        <ExactLink href={d.channel.url} />
        <p className="max-w-prose text-label text-muted">
          {d.channel.description ? d.channel.description : 'This channel has no public description.'}
        </p>
        <p className="text-micro text-subtle">
          Read from public YouTube pages at {fetched} UTC for {d.game}. Subscribers and most view counts are the rounded figures YouTube shows.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-24 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-16">
          <Section label="Partnership fit" hint="Fit = coverage 30 + views per subscriber 25 + sponsorship 20 + brand safety 15 + cadence 10">
            <div className="flex items-baseline gap-8">
              <span className="tabular text-headline text-ink">{d.fit.score}</span>
              <span className="text-label text-muted">out of 100</span>
            </div>
            <ul className="flex flex-col">
              {d.fit.components.map((c) => (
                <FitRow key={c.label} c={c} />
              ))}
            </ul>
            <p className="text-micro text-subtle">Strong fit is 75 or more, Good fit 55 or more, otherwise Weak fit. Any high-confidence brand-safety flag makes it Risky whatever the score.</p>
          </Section>

          <Section label="Reach" hint={`Last ${d.stats.sampleSize} uploads`}>
            <dl>
              <KeyValue label="Subscribers" value={d.channel.subscribers === null ? 'Hidden by the channel' : fmtCompact(d.channel.subscribers)} />
              <KeyValue label="Median views" value={views(d.stats.median)} />
              <KeyValue label="Mean views" value={views(d.stats.mean)} />
              <KeyValue label="Views per subscriber" value={pct(d.stats.viewsPerSub)} />
              <KeyValue label="Upload cadence" value={d.stats.cadenceDays === null ? 'Not available' : d.stats.cadenceDays < 1 ? 'More than one a day' : `Every ${d.stats.cadenceDays} days`} />
              <KeyValue label={`Uploads about ${d.game}`} value={`${d.stats.gameUploads} of ${d.stats.uploadsRead} (${pct(d.stats.gameShare, 0)})`} />
              <KeyValue label="Exact view counts" value={`${d.stats.exactViews} of ${d.stats.sampleSize}`} />
            </dl>
            <p className="text-micro text-subtle">Cadence is estimated from approximate ages such as "3 days ago". Exact counts come from each video's own page; the rest are the rounded figures on the channel page.</p>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-16">
          <Section label="Sponsorship" hint={`${sp.sampled} recent uploads sampled`}>
            {sp.sampled === 0 ? (
              <p className="text-label text-muted">No watch pages could be read, so sponsorship was not checked.</p>
            ) : (
              <>
                <dl>
                  <KeyValue label="Sponsored share" value={`${pct(sp.share, 0)} (${sp.sponsored} of ${sp.sampled})`} />
                  <KeyValue label="Median views, sponsored" value={sp.sponsored ? views(sp.sponsoredMedian) : 'No sponsored sample'} />
                  <KeyValue label="Median views, organic" value={sp.organic ? views(sp.organicMedian) : 'No organic sample'} />
                  <KeyValue
                    label="Sponsored vs organic"
                    value={sp.deltaPct === null ? 'Not enough sponsored videos to compare' : `${sp.deltaPct > 0 ? '+' : ''}${sp.deltaPct}% median views`}
                  />
                </dl>
                <p className="text-micro text-subtle">
                  Sponsored means YouTube's paid-promotion label, or #ad, sponsored, paid promotion, partnered with, use code or affiliate in the title or description. A comparison needs 3 sponsored and 3 organic samples.
                </p>
                <div className="flex flex-wrap items-center gap-8">
                  <span className="text-label text-muted">Brands named</span>
                  {sp.brands.length ? sp.brands.map((b) => <Badge key={b}>{b}</Badge>) : <span className="text-label text-ink">{sp.sponsored ? 'None named in the descriptions' : 'No sponsored videos sampled'}</span>}
                </div>
                {sp.examples.length > 0 && (
                  <ul className="flex flex-col">
                    {sp.examples.map((e) => (
                      <li key={e.url} className="flex min-w-0 flex-col gap-2 border-b border-line py-8 last:border-b-0">
                        <span className="text-label text-ink">{e.title}</span>
                        <span className="text-micro text-muted">
                          {e.views === null ? 'Views not shown' : `${fmtInt(e.views)} views`}. Disclosure: {e.disclosure}
                        </span>
                        <ExactLink href={e.url} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Section>

          <Section label="Brand safety" hint={`${bs.checked} recent titles read`}>
            {bs.unavailable ? (
              <p className="text-label text-warn">The brand-safety check did not run: {bs.unavailable}. Rerun to try again.</p>
            ) : bs.flags.length === 0 ? (
              <p className="text-label text-ink">No concerns found in {bs.checked} recent titles.</p>
            ) : (
              <ul className="flex flex-col">
                {bs.flags.map((f) => (
                  <li key={`${f.category}-${f.url}`} className="flex min-w-0 flex-col gap-2 border-b border-line py-8 last:border-b-0">
                    <span className="flex flex-wrap items-center gap-8">
                      <Badge tone={confTone[f.confidence] ?? 'muted'}>{f.category}</Badge>
                      <span className="text-micro text-muted">{f.confidence} confidence</span>
                    </span>
                    <span className="text-label text-ink">{f.evidenceTitle}</span>
                    <ExactLink href={f.url} />
                  </li>
                ))}
              </ul>
            )}
            <p className="text-micro text-subtle">
              {bs.familySafe === null ? 'YouTube did not include a family-safe marker.' : bs.familySafe ? 'YouTube marks this channel family safe.' : 'YouTube does not mark this channel family safe.'}
            </p>
          </Section>

          <Section label="Public business contact">
            {d.contact.email ? (
              <div className="flex flex-wrap items-center gap-12">
                <span className="min-w-0 break-all font-mono text-label text-ink">{d.contact.email}</span>
                <Button size="sm" icon={Copy} onClick={() => void copy(d.contact.email as string)}>
                  Copy
                </Button>
              </div>
            ) : (
              <p className="text-label text-ink">No public business contact</p>
            )}
            {d.contact.lines.length > 0 && (
              <ul className="flex flex-col gap-4">
                {d.contact.lines.map((l) => (
                  <li key={l} className="break-words text-micro text-muted">
                    {l}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-micro text-subtle">Only text the creator published in their channel description. YouTube keeps the "business email" behind a captcha, so it is never read.</p>
          </Section>
        </div>
      </div>

      <Section label={`Videos about ${d.game}`} hint="Newest first">
        {d.gameVideos.length === 0 ? (
          <p className="text-label text-muted">No video about {d.game} was found in the last {d.stats.uploadsRead} uploads or the searches.</p>
        ) : (
          <ul className="flex flex-col">
            {d.gameVideos.map((v) => (
              <li key={v.url} className="flex flex-wrap items-start gap-x-16 gap-y-2 border-b border-line py-8 last:border-b-0">
                <div className="flex min-w-0 flex-1 basis-240 flex-col gap-2">
                  <span className="text-label text-ink">{v.title}</span>
                  <ExactLink href={v.url} />
                </div>
                <span className="tabular whitespace-nowrap text-label text-ink">{v.views === null ? 'Views not shown' : `${fmtInt(v.views)} views`}</span>
                <span className="whitespace-nowrap text-micro text-muted">{v.publishedText}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {d.talkingPoints.length > 0 && (
        <Section label="Talking points" hint="Written by the analysis model from the videos above">
          <ul className="flex max-w-prose flex-col gap-4 text-label text-ink">
            {d.talkingPoints.map((t) => (
              <li key={t} className="flex gap-8">
                <span aria-hidden className="mt-8 size-4 shrink-0 rounded-full bg-accent" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-12 border-t border-line pt-12">
        {contacted ? (
          <Badge tone="live" dot pulse={false}>
            Contacted
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon={Check}
            onClick={() => {
              act('contacted')
              toast.push({ title: 'Marked as contacted', description: `${d.channel.name} is tracked as contacted in this session.`, tone: 'ok' })
            }}
          >
            Mark as contacted
          </Button>
        )}
        <span className="text-micro text-subtle">Kept in this session only. Nothing is sent to the creator.</span>
      </div>
      <p className="flex flex-wrap gap-x-12 border-t border-line pt-12 text-label">
        <span className="font-medium text-muted">Not collected</span>
        <span className="text-ink">{d.notCollected.replace(/^Not collected:\s*/i, '')}</span>
      </p>
    </div>
  )
}
