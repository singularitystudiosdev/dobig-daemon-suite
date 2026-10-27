import { useEffect, useId, useRef, useState, ViewTransition, type KeyboardEvent } from 'react'
import { ChevronDown, LayoutGrid, Zap } from 'lucide-react'
import { tools, toolsBySlug } from '@/data/tools'
import type { DaemonSlug } from '@/data/daemons'
import { useBalance } from '@/lib/credits'
import { navigate } from '@/lib/router'
import { useOnClickOutside } from '@/lib/hooks'
import { cn } from '@/lib/cn'

/* The tool frame, top left of the dashboard: the current tool's art, its name and a chevron.
   Opens a listbox of all six tools with their credits left. Arrows, Home, End, Enter, Escape and Tab work;
   Escape and picking return focus to the button. */

function Credits({ slug }: { slug: DaemonSlug }) {
  const n = useBalance(slug)
  return (
    <span className="tabular inline-flex items-center gap-4 text-micro text-muted">
      <Zap aria-hidden className="size-12" />
      {n} left
    </span>
  )
}

export function ToolSwitcher({ slug }: { slug: DaemonSlug }) {
  const tool = toolsBySlug[slug]
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  useOnClickOutside(wrapRef, () => setOpen(false), open)

  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  const openList = () => {
    setActive(Math.max(0, tools.findIndex((t) => t.slug === slug)))
    setOpen(true)
  }
  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }
  const pick = (next: DaemonSlug) => {
    close(true)
    if (next !== slug) navigate(`/demo/${next}`, 'swap')
  }

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      openList()
    }
  }
  const onListKey = (e: KeyboardEvent) => {
    const last = tools.length - 1
    if (e.key === 'ArrowDown') setActive((i) => (i >= last ? 0 : i + 1))
    else if (e.key === 'ArrowUp') setActive((i) => (i <= 0 ? last : i - 1))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(last)
    else if (e.key === 'Enter' || e.key === ' ') pick(tools[active].slug)
    else if (e.key === 'Escape') close(true)
    else if (e.key === 'Tab') close(false)
    else return
    e.preventDefault()
  }

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onButtonKey}
        className="state-layer flex max-w-full min-w-0 items-center gap-12 rounded-8 py-4 pl-4 pr-12"
      >
        <ViewTransition name={`tool-${slug}`} share="tool-morph" default="none">
          <img src={tool.art} alt="" width={64} height={36} className="h-36 w-64 shrink-0 rounded-8 object-cover" />
        </ViewTransition>
        <span className="min-w-0 truncate text-body font-bold text-ink">{tool.name}</span>
        <ChevronDown aria-hidden className={cn('size-16 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-8 w-320 rounded-20 border border-line-strong bg-surface p-8 motion-safe:animate-enter">
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label="Switch tool"
            aria-activedescendant={`${listId}-${tools[active].slug}`}
            onKeyDown={onListKey}
            className="flex flex-col gap-2 outline-none focus-visible:outline-none"
          >
            {tools.map((t, i) => (
              <li
                key={t.slug}
                id={`${listId}-${t.slug}`}
                role="option"
                aria-selected={t.slug === slug}
                onClick={() => pick(t.slug)}
                onPointerMove={() => setActive(i)}
                className={cn('flex cursor-pointer items-center gap-12 rounded-8 p-8', i === active && 'bg-raised', t.slug === slug && 'text-accent-ink')}
              >
                <img src={t.art} alt="" width={64} height={36} loading="lazy" className="h-36 w-64 shrink-0 rounded-8 object-cover" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn('truncate text-label font-medium', t.slug === slug ? 'text-accent-ink' : 'text-ink')}>{t.name}</span>
                  <Credits slug={t.slug} />
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              close(false)
              navigate('/', 'back')
            }}
            className="state-layer mt-8 flex w-full items-center gap-8 rounded-8 border-t border-line px-8 pb-4 pt-12 text-label text-muted"
          >
            <LayoutGrid aria-hidden className="size-16" />
            All tools
          </button>
        </div>
      )}
    </div>
  )
}
