import type { Game } from '@/data/games'
import type { SimStage } from '@/lib/useSimulation'
import type { LogLine } from '@/components/ui'
import { createRng, type Rng } from '@/lib/random'
import { fmtCompact, fmtInt, fmtLogTime } from '@/lib/format'

/* Hack Daemon dataset. Steal An Egg is hand-authored from the spec; the other eleven games are
   derived with a seeded RNG from game.noun and game.shortName. The remote-abuse headline cluster
   and the 143 / 97 / 46 crawl totals are pinned for every game because src/data/bus.ts quotes them. */

export const STAGES: SimStage[] = [
  { id: 'watchlist', label: 'Watchlist', detail: 'Compose the search query', duration: 1500 },
  { id: 'crawl', label: 'Crawl', detail: 'search.list and videos.list', duration: 3000 },
  { id: 'filter', label: 'Filter bait', detail: 'Strike bait, malware, fakes', duration: 4000 },
  { id: 'classify', label: 'Classify', detail: 'Merge into clusters', duration: 3500 },
  { id: 'map', label: 'Map to systems', detail: 'Strike the abused node', duration: 4500 },
  { id: 'summarise', label: 'Dev summary', detail: 'Briefs for the patch', duration: 2500 },
]

/* Absolute stage boundaries in script ms, mirrored from STAGES so data can be timed without a sim. */
const starts: Record<string, number> = {}
{
  let acc = 0
  for (const s of STAGES) {
    starts[s.id] = acc
    acc += s.duration
  }
}
export const T = {
  watchlist: starts.watchlist,
  crawl: starts.crawl,
  filter: starts.filter,
  classify: starts.classify,
  map: starts.map,
  summarise: starts.summarise,
  end: STAGES.reduce((a, s) => a + s.duration, 0),
}

export type ClusterClass = 'remote abuse' | 'speed/teleport' | 'dupe' | 'auto-farm' | 'ESP'
export type Severity = 'LOW' | 'MED' | 'HIGH' | 'CRIT'
export type Verdict = 'real' | 'key-system bait' | 'malware' | 'fake' | 're-upload'
export type PatchStatus = 'open' | 'patched' | 'monitoring'

export interface ExploitCluster {
  id: string
  cls: ClusterClass
  system: string
  side: 'client' | 'server'
  videos: number
  totalViews: number
  firstSeen: string
  trend: 'rising' | 'flat' | 'fading'
  confidence: 'confirmed' | 'likely' | 'unverified'
  severity: Severity
  /** Map node the cluster strikes. */
  nodeId: NodeId
  /** Daily new views over the last 14 days, for the trend sparkline. */
  daily: number[]
}

export interface SourceVideo {
  videoId: string
  title: string
  channel: string
  publishedAt: string
  viewCount: number
  verdict: Verdict
  clusterId?: string
}

export interface DevBrief {
  clusterId: string
  observed: string
  cause: string
  fix: string
  status: PatchStatus
}

export interface SellerProfile {
  id: string
  persona: string
  pitch: string
  channels: number
  videos: number
  storefront: string
  discordMembers: string
  clusterIds: string[]
  lastSeen: string
  status: 'active' | 'dormant'
}

export interface ApiCall {
  id: string
  at: number
  method: 'search.list' | 'videos.list'
  request: string
  items: number
  /** search.list counts calls against its own 100/day bucket; videos.list costs 1 unit per call. */
  cost: number
}

export type NodeId = 'local' | 'physics' | 'ui' | 'action' | 'trade' | 'collect'

export interface MapNode {
  id: NodeId
  side: 'client' | 'server'
  label: string
  hint: string
}

export interface HackDataset {
  query: string
  params: string[]
  publishedAfter: string
  nodes: MapNode[]
  clusters: ExploitCluster[]
  sources: SourceVideo[]
  briefs: DevBrief[]
  profiles: SellerProfile[]
  calls: ApiCall[]
  logs: (LogLine & { at: number })[]
  /** When each source tile is struck during the filter stage (ms), by videoId. */
  strikeAt: Record<string, number>
  filteredBy: Record<Exclude<Verdict, 'real'>, number>
}

export const SEARCH_CAP = 100
export const VIDEOS_CAP = 10_000
export const RUN_BASE = new Date('2026-10-26T06:38:00-06:00')
export const PUBLISHED_AFTER = '2026-10-12T00:00:00Z'

export const verdictLabel: Record<Verdict, string> = {
  real: 'real',
  'key-system bait': 'key-system bait',
  malware: 'malware download link',
  fake: 'fake (edited footage)',
  're-upload': 're-upload',
}

