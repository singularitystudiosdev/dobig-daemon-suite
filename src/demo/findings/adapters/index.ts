import type { DaemonSlug } from '@/data/daemons'
import type { GameInfo } from '@/lib/apiTypes'
import { gameFromInfo } from '@/lib/gameFromInfo'
import type { FindingsModel } from '../types'
import { creatorModel } from './creator'
import { descriptionModel } from './description'
import { discordModel } from './discord'
import { dmcaModel } from './dmca'
import { hackModel } from './hack'

/** The findings model for a tool and a game; null for the thumbnail tool, which has its own workspace. */
export function modelFor(slug: DaemonSlug, info: GameInfo): FindingsModel | null {
  const game = gameFromInfo(info)
  switch (slug) {
    case 'hack-daemon':
      return hackModel(game)
    case 'dmca-daemon':
      return dmcaModel(game)
    case 'discord-daemon':
      return discordModel(game)
    case 'description-daemon':
      return descriptionModel(game)
    case 'creator-dox':
      return creatorModel(game)
    default:
      return null
  }
}
