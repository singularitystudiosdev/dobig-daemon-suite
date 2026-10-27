import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

/* Modal on native <dialog>: showModal() makes the page inert and traps Tab; Escape routes through
   onOpenChange so the owner stays the source of truth (design-web Dialog). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      data-slot="dialog"
      onCancel={(e) => {
        e.preventDefault()
        onOpenChange(false)
      }}
      onClose={() => open && onOpenChange(false)}
      className={cn('m-auto w-560 max-w-full rounded-20 border border-line bg-surface p-0 text-ink shadow-64 backdrop:bg-canvas/70', className)}
    >
      {open && (
        <div className="motion-safe:animate-enter">
          <header className="flex items-start justify-between gap-16 border-b border-line px-24 py-20">
            <div className="min-w-0">
              <h2 className="text-title font-bold">{title}</h2>
              {description && <p className="mt-4 text-label text-muted">{description}</p>}
            </div>
            <button type="button" aria-label="Close" onClick={() => onOpenChange(false)} className="state-layer inline-flex size-32 shrink-0 items-center justify-center rounded-8 text-muted">
              <X aria-hidden className="size-16" />
            </button>
          </header>
          {children && <div className="px-24 py-20">{children}</div>}
          {footer && <footer className="flex justify-end gap-8 border-t border-line px-24 py-16">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}
