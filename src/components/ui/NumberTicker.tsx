import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { fmtInt } from '@/lib/format'
import { useReducedMotion } from '@/lib/hooks'

/* Rolling number for an in-place value change (design-motion "Rolling number").
   Reduced motion replaces the value instantly. */
export function NumberTicker({
  value,
  format = fmtInt,
  duration = 280,
  startFrom,
  className,
}: {
  value: number
  format?: (n: number) => string
  duration?: number
  /** Count up from this value on mount instead of showing `value` immediately. */
  startFrom?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(startFrom ?? value)
  const current = useRef(startFrom ?? value)
  useEffect(() => {
    if (reduced) {
      current.current = value
      setDisplay(value)
      return
    }
    const from = current.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = from + (value - from) * eased
      current.current = v
      setDisplay(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, reduced])
  return <span className={cn('tabular', className)}>{format(display)}</span>
}
