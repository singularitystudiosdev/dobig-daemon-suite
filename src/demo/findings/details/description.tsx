import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, Send, TriangleAlert, X } from 'lucide-react'
import { Badge, Button, Dialog, useToast } from '@/components/ui'
import type { DescriptionDetail, DescriptionDiffPart, DescriptionLintCheck } from '@/lib/details/description'
import { fmtInt } from '@/lib/format'
import type { DetailViewProps } from './types'

/* Description Daemon: one draft against the live description.
   Left: the word-level diff (the redline), then the full draft with the spans the lint struck.
   Right: what changed, the eight lint checks with their reasons and exact character offsets, claims the live copy does not
   support, the similarity guard, the competitors read (real links), and the actions.
   Nothing here is modelled: every count comes from the run that wrote the draft, and the diff, lint and offsets are recomputable. */

function Block({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 border-b border-line pb-16 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-12 gap-y-4">
        <h3 className="text-label font-medium text-muted">{label}</h3>
        {aside && <div className="text-micro text-subtle">{aside}</div>}
      </div>
      {children}
    </div>
  )
}

/** Open Cloud status, asked once a half minute at most: the key may be added while the dashboard is open. */
let statusAt = 0
let statusPromise: Promise<boolean> | null = null
function connected(): Promise<boolean> {
  if (!statusPromise || Date.now() - statusAt > 30_000) {
    statusAt = Date.now()
    statusPromise = fetch('/api/description/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { connected?: boolean } | null) => j?.connected === true)
      .catch(() => false)
  }
  return statusPromise
}

const trimEnd = (s: string) => s.replace(/\s+$/, '')

/* A diff run, marked by text AND symbol: added = underline + "+", removed = strike + "-". Colour is never the only cue. */
function DiffText({ parts }: { parts: DescriptionDiffPart[] }) {
  return (
    <p className="scroll-thin max-h-320 overflow-y-auto whitespace-pre-wrap break-words pr-8 text-label text-ink">
      {parts.map((p, i) => {
        if (p.kind === 'same') return <span key={i}>{p.text}</span>
        const core = trimEnd(p.text)
        const tail = p.text.slice(core.length)
        return (
          <span key={i}>
            {p.kind === 'added' ? (
              <ins className="rounded-8 bg-live-soft px-2 text-live underline decoration-live underline-offset-4">
                <span className="sr-only">added: </span>
                <span aria-hidden className="mr-2 font-mono text-micro">+</span>
                {core}
              </ins>
            ) : (
              <del className="rounded-8 bg-danger-soft px-2 text-danger line-through decoration-danger">
                <span className="sr-only">removed: </span>
                <span aria-hidden className="mr-2 font-mono text-micro">-</span>
                {core}
              </del>
            )}
            {tail}
          </span>
        )
      })}
    </p>
  )
}

function wordCount(s: string) {
  return (s.match(/\S+/g) ?? []).length
}

function CheckRow({ c }: { c: DescriptionLintCheck }) {
  return (
    <li className="flex items-start gap-8 border-b border-line py-8 last:border-b-0">
      {c.passed ? <Check aria-hidden className="mt-2 size-16 shrink-0 text-live" /> : <X aria-hidden className="mt-2 size-16 shrink-0 text-danger" />}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-8 gap-y-2 text-label text-ink">
          <span>{c.title}</span>
          <span className={`text-micro font-medium ${c.passed ? 'text-live' : 'text-danger'}`}>
            {c.passed ? 'Passed' : 'Failed'}
            {!c.passed && !c.blocking ? ', advisory' : ''}
          </span>
        </p>
        <p className="max-w-prose text-micro text-muted">{c.reason}</p>
        {c.flags.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {c.flags.slice(0, 8).map((f, i) => (
              <li key={`${f.start}-${i}`} className="text-micro text-subtle">
                <span className="tabular font-mono">
                  {f.start} to {f.end}
                </span>{' '}
                <s className="text-danger">{f.text.length > 60 ? `${f.text.slice(0, 60)}...` : f.text.replace(/\n/g, ' / ')}</s> {f.reason}
              </li>
            ))}
            {c.flags.length > 8 && <li className="text-micro text-subtle">{c.flags.length - 8} more flagged spans, all struck through in the draft.</li>}
          </ul>
        )}
      </div>
    </li>
  )
}

