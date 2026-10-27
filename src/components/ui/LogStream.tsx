import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

export type LogLevel = 'info' | 'ok' | 'warn' | 'error' | 'dim' | 'cmd'

export interface LogLine {
  id: string | number
  ts?: string
  level?: LogLevel
  text: string
}

const levelClass: Record<LogLevel, string> = {
  info: 'text-accent-ink',
  ok: 'text-live',
  warn: 'text-warn',
  error: 'text-danger',
  dim: 'text-subtle',
  cmd: 'text-ink',
}

/* Daemon log: mono lines that follow the tail unless the reader scrolls up.
   role="log" with aria-live off so screen readers are not flooded during a run. */
export function LogStream({ lines, title = 'Daemon log', className, heightClass = 'h-240' }: { lines: LogLine[]; title?: string; className?: string; heightClass?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && follow.current) el.scrollTop = el.scrollHeight
  }, [lines.length])
  return (
    <div data-slot="log-stream" className={cn('flex min-w-0 flex-col rounded-8 border border-line bg-sunken', className)}>
      <div className="flex items-center justify-between gap-8 border-b border-line px-12 py-8">
        <span className="text-micro font-medium text-muted">{title}</span>
        <span className="tabular font-mono text-micro text-subtle">{lines.length} lines</span>
      </div>
      <div
        ref={ref}
        role="log"
        aria-live="off"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className={cn('scroll-thin overflow-y-auto px-12 py-8 font-mono text-micro', heightClass)}
      >
        {lines.map((line, i) => {
          const level = line.level ?? 'info'
          return (
            <div key={line.id} className={cn('flex gap-8 py-2', i === lines.length - 1 && 'motion-safe:animate-enter')}>
              {line.ts && <span className="shrink-0 text-subtle">{line.ts}</span>}
              <span className={cn('w-40 shrink-0', levelClass[level])}>{level}</span>
              <span className="min-w-0 whitespace-pre-wrap break-words text-ink">{line.text}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
