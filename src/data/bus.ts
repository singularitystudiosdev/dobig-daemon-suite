import type { DaemonSlug } from './daemons'
import type { Game } from './games'

/* The confounder bus: every daemon writes dated, typed events to one timeline per game, and the
   daemons read each other's events. Description Daemon treats a creator's sponsored video as a
   confounder; Discord Daemon cites Hack Daemon clusters as mood-drop causes; Thumbnail Daemon
   refuses to start a test while a description test holds the same universe. */

export type BusKind =
  | 'creator-video'
  | 'exploit-surge'
  | 'mood-drop'
  | 'takedown-filed'
  | 'takedown-approved'
  | 'thumbnail-winner'
  | 'description-kept'
  | 'description-hold'
  | 'bait-filtered'

export type BusSeverity = 'info' | 'ok' | 'warn' | 'danger'

export interface BusEvent {
  id: string
  gameId: string
  daemon: DaemonSlug
  kind: BusKind
  title: string
  detail: string
  /** ISO time. */
  at: string
  severity: BusSeverity
  /** Deep link query for the emitting daemon's page, e.g. { focus: 'cluster-hatchery' }. */
  focus?: string
}

/** Rights Manager request-name prefix; DMCA Daemon names requests the same way. */
export function requestPrefix(game: Game) {
  if (game.id === 'steal-an-egg') return 'STEALEGG'
  return game.shortName.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8)
}

/** The last week of bus traffic for a game, newest first. */
export function busFor(game: Game): BusEvent[] {
  const noun = game.noun
  const Noun = noun[0].toUpperCase() + noun.slice(1)
  const events: BusEvent[] = [
    {
      id: `${game.id}-takedown-filed`,
      gameId: game.id,
      daemon: 'dmca-daemon',
      kind: 'takedown-filed',
      title: 'Removal request filed',
      detail: `${requestPrefix(game)}-2026-10-26-A: 37 links under standing attestation`,
      at: '2026-10-26T08:05:00-06:00',
      severity: 'ok',
      focus: 'requests',
    },
    {
      id: `${game.id}-bait`,
      gameId: game.id,
      daemon: 'hack-daemon',
      kind: 'bait-filtered',
      title: 'Bait videos filtered',
      detail: '97 key-system, malware and re-upload videos dropped from 143',
      at: '2026-10-26T06:40:00-06:00',
      severity: 'info',
      focus: 'sources',
    },
    {
      id: `${game.id}-desc-kept`,
      gameId: game.id,
      daemon: 'description-daemon',
      kind: 'description-kept',
      title: 'Description test kept',
      detail: 'Variant B: +0.41pp play-through rate, 95% CI [+0.06, +0.77]',
      at: '2026-10-25T23:59:00-06:00',
      severity: 'ok',
      focus: 'test',
    },
    {
      id: `${game.id}-thumb-winner`,
      gameId: game.id,
      daemon: 'thumbnail-daemon',
      kind: 'thumbnail-winner',
      title: 'Segment winner changed',
      detail: 'T3 now wins 9-12 Mobile at 5.3% QPTR; T2 holds every other segment',
      at: '2026-10-25T14:30:00-06:00',
      severity: 'ok',
      focus: 'segments',
    },
    {
      id: `${game.id}-takedown-approved`,
      gameId: game.id,
      daemon: 'dmca-daemon',
      kind: 'takedown-approved',
      title: 'Takedowns approved',
      detail: "Last week's request: 31 approved, 4 rejected",
      at: '2026-10-24T11:20:00-06:00',
      severity: 'ok',
      focus: 'requests',
    },
    {
      id: `${game.id}-mood`,
      gameId: game.id,
      daemon: 'discord-daemon',
      kind: 'mood-drop',
      title: 'Mood drop of 0.21',
      detail: `Top cause: ${noun} dupe (64% confidence), linked to Hack Daemon's dupe cluster`,
      at: '2026-10-23T21:40:00-06:00',
      severity: 'warn',
      focus: 'mood',
    },
    {
      id: `${game.id}-exploit`,
      gameId: game.id,
      daemon: 'hack-daemon',
      kind: 'exploit-surge',
      title: 'Exploit surge: remote abuse',
      detail: `${Noun} collect remote fired with forged arguments; 18 videos, 1.4M views, rising`,
      at: '2026-10-23T09:12:00-06:00',
      severity: 'danger',
      focus: 'clusters',
    },
    {
      id: `${game.id}-creator`,
      gameId: game.id,
      daemon: 'creator-dox',
      kind: 'creator-video',
      title: 'Tracked creator went live',
      detail: `Sponsored ${game.shortName} video from a tracked creator; Description Daemon marked it as a confounder`,
      at: '2026-10-22T17:00:00-06:00',
      severity: 'info',
      focus: 'uploads',
    },
    {
      id: `${game.id}-desc-hold`,
      gameId: game.id,
      daemon: 'description-daemon',
      kind: 'description-hold',
      title: 'Description test holding',
      detail: 'Universe locked for 7 days: new thumbnail tests wait until Oct 26',
      at: '2026-10-19T09:00:00-06:00',
      severity: 'info',
      focus: 'test',
    },
  ]
  return events
}