export default function DescriptionDetailView({ detail: d, state, act, daemonId }: DetailViewProps<DescriptionDetail>) {
  const toast = useToast()
  const fullText = useMemo(() => d.text.map((s) => s.text).join(''), [d.text])
  const published = state === 'published'
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState<boolean | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void connected().then((c) => live && setKey(c))
    return () => {
      live = false
    }
  }, [])

  // Reasons for struck spans, by offset, for the tooltip on each struck run.
  const reasonAt = useMemo(() => {
    const flags = d.lint.flatMap((c) => c.flags)
    return (offset: number) => flags.filter((f) => offset >= f.start && offset < f.end).map((f) => f.reason).join('; ')
  }, [d.lint])

  const added = d.diffAgainstLive.filter((p) => p.kind === 'added').reduce((n, p) => n + wordCount(p.text), 0)
  const removed = d.diffAgainstLive.filter((p) => p.kind === 'removed').reduce((n, p) => n + wordCount(p.text), 0)
  const failed = d.lint.filter((c) => !c.passed)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullText)
      toast.push({ title: 'Draft copied', description: `Variant ${d.variant} is on your clipboard, ${fmtInt(d.chars)} characters.`, tone: 'ok' })
    } catch {
      toast.push({ title: 'Could not copy', description: 'Your browser blocked clipboard access. Select the draft text and copy it by hand.', tone: 'warn' })
    }
  }

  const publish = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/description/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ daemonId, universeId: d.universeId, text: fullText, confirm: true }),
      })
      const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string; updateTime?: string | null; robloxStatus?: number } | null
      if (r.ok && j?.ok) {
        setUpdatedAt(j.updateTime ?? null)
        setOpen(false)
        act('published')
        toast.push({ title: 'Published to Roblox', description: `Roblox answered ${j.robloxStatus ?? r.status}. Measure for a full week before comparing.`, tone: 'ok' })
      } else {
        setError(j?.message ?? `The publish request failed (${r.status}).`)
      }
    } catch {
      setError('The local server did not answer. Nothing was sent to Roblox.')
    } finally {
      setBusy(false)
    }
  }

  let offset = 0
  return (
    <div className="flex flex-col gap-24">
      <p className="flex flex-wrap items-center gap-x-16 gap-y-4 text-label text-muted">
        <span>
          Lint score <span className="tabular font-medium text-ink">{d.lintScore.passed} of {d.lintScore.total}</span>
        </span>
        <span>
          <span className="tabular font-medium text-ink">{fmtInt(d.chars)}</span> of {fmtInt(d.limit)} characters
        </span>
        <span>
          Unverified claims <span className="tabular font-medium text-ink">{d.unverifiedClaims.length}</span>
        </span>
        <span>
          Iteration <span className="tabular font-medium text-ink">{d.iteration}</span>
        </span>
        {d.blocked && (
          <Badge tone="danger">
            <TriangleAlert aria-hidden className="size-12" />
            Blocked by lint
          </Badge>
        )}
      </p>

      <div className="grid grid-cols-1 gap-24 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-16">
          <Block
            label="Changes against the live description"
            aside={
              <span className="tabular">
                <span className="text-live">+{added} words</span>, <span className="text-danger">-{removed} words</span>
              </span>
            }
          >
            <DiffText parts={d.diffAgainstLive} />
            <p className="text-micro text-subtle">
              <ins className="text-live underline decoration-live underline-offset-4">+ underlined</ins> is new in this draft. <del className="text-danger line-through decoration-danger">- struck</del> is in the live text and gone from this draft.
            </p>
          </Block>

          <Block label={`Variant ${d.variant}, full draft`} aside={d.blocked ? 'Struck spans are what the lint flagged' : failed.length ? 'Struck spans are what the lint flagged' : 'No spans flagged'}>
            <p className="scroll-thin max-h-320 overflow-y-auto whitespace-pre-wrap break-words pr-8 text-label text-ink">
              {d.text.map((seg, i) => {
                const at = offset
                offset += seg.text.length
                return seg.struck ? (
                  <s key={i} title={reasonAt(at)} className="rounded-8 bg-danger-soft px-2 text-danger decoration-danger">
                    <span className="sr-only">flagged by lint: </span>
                    {seg.text}
                  </s>
                ) : (
                  <span key={i}>{seg.text}</span>
                )
              })}
            </p>
          </Block>
        </div>

        <div className="flex min-w-0 flex-col gap-16">
          <Block label="What changed and why">
            <p className="max-w-prose text-label text-ink">{d.whatChanged}</p>
          </Block>

          <Block label="Lint checklist" aside="Pure code, same text gives the same result">
            <ul>
              {d.lint.map((c) => (
                <CheckRow key={c.id} c={c} />
              ))}
            </ul>
          </Block>

          <Block label="Unverified claims" aside="Suggestions to confirm, not errors">
            {d.unverifiedClaims.length === 0 ? (
              <p className="max-w-prose text-label text-muted">The claim check found nothing in this draft that the live description and the game facts do not support.</p>
            ) : (
              <>
                <p className="max-w-prose text-micro text-subtle">The draft says these, but the live description and the game facts do not. Keep only what is true of your game.</p>
                <ul className="flex flex-col gap-4">
                  {d.unverifiedClaims.map((c) => (
                    <li key={c} className="flex items-start gap-8 text-label text-ink">
                      <TriangleAlert aria-hidden className="mt-2 size-16 shrink-0 text-warn" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Block>

          <Block label="Similarity guard">
            <p className="max-w-prose text-label text-ink">
              {d.guard.competitorsChecked === 0
                ? 'No competitor descriptions could be read this run, so there was nothing to compare against.'
                : `Checked against ${d.guard.competitorsChecked} real competing descriptions: ${d.guard.sharedPhrases} shared 7-word phrases${d.guard.attempts > 1 ? `, after ${d.guard.attempts - 1} rewrite${d.guard.attempts > 2 ? 's' : ''}` : ''}.`}
            </p>
          </Block>

          {d.competitorsUsed.length > 0 && (
            <Block label="Competitors read for phrasing patterns" aside={`${d.competitorsUsed.length} games, never copied`}>
              <ul className="flex flex-col">
                {d.competitorsUsed.map((c) => (
                  <li key={c.url} className="flex flex-wrap items-baseline gap-x-12 gap-y-2 border-b border-line py-4 last:border-b-0">
                    <span className="min-w-0 flex-1 basis-160 truncate text-label text-ink">{c.name}</span>
                    <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-4 break-all font-mono text-micro text-accent-ink hover:underline">
                      {c.url}
                      <ExternalLink aria-hidden className="size-12 shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-8 border-t border-line pt-12">
        <div className="flex flex-wrap items-center gap-12">
          <Button size="sm" icon={Copy} onClick={() => void copy()}>
            Copy draft
          </Button>
          {published ? (
            <Badge tone="live" dot pulse={false}>
              Published{updatedAt ? `, Roblox updated ${new Date(updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
            </Badge>
          ) : key ? (
            <Button size="sm" variant="primary" icon={Send} disabled={d.blocked} onClick={() => setOpen(true)}>
              Publish to Roblox
            </Button>
          ) : null}
          {!published && key && d.blocked && <span className="text-micro text-danger">Blocked: fix the failed policy checks before publishing.</span>}
        </div>
        {!published && key === false && (
          <p className="max-w-prose text-micro text-subtle">Publishing needs your Roblox Open Cloud key with universe write access. Add it in the key dialog; Copy draft works without it.</p>
        )}
        <p className="max-w-prose text-micro text-subtle">
          Roblox has no description A/B test: publish one draft, measure over a full week, then compare. Publishing and the measured baseline were verified against a mock Open Cloud server only, never against real Roblox.
        </p>
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => !busy && setOpen(o)}
        title={`Publish Variant ${d.variant} to Roblox?`}
        description={`This replaces the live description of universe ${d.universeId} with this draft (${fmtInt(d.chars)} characters).`}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon={Send} loading={busy} onClick={() => void publish()}>
              Publish now
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-12">
          <p className="max-w-prose text-label text-ink">It passed the policy lint ({d.lintScore.passed} of {d.lintScore.total} checks). {d.unverifiedClaims.length > 0 ? `${d.unverifiedClaims.length} claim${d.unverifiedClaims.length === 1 ? ' is' : 's are'} unverified: confirm they are true of your game first.` : 'No unverified claims were found.'}</p>
          <p className="max-w-prose text-micro text-subtle">The request is a PATCH to the Open Cloud Update Universe endpoint with your key; the key stays on the server. This path was only tested against a mock, never against real Roblox.</p>
          {error && (
            <p role="alert" className="flex items-start gap-8 text-label text-danger">
              <TriangleAlert aria-hidden className="mt-2 size-16 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>
      </Dialog>
    </div>
  )
}