/* Remote names per game. The spec fixes Steal An Egg; the others follow each game's core loop. */
const REMOTES: Record<string, { action: string; trade: string; collect: string }> = {
  'steal-an-egg': { action: 'EggService.StealEgg', trade: 'TradeService.Confirm', collect: 'Hatchery.Collect' },
  'steal-a-brainrot': { action: 'BrainrotService.StealBrainrot', trade: 'TradeService.Confirm', collect: 'BaseService.CollectCash' },
  fisch: { action: 'RodService.Reel', trade: 'TradeService.Confirm', collect: 'FishMerchant.SellCatch' },
  'murderers-vs-sheriffs': { action: 'CombatService.Hit', trade: 'TradeService.Confirm', collect: 'DuelRewards.Claim' },
  'ride-a-pet': { action: 'PetService.Ride', trade: 'TradeService.Confirm', collect: 'EggSpawns.Collect' },
  'fake-an-egg': { action: 'DisguiseService.StealPet', trade: 'TradeService.Confirm', collect: 'EggService.Collect' },
  'grow-a-garden': { action: 'GardenService.PlantSeed', trade: 'TradeService.Confirm', collect: 'Harvest.Collect' },
  'blade-ball': { action: 'BallService.Parry', trade: 'TradeService.Confirm', collect: 'Crates.Claim' },
  'tower-defense-simulator': { action: 'TowerService.Place', trade: 'TradeService.Confirm', collect: 'WaveRewards.Claim' },
  'blue-lock-rivals': { action: 'BallService.Shoot', trade: 'TradeService.Confirm', collect: 'Spins.Claim' },
  'a-dusty-trip': { action: 'CarService.Repair', trade: 'StorageService.Transfer', collect: 'Loot.Collect' },
  'knife-duels': { action: 'CombatService.Throw', trade: 'TradeService.Confirm', collect: 'CaseService.Open' },
}

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1)
}

export function remotesFor(game: Game) {
  const N = cap(game.noun)
  return REMOTES[game.id] ?? { action: `${N}Service.Steal${N}`, trade: 'TradeService.Confirm', collect: `${N}Service.Collect` }
}

const CH_A = ['Byte', 'Null', 'Hex', 'Pixel', 'Turbo', 'Glitch', 'Nova', 'Frost', 'Shadow', 'Zap', 'Lag', 'Rift', 'Echo', 'Volt', 'Mochi', 'Crisp']
const CH_B = ['Goblin', 'Hunter', 'RBX', 'Scripts', 'Plays', 'Lab', 'Clips', 'Kid', 'Bros', 'Den', 'Vault', 'Zone']

function channelName(rng: Rng) {
  const a = rng.pick(CH_A)
  const b = rng.pick(CH_B)
  const style = rng.int(0, 3)
  if (style === 0) return `${a}${b}`
  if (style === 1) return `${a.toLowerCase()}_${b.toLowerCase()}`
  if (style === 2) return `${a}${b}${rng.int(2, 99)}`
  return `The${a}${b}`
}

function titleFor(rng: Rng, kind: ClusterClass | Exclude<Verdict, 'real'>, S: string, noun: string): string {
  const pools: Record<string, string[]> = {
    'remote abuse': [
      `${S} infinite ${noun}s glitch (still works?)`,
      `how they collect every ${noun} in ${S}`,
      `I collected 400 ${noun}s without hatching (${S})`,
      `${S} collect glitch showcase`,
      `this ${S} glitch breaks the hatchery`,
    ],
    dupe: [`${S} trade dupe explained`, `duping ${noun}s with two accounts in ${S}`, `${S} dupe glitch (patched?)`],
    'speed/teleport': [`${S} speed showcase`, `fastest stealer in ${S} (not clickbait)`, `teleporting to every base in ${S}`],
    'auto-farm': [`${S} AFK farm overnight results`, `auto farming ${noun}s for 24 hours in ${S}`, `${S} farm while you sleep`],
    ESP: [`seeing every rare ${noun} through walls`, `${S} ESP showcase`, `I can see what is inside every ${noun}`],
    'key-system bait': [`${S} script NO KEY (OP)`, `${S} BEST hack 2026 free`, `new ${S} script, keyless?!`, `${S} OP GUI free (works on mobile)`],
    malware: [`${S} mod menu download (free)`, `${S} hack PC + mobile download`, `${S} unlock all tool free`],
    fake: [`${S} admin hack gives 1000 ${noun}s (real?)`, `I hacked the ${S} owner account`, `${S} god mode is insane`],
    're-upload': [`${S} glitch (reupload)`, `${S} OP glitch (not mine, credit in desc)`, `${S} infinite ${noun}s (reup)`],
  }
  return rng.pick(pools[kind])
}

