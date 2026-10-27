/* cn(): clsx + tailwind-merge, the shadcn class-merging convention (design-web templates/cn.ts). */
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge the project's own text ramp so `text-label` and `text-muted` are not
// treated as the same group and dropped.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['mega', 'display', 'headline', 'title', 'stat', 'body', 'label', 'micro'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
