import { useLayoutEffect, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { daemonHref } from '@/lib/router'
import { daemons } from '@/data/daemons'

/* The dobig.com navbar: black, sticky, logo and wordmark left, text links right, the active link in
   accent with a sliding underline. Below xl the links move into a menu. */

const items = [{ id: 'hub', label: 'All Daemons', href: '#/' }, ...daemons.map((d) => ({ id: d.slug as string, label: d.navLabel, href: daemonHref(d.slug) }))]

export function TopNav({ active }: { active: string }) {
  const listRef = useRef<HTMLUListElement>(null)
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({})
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    const measure = () => {
      const el = linkRefs.current[active]
      if (!el || !el.offsetWidth) return setBar(null)
      setBar({ x: el.offsetLeft, w: el.offsetWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    document.fonts?.ready.then(measure)
    return () => window.removeEventListener('resize', measure)
  }, [active])

  useLayoutEffect(() => setOpen(false), [active])

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="mx-auto flex h-80 max-w-page items-center justify-between gap-24 px-24">
        <a href="#/" className="group flex shrink-0 items-center gap-12 rounded-8" aria-label="Do Big Daemons home">
          <img src="/brand/icon.png" alt="" width={44} height={44} className="size-44 rounded-8" />
          <span className="flex items-baseline gap-8">
            <span className="text-headline text-ink">Do Big</span>
            <span className="text-title font-normal text-muted">Daemons</span>
          </span>
        </a>

        <nav aria-label="Main navigation" className="relative hidden xl:block">
          <ul ref={listRef} className="flex items-center gap-4">
            {items.map((item) => {
              const isActive = item.id === active
              return (
                <li key={item.id}>
                  <a
                    ref={(el) => {
                      linkRefs.current[item.id] = el
                    }}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'state-layer block whitespace-nowrap rounded-8 px-12 py-8 text-body transition-colors duration-150',
                      isActive ? 'font-semibold text-accent-ink' : 'text-ink hover:text-accent-ink',
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              )
            })}
          </ul>
          {bar && (
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-8 left-0 h-2 w-100 origin-left rounded-full bg-accent transition-transform duration-200 ease-standard motion-reduce:transition-none"
              style={{ transform: `translateX(${bar.x}px) scaleX(${bar.w / 100})` }}
            />
          )}
        </nav>

        <button
          type="button"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}
          className="state-layer inline-flex h-44 items-center gap-8 rounded-8 px-12 text-label font-medium text-ink xl:hidden"
        >
          {open ? <X aria-hidden className="size-20" /> : <Menu aria-hidden className="size-20" />}
          Menu
        </button>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Main navigation" className="border-t border-line bg-canvas px-24 pb-16 xl:hidden">
          <ul className="mx-auto flex max-w-page flex-col">
            {items.map((item) => (
              <li key={item.id}>
                <a
                  href={item.href}
                  aria-current={item.id === active ? 'page' : undefined}
                  className={cn('flex h-48 items-center border-b border-line text-body', item.id === active ? 'font-semibold text-accent-ink' : 'text-ink')}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  )
}