/** Split `total` into `n` integer parts with random weights; parts sum exactly to total. */
function splitTotal(rng: Rng, total: number, n: number, skew = 1.6) {
  const w = Array.from({ length: n }, () => Math.pow(rng.float(0.2, 1), skew))
  const sum = w.reduce((a, b) => a + b, 0)
  const parts = w.map((x) => Math.round((x / sum) * total / 100) * 100)
  const diff = total - parts.reduce((a, b) => a + b, 0)
  parts[0] += diff
  return parts.sort((a, b) => b - a)
}

const PUB_FROM = Date.parse(PUBLISHED_AFTER)
const PUB_TO = Date.parse('2026-10-26T12:20:00Z')

function dailySeries(rng: Rng, trend: ExploitCluster['trend'], total: number) {
  const shape = Array.from({ length: 14 }, (_, i) => {
    const x = i / 13
    const base = trend === 'rising' ? 0.15 + x * x * 1.6 : trend === 'fading' ? 1.4 - x * 1.1 : 0.8
    return Math.max(0.05, base * rng.float(0.75, 1.25))
  })
  const s = shape.reduce((a, b) => a + b, 0)
  return shape.map((v) => Math.round((v / s) * total))
}

interface ClusterSeed {
  cls: ClusterClass
  nodeId: NodeId
  videos: number
  totalViews: number
  trend: ExploitCluster['trend']
  confidence: ExploitCluster['confidence']
  severity: Severity
}

function clusterSeeds(game: Game, rng: Rng): ClusterSeed[] {
  // The headline cluster matches the bus event every game shows ("18 videos, 1.4M views, rising").
  const headline: ClusterSeed = { cls: 'remote abuse', nodeId: 'collect', videos: 18, totalViews: 1_412_000, trend: 'rising', confidence: 'confirmed', severity: 'HIGH' }
  if (game.id === 'steal-an-egg')
    return [
      headline,
      { cls: 'dupe', nodeId: 'trade', videos: 6, totalViews: 388_000, trend: 'rising', confidence: 'likely', severity: 'CRIT' },
      { cls: 'speed/teleport', nodeId: 'physics', videos: 11, totalViews: 220_000, trend: 'flat', confidence: 'confirmed', severity: 'MED' },
      { cls: 'auto-farm', nodeId: 'action', videos: 7, totalViews: 164_000, trend: 'rising', confidence: 'likely', severity: 'MED' },
      { cls: 'ESP', nodeId: 'ui', videos: 4, totalViews: 61_000, trend: 'fading', confidence: 'unverified', severity: 'LOW' },
    ]
  const duel = game.genre === 'Action' || game.subgenre.includes('Fighting')
  const dupe = rng.int(4, 8)
  const speed = rng.int(6, 11)
  const esp = rng.int(3, 5)
  const farm = 28 - dupe - speed - esp
  const round = (n: number) => Math.round(n / 1000) * 1000
  return [
    headline,
    { cls: 'dupe', nodeId: 'trade', videos: dupe, totalViews: round(rng.int(240_000, 480_000)), trend: rng.pick(['rising', 'flat'] as const), confidence: 'likely', severity: 'CRIT' },
    { cls: 'speed/teleport', nodeId: 'physics', videos: speed, totalViews: round(rng.int(120_000, 300_000)), trend: rng.pick(['flat', 'rising', 'fading'] as const), confidence: 'confirmed', severity: 'MED' },
    { cls: 'auto-farm', nodeId: 'action', videos: farm, totalViews: round(rng.int(90_000, 230_000)), trend: rng.pick(['rising', 'flat'] as const), confidence: 'likely', severity: duel ? 'HIGH' : 'MED' },
    { cls: 'ESP', nodeId: 'ui', videos: esp, totalViews: round(rng.int(30_000, 95_000)), trend: rng.pick(['fading', 'flat'] as const), confidence: duel ? 'likely' : 'unverified', severity: duel ? 'MED' : 'LOW' },
  ]
}

