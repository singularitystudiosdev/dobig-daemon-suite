import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Badge, Button, Dialog, Field, KeyValue, Skeleton, TextInput, useToast } from '@/components/ui'
import { getStatus } from '@/lib/api'
import { maskKey, removeGeminiKey, useGeminiKey, writeGeminiKey } from '@/lib/gemini'
import type { StatusResponse } from '@/lib/apiTypes'

/* Live generation needs the visitor's own billing-enabled Gemini key. The key stays in this browser's
   localStorage and is sent only to this local server, as the x-gemini-key header. */

export function GeminiDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const saved = useGeminiKey()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [statusFailed, setStatusFailed] = useState(false)

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
    writeGeminiKey(key)
    setDraft('')
    toast.push({ title: 'Gemini key saved', description: 'It stays in this browser and goes only to this local server.', tone: 'ok' })
    onOpenChange(false)
  }
  const remove = () => {
    removeGeminiKey()
    toast.push({ title: 'Gemini key removed', tone: 'info' })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Gemini API key"
      description="Live generation asks Nano Banana 2.1 for new images, and Google does not offer it on the free tier."
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
          You need a billing-enabled Gemini API key. A 1K image costs about $0.034, so a four-thumbnail game is 12 variants, roughly $0.41. The key is stored in this browser only and is sent to this local server as the x-gemini-key header, never anywhere else.
        </p>
        <form id="gemini-key-form" onSubmit={save} className="flex flex-col gap-8">
          <Field label={saved ? `Replace saved key (${maskKey(saved)})` : 'Paste your key'}>
            {(id) => <TextInput id={id} type="password" autoComplete="off" spellCheck={false} placeholder="AIza..." value={draft} onChange={(e) => setDraft(e.target.value)} />}
          </Field>
        </form>
        <dl>
          {status ? (
            <>
              <KeyValue label="Key on the server" value={<Badge tone={status.geminiKey ? 'live' : 'muted'}>{status.geminiKey ? 'Yes' : 'No'}</Badge>} />
              <KeyValue label="Key in this browser" value={<Badge tone={saved ? 'live' : 'muted'}>{saved ? 'Saved' : 'None'}</Badge>} />
              <KeyValue label="Recorded sets available" value={<span className="tabular">{status.recorded.length} thumbnails</span>} />
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
