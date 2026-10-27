import { useId, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, FileCheck2, ShieldAlert, Undo2, X } from 'lucide-react'
import { Badge, Button, useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { DmcaDetail, DmcaImagePair, DmcaLane } from '@/lib/details/dmca'
import type { Tone } from '@/lib/tone'
import type { DetailViewProps } from './types'

/* DMCA Daemon detail: the exact game link first, then the real evidence (image pairs with their hash distance, text
   overlap), the rule that chose the lane, and the notice draft. Filing is a human step: nothing here files anything. */

const LANE_LABEL: Record<DmcaLane, string> = { identical: 'Identical image', near: 'Near-identical image', review: 'Needs review', weak: 'Weak signal' }
const LANE_TONE: Record<DmcaLane, Tone> = { identical: 'danger', near: 'danger', review: 'warn', weak: 'muted' }

const linkClass = 'break-all font-mono text-label text-accent-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent-ink'

function Section({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-12 border-t border-line pt-16">
      <div className="flex flex-col gap-2">
        <h3 className="text-label font-medium text-ink">{label}</h3>
        {hint && <p className="max-w-prose text-micro text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function ExternalLinkText({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn(linkClass, className)}>
      {children}
      <ExternalLink aria-hidden className="ml-4 inline size-12 align-baseline" />
    </a>
  )
}

function Frame({ src, label }: { src: string; label: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')
  return (
    <figure className="flex min-w-0 flex-col gap-4">
      <div className="relative aspect-video overflow-hidden rounded-8 border border-line bg-raised">
        {state === 'loading' && <span aria-hidden className="absolute inset-0 bg-raised motion-safe:animate-pulse" />}
        {state === 'failed' ? (
          <span className="absolute inset-0 flex items-center justify-center px-12 text-center text-micro text-muted">This image could not be loaded here. Open the game to see it.</span>
        ) : (
          <img
            src={src}
            alt={label}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setState('ok')}
            onError={() => setState('failed')}
            className={cn('size-full object-cover transition-opacity duration-200 motion-reduce:transition-none', state === 'ok' ? 'opacity-100' : 'opacity-0')}
          />
        )}
      </div>
      <figcaption className="text-micro text-muted">{label}</figcaption>
    </figure>
  )
}

function Pair({ pair, index }: { pair: DmcaImagePair; index: number }) {
  return (
    <li className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-8">
        <Frame src={pair.ours} label="Yours" />
        <Frame src={pair.theirs} label="Theirs" />
      </div>
      <div className="flex flex-wrap items-center gap-8">
        {pair.identical ? (
          <Badge tone="danger">
            <Check aria-hidden className="size-12" />
            Identical bytes
          </Badge>
        ) : (
          <Badge tone={pair.distance <= 2 ? 'danger' : pair.distance <= 10 ? 'warn' : 'muted'}>Hash distance {pair.distance} of 64</Badge>
        )}
        <span className="text-micro text-muted">Colour match {Math.round(pair.colorSimilarity * 100)}%</span>
        <span className="sr-only">Pair {index + 1}</span>
      </div>
    </li>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-8 bg-raised px-12 py-8">
      <span className="text-micro text-muted">{label}</span>
      <span className="tabular text-stat font-bold text-ink">{value}</span>
      <span className="text-micro text-subtle">{note}</span>
    </div>
  )
}

export default function DmcaDetailView({ finding, detail: d, state, act }: DetailViewProps<DmcaDetail>) {
  const toast = useToast()
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const areaId = useId()
  const [copied, setCopied] = useState(false)
  const c = d.candidate
  const checked = d.checked ? new Date(d.checked).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not available'
  const pageInfo = [`${c.playing.toLocaleString('en-US')} playing`, `${c.visits.toLocaleString('en-US')} visits`, c.created ? `created ${c.created.slice(0, 10)}` : null].filter(Boolean).join(', ')

  async function copyNotice() {
    try {
      await navigator.clipboard.writeText(d.notice)
    } catch {
      areaRef.current?.select()
      document.execCommand('copy')
    }
    setCopied(true)
    toast.push({ title: 'Notice copied', description: 'Complete every bracketed item before you file it.', tone: 'ok' })
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-16">
      <section aria-label="Exact game link" className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center gap-8">
          <h3 className="text-label font-medium text-ink">Game link</h3>
          <Badge tone={LANE_TONE[d.lane]}>{LANE_LABEL[d.lane]}</Badge>
        </div>
        <ExternalLinkText href={c.url} className="w-fit text-body">
          {c.url}
        </ExternalLinkText>
        <p className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-label text-muted">
          <span>Creator {c.creatorType ? `(${c.creatorType.toLowerCase() === 'group' ? 'community' : 'user'})` : ''}:</span>
          <ExternalLinkText href={c.creatorUrl}>{c.creatorUrl}</ExternalLinkText>
          <span className="text-ink">{c.creatorName}</span>
        </p>
        <p className="text-micro text-muted">
          {pageInfo}. Compared against your game <ExternalLinkText href={d.ours.url} className="text-micro">{d.ours.url}</ExternalLinkText> on {checked}.
        </p>
      </section>

      <Section label="Why it is in this lane" hint="The lane rules are fixed in the analyzer. A perceptual or text match is never certain.">
        <p className="max-w-prose text-label text-ink">{d.ruleExplanation}</p>
        <dl className="flex flex-col">
          {(['identical', 'near', 'review', 'weak'] as const).map((lane) => (
            <div key={lane} className={cn('flex flex-col gap-2 border-b border-line py-8 last:border-b-0 sm:flex-row sm:gap-16', lane !== d.lane && 'opacity-70')}>
              <dt className="flex shrink-0 items-start sm:w-136">
                <Badge tone={LANE_TONE[lane]}>{LANE_LABEL[lane]}</Badge>
              </dt>
              <dd className="max-w-prose text-micro text-muted">
                {d.laneRules[lane]}
                {lane === d.lane && <span className="font-medium text-ink"> This game is here.</span>}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section
        label="Image evidence"
        hint={`Your game against theirs. Hash distance counts the differing bits of a 64-bit picture fingerprint: 0 is the same picture, about 32 is unrelated. ${d.imagesCompared.theirs} of their images were compared with ${d.imagesCompared.ours} of yours.`}
      >
        {d.imagePairs.length ? (
          <ul className="grid grid-cols-1 gap-16 lg:grid-cols-2">
            {d.imagePairs.map((p, i) => (
              <Pair key={`${p.ours}|${p.theirs}`} pair={p} index={i} />
            ))}
          </ul>
        ) : (
          <p className="max-w-prose text-label text-muted">None of their images could be fetched and compared, so this lane rests on the text alone. Open the game to look yourself.</p>
        )}
      </Section>

      <Section label="Text evidence" hint="Name similarity is the mean of word overlap and spelling closeness. Description similarity is the share of 5-word runs that appear in both descriptions.">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          <Stat label="Name similarity" value={`${Math.round(d.nameSimilarity * 100)}%`} note={`Yours: ${d.ours.name}`} />
          <Stat label="Description similarity" value={`${Math.round(d.descriptionSimilarity * 100)}%`} note={d.sharedPhrases.length ? `${d.sharedPhrases.length} shared phrase${d.sharedPhrases.length === 1 ? '' : 's'}` : 'No shared 5-word phrase'} />
        </div>
        {d.sharedPhrases.length > 0 && (
          <div className="flex flex-col gap-4">
            <span className="text-micro text-muted">Phrases in both descriptions</span>
            <ul className="flex flex-col gap-4">
              {d.sharedPhrases.map((p) => (
                <li key={p} className="border-l-2 border-line-strong pl-12 font-mono text-micro text-ink">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
        {c.descriptionExcerpt && (
          <p className="max-w-prose text-micro text-muted">
            <span className="text-ink">Their description: </span>
            {c.descriptionExcerpt}
          </p>
        )}
        {d.modelNote && (
          <p className="max-w-prose text-label text-muted">
            <span className="font-medium text-ink">Model note, not a verdict: </span>
            {d.modelNote}
          </p>
        )}
      </Section>

      <Section label="Takedown notice draft" hint="Facts come from this comparison. Your name, contact, good-faith and accuracy statements are bracketed for you to write.">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-8 lg:col-span-2">
            <label htmlFor={areaId} className="sr-only">
              Notice text, read only
            </label>
            <textarea
              id={areaId}
              ref={areaRef}
              readOnly
              rows={16}
              value={d.notice}
              className="w-full resize-y rounded-8 border border-line bg-sunken p-12 font-mono text-micro text-ink"
            />
            <div>
              <Button size="sm" variant="primary" icon={copied ? Check : Copy} onClick={copyNotice}>
                {copied ? 'Copied' : 'Copy notice'}
              </Button>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-12">
            <a
              href={d.rightsManagerUrl}
              target="_blank"
              rel="noreferrer"
              className="state-layer inline-flex h-32 w-fit items-center gap-6 rounded-8 border border-line bg-raised px-12 text-label font-medium text-ink"
            >
              <ExternalLink aria-hidden className="size-16" />
              Open Rights Manager
            </a>
            <p className="text-micro text-muted">
              Creator Hub, Intellectual Property, Removal Requests. You must be a registered rights holder.{' '}
              <ExternalLinkText href={d.rightsManagerDocsUrl} className="text-micro">
                Roblox guide
              </ExternalLinkText>
            </p>
            <div className="flex items-start gap-8 rounded-8 border border-line bg-raised p-12">
              <ShieldAlert aria-hidden className="mt-2 size-16 shrink-0 text-warn" />
              <p className="text-micro text-muted">
                <span className="font-medium text-ink">Before you file: </span>
                under 17 U.S.C. 512(f), knowingly filing a false takedown makes you liable for the other side&apos;s damages and legal fees. Roblox Rights Manager has no public API, so DMCA Daemon cannot file for you.
              </p>
            </div>
          </div>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-12 border-t border-line pt-16">
        {state === 'dismissed' || state === 'filed' ? (
          <>
            <Badge tone={state === 'filed' ? 'live' : 'muted'}>{state === 'filed' ? 'Filed' : 'Dismissed'}</Badge>
            <span className="text-label text-muted">{state === 'filed' ? `Marked as filed by you. DMCA Daemon filed nothing.` : `${finding.title} is marked as not a copy.`}</span>
            <Button size="sm" icon={Undo2} onClick={() => act('open')}>
              Reopen
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" icon={X} onClick={() => act('dismissed')}>
              Not a copy
            </Button>
            <Button size="sm" icon={FileCheck2} onClick={() => act('filed')}>
              I filed this
            </Button>
            <span className="max-w-prose text-micro text-subtle">&quot;I filed this&quot; only records that you filed it yourself in Creator Hub.</span>
          </>
        )}
      </div>
    </div>
  )
}
