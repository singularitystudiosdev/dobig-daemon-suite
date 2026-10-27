import type { ReactNode } from 'react'
import { Check, Copy, Gavel, ShieldCheck, Undo2, X } from 'lucide-react'
import { Badge, Button, KeyValue, useToast } from '@/components/ui'
import { fmtCompact, fmtInt, fmtPct, fmtUsdRange } from '@/lib/format'

import { ATTESTATION } from '@/tools/dmca-daemon/data'
import type { CreatorDetail, DescriptionDetail, DiscordDetail, DmcaDetail, Finding, HackDetail } from './types'

/* The expanded region of a row: a plain bordered block with the tool-specific detail and its actions. */

type SetState = (id: string, state: string | undefined) => void

export function FindingDetailView({ finding, state, setState }: { finding: Finding; state: string | undefined; setState: SetState }) {
  const d = finding.detail
  switch (d.kind) {
    case 'hack':
      return <HackView id={finding.id} d={d} state={state} setState={setState} />
    case 'dmca':
      return <DmcaView id={finding.id} title={finding.title} d={d} state={state} setState={setState} />
    case 'discord':
      return <DiscordView d={d} />
    case 'description':
      return <DescriptionView d={d} />
    case 'creator':
      return <CreatorView d={d} />
  }
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-12 last:border-b-0 last:pb-0">
      <h3 className="text-label font-medium text-muted">{label}</h3>
      <div className="max-w-prose text-label text-ink">{children}</div>
    </div>
  )
}

function Split({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-24 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-12">{left}</div>
      <div className="flex min-w-0 flex-col gap-12">{right}</div>
    </div>
  )
}

