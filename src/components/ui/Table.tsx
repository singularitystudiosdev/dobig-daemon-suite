import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/* Dense data table: hairline rows, muted header, tabular numbers right-aligned via `numeric`. */

export function Table({ children, className, caption }: { children: ReactNode; className?: string; caption?: string }) {
  return (
    <div data-slot="table" className={cn('scroll-thin min-w-0 overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-label">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  )
}

export function Th({ children, numeric, className, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th scope="col" className={cn('whitespace-nowrap border-b border-line px-12 py-8 text-micro font-medium text-muted first:pl-0 last:pr-0', numeric && 'text-right', className)} {...props}>
      {children}
    </th>
  )
}

export function Td({ children, numeric, className, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td className={cn('border-b border-line px-12 py-12 align-middle text-ink first:pl-0 last:pr-0', numeric && 'tabular text-right', className)} {...props}>
      {children}
    </td>
  )
}
