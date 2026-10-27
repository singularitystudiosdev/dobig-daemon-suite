import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

/* Button and IconButton after design-web templates/button.tsx: state layer for hover and press
   (survives reduced motion), 2px focus ring from globals, data-slot on every part. */

type Variant = 'primary' | 'normal' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-ink',
  normal: 'border border-line bg-raised text-ink',
  ghost: 'text-muted hover:text-ink',
  danger: 'bg-danger-soft text-danger',
}

const sizes: Record<Size, string> = {
  sm: 'h-32 gap-6 px-12 text-label',
  md: 'h-40 gap-8 px-16 text-label',
  lg: 'h-48 gap-8 px-20 text-body',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: LucideIcon
  iconRight?: LucideIcon
  children?: ReactNode
}

export function Button({ variant = 'normal', size = 'md', loading, icon: Icon, iconRight: IconRight, className, children, disabled, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'state-layer inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-8 font-medium transition-colors duration-150 disabled:pointer-events-none disabled:text-subtle',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <LoaderCircle data-slot="button-spinner" aria-hidden className="size-16 motion-safe:animate-spin" />
      ) : Icon ? (
        <Icon data-slot="button-icon" aria-hidden className="size-16" />
      ) : null}
      {children}
      {IconRight && <IconRight data-slot="button-icon-right" aria-hidden className="size-16" />}
    </button>
  )
}

const iconSizes: Record<Size, string> = { sm: 'size-32', md: 'size-40', lg: 'size-48' }

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string
  icon: LucideIcon
  variant?: Variant
  size?: Size
}

export function IconButton({ label, icon: Icon, variant = 'ghost', size = 'md', className, type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      data-slot="icon-button"
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'state-layer inline-flex shrink-0 items-center justify-center rounded-8 transition-colors duration-150 disabled:pointer-events-none disabled:text-subtle',
        variants[variant],
        iconSizes[size],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className="size-16" />
    </button>
  )
}
