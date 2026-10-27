import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Badge, Button, Dialog, Field, KeyValue, Skeleton, TextInput, useToast } from '@/components/ui'
import type { SecretName } from '@/lib/api'
import { deleteKey, detectProvider, PROVIDER_NAME, saveKey, useKeys, type ServerStatus } from '@/lib/gemini'

/* One dialog for every key. The user pastes ONE key; sk-or- is an OpenRouter key and serves both image generation and
   the analysis the other tools do, anything else is a Gemini key for images only. The server stores it in .data and
   never sends it back: this dialog only learns which keys exist. */

function llmFact(status: ServerStatus | null): string {
  const llm = status?.llm
  if (llm === undefined || llm === null) return 'Not reported'
  if (typeof llm === 'string') return llm
  if (typeof llm === 'boolean') return llm ? 'Ready' : 'No key'
  if (typeof llm === 'object') {
    const o = llm as Record<string, unknown>
    const parts = [o.provider, o.model].filter((x): x is string => typeof x === 'string' && x.length > 0)
    if (parts.length > 0) return parts.join(', ')
    if (typeof o.available === 'boolean') return o.available ? 'Ready' : 'No key'
  }
  return 'Ready'
}

export function KeyDialog({ open, onOpenChange, onChanged, openDiscordToken }: { open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void; openDiscordToken: () => void }) {
  const keys = useKeys()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draftProvider = detectProvider(draft)
  const { secrets, status } = keys

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const key = draft.trim()
    if (!key || saving) return
    setSaving(true)
    setError(null)
    try {
      const name = await saveKey(key)
      setDraft('')
      toast.push({
        title: name === 'openrouter-key' ? 'OpenRouter key saved' : 'Gemini key saved',
        description: name === 'openrouter-key' ? 'It now serves image generation and analysis.' : 'It now serves image generation.',
        tone: 'ok',
      })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The key could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }
  const remove = async (name: SecretName, label: string) => {
    try {
      await deleteKey(name)
      toast.push({ title: `${label} removed`, tone: 'info' })
      onChanged()
    } catch (err) {
      toast.push({ title: `${label} could not be removed`, description: err instanceof Error ? err.message : undefined, tone: 'danger' })
    }
  }

  const imageFrom = secrets?.['gemini-key'] ? 'Gemini' : secrets?.['openrouter-key'] ? 'OpenRouter' : status?.provider ? `${PROVIDER_NAME[status.provider]} (server environment)` : null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keys"
      description="Paste one key and the server works out what it is for."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="primary" type="submit" form="key-form" disabled={!draft.trim()} loading={saving}>
            Save key
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-16">
        <form id="key-form" onSubmit={(e) => void save(e)} className="flex flex-col gap-8">
          <Field
            label="Paste a key"
            hint={
              <span aria-live="polite">
                {draftProvider === 'openrouter'
                  ? 'An OpenRouter key (sk-or-). It serves image generation and the analysis the other tools do.'
                  : draftProvider === 'google'
                    ? 'A Gemini key. It serves image generation only.'
                    : 'OpenRouter keys start with sk-or-. Any other key is treated as a Gemini key.'}
              </span>
            }
          >
            {(id) => <TextInput id={id} type="password" autoComplete="off" spellCheck={false} placeholder="sk-or-... or AIza..." value={draft} onChange={(e) => setDraft(e.target.value)} />}
          </Field>
          {error && (
            <p role="alert" className="text-label text-danger">
              {error}
            </p>
          )}
        </form>

        {secrets ? (
          <dl>
            <KeyValue
              label="Analysis key (OpenRouter)"
              value={
                <span className="inline-flex items-center gap-8">
                  <Badge tone={secrets['openrouter-key'] ? 'live' : 'muted'}>{secrets['openrouter-key'] ? 'Saved' : 'Not saved'}</Badge>
                  {secrets['openrouter-key'] && (
                    <Button size="sm" variant="ghost" onClick={() => void remove('openrouter-key', 'OpenRouter key')}>
                      Remove
                    </Button>
                  )}
                </span>
              }
            />
            <KeyValue
              label="Image key (Gemini or OpenRouter)"
              value={
                <span className="inline-flex items-center gap-8">
                  <Badge tone={keys.hasImageKey ? 'live' : 'muted'}>{imageFrom ? `Saved, ${imageFrom}` : 'Not saved'}</Badge>
                  {secrets['gemini-key'] && (
                    <Button size="sm" variant="ghost" onClick={() => void remove('gemini-key', 'Gemini key')}>
                      Remove
                    </Button>
                  )}
                </span>
              }
            />
            <KeyValue
              label="Discord bot token"
              value={
                <span className="inline-flex items-center gap-8">
                  <Badge tone={secrets['discord-bot-token'] ? 'live' : 'muted'}>{secrets['discord-bot-token'] ? 'Saved' : 'Not saved'}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onOpenChange(false)
                      openDiscordToken()
                    }}
                  >
                    {secrets['discord-bot-token'] ? 'Replace' : 'Add'}
                  </Button>
                  {secrets['discord-bot-token'] && (
                    <Button size="sm" variant="ghost" onClick={() => void remove('discord-bot-token', 'Discord bot token')}>
                      Remove
                    </Button>
                  )}
                </span>
              }
            />
            <KeyValue label="Analysis model" value={llmFact(status)} />
            <KeyValue label="Image provider" value={status ? (status.provider ? PROVIDER_NAME[status.provider] : 'None') : 'Not reported'} />
            <KeyValue label="Image model" value={status?.model ?? 'Not reported'} mono />
          </dl>
        ) : keys.failed ? (
          <p className="flex items-center gap-8 text-label text-warn">
            <KeyRound aria-hidden className="size-16 shrink-0" />
            The server did not answer. Check that the dev server is running, then reopen this dialog.
          </p>
        ) : (
          <div aria-busy className="flex flex-col gap-8">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        <p className="text-label text-muted">
          Images cost about $0.034 each. Analysis calls cost a fraction of a cent. Keys are stored on this machine in the .data folder and are never sent back to the browser.
        </p>
      </div>
    </Dialog>
  )
}
