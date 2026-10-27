import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CircleCheck, MessageSquareText, Rocket, Send, Users, type LucideIcon } from 'lucide-react'
import { Badge, Button, Dialog, Field, TextInput } from '@/components/ui'
import { automation, toolsBySlug } from '@/data/tools'
import type { ToolRequest } from '@/lib/apiTypes'
import { ApiFailure, listToolRequests, sendToolRequest } from '@/lib/api'
import { asset } from '@/lib/static'
import { closeNewTool, useNewToolState } from './newTool'
import { ago } from './time'

/* The contact-us panel. Two kinds of request share it: "New tool" (ask for tooling that does not exist yet) and
   "automation" (set an existing tool up to run for you, for example send the DMCA takedowns). The request is saved
   by the server (server/requests.ts); the confirmation says "Sent to the engineering team" only when the team's
   webhook accepted it, and otherwise says it is saved in the queue. It is mounted once, in the tool switcher, and
   opened from anywhere through ./newTool. */

type Step = { icon: LucideIcon; title: string; body: string }

const NEW_STEPS: Step[] = [
  { icon: MessageSquareText, title: 'Tell us the problem', body: 'A few sentences is enough. Link a game if it is about one.' },
  { icon: Users, title: 'Scope it with an engineer', body: 'A forward deployed engineer gets back to you, asks the questions and agrees what done looks like.' },
  { icon: Rocket, title: 'We build it, ship it and run it', body: 'It lands in this tool menu with its own credits and reruns on a schedule, like the others.' },
]

const AUTOMATE_STEPS: Step[] = [
  { icon: MessageSquareText, title: 'Tell us how it should run', body: 'Which game, how often, and anything it must never do. The request below is a starting point.' },
  { icon: Users, title: 'An engineer scopes it with you', body: 'They confirm the access they need, what gets sent and where, and what you approve first.' },
  { icon: Rocket, title: 'We set it up and run it', body: 'It runs on the schedule you pick, and every result still shows up here in the tool.' },
]

const IDEAS = [
  { label: 'Competitor tracker', text: 'Track the top games in my genre every day and tell me when one changes its thumbnail, description or update cadence.' },
  { label: 'Update announcer', text: 'Draft my update announcement for Discord, X and the Roblox game page from the patch notes, in our voice.' },
  { label: 'Retention digest', text: 'Send my team a weekly digest of retention, session length and top complaints across Roblox analytics and Discord.' },
]

