import { cn } from '@/lib/cn'
import type { Game } from '@/data/games'

/* A copycat's icon: the active game's real thumbnail flipped, cropped and hue-shifted, the way
   knock-offs re-skin a hit. Static transforms and filters only; nothing here animates. */
const VARIANTS = [
  '-scale-x-100',
  'scale-150 hue-rotate-30',
  'hue-rotate-180 saturate-150',
  '-scale-x-125 scale-y-125 hue-rotate-60',
  'grayscale contrast-125',
  'scale-125 sepia saturate-200',
  '-scale-x-100 hue-rotate-90 brightness-110',
  'scale-150 -translate-x-8 contrast-150',
]

const sizes = { 24: 'size-24', 32: 'size-32', 40: 'size-40', 48: 'size-48', 64: 'size-64' } as const

export function Knockoff({ game, variant, size = 40, className }: { game: Pick<Game, 'thumb'>; variant: number; size?: keyof typeof sizes; className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-block shrink-0 overflow-hidden rounded-8 bg-raised', sizes[size], className)}>
      <img src={game.thumb} alt="" width={size} height={size} loading="lazy" decoding="async" className={cn('size-full object-cover', VARIANTS[variant % VARIANTS.length])} />
    </span>
  )
}