/* Hack Daemon: observed behaviour, likely cause, server-side fix, sources with links withheld. */
function HackView({ id, d, state, setState }: { id: string; d: HackDetail; state: string | undefined; setState: SetState }) {
  const toast = useToast()
  const patched = state === 'patched'
  return (
    <div className="flex flex-col gap-16">
      <Split
        left={
          <>
            <Block label="Observed behaviour">{d.observed}</Block>
            <Block label="Likely cause">{d.cause}</Block>
            <Block label="Server-side fix">{d.fix}</Block>
          </>
        }
        right={
          <>
            <dl>
              <KeyValue label="Class" value={d.cls} />
              <KeyValue label="Affected system" value={`${d.system} (${d.side})`} />
              <KeyValue label="Confidence" value={d.confidence} />
              <KeyValue label="Trend" value={d.trend} />
              <KeyValue label="First seen" value={d.firstSeen} />
            </dl>
            <div className="flex flex-col gap-4">
              <h3 className="text-label font-medium text-muted">Sources</h3>
              <ul>
                {d.sources.map((s) => (
                  <li key={s.title + s.channel} className="flex flex-wrap items-center gap-x-12 gap-y-4 border-b border-line py-8 last:border-b-0">
                    <span className="font-mono text-micro text-subtle">[link withheld]</span>
                    <span className="min-w-0 flex-1 basis-160 text-label text-ink">
                      {s.title} <span className="text-muted">by {s.channel}</span>
                    </span>
                    <span className="tabular text-micro text-muted">{fmtCompact(s.views)} views</span>
                    <Badge tone="danger">{s.verdict}</Badge>
                  </li>
                ))}
              </ul>
              {d.moreSources > 0 && <p className="text-micro text-subtle">{d.moreSources} more videos in this cluster, links withheld.</p>}
            </div>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-12 border-t border-line pt-12">
        {patched ? (
          <>
            <Badge tone="live" dot pulse={false}>
              Patched
            </Badge>
            <Button size="sm" icon={Undo2} onClick={() => setState(id, undefined)}>
              Reopen
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon={Check}
            onClick={() => {
              setState(id, 'patched')
              toast.push({ title: 'Marked patched', description: `${d.system} is now tracked as patched in this demo.`, tone: 'ok' })
            }}
          >
            Mark patched
          </Button>
        )}
        <span className="text-micro text-subtle">Kept in this session only. Nothing is sent to your game.</span>
      </div>
    </div>
  )
}

/* DMCA Daemon: the evidence, and the lane's action. Review rows are the only ones with buttons. */
function DmcaView({ id, title, d, state, setState }: { id: string; title: string; d: DmcaDetail; state: string | undefined; setState: SetState }) {
  const toast = useToast()
  return (
    <div className="flex flex-col gap-16">
      <Split
        left={
          <dl>
            <KeyValue label="Matched asset" value={d.assetName ?? 'Creator Store asset'} />
            <KeyValue label="Asset id" value={d.assetId ? String(d.assetId) : 'Not registered'} mono />
            <KeyValue label="Hash type" value={d.hashType} />
            <KeyValue label="Similarity" value={d.similarity === undefined ? '100%, identical bytes' : `${Math.round(d.similarity * 100)}%, modelled`} />
            <KeyValue label="Evidence" value={d.evidence} mono />
          </dl>
        }
        right={
          <dl>
            <KeyValue label="Experience" value={`${title} (place ${d.placeId})`} />
            <KeyValue label="Creator" value={d.creator} />
            <KeyValue label="Found via" value={d.source} />
            <KeyValue label="Detected" value={d.detectedAt} />
          </dl>
        }
      />
      {d.note && <p className="max-w-prose text-label text-muted">{d.note}</p>}
      <div className="flex flex-wrap items-center gap-12 border-t border-line pt-12">
        {d.lane === 'auto-file' && (
          <>
            <Badge tone="live">
              <ShieldCheck aria-hidden className="size-12" />
              Filed under standing attestation
            </Badge>
            <span className="text-micro text-subtle">{ATTESTATION.scope}</span>
          </>
        )}
        {d.lane === 'cleared' && (
          <>
            <Badge tone="muted">Cleared</Badge>
            <span className="text-label text-muted">Licensed Creator Store assets are cleared. No notice is filed, because a wrong takedown carries legal liability.</span>
          </>
        )}
        {d.lane === 'review' && state === undefined && (
          <>
            <Button
              size="sm"
              variant="primary"
              icon={Gavel}
              onClick={() => {
                setState(id, 'filed')
                toast.push({ title: 'Approved and filed', description: `${title} was added to the reviewed request.`, tone: 'ok' })
              }}
            >
              Approve
            </Button>
            <Button
              size="sm"
              icon={X}
              onClick={() => {
                setState(id, 'dismissed')
                toast.push({ title: 'Dismissed', description: `${title} will not be filed.`, tone: 'info' })
              }}
            >
              Dismiss
            </Button>
            <span className="text-micro text-subtle">A person decides: perceptual matches are never auto-filed.</span>
          </>
        )}
        {d.lane === 'review' && state !== undefined && (
          <>
            <Badge tone={state === 'filed' ? 'live' : 'muted'}>{state === 'filed' ? 'Filed after your approval' : 'Dismissed, nothing filed'}</Badge>
            <Button size="sm" icon={Undo2} onClick={() => setState(id, undefined)}>
              Undo
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/* Discord Daemon: counts, estimated rating, the mood drops that cite the topic, short fictional quotes. */
function DiscordView({ d }: { d: DiscordDetail }) {
  return (
    <Split
      left={
        <>
          <dl>
            <KeyValue label="People" value={fmtInt(d.people)} />
            <KeyValue label="Messages" value={fmtInt(d.messages)} />
            <KeyValue label="Rating (estimated)" value={`${d.rating.toFixed(1)} of 5`} />
            <KeyValue label="Sentiment (estimated)" value={d.sentiment.toFixed(2)} />
            <KeyValue label="Main channel" value={d.channel} mono />
            <KeyValue label="Confidence" value={d.confidence} />
          </dl>
          {d.confidenceNote && <p className="text-micro text-subtle">{d.confidenceNote}</p>}
        </>
      }
      right={
        <>
          <Block label="Mood drops that cite this topic">
            {d.causes.length === 0 ? (
              <span className="text-muted">No mood drop cites this topic.</span>
            ) : (
              <ul className="flex flex-col gap-4">
                {d.causes.map((c) => (
                  <li key={c.date} className="tabular">
                    {c.date}: mood {c.delta.toFixed(2)}, {c.confidence}% likely cause
                  </li>
                ))}
              </ul>
            )}
          </Block>
          <Block label="What people said">
            <ul className="flex flex-col gap-8">
              {d.quotes.map((q) => (
                <li key={q.author + q.text} className="flex flex-col gap-2">
                  <span>&ldquo;{q.text}&rdquo;</span>
                  <span className="text-micro text-subtle">
                    {q.author}, {q.tone}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        </>
      }
    />
  )
}

/* Description Daemon: the full draft with flagged spans struck, lint results and the predicted interval. */
function DescriptionView({ d }: { d: DescriptionDetail }) {
  const toast = useToast()
  const lift = d.lift
  const liftText = !lift ? 'Not estimated: blocked before any test' : d.live ? '0.00pp, the control by definition' : `${sign(lift.lo)} to ${sign(lift.hi)}pp, 95% interval`
  return (
    <div className="flex flex-col gap-16">
      <Split
        left={
          <Block label={`${d.variant}, full draft`}>
            <p className="scroll-thin max-h-240 overflow-y-auto whitespace-pre-line pr-8">
              {d.text.map((seg, i) => (seg.struck ? <s key={i} className="text-danger">{seg.text}</s> : <span key={i}>{seg.text}</span>))}
            </p>
          </Block>
        }
        right={
          <>
            <div className="flex flex-col gap-4">
              <h3 className="text-label font-medium text-muted">Lint results</h3>
              <ul>
                {d.lint.map((l) => (
                  <li key={l.title} className="flex items-start gap-8 border-b border-line py-8 last:border-b-0">
                    {l.passed ? <Check aria-hidden className="mt-2 size-16 shrink-0 text-live" /> : <X aria-hidden className="mt-2 size-16 shrink-0 text-danger" />}
                    <span className="text-label text-ink">
                      {l.title}
                      <span className={`ml-8 text-micro ${l.passed ? 'text-subtle' : 'text-danger'}`}>{l.passed ? 'passed' : `flagged: ${l.flags}`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <dl>
              <KeyValue label="Predicted play-through lift (modelled)" value={liftText} />
              {lift && !d.live && <KeyValue label="Midpoint" value={`${sign(lift.mid)}pp`} />}
              <KeyValue label="Baseline play-through" value={`${d.baseline.toFixed(2)}%`} />
              <KeyValue label="Length" value={`${fmtInt(d.chars)} characters`} />
            </dl>
            <p className="max-w-prose text-micro text-subtle">One change at a time: only the description changes during the 7 day hold, so any shift in play-through can be put down to the copy.</p>
          </>
        }
      />
      {!d.blocked && !d.live && (
        <div className="flex flex-wrap items-center gap-12 border-t border-line pt-12">
          <Button
            size="sm"
            icon={Copy}
            onClick={() => {
              const text = d.text.map((s) => s.text).join('')
              void navigator.clipboard?.writeText(text)
              toast.push({ title: 'Draft copied', description: `${d.variant} is on your clipboard.`, tone: 'ok' })
            }}
          >
            Copy draft
          </Button>
        </div>
      )}
    </div>
  )
}

const sign = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`

/* Creator Dox: the sponsorship split, earnings as a range, a public business contact, and what is never collected. */
function CreatorView({ d }: { d: CreatorDetail }) {
  return (
    <div className="flex flex-col gap-16">
      <Split
        left={
          <>
            <Block label="Sponsorship split">{d.sponsorLine}</Block>
            <dl>
              <KeyValue label="Engagement, organic" value={fmtPct(d.erOrganic)} />
              <KeyValue label="Engagement, sponsored" value={fmtPct(d.erSponsored)} />
              <KeyValue label="Estimated earnings per month (range)" value={fmtUsdRange(d.earnings[0], d.earnings[1])} />
              <KeyValue label="Public business contact" value={d.email ?? 'None published'} mono />
            </dl>
          </>
        }
        right={
          <>
            <dl>
              <KeyValue label="Quality score, total" value={String(d.cqs.total)} />
              <KeyValue label="Influence" value={String(d.cqs.influence)} />
              <KeyValue label="Audience" value={String(d.cqs.audience)} />
              <KeyValue label="Credibility" value={String(d.cqs.credibility)} />
              <KeyValue label="Engagement" value={String(d.cqs.engagement)} />
            </dl>
            {d.talking.length > 0 && (
              <Block label="Talking points">
                <ul className="flex flex-col gap-4">
                  {d.talking.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </Block>
            )}
          </>
        }
      />
      <p className="flex flex-wrap gap-x-12 border-t border-line pt-12 text-label">
        <span className="font-medium text-muted">Not collected</span>
        <span className="text-ink">Home address, phone, family, private data</span>
      </p>
    </div>
  )
}
