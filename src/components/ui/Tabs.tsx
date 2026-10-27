import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem<T extends string> {
  id: T
  label: string
  count?: number | string
}

/* Tabs with roving focus (arrow keys, Home, End) and an accent underline like dobig.com's nav. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  idPrefix,
  ariaLabel,
  className,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Unique per page so tab and panel ids do not collide. */
  idPrefix: string
  ariaLabel: string
  className?: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next < 0) return
    e.preventDefault()
    onChange(items[next].id)
    refs.current[next]?.focus()
  }
  return (
    <div role="tablist" aria-label={ariaLabel} data-slot="tabs" className={cn('scroll-thin flex gap-4 overflow-x-auto border-b border-line', className)}>
      {items.map((item, i) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'state-layer relative flex h-44 shrink-0 items-center gap-8 rounded-8 px-12 text-label font-medium transition-colors duration-150',
              active ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined && <span className="tabular rounded-full bg-raised px-6 text-micro text-muted">{item.count}</span>}
            {active && <span aria-hidden className="absolute inset-x-8 bottom-0 h-2 rounded-full bg-accent" />}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ idPrefix, id, children, className }: { idPrefix: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-tab-${id}`} className={className}>
      {children}
    </div>
  )
}
