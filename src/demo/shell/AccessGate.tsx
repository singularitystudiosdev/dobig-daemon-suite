import { useEffect, useState, type FormEvent } from 'react'
import { CircleAlert, KeyRound } from 'lucide-react'
import { Button, Dialog, Field } from '@/components/ui'
import { ACCESS_EVENT, ACCESS_KEY, checkAccessCode } from '@/lib/static'

/* The access code of a private hosted server. Opened by the 'dobig:access-needed' event, which the fetch shim in
   src/lib/static.ts fires when the server answers 401. The code is checked against the server before it is kept,
   then saved in this browser only and the page reloads so every list loads again. */

const INPUT_ID = 'access-code'

export function AccessGate() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onNeeded = () => {
      // A code is already saved, so the server has just refused it.
      let saved = ''
      try {
        saved = window.localStorage.getItem(ACCESS_KEY) ?? ''
      } catch {
        /* storage blocked: the field simply starts empty */
      }
      setError(saved ? 'That code was not accepted.' : null)
      setOpen(true)
    }
    window.addEventListener(ACCESS_EVENT, onNeeded)
    return () => window.removeEventListener(ACCESS_EVENT, onNeeded)
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const code = value.trim()
    if (!code) {
      setError('Enter the access code first.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await checkAccessCode(code)
    if (result === 'ok') {
      try {
        window.localStorage.setItem(ACCESS_KEY, code)
      } catch {
        setBusy(false)
        setError('This browser would not save the code. Allow site storage and try again.')
        return
      }
      window.location.reload()
      return
    }
    setBusy(false)
    setError(result === 'wrong' ? 'That code was not accepted.' : 'The server did not answer. Try again in a moment.')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Access code"
      description="This server is private. Enter the access code you were given."
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Not now
          </Button>
          <Button type="submit" form={`${INPUT_ID}-form`} variant="primary" loading={busy}>
            {busy ? 'Checking' : 'Save'}
          </Button>
        </>
      }
    >
      <form id={`${INPUT_ID}-form`} onSubmit={submit} noValidate className="flex flex-col gap-12">
        <Field label="Access code">
          {(id) => (
            <div className="relative">
              <KeyRound aria-hidden className="pointer-events-none absolute left-12 top-1/2 size-16 -translate-y-1/2 text-muted" />
              <input
                id={id}
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={value}
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  setValue(e.target.value)
                  if (error) setError(null)
                }}
                className="h-40 w-full min-w-0 rounded-8 border border-line bg-raised pl-36 pr-12 text-body text-ink placeholder:text-subtle"
              />
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
    </Dialog>
  )
}
