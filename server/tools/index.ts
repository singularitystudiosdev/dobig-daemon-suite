import type { DaemonSlug } from '../../src/data/daemons.ts'
import { tool as creator } from './creator.ts'
import { tool as description } from './description.ts'
import { tool as discord } from './discord.ts'
import { tool as dmca } from './dmca.ts'
import { tool as hack } from './hack.ts'
import { tool as pulse } from './pulse.ts'
import { tool as rank } from './rank.ts'
import { tool as sponsor } from './sponsor.ts'
import type { ToolModule } from './types.ts'

/** Every tool that runs through the run engine. thumbnail-daemon is separate: its generation is /api/variants and
 *  its daemon is a gallery watcher built into the run engine (server/runs.ts). */
export const toolModules: Record<Exclude<DaemonSlug, 'thumbnail-daemon'>, ToolModule> = {
  'creator-dox': creator,
  'description-daemon': description,
  'discord-daemon': discord,
  'dmca-daemon': dmca,
  'hack-daemon': hack,
  'rank-daemon': rank,
  'sponsor-daemon': sponsor,
  'pulse-daemon': pulse,
}
