import { useEffect, useRef, type ReactNode } from 'react'
import { Check, Copy, Mail, Undo2 } from 'lucide-react'
import { Button, KeyValue, useToast } from '@/components/ui'
import type { ContentCreatorDetail, ContentCreatorMark, ContentCreatorStatus } from '@/lib/details/content-creator'
import { AutomateCta } from '@/demo/shell/AutomateCta'
import type { DetailViewProps } from './types'

/* Content Creator Daemon detail for one creator, in three plain blocks: why they fit, the drafted message, and the pipeline.
   The message is a draft for the owner to send; nothing here sends. Marks (contacted, replied, back to new) are kept
   by the server so a rerun keeps them. */

const linkClass = 'rounded-8 text-accent-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent-ink'

const STATUS_LINE: Record<ContentCreatorStatus, string> = {
  New: 'New. Not contacted yet.',
  Drafted: 'Drafted. A message is ready and no public email was found.',
  Ready: 'Ready. A message is drafted and a public business email was found.',
  Contacted: 'Contacted. You marked this message as sent.',
  Replied: 'Replied. You marked that this creator answered.',
  'Not drafted': 'Not drafted. This creator is not a strong match, so no message was written.',
}

const STATE_STATUS: Record<string, ContentCreatorStatus> = { new: 'New', contacted: 'Contacted', replied: 'Replied' }

