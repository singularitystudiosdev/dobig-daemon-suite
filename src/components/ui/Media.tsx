import { useState } from 'react'
import { cn } from '@/lib/cn'
import { hashString } from '@/lib/random'
import type { Game } from '@/data/games'

const avatarSizes = { 24: 'size-24 text-micro', 32: 'size-32 text-micro', 40: 'size-40 text-label', 48: 'size-48 text-body', 64: 'size-64 text-title' } as const
const avatarTones = ['bg-accent-soft text-accent-ink', 'bg-live-soft text-live', 'bg-warn-soft text-warn', 'bg-danger-soft text-danger', 'bg-data-5-soft text-data-5', 'bg-data-6-soft text-data-6']

/* Initials avatar with a deterministic category tint. Mock people never get photos. */
export function Avatar({ name, size = 32, className }: { name: string; size?: keyof typeof avatarSizes; className?: string }) {
  const clean = name.replace(/^@/, '')
  const initials = clean
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || clean.slice(0, 2).toUpperCase()
  const tone = avatarTones[hashString(clean) % avatarTones.length]
  return (
    <span data-slot="avatar" aria-hidden className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold', avatarSizes[size], tone, className)}>
      {initials}
    </span>
  )
}

const thumbSizes = { 24: 'size-24', 32: 'size-32', 40: 'size-40', 48: 'size-48', 64: 'size-64', 72: 'size-72', 96: 'size-96' } as const

/* A Roblox game icon with a skeleton behind it until it decodes (dobig.com does the same). */
export function GameThumb({ game, size = 40, className }: { game: Pick<Game, 'thumb' | 'shortName'>; size?: keyof typeof thumbSizes; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <span data-slot="game-thumb" className={cn('relative inline-block shrink-0 overflow-hidden rounded-8 bg-raised', thumbSizes[size], className)}>
      {!loaded && <span aria-hidden className="absolute inset-0 bg-raised motion-safe:animate-pulse" />}
      <img
        src={game.thumb}
        alt={`${game.shortName} icon`}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cn('size-full object-cover transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')}
      />
    </span>
  )
}
