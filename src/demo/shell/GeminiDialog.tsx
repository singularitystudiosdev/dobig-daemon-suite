import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Badge, Button, Dialog, Field, KeyValue, Skeleton, TextInput, useToast } from '@/components/ui'
import { getStatus } from '@/lib/api'
import { detectProvider, maskKey, PROVIDER_NAME, removeGeminiKey, useGeminiKey, writeGeminiKey } from '@/lib/gemini'
import type { ImageProvider, StatusResponse } from '@/lib/apiTypes'

/* Live generation needs the visitor's own paid key: a Google Gemini key or an OpenRouter key, same model. The key
   stays in this browser's localStorage and is sent only to this local server, as the x-gemini-key header. The key
   itself is never shown; only its provider and last four characters. */

const SERVER_PROVIDER_NAME: Record<ImageProvider, string> = { google: 'Google', openrouter: 'OpenRouter' }

export function GeminiDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const saved = useGeminiKey()
  const savedProvider = detectProvider(saved)
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [statusFailed, setStatusFailed] = useState(false)
  const draftProvider = detectProvider(draft)

  useEffect(() => {
    if (!open) return
    const ac = new AbortController()
    setStatus(null)
    setStatusFailed(false)
    getStatus(ac.signal)
      .then(setStatus)
      .catch((e: unknown) => {
        if (!ac.signal.aborted && !(e instanceof DOMException)) setStatusFailed(true)
      })
    return () => ac.abort()
  }, [open])

  const save = (e: FormEvent) => {
    e.preventDefault()
    const key = draft.trim()
    if (!key) return
    const provider = detectProvider(key)
    writeGeminiKey(key)
    setDraft('')
    toast.push({ title: provider ? `${PROVIDER_NAME[provider]} key saved` : 'Key saved', description: 'It stays in this browser and goes only to this local server.', tone: 'ok' })
    onOpenChange(false)
  }
  const remove = () => {
    removeGeminiKey()
    toast.push({ title: `${savedProvider ? PROVIDER_NAME[savedProvider] : 'Image'} key removed`, tone: 'info' })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Image provider key"
      description="Live generation asks Nano Banana 2.1 for new images, and it needs a paid key."
      footer={
        <>
          {saved && (
            <Button variant="danger" onClick={remove}>
              Remove key
            </Button>
          )}
          <Button variant="primary" type="submit" form="gemini-key-form" disabled={!draft.trim()}>
            Save key
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-16">
        <p className="text-label text-muted">
          Use either a Google Gemini API key (AIza...) with billing enabled, or an OpenRouter key (sk-or-...) with credits. Both reach the same model at about $0.034 per variant, so a four-thumbnail game is 12 variants, roughly $0.41. The key is kept in this browser only and is sent only to this local server as a request header, never anywhere else.
        </p>
        <form id="gemini-key-form" onSubmit={save} className="flex flex-col gap-8">
          <Field
            label="Paste a Gemini or OpenRouter key"
            hint={
              <span aria-live="polite">
                {draftProvider
                  ? `Looks like ${draftProvider === 'openrouter' ? 'an OpenRouter' : 'a Gemini'} key`
                  : saved
                    ? `Saved key ends in ${maskKey(saved)}. Pasting a new one replaces it.`
                    : 'Nothing is saved until you press Save key.'}
              </span>
            }
          >
            {(id) => <TextInput id={id} type="password" autoComplete="off" spellCheck={false} placeholder="AIza... or sk-or-..." value={draft} onChange={(e) => setDraft(e.target.value)} />}
          </Field>
        </form>
        <dl>
          {status ? (
            <>
              <KeyValue label="Key on the server" value={<Badge tone={status.geminiKey ? 'live' : 'muted'}>{status.provider ? SERVER_PROVIDER_NAME[status.provider] : status.geminiKey ? 'Yes' : 'None'}</Badge>} />
              <KeyValue label="Key in this browser" value={<Badge tone={savedProvider ? 'live' : 'muted'}>{savedProvider ? PROVIDER_NAME[savedProvider] : 'None'}</Badge>} />
              <KeyValue label="Model" value={status.model} mono />
            </>
          ) : statusFailed ? (
            <p className="flex items-center gap-8 text-label text-warn">
              <KeyRound aria-hidden className="size-16" />
              The server status did not load. Check that the dev server is running.
            </p>
          ) : (
            <div aria-busy className="flex flex-col gap-8">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
        </dl>
      </div>
    </Dialog>
  )
}