export function NewToolDialog() {
  const { open, preset } = useNewToolState()
  const [message, setMessage] = useState('')
  const [game, setGame] = useState('')
  const [contact, setContact] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<ToolRequest | null>(null)
  const [past, setPast] = useState<ToolRequest[]>([])
  const messageRef = useRef<HTMLTextAreaElement>(null)

  const tool = preset.kind === 'automation' && preset.tool ? toolsBySlug[preset.tool] : null
  const auto = tool ? automation[tool.slug] : null

  useEffect(() => {
    if (!open) return
    let live = true
    listToolRequests()
      .then((rows) => live && setPast(rows))
      .catch(() => live && setPast([]))
    return () => {
      live = false
    }
  }, [open, sent])

  // Each time the panel opens it starts from what the opener wrote (an automation request is pre-filled); a plain
  // New tool keeps whatever draft the visitor already had.
  useEffect(() => {
    if (!open) {
      setSent(null)
      setError(null)
      return
    }
    if (preset.message) setMessage(preset.message)
    if (preset.game !== undefined) setGame(preset.game)
  }, [open, preset])

  // This effect runs after the dialog's own (child effects first), so the modal is already open and focus can land
  // on the question instead of the close button. Not on a touch screen, where it would raise the keyboard over the panel.
  useEffect(() => {
    if (open && window.matchMedia('(pointer: fine)').matches) messageRef.current?.focus()
  }, [open, preset])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (sending) return
    // The same plain checks the server makes, so a short answer gets instant feedback and no failed request.
    if (message.trim().length < 12) return setError('Add a little more detail: at least 12 characters about what the tool should do.')
    if (contact.trim().length < 3) return setError('Tell us how to reach you: an email, a Discord name or an X handle.')
    setSending(true)
    setError(null)
    try {
      const saved = await sendToolRequest({ kind: preset.kind, tool: preset.kind === 'automation' ? preset.tool : undefined, message, game: game.trim() || undefined, contact })
      setSent(saved)
      setMessage('')
      setGame('')
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong sending that. Try again.')
    } finally {
      setSending(false)
    }
  }

  const idea = (text: string) => {
    setMessage(text)
    setSent(null)
    messageRef.current?.focus()
  }

  const steps = tool ? AUTOMATE_STEPS : NEW_STEPS
  const hero = tool ? tool.art : asset('/tools/build-it.webp')

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && closeNewTool()}
      title={tool && auto ? auto.label : 'Build new tooling with us'}
      description={tool && auto ? `${auto.pitch} Our forward deployed engineers set it up with you.` : 'Tell our forward deployed engineers what slows your team down. They build the tool with you, directly.'}
      className="w-880 overflow-y-auto"
    >
      <div className="grid gap-24 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-16">
          <img src={hero} alt="" width={960} height={540} className="aspect-video w-full rounded-8 object-cover" />
          <h3 className="text-label font-medium text-ink">How it works</h3>
          <ol className="flex flex-col gap-16">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-12">
                <span aria-hidden className="flex size-36 shrink-0 items-center justify-center rounded-8 bg-raised text-accent-ink">
                  <s.icon className="size-20" />
                </span>
                <div className="min-w-0">
                  <p className="text-label font-medium text-ink">
                    <span className="tabular text-muted">{i + 1}.</span> {s.title}
                  </p>
                  <p className="mt-2 text-micro text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex min-w-0 flex-col gap-16">
          {sent ? (
            <div role="status" className="flex flex-col gap-12 rounded-8 border border-line p-16">
              <div className="flex items-center gap-8">
                <CircleCheck aria-hidden className="size-20 text-live" />
                <p className="text-body font-bold text-ink">{sent.delivered ? 'Sent to the engineering team' : 'Request saved'}</p>
              </div>
              <p className="text-label text-muted">
                {sent.delivered ? 'An engineer has it now. ' : 'It is in the request queue. '}
                We will use <span className="break-all font-medium text-ink">{sent.contact}</span> to get back to you.
              </p>
              <p className="whitespace-pre-line border-t border-line pt-12 text-micro text-muted">{sent.message}</p>
              <div className="flex flex-wrap gap-8">
                <Button size="sm" variant="normal" onClick={() => setSent(null)}>
                  Send another request
                </Button>
                <Button size="sm" variant="ghost" onClick={closeNewTool}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-16" noValidate>
              <Field label={tool ? 'How should it run?' : 'What should the tool do?'} hint={`${message.trim().length.toLocaleString('en-US')} of 2,000 characters`}>
                {(id) => (
                  <textarea
                    id={id}
                    ref={messageRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={2000}
                    rows={5}
                    placeholder="Example: warn me the moment a copycat of my game reaches the top 50 in search."
                    className="min-h-120 w-full min-w-0 resize-y rounded-8 border border-line bg-raised px-12 py-8 text-body text-ink placeholder:text-subtle"
                  />
                )}
              </Field>
              {!tool && (
                <div className="flex flex-wrap items-center gap-8" role="group" aria-label="Ideas to start from">
                  <span className="text-micro text-muted">Start from</span>
                  {IDEAS.map((i) => (
                    <button key={i.label} type="button" onClick={() => idea(i.text)} className="state-layer inline-flex h-32 items-center rounded-full border border-line px-12 text-micro text-ink">
                      {i.label}
                    </button>
                  ))}
                </div>
              )}
              <Field label="Game (optional)">
                {(id) => <TextInput id={id} value={game} onChange={(e) => setGame(e.target.value)} placeholder="A name or a roblox.com/games link" autoComplete="off" />}
              </Field>
              <Field label="How can we reach you?" hint="An email, a Discord name or an X handle.">
                {(id) => <TextInput id={id} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="you@studio.com" autoComplete="email" />}
              </Field>
              {error && (
                <p role="alert" className="rounded-8 border border-danger px-12 py-8 text-label text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" size="lg" icon={Send} loading={sending}>
                Send to the engineers
              </Button>
            </form>
          )}

          {past.length > 0 && (
            <section aria-label="Your requests" className="flex flex-col gap-8 border-t border-line pt-16">
              <h3 className="text-label font-medium text-ink">Your requests</h3>
              <ul className="flex flex-col">
                {past.slice(0, 4).map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-12 border-b border-line py-8 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-label text-ink">{r.message.split('\n')[0]}</p>
                      <p className="text-micro text-muted">
                        {ago(r.createdAt)}, {r.kind === 'automation' && r.tool && toolsBySlug[r.tool as keyof typeof toolsBySlug] ? `automate ${toolsBySlug[r.tool as keyof typeof toolsBySlug].name}` : 'new tool'}
                      </p>
                    </div>
                    <Badge tone={r.delivered ? 'live' : 'muted'}>{r.delivered ? 'Sent' : 'Saved'}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </Dialog>
  )
}
