import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/* Toasts after the Sonner interaction spec: stacked newest last, capped at 4, role="status",
   auto-dismiss paused while the pointer is over the stack. */

export type ToastTone = 'info' | 'ok' | 'warn' | 'danger'

export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  /** Auto-dismiss after this many ms (judgment; Sonner publishes no default). */
  duration?: number
}

interface ToastItem extends ToastInput {
  id: number
}

const ToastContext = createContext<{ push: (t: ToastInput) => void } | null>(null)

const toneIcon = { info: Info, ok: CircleCheck, warn: TriangleAlert, danger: CircleAlert }
const toneClass = { info: 'text-accent-ink', ok: 'text-live', warn: 'text-warn', danger: 'text-danger' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const timers = useRef(new Map<number, number>())
  const paused = useRef(false)

  const dismiss = useCallback((id: number) => {
    setItems((s) => s.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) window.clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const schedule = useCallback(
    (id: number, ms: number) => {
      timers.current.set(
        id,
        window.setTimeout(() => {
          if (paused.current) schedule(id, 1200)
          else dismiss(id)
        }, ms),
      )
    },
    [dismiss],
  )

  const push = useCallback(
    (t: ToastInput) => {
      const id = ++seq.current
      setItems((s) => [...s.slice(-3), { ...t, id }])
      schedule(id, t.duration ?? 4200)
    },
    [schedule],
  )

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        onPointerEnter={() => (paused.current = true)}
        onPointerLeave={() => (paused.current = false)}
        className="pointer-events-none fixed bottom-24 right-24 z-50 flex w-360 max-w-full flex-col gap-8"
      >
        {items.map((t) => {
          const tone = t.tone ?? 'info'
          const Icon = toneIcon[tone]
          return (
            <div key={t.id} role="status" className="pointer-events-auto flex items-start gap-12 rounded-8 border border-line bg-surface px-16 py-12 shadow-16 motion-safe:animate-enter">
              <Icon aria-hidden className={cn('mt-2 size-16 shrink-0', toneClass[tone])} />
              <div className="min-w-0 flex-1">
                <p className="text-label font-medium text-ink">{t.title}</p>
                {t.description && <p className="mt-2 text-micro text-muted">{t.description}</p>}
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="state-layer -mr-4 inline-flex size-24 items-center justify-center rounded-8 text-muted">
                <X aria-hidden className="size-14" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
