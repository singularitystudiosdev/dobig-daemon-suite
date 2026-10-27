import { useState, type FormEvent } from 'react'
import { CircleAlert, KeyRound } from 'lucide-react'
import { Button, Field } from '@/components/ui'
import { ApiFailure } from '@/lib/api'
import { saveBotToken } from './api'

/* The paste-a-token form and the four steps to get one. Shared by the add card and the token dialog. */

export const TOKEN_STEPS = [
  'Open discord.com/developers/applications and press New Application.',
  'Open Bot in the left menu and press Reset Token. Copy the token, it is shown once.',
  'On the same page turn ON Message Content Intent and save.',
  'Paste the token below. It stays on this computer and is never shown again.',
]

export function TokenSteps() {
  return (
    <ol className="flex flex-col gap-6 text-label text-muted">
      {TOKEN_STEPS.map((s, i) => (
        <li key={s} className="flex gap-8">
          <span className="tabular w-16 shrink-0 text-subtle">{i + 1}.</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  )
}

export function TokenForm({ onSaved, label = 'Save token' }: { onSaved: (bot: { username: string; id: string }) => void; label?: string }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!value.trim()) {
      setError('Paste the bot token first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await saveBotToken(value.trim())
      setValue('')
      onSaved(res.bot)
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Saving the token failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-12">
      <Field label="Bot token">
        {(id) => (
          <div className="flex flex-wrap gap-8">
            <div className="relative min-w-160 flex-1">
              <KeyRound aria-hidden className="pointer-events-none absolute left-12 top-1/2 size-16 -translate-y-1/2 text-muted" />
              <input
                id={id}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={value}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-err` : undefined}
                onChange={(e) => {
                  setValue(e.target.value)
                  if (error) setError(null)
                }}
                className="h-40 w-full min-w-0 rounded-8 border border-line bg-raised pl-36 pr-12 text-body text-ink placeholder:text-subtle"
                placeholder="Paste the token"
              />
            </div>
            <Button type="submit" variant="primary" loading={busy}>
              {busy ? 'Checking token' : label}
            </Button>
          </div>
        )}
      </Field>
      {error && (
        <div role="alert" className="flex items-start gap-8 rounded-8 bg-danger-soft p-12 text-label text-danger">
          <CircleAlert aria-hidden className="mt-2 size-16 shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </form>
  )
}