function Block({ title, hint, first, children }: { title: string; hint?: string; first?: boolean; children: ReactNode }) {
  return (
    <section className={first ? 'flex min-w-0 flex-col gap-12' : 'flex min-w-0 flex-col gap-12 border-t border-line pt-16'}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-12 gap-y-2">
        <h3 className="text-label font-medium text-muted">{title}</h3>
        {hint && <span className="text-micro text-subtle">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

/** The message with its bracketed placeholders picked out, so it is obvious what the owner still has to fill in. */
function MessageText({ body }: { body: string }) {
  return (
    <div className="max-w-prose whitespace-pre-wrap border-l-2 border-line-strong pl-16 text-label text-ink">
      {body.split(/(\[[^\]]+\])/g).map((part, i) =>
        /^\[[^\]]+\]$/.test(part) ? (
          <span key={i} className="font-medium text-accent-ink">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </div>
  )
}

export default function ContentCreatorDetailView({ detail: d, state, act, daemonId }: DetailViewProps<ContentCreatorDetail>) {
  const toast = useToast()
  const status: ContentCreatorStatus = (state && STATE_STATUS[state]) || d.status
  const contacted = status === 'Contacted'
  const replied = status === 'Replied'
  const concern = d.safety.flags[0]
  const hydrated = useRef(false)

  // The row remembers a mark only for this page visit; the server remembers it across visits and runs. Pick it up once.
  useEffect(() => {
    if (hydrated.current || state !== undefined) return
    hydrated.current = true
    const ctl = new AbortController()
    fetch(`/api/content-creator/marks?daemon=${encodeURIComponent(daemonId)}`, { signal: ctl.signal, headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { marks?: Record<string, ContentCreatorMark> } | null) => {
        const mark = body?.marks?.[d.channel.id]
        if (mark && mark !== (d.status === 'Contacted' ? 'contacted' : d.status === 'Replied' ? 'replied' : d.status === 'New' ? 'new' : '')) act(mark)
      })
      .catch(() => undefined)
    return () => ctl.abort()
  }, [act, d.channel.id, d.status, daemonId, state])

  const mark = (next: ContentCreatorMark) => {
    act(next)
    fetch('/api/content-creator/mark', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ daemonId, channelId: d.channel.id, mark: next }),
    })
      .then((r) => {
        if (!r.ok) throw new Error('not saved')
      })
      .catch(() => toast.push({ title: 'Mark not saved', description: 'It shows on this page only and will not carry over to the next run.', tone: 'warn' }))
  }

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.push({ title: `${what} copied`, tone: 'ok' })
    } catch {
      toast.push({ title: 'Could not copy', description: 'Select the text and copy it by hand.', tone: 'warn' })
    }
  }

  const draft = d.draft
  const mailto = draft && d.contact.email ? `mailto:${d.contact.email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}` : null

  return (
    <div className="flex flex-col gap-16">
      <Block first title="Why they fit" hint={`Fit ${d.fit.score} of 100`}>
        <dl>
          {d.fit.components.map((c) => (
            <KeyValue
              key={c.key}
              label={c.label}
              className="max-sm:flex-col max-sm:items-start max-sm:gap-2 max-sm:[&>dd]:text-left"
              value={
                <span className="block whitespace-normal">
                  {c.line} <span className="tabular whitespace-nowrap text-subtle">{c.points} of {c.max}</span>
                </span>
              }
            />
          ))}
          {concern && (
            <KeyValue
              label="Worth a look"
              className="max-sm:flex-col max-sm:items-start max-sm:gap-2 max-sm:[&>dd]:text-left"
              value={
                <span className="block whitespace-normal">
                  Possible {concern.category} in{' '}
                  <a href={concern.url} target="_blank" rel="noreferrer" className={linkClass}>
                    {concern.evidenceTitle}
                  </a>
                </span>
              }
            />
          )}
        </dl>
      </Block>

      <Block title="Message" hint="A draft. This tool sends nothing.">
        {draft ? (
          <>
            <p className="text-label text-ink">
              <span className="text-muted">Subject: </span>
              {draft.subject}
            </p>
            <MessageText body={draft.body} />
            <p className="max-w-prose text-micro text-subtle">Fill in the parts in brackets before you send. The video it mentions is a real recent upload of theirs.</p>
            <div className="flex flex-wrap items-center gap-8">
              <Button size="sm" icon={Copy} aria-label="Copy subject to clipboard" onClick={() => copy('Subject', draft.subject)}>
                Copy subject
              </Button>
              <Button size="sm" icon={Copy} aria-label="Copy message to clipboard" onClick={() => copy('Message', draft.body)}>
                Copy message
              </Button>
              {mailto && (
                <a href={mailto} className="state-layer inline-flex h-32 items-center gap-6 whitespace-nowrap rounded-8 border border-line bg-raised px-12 text-label font-medium text-ink">
                  <Mail aria-hidden className="size-16" />
                  Open in email
                </a>
              )}
            </div>
            {d.contact.email ? (
              <p className="max-w-prose text-label text-muted">
                Public email: <span className="text-ink">{d.contact.email}</span>, written in {d.contact.source}
                {d.contact.excerpt ? `: "${d.contact.excerpt}"` : ''}.
              </p>
            ) : (
              <p className="max-w-prose text-label text-muted">
                No public email was found. The channel's{' '}
                <a href={d.channel.aboutUrl} target="_blank" rel="noreferrer" className={linkClass}>
                  About page
                </a>{' '}
                lists any other way they ask to be contacted.
              </p>
            )}
          </>
        ) : (
          <p className="max-w-prose text-label text-muted">
            {d.fit.tier === 'Risky'
              ? 'No message was written because the titles show a brand-safety concern.'
              : 'No message was written because this creator is a weak match. Strong and good matches get one.'}{' '}
            Their{' '}
            <a href={d.channel.aboutUrl} target="_blank" rel="noreferrer" className={linkClass}>
              About page
            </a>{' '}
            is public if you want to look.
          </p>
        )}
      </Block>

      <Block title="Pipeline">
        <p className="max-w-prose text-label text-ink">{STATUS_LINE[status]}</p>
        {d.changed && <p className="max-w-prose text-label text-muted">{d.changed}</p>}
        <div className="flex flex-wrap items-center gap-8">
          {!contacted && !replied && (
            <>
              <Button size="sm" variant="primary" icon={Check} onClick={() => mark('contacted')}>
                Mark contacted
              </Button>
              <Button size="sm" icon={Check} onClick={() => mark('replied')}>
                Mark replied
              </Button>
            </>
          )}
          {contacted && (
            <Button size="sm" variant="primary" icon={Check} onClick={() => mark('replied')}>
              Mark replied
            </Button>
          )}
          {(contacted || replied) && (
            <Button size="sm" icon={Undo2} onClick={() => mark('new')}>
              Back to new
            </Button>
          )}
        </div>
        <p className="max-w-prose text-micro text-subtle">Your marks are kept when this tool runs again. Nothing is sent to the creator or to YouTube.</p>
      </Block>

      <AutomateCta slug="content-creator-daemon" game={d.game} variant="line" />
    </div>
  )
}
