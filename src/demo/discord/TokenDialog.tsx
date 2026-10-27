import { useEffect, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { Badge, Button, Dialog } from '@/components/ui'
import { getBotStatus, removeBotToken, type BotStatus } from './api'
import { TokenForm, TokenSteps } from './TokenForm'

/* The bot token dialog: how to get a token, paste it, see which bot it belongs to, or remove it. */
export function TokenDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (!open) return
    const ac = new AbortController()
    getBotStatus('0', ac.signal).then(setStatus, () => setStatus(null))
    return () => ac.abort()
  }, [open])

  const remove = async () => {
    setRemoving(true)
    try {
      await removeBotToken()
      setStatus((s) => (s ? { ...s, tokenSet: false, bot: null, applicationId: null, inviteUrl: null, tokenValid: null } : s))
      onSaved()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Discord bot token"
      description="The Discord Daemon reads your server through a bot you own. The token is stored on this computer and never shown again."
      footer={
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-16">
        {status?.tokenSet && (
          <div className="flex flex-wrap items-center justify-between gap-12 border-b border-line pb-16">
            <div className="flex items-center gap-8">
              {status.tokenValid === false ? <Badge tone="danger">Discord rejected the saved token</Badge> : <Badge tone="live" dot pulse={false}>Token saved</Badge>}
              {status.bot && <span className="text-label text-ink">{status.bot.username}</span>}
            </div>
            <Button size="sm" variant="danger" icon={Trash2} loading={removing} onClick={remove}>
              Remove token
            </Button>
          </div>
        )}
        <TokenSteps />
        <TokenForm
          label={status?.tokenSet ? 'Replace token' : 'Save token'}
          onSaved={(bot) => {
            setStatus((s) => ({ tokenSet: true, tokenValid: true, bot, applicationId: s?.applicationId ?? null, inGuild: null, inviteUrl: null, intent: 'unknown' }))
            onSaved()
          }}
        />
        {status?.tokenSet && status.tokenValid !== false && (
          <p className="flex items-center gap-6 text-micro text-live">
            <Check aria-hidden className="size-12" />
            Saved. The next run uses this token.
          </p>
        )}
      </div>
    </Dialog>
  )
}