function briefFor(c: ExploitCluster, game: Game, r: ReturnType<typeof remotesFor>): DevBrief {
  const n = game.noun
  switch (c.cls) {
    case 'remote abuse':
      return {
        clusterId: c.id,
        observed: `Players fire ${r.collect} from anywhere on the map and collect ${n}s they do not own, skipping the hatch timer.`,
        cause: 'Client-authoritative collect: the server trusts the item id and position the client sends.',
        fix: 'Validate on the server that the player owns the item, stands within range of it, and that the timer and a per-player cooldown have elapsed. Reject and log anything else.',
        status: 'open',
      }
    case 'dupe':
      return {
        clusterId: c.id,
        observed: `Two clients confirm the same trade in one window and both inventories keep the ${n}.`,
        cause: 'Trade confirmation is not atomic; offered items are not locked between offer and confirm.',
        fix: 'Lock offered items on the server at offer time, make confirm idempotent per trade id, and commit both inventories in one session-locked save.',
        status: 'open',
      }
    case 'speed/teleport':
      return {
        clusterId: c.id,
        observed: "Characters move several times faster than WalkSpeed allows and appear inside other players' bases.",
        cause: 'The client owns its character physics and the server never checks displacement.',
        fix: 'Sample each character position on the server, compare displacement to max speed with a latency allowance, and rubber-band or flag the player instead of trusting the client.',
        status: 'monitoring',
      }
    case 'auto-farm':
      return {
        clusterId: c.id,
        observed: `${r.action} fires on a tight loop with no player input, farming ${n}s while the player is away.`,
        cause: 'No server-side rate limit or proximity check on the action remote.',
        fix: 'Rate-limit the remote per player on the server, require proximity to the target, and flag cadences that stay inhumanly regular.',
        status: 'open',
      }
    case 'ESP':
      return {
        clusterId: c.id,
        observed: `Overlays show which bases hold rare ${n}s and where players are through walls.`,
        cause: 'The server replicates hidden values (rarity, contents) to every client before they should be visible.',
        fix: 'Keep hidden values on the server, replicate only what a player can see, and reveal on interaction.',
        status: 'patched',
      }
  }
}

const PERSONA_A = ['Velvet', 'Cobalt', 'Static', 'Hollow', 'Quartz', 'Sable', 'Neon', 'Pocket']
const PERSONA_B = ['Hub', 'Market', 'Works', 'Supply', 'Club', 'Exchange']

