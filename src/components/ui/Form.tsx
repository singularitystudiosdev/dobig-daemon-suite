import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/* Form controls: visible labels, 40px controls, 16px text so iOS never zooms on focus. */

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: (id: string) => ReactNode; className?: string }) {
  const id = useId()
  return (
    <div data-slot="field" className={cn('flex min-w-0 flex-col gap-6', className)}>
      <label htmlFor={id} className="text-label font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-micro text-muted">{hint}</p>}
    </div>
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      data-slot="text-input"
      className={cn('h-40 w-full min-w-0 rounded-8 border border-line bg-raised px-12 text-body text-ink placeholder:text-subtle', className)}
      {...props}
    />
  )
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select data-slot="select" className={cn('h-40 w-full min-w-0 rounded-8 border border-line bg-raised px-12 text-body text-ink', className)} {...props}>
      {children}
    </select>
  )
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div data-slot="toggle" className="flex items-start justify-between gap-16">
      <div className="min-w-0">
        <label id={`${id}-label`} htmlFor={id} className="text-label font-medium text-ink">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="mt-2 text-micro text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative inline-flex h-24 w-44 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-50', checked ? 'bg-accent' : 'bg-line-strong')}
      >
        <span
          aria-hidden
          className={cn('inline-block size-18 rounded-full bg-ink transition-transform duration-150 ease-standard motion-reduce:transition-none', checked ? 'translate-x-22' : 'translate-x-4')}
        />
      </button>
    </div>
  )
}
