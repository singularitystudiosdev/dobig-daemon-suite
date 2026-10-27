import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { DaemonSlug } from '@/data/daemons'

/* Each daemon page lives in src/tools/<slug>/ and default-exports its page component. */
export const toolPages: Record<DaemonSlug, LazyExoticComponent<ComponentType>> = {
  'creator-dox': lazy(() => import('./creator-dox')),
  'thumbnail-daemon': lazy(() => import('./thumbnail-daemon')),
  'discord-daemon': lazy(() => import('./discord-daemon')),
  'description-daemon': lazy(() => import('./description-daemon')),
  'dmca-daemon': lazy(() => import('./dmca-daemon')),
  'hack-daemon': lazy(() => import('./hack-daemon')),
}