export function buildDataset(game: Game): HackDataset {
  const rng = createRng('hack-daemon-' + game.id)
  const S = game.shortName
  const noun = game.noun
  const r = remotesFor(game)
  const query = `"${S.toLowerCase()}" (script|exploit|hack|dupe) -tutorial -fanmade`
  const params = ['part=snippet', 'type=video', 'order=date', `publishedAfter=${PUBLISHED_AFTER}`, 'maxResults=50']

  const nodes: MapNode[] = [
    { id: 'local', side: 'client', label: 'LocalScripts', hint: 'fires remotes' },
    { id: 'physics', side: 'client', label: 'Character physics', hint: 'client-owned movement' },
    { id: 'ui', side: 'client', label: 'UI', hint: 'renders replicated state' },
    { id: 'action', side: 'server', label: r.action, hint: 'RemoteEvent' },
    { id: 'trade', side: 'server', label: r.trade, hint: 'RemoteFunction' },
    { id: 'collect', side: 'server', label: r.collect, hint: 'RemoteEvent' },
  ]
  const systemOf = (id: NodeId) => nodes.find((nd) => nd.id === id)!.label

  // Real videos per cluster, with views that sum exactly to the cluster total.
  const seeds = clusterSeeds(game, rng)
  const sources: SourceVideo[] = []
  const clusterIdOf = (cls: ClusterClass) => 'cl-' + cls.replace(/[^a-z]/gi, '').toLowerCase()
  const pubAt = (lo = PUB_FROM, hi = PUB_TO) => new Date(rng.float(lo, hi)).toISOString().replace(/\.\d+Z$/, 'Z')

  for (const s of seeds) {
    const views = splitTotal(rng, s.totalViews, s.videos)
    // Rising clusters skew recent; fading ones skew old.
    const lo = s.trend === 'rising' ? PUB_FROM + 2 * 86400000 : PUB_FROM
    const hi = s.trend === 'fading' ? PUB_TO - 5 * 86400000 : PUB_TO
    for (let i = 0; i < s.videos; i++)
      sources.push({ videoId: rng.id(11), title: titleFor(rng, s.cls, S, noun), channel: channelName(rng), publishedAt: pubAt(lo, hi), viewCount: views[i], verdict: 'real', clusterId: clusterIdOf(s.cls) })
  }

  const filteredBy = { 'key-system bait': 41, malware: 22, 're-upload': 21, fake: 13 } as const
  for (const [verdict, count] of Object.entries(filteredBy) as [Exclude<Verdict, 'real'>, number][]) {
    for (let i = 0; i < count; i++) {
      const hero = verdict === 'key-system bait' && i === 0
      sources.push({
        videoId: rng.id(11),
        title: hero ? `${S} script NO KEY, OP auto ${noun} farm (updated)` : titleFor(rng, verdict, S, noun),
        channel: channelName(rng),
        publishedAt: pubAt(),
        viewCount: hero ? 41_000 : Math.round(Math.exp(rng.float(Math.log(800), Math.log(36_000))) / 10) * 10,
        verdict,
      })
    }
  }
  // order=date: the crawl returns newest first.
  sources.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))

  const clusters: ExploitCluster[] = seeds.map((s) => {
    const id = clusterIdOf(s.cls)
    const first = sources.filter((v) => v.clusterId === id).reduce((m, v) => (v.publishedAt < m ? v.publishedAt : m), '9999')
    const node = nodes.find((nd) => nd.id === s.nodeId)!
    return {
      id,
      cls: s.cls,
      system: systemOf(s.nodeId),
      side: node.side,
      videos: s.videos,
      totalViews: s.totalViews,
      firstSeen: first,
      trend: s.trend,
      confidence: s.confidence,
      severity: s.severity,
      nodeId: s.nodeId,
      daily: dailySeries(rng, s.trend, s.totalViews),
    }
  })

  const briefs = clusters.map((c) => briefFor(c, game, r))

  // Filter-stage strike times, grouped by reason so the log and the grid agree.
  const strikeAt: Record<string, number> = {}
  const groups: [Exclude<Verdict, 'real'>, number, number][] = [
    ['key-system bait', T.filter + 150, T.filter + 1150],
    ['malware', T.filter + 1150, T.filter + 1900],
    ['re-upload', T.filter + 2150, T.filter + 3050],
    ['fake', T.filter + 3050, T.filter + 3750],
  ]
  for (const [verdict, from, to] of groups) {
    const list = sources.filter((v) => v.verdict === verdict)
    list.forEach((v, i) => (strikeAt[v.videoId] = from + ((to - from) * i) / list.length))
  }

  const calls: ApiCall[] = [
    { id: 's1', at: T.crawl + 200, method: 'search.list', request: `q=${query} ${params.join(' ')}`, items: 50, cost: 1 },
    { id: 's2', at: T.crawl + 850, method: 'search.list', request: 'pageToken=CDIQAA', items: 50, cost: 1 },
    { id: 's3', at: T.crawl + 1500, method: 'search.list', request: 'pageToken=CGQQAA', items: 43, cost: 1 },
    { id: 'v1', at: T.crawl + 1950, method: 'videos.list', request: 'part=snippet,statistics,contentDetails id=50 ids', items: 50, cost: 1 },
    { id: 'v2', at: T.crawl + 2350, method: 'videos.list', request: 'part=snippet,statistics,contentDetails id=50 ids', items: 50, cost: 1 },
    { id: 'v3', at: T.crawl + 2750, method: 'videos.list', request: 'part=snippet,statistics,contentDetails id=43 ids', items: 43, cost: 1 },
    { id: 's4', at: T.filter + 1950, method: 'search.list', request: 're-upload check: q=title fingerprints order=viewCount', items: 21, cost: 1 },
  ]

  const fc = (n: number) => fmtCompact(n)
  const byCls = (cls: ClusterClass) => clusters.find((c) => c.cls === cls)!
  const logs: HackDataset['logs'] = []
  const log = (at: number, level: LogLine['level'], text: string) => logs.push({ id: `l${logs.length}`, at, ts: fmtLogTime(at, RUN_BASE), level, text })

  log(80, 'cmd', `hack-daemon run --universe ${game.universeId} --place ${game.placeId}`)
  log(350, 'info', `watchlist for ${S}: 4 terms, 2 exclusions`)
  log(1050, 'dim', `q=${query}`)
  log(1350, 'dim', `publishedAfter=${PUBLISHED_AFTER} order=date type=video`)
  let searchUsed = 0
  let unitsUsed = 0
  for (const c of calls) {
    if (c.method === 'search.list') {
      searchUsed += 1
      log(c.at, 'info', `GET youtube/v3/search ${c.id === 's4' ? c.request : c.id === 's1' ? 'page 1' : `page ${c.id.slice(1)} ${c.request}`} 200, ${c.items} items`)
      log(c.at + 60, 'dim', `quota search.list ${searchUsed}/${SEARCH_CAP} calls today`)
    } else {
      unitsUsed += c.cost
      log(c.at, 'info', `GET youtube/v3/videos ${c.request} 200, ${c.items} items`)
      log(c.at + 60, 'dim', `quota videos.list ${unitsUsed}/${fmtInt(VIDEOS_CAP)} units today`)
    }
  }
  log(T.crawl + 2950, 'ok', '143 videos fetched with statistics')
  log(T.filter + 1100, 'warn', 'struck 41 key-system bait (description routes to a key gate, link withheld)')
  log(T.filter + 1850, 'warn', 'struck 22 malware (download link in description, withheld)')
  log(T.filter + 3000, 'warn', 'struck 21 re-uploads (matched an earlier upload)')
  log(T.filter + 3700, 'warn', 'struck 13 fakes (edited footage, spliced frames)')
  log(T.filter + 3900, 'ok', '46 videos remain of 143')
  log(T.classify + 400, 'info', 'embedding titles, transcripts and frame captions')
  log(T.classify + 3100, 'ok', `46 videos in 5 clusters: ${clusters.map((c) => `${c.cls} ${c.videos}`).join(', ')}`)
  const order = mapOrder(clusters)
  order.forEach((c, i) => {
    const { arrive } = flightTimes(i)
    log(arrive, c.severity === 'HIGH' || c.severity === 'CRIT' ? 'error' : 'warn', `${c.system} hit by ${c.cls}, ${c.videos} videos, ${fc(c.totalViews)} views, ${c.severity}`)
  })
  log(T.summarise + 300, 'info', `writing 5 dev briefs for ${S}`)
  log(T.summarise + 1600, 'ok', `bus: exploit-surge emitted for ${byCls('remote abuse').system}`)
  log(T.summarise + 2000, 'dim', `bus: dupe cluster linked to Discord Daemon mood drop`)
  log(T.summarise + 2400, 'ok', `run complete, ${searchUsed} search calls and ${unitsUsed} units used`)
  logs.sort((a, b) => a.at - b.at)

  const profiles: SellerProfile[] = Array.from({ length: 4 }, (_, i) => {
    const name = `${rng.pick(PERSONA_A)}${rng.pick(PERSONA_B)}`
    const ids = i === 0 ? [clusterIdOf('remote abuse'), clusterIdOf('auto-farm')] : i === 1 ? [clusterIdOf('dupe')] : i === 2 ? [clusterIdOf('speed/teleport'), clusterIdOf('ESP')] : [clusterIdOf('remote abuse')]
    const lo = rng.pick([1, 2, 3, 5])
    return {
      id: `p${i}`,
      persona: name,
      pitch: [
        `Sells paid access to a ${S} "collect all" script through a key gate`,
        `Runs a dupe service: buyers hand over ${noun}s, get doubles back`,
        `Bundles speed and wallhack overlays across several games`,
        `Re-uploads other channels' footage to push a storefront`,
      ][i],
      channels: rng.int(2, 6),
      videos: [21, 9, 14, 17][i],
      storefront: ['Hosted storefront', 'Discord-only orders', 'Paste site behind a key gate', 'Hosted storefront'][i],
      discordMembers: `${lo}K to ${lo * 2 + rng.int(1, 3)}K`,
      clusterIds: ids,
      lastSeen: new Date(PUB_TO - rng.float(0.1, i === 3 ? 9 : 3) * 86400000).toISOString(),
      status: i === 3 ? 'dormant' : 'active',
    }
  })

  return { query, params, publishedAfter: PUBLISHED_AFTER, nodes, clusters, sources, briefs, profiles, calls, logs, strikeAt, filteredBy: { ...filteredBy } }
}

/* Map-stage choreography, shared by the map and the log. Clusters fly in severity-ascending order
   so the headline strike lands last. */
const sevRank: Record<Severity, number> = { LOW: 0, MED: 1, HIGH: 2, CRIT: 3 }
export function mapOrder(clusters: ExploitCluster[]) {
  return clusters
    .slice()
    .sort((a, b) => (a.cls === 'remote abuse' ? 1 : b.cls === 'remote abuse' ? -1 : sevRank[a.severity] - sevRank[b.severity] || a.totalViews - b.totalViews))
}
export function flightTimes(i: number) {
  const launch = T.map + 250 + i * 780
  return { launch, arrive: launch + 950 }
}
