/* Status and category tones. Class strings are literal so Tailwind sees them. */
export type Tone = 'accent' | 'live' | 'warn' | 'danger' | 'muted' | 'ink' | 'data5' | 'data6'

export const toneText: Record<Tone, string> = {
  accent: 'text-accent-ink',
  live: 'text-live',
  warn: 'text-warn',
  danger: 'text-danger',
  muted: 'text-muted',
  ink: 'text-ink',
  data5: 'text-data-5',
  data6: 'text-data-6',
}

export const toneBg: Record<Tone, string> = {
  accent: 'bg-accent',
  live: 'bg-live',
  warn: 'bg-warn',
  danger: 'bg-danger',
  muted: 'bg-muted',
  ink: 'bg-ink',
  data5: 'bg-data-5',
  data6: 'bg-data-6',
}

export const toneSoft: Record<Tone, string> = {
  accent: 'bg-accent-soft',
  live: 'bg-live-soft',
  warn: 'bg-warn-soft',
  danger: 'bg-danger-soft',
  muted: 'bg-raised',
  ink: 'bg-raised',
  data5: 'bg-data-5-soft',
  data6: 'bg-data-6-soft',
}

export const toneBorder: Record<Tone, string> = {
  accent: 'border-accent-ink',
  live: 'border-live',
  warn: 'border-warn',
  danger: 'border-danger',
  muted: 'border-line-strong',
  ink: 'border-ink',
  data5: 'border-data-5',
  data6: 'border-data-6',
}

export const toneStroke: Record<Tone, string> = {
  accent: 'stroke-accent-ink',
  live: 'stroke-live',
  warn: 'stroke-warn',
  danger: 'stroke-danger',
  muted: 'stroke-muted',
  ink: 'stroke-ink',
  data5: 'stroke-data-5',
  data6: 'stroke-data-6',
}

export const toneFill: Record<Tone, string> = {
  accent: 'fill-accent-ink',
  live: 'fill-live',
  warn: 'fill-warn',
  danger: 'fill-danger',
  muted: 'fill-muted',
  ink: 'fill-ink',
  data5: 'fill-data-5',
  data6: 'fill-data-6',
}
