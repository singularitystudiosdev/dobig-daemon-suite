import { useId, useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, ShieldAlert, Undo2, X } from 'lucide-react'
import { Badge, Button, useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { DmcaDetail, DmcaImagePair, DmcaLane } from '@/lib/details/dmca'
import type { Tone } from '@/lib/tone'
import { AutomateCta } from '@/demo/shell/AutomateCta'
import type { DetailViewProps } from './types'

/* DMCA Daemon detail: the exact game link first, then the real evidence (image pairs with their hash distance, text
   overlap), the rule that chose the lane, and a practice walkthrough of the filing. Filing is a human step in Roblox
   Rights Manager: nothing here files or sends anything. The only way to ask for it to be done for you is the contact-us option. */

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

/* ---- Practice the filing ---- */

/** The statements the filer must be able to make under 17 U.S.C. 512(c)(3)(A)(v) and (vi), each one plain sentence. */
const STATEMENTS = [
  'You own the exclusive right in the work, or you are authorised to act for the owner.',
  'You have opened both games yourself and the material you name is really there.',
  'You have a good-faith belief that the use is not authorised by the copyright owner, its agent, or the law.',
  'Everything in the notice is accurate, and you say so under penalty of perjury.',
]

/** What each bracketed item of the notice asks the filer to write, in plain words. */
const FILL_INS: [RegExp, string][] = [
  [/^Describe which/, 'Which of your works are protected, and that you own them or may act for the owner'],
  [/^Add what you/, 'What you saw yourself in their game, and the exact assets copied'],
  [/^YOUR FULL NAME/, 'Your full name, postal address, email and phone'],
  [/^YOUR STATEMENT that you have a good faith/, 'Your good-faith statement'],
  [/^YOUR STATEMENT that the information/, 'Your accuracy and authority statement, under penalty of perjury'],
  [/^YOUR PHYSICAL/, 'Your signature: your full legal name'],
]

/** The bracketed items of the notice, so the filer sees what is left to write. The header's own "[BRACKETED]" is skipped. */
function fillIns(notice: string): string[] {
  const out: string[] = []
  for (const m of notice.matchAll(/\[([^\]]+)\]/g)) {
    const text = m[1].trim()
    if (text === 'BRACKETED') continue
    const known = FILL_INS.find(([re]) => re.test(text))
    if (known) out.push(known[1])
    else {
      const first = text.split(/(?<=[.:])\s+/)[0].replace(/[.:]$/, '')
      out.push(first.length > 110 ? `${first.slice(0, 107).trimEnd()}...` : first)
    }
  }
  return out
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

function CopyButton({ text, what, toastTitle, children }: { text: string; what: string; toastTitle: string; children: ReactNode }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  async function copy() {
    await writeClipboard(text)
    setCopied(true)
    toast.push({ title: toastTitle, description: 'Practice only. Nothing was sent.', tone: 'ok' })
    window.setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Button size="sm" icon={copied ? Check : Copy} onClick={copy} aria-label={`Copy ${what}`}>
      {copied ? 'Copied' : children}
    </Button>
  )
}

/** One row of the walkthrough: a real checkbox with its title as the label, then the step's own content. */
function StepRow({ n, title, done, onToggle, children }: { n: number; title: string; done: boolean; onToggle: (on: boolean) => void; children: ReactNode }) {
  const id = useId()
  return (
    <li className="flex gap-12 border-b border-line py-16 last:border-b-0">
      <input id={id} type="checkbox" checked={done} onChange={(e) => onToggle(e.target.checked)} className="mt-2 size-16 shrink-0 accent-accent" />
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        <label htmlFor={id} className={cn('w-fit cursor-pointer text-label font-medium', done ? 'text-muted' : 'text-ink')}>
          {n}. {title}
        </label>
        {children}
      </div>
    </li>
  )
}

function ValueLine({ label, href, text, copyWhat }: { label: string; href: string; text: string; copyWhat: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-12 gap-y-4">
      <span className="w-full text-micro text-muted">{label}</span>
      <ExternalLinkText href={href} className="min-w-0">
        {text}
      </ExternalLinkText>
      <CopyButton text={text} what={copyWhat} toastTitle="Link copied">
        Copy
      </CopyButton>
    </div>
  )
}

const STEP_COUNT = 5

function PracticeFiling({ d, state, act }: { d: DmcaDetail; state: string | undefined; act: (state: string) => void }) {
  const c = d.candidate
  const areaId = useId()
  const [done, setDone] = useState<boolean[]>(() => Array.from({ length: STEP_COUNT }, () => false))
  const filed = state === 'filed'
  const isDone = (i: number) => (i === STEP_COUNT - 1 ? filed || done[i] : done[i])
  const set = (i: number) => (on: boolean) => setDone((prev) => prev.map((v, j) => (j === i ? on : v)))
  const count = Array.from({ length: STEP_COUNT }, (_, i) => isDone(i)).filter(Boolean).length
  const next = Array.from({ length: STEP_COUNT }, (_, i) => isDone(i)).indexOf(false)
  const progress = next === -1 ? 'All 5 steps done' : `Step ${next + 1} of 5`
  const placeholders = fillIns(d.notice)
  const creatorKind = c.creatorType ? (c.creatorType.toLowerCase() === 'group' ? 'community' : 'user') : ''

  return (
    <Section label="Practice the filing" hint="Nothing is sent. This is a practice run; the real filing happens in Rights Manager.">
      <p aria-live="polite" className="text-micro text-muted">
        <span className="font-medium text-ink">{progress}.</span> {count} of {STEP_COUNT} done. Ticks are kept on this page only.
      </p>
      <ol className="flex flex-col">
        <StepRow n={1} title="Compare the evidence" done={isDone(0)} onToggle={set(0)}>
          <p className="max-w-prose text-label text-muted">
            Look at the image pairs above, Yours beside Theirs. A real copy shows the same scene, the same text or the same layout, not only a similar colour or theme. If the pairs only look alike in style, mark this game as not a copy.
          </p>
        </StepRow>

        <StepRow n={2} title="Confirm both games" done={isDone(1)} onToggle={set(1)}>
          <div className="flex flex-col gap-8">
            <ValueLine label={`Your game: ${d.ours.name}`} href={d.ours.url} text={d.ours.url} copyWhat="your game link" />
            <ValueLine label={`Their game: ${c.name}`} href={c.url} text={c.url} copyWhat="their game link" />
            <p className="text-micro text-muted">
              Creator of theirs{creatorKind ? ` (${creatorKind})` : ''}: <span className="text-ink">{c.creatorName || 'Unknown'}</span>,{' '}
              <ExternalLinkText href={c.creatorUrl} className="text-micro">
                {c.creatorUrl}
              </ExternalLinkText>
            </p>
          </div>
          <div className="flex flex-col gap-4">
            <span className="text-micro text-muted">You must be able to say, truthfully, each of these</span>
            <ul className="flex list-disc flex-col gap-4 pl-20 marker:text-subtle">
              {STATEMENTS.map((t) => (
                <li key={t} className="max-w-prose text-label text-ink">
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-start gap-8">
            <ShieldAlert aria-hidden className="mt-2 size-16 shrink-0 text-warn" />
            <p className="max-w-prose text-micro text-muted">
              <span className="font-medium text-ink">Before you file: </span>
              under 17 U.S.C. 512(f), knowingly filing a false takedown makes you liable for the other side&apos;s damages and legal fees.
            </p>
          </div>
        </StepRow>

        <StepRow n={3} title="Copy the notice" done={isDone(2)} onToggle={set(2)}>
          <div className="flex flex-col gap-4">
            <span className="text-micro text-muted">Fill these in before you file. The notice marks each one in square brackets.</span>
            <ul className="flex list-disc flex-col gap-2 pl-20 marker:text-subtle">
              {placeholders.map((t, i) => (
                <li key={i} className="max-w-prose text-micro text-ink">
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <label htmlFor={areaId} className="sr-only">
            Notice text, read only
          </label>
          <textarea id={areaId} readOnly rows={10} value={d.notice} className="w-full resize-y rounded-8 border border-line bg-sunken p-12 font-mono text-micro text-ink" />
          <div>
            <CopyButton text={d.notice} what="the notice text" toastTitle="Notice copied">
              Copy notice
            </CopyButton>
          </div>
        </StepRow>

        <StepRow n={4} title="Open Rights Manager" done={isDone(3)} onToggle={set(3)}>
          <p className="max-w-prose text-label text-muted">
            Creator Hub, Intellectual Property, Removal Requests. The rights owner must be signed in, and registered as a rights holder.{' '}
            <ExternalLinkText href={d.rightsManagerDocsUrl} className="text-label">
              Roblox guide
            </ExternalLinkText>
          </p>
          <a
            href={d.rightsManagerUrl}
            target="_blank"
            rel="noreferrer"
            className="state-layer inline-flex h-32 w-fit items-center gap-6 rounded-8 border border-line bg-raised px-12 text-label font-medium text-ink"
          >
            <ExternalLink aria-hidden className="size-16" />
            Open Rights Manager
          </a>
        </StepRow>

        <StepRow n={5} title="Mark as filed" done={isDone(4)} onToggle={set(4)}>
          {filed ? (
            <div className="flex flex-wrap items-center gap-12">
              <Badge tone="live">Filed</Badge>
              <span className="text-label text-muted">Marked as filed by you. DMCA Daemon filed nothing.</span>
              <Button size="sm" icon={Undo2} onClick={() => act('open')}>
                Reopen
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-12">
              <Button
                size="sm"
                icon={Check}
                onClick={() => {
                  set(4)(true)
                  act('filed')
                }}
              >
                Mark as filed
              </Button>
              <span className="max-w-prose text-micro text-subtle">This only records that you filed it yourself in Rights Manager. The daemon sends nothing.</span>
            </div>
          )}
        </StepRow>
      </ol>
    </Section>
  )
}

export default function DmcaDetailView({ finding, detail: d, state, act, daemonId }: DetailViewProps<DmcaDetail>) {
  const c = d.candidate
  const checked = d.checked ? new Date(d.checked).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not available'
  const pageInfo = [`${c.playing.toLocaleString('en-US')} playing`, `${c.visits.toLocaleString('en-US')} visits`, c.created ? `created ${c.created.slice(0, 10)}` : null].filter(Boolean).join(', ')
  const fileable = d.lane !== 'weak'

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

      {fileable ? (
        <PracticeFiling d={d} state={state} act={act} />
      ) : (
        <Section label="Not a filing candidate" hint="A weak signal is a lead to look at, not grounds for a takedown.">
          <p className="max-w-prose text-label text-muted">
            Open the game and look yourself. A notice needs your own evidence, and under 17 U.S.C. 512(f), knowingly filing a false takedown makes you liable for the other side&apos;s damages and legal fees.
          </p>
        </Section>
      )}

      {fileable && daemonId !== 'example' && <AutomateCta slug="dmca-daemon" game={d.ours.name} variant="line" />}

      <div className="flex flex-wrap items-center gap-12 border-t border-line pt-16">
        {state === 'dismissed' ? (
          <>
            <Badge tone="muted">Dismissed</Badge>
            <span className="text-label text-muted">{finding.title} is marked as not a copy.</span>
            <Button size="sm" icon={Undo2} onClick={() => act('open')}>
              Reopen
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" icon={X} onClick={() => act('dismissed')}>
              Not a copy
            </Button>
            <span className="max-w-prose text-micro text-subtle">&quot;Not a copy&quot; only marks it here. It tells nobody.</span>
          </>
        )}
      </div>
    </div>
  )
}
