import type { Game } from '@/data/games'
import { createRng } from '@/lib/random'
import type { SimStage } from '@/lib/useSimulation'
import type { LogLevel } from '@/components/ui'

/* DMCA Daemon: notice-and-takedown with two lanes, filed through Roblox Rights Manager.
   Exact (byte / sha256-identical) matches auto-file under the owner's standing attestation;
   perceptual matches always go to a person; licensed Toolbox / Creator Store matches are cleared.
   Steal An Egg is hand-authored from the spec; the other games derive from a seeded RNG. */

export const STAGES: SimStage[] = [
  { id: 'fingerprint', label: 'Fingerprint IP', detail: 'Hash registered assets', duration: 2000 },
  { id: 'crawl', label: 'Crawl candidates', detail: 'Search and similar games', duration: 3000 },
  { id: 'match', label: 'Match', detail: 'Two-lane sorter', duration: 5000 },
  { id: 'evidence', label: 'Capture evidence', detail: 'Screenshot and asset record', duration: 2500 },
  { id: 'review', label: 'Review queue', detail: 'Lookalikes go to a person', duration: 2500 },
  { id: 'file', label: 'File request', detail: '512(c)(3) notice', duration: 3000 },
  { id: 'track', label: 'Track', detail: 'Rights Manager status', duration: 2000 },
]

/** Absolute stage starts in script ms, mirrored from STAGES for log timing. */
export const AT = { fingerprint: 0, crawl: 2000, match: 5000, evidence: 10000, review: 12500, file: 15000, track: 18000, end: 20000 } as const

export const LINK_CAP = 250
export const TOTALS = { crawled: 214, auto: 37, review: 19, cleared: 11, none: 147 } as const
export const SOURCES = { search: 128, similar: 61, recommended: 25 } as const
/** Wall-clock start of the scripted run, so log stamps line up with the bus event at 08:05. */
export const RUN_BASE = new Date('2026-10-26T08:04:40-06:00')

export const ATTESTATION = {
  signer: 'Daniel R. Kessler',
  short: 'Dan K.',
  title: 'Head of Legal, Do Big Studios',
  signedAt: '2026-08-02',
  scope: 'Exact hash matches only: sha256 byte-identical copies of registered assets.',
}

export const ASSET_DELIVERY = 'GET /asset-delivery-api/v1/assetId/{assetId}'
export const RM_PATH = ['Intellectual Property', 'Removal Requests', 'New Removal Request']

export const CHECKLIST_512C3 = [
  { roman: '(i)', label: 'Physical or electronic signature of the owner or authorized agent' },
  { roman: '(ii)', label: 'Identification of the copyrighted work claimed to be infringed' },
  { roman: '(iii)', label: 'Infringing material and information to locate it' },
  { roman: '(iv)', label: 'Contact information for the complaining party' },
  { roman: '(v)', label: 'Good-faith statement that the use is not authorized' },
  { roman: '(vi)', label: 'Accuracy statement, under penalty of perjury' },
]

export type AssetKind = 'image' | 'mesh' | 'audio'
export type Lane = 'auto-file' | 'review' | 'cleared' | 'none'

export interface RegisteredAsset {
  assetId: number
  kind: AssetKind
  name: string
  sha256: string
  phash?: string
  ipFamily: string
}

export interface Candidate {
  placeId: number
  universeId: number
  name: string
  creator: string
  matchedAssetId?: number
  match: 'exact' | 'perceptual' | 'none'
  similarity?: number
  licensed: boolean
  lane: Lane
  evidenceUrl?: string
  /* Local extras for the UI. */
  id: string
  kind?: AssetKind
  source: 'Search' | 'Similar games' | 'Recommended'
  detectedAt: string
  licenseNote?: string
  thumbVariant: number
}

export interface RemovalRequest {
  name: string
  links: number
  maxLinks: 250
  submittedAt: string
  status: 'Pending' | 'Approved' | 'Rejected'
  basis: 'standing-attestation' | 'manual-review'
  checklist512c3: boolean[]
  /* Per-link outcomes once Roblox has decided. */
  approved?: number
  rejected?: number
  note?: string
}

export interface CounterNotice {
  id: string
  request: string
  placeId: number
  game: string
  creator: string
  receivedAt: string
  restoreAfter: string
  claim: string
  status: 'Open'
}

export interface IpFamily {
  name: string
  images: number
  meshes: number
  audio: number
  approvedImages: number
  matchesThisWeek: number
  filedThisWeek: number
}

export interface FunnelStep {
  key: 'detected' | 'evidenced' | 'filed' | 'removed'
  label: string
  value: number
}

export interface LogEntry {
  at: number
  level: LogLevel
  text: string
}

export interface ShowcaseItem {
  c: Candidate
  /** Script ms when the card reaches the scan beam. */
  arrive: number
  asset?: RegisteredAsset
}

export interface Dataset {
  prefix: string
  requestA: string
  requestR: string
  lastWeek: RemovalRequest
  assets: RegisteredAsset[]
  auto: Candidate[]
  review: Candidate[]
  cleared: Candidate[]
  none: Candidate[]
  showcase: ShowcaseItem[]
  requests: RemovalRequest[]
  claim: CounterNotice
  families: IpFamily[]
  funnel: { weekly: FunnelStep[]; monthly: FunnelStep[]; weeklyRemoved: number[] }
  reviewers: string[]
  /** Review ids the run decides: two approvals, one dismissal. */
  runDecisions: { id: string; decision: 'approved' | 'dismissed'; reviewer: string }[]
  log: LogEntry[]
}

/* Showcase timing: ten cards cross the beam during the 5s match stage. */
export const SHOW_GAP = 400
export const SHOW_LEAD = 600
export const HOLD_MS = 150
export const DROP_MS = 440
export const FADE_MS = 160

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1)
}

/* Same derivation as the confounder bus, so request names match its events. */
function upper(s: string) {
  return s.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8)
}

const SFX_WORD: Record<string, string> = {
  egg: 'Cluck',
  brainrot: 'Bonk',
  fish: 'Splash',
  duel: 'Gunshot',
  pet: 'Purr',
  seed: 'Sprout',
  ball: 'Parry',
  tower: 'Upgrade',
  goal: 'Whistle',
  car: 'Engine',
  knife: 'Slash',
}

const CREATORS = [
  'BloxForge Studios',
  'xX_CopyKing_Xx',
  'TurboNoob Games',
  'Pixel Pirates Co',
  'NovaBuild Labs',
  'sk1dworks',
  'Lumen Tycoons',
  'CrateDrop Interactive',
  'MoonPie Devs',
  'quickflip_games',
  'Brickwave',
  'OBBYHUB',
  'Nifty Nugget Games',
  'GoldRushRBX',
]

const REVIEWERS = ['Maya Okafor', 'Theo Lindqvist', 'Priya Raman']

export function shortHash(h: string) {
  return `${h.slice(0, 4)}…${h.slice(-4)}`
}

export function kindLabel(k: AssetKind) {
  return k === 'image' ? 'image' : k === 'mesh' ? 'mesh' : 'audio'
}

export function buildDataset(game: Game): Dataset {
  const rng = createRng('dmca-daemon-' + game.id)
  const hero = game.id === 'steal-an-egg'
  const S = game.shortName
  const N = cap(game.noun)
  const sfx = SFX_WORD[game.noun] ?? N
  const prefix = hero ? 'STEALEGG' : upper(S)
  const requestA = `${prefix}-2026-10-26-A`
  const requestR = `${prefix}-2026-10-26-R`
  const family = S

  /* Registered assets: the family's fingerprints. */
  const assetSpecs: [string, AssetKind][] = [
    [`Golden${N}_Mesh`, 'mesh'],
    [`Golden${N}_Texture`, 'image'],
    [`${sfx}_SFX`, 'audio'],
    [`${N}Icon_512`, 'image'],
    [`${N}Base_Mesh`, 'mesh'],
    ['Rebirth_SFX', 'audio'],
    [`${N}Shop_Texture`, 'image'],
    ['KeyArt_Thumb', 'image'],
    ['DoBig_Logo_Decal', 'image'],
  ]
  const assets: RegisteredAsset[] = assetSpecs.map(([name, kind], i) => {
    const sha = i === 0 && hero ? '9f2c' + rng.hex(56) + 'a71e' : rng.hex(64)
    return {
      assetId: i === 0 && hero ? 14820397755 : rng.int(10_400_000_000, 18_900_000_000),
      kind,
      name,
      sha256: sha,
      phash: kind === 'image' ? rng.hex(16) : undefined,
      ipFamily: name === 'DoBig_Logo_Decal' ? 'Do Big brand marks' : family,
    }
  })
  const assetById = new Map(assets.map((a) => [a.assetId, a]))

  const placeId = () => rng.int(80_000_000_000, 139_000_000_000_000)
  const universeId = () => rng.int(3_000_000_000, 10_900_000_000)
  const source = (): Candidate['source'] => {
    const r = rng.next()
    return r < 128 / 214 ? 'Search' : r < 189 / 214 ? 'Similar games' : 'Recommended'
  }
  const detectedAt = (i: number) => new Date(RUN_BASE.getTime() + 5000 + i * 61_000).toISOString()

  /* Auto-file: exact sha256 matches only. */
  const autoNames = [
    `${S}${S.slice(-1)} [UPD]`,
    `${S} 2`,
    `${S} [FREE ADMIN]`,
    `${S} Remastered`,
    `${S} (OG)`,
    `${S} but OP`,
    `NEW ${S}`,
    `${S} Classic`,
    `${S} [BETA]`,
    `${S} X`,
    `${S} Reborn`,
    `Real ${S}`,
    `${S} Legacy`,
  ]
  const autoSuffix = ['', ' [Uncopylocked]', ' (Copy)']
  const auto: Candidate[] = Array.from({ length: TOTALS.auto }, (_, i) => {
    const asset = i === 0 ? assets[0] : assets[rng.pick([0, 1, 2, 3, 4, 6, 7])]
    const pid = i === 0 && hero ? 98213004417 : placeId()
    return {
      id: `auto-${i}`,
      placeId: pid,
      universeId: universeId(),
      name: autoNames[i % autoNames.length] + autoSuffix[Math.floor(i / autoNames.length)],
      creator: rng.pick(CREATORS),
      matchedAssetId: asset.assetId,
      match: 'exact',
      licensed: false,
      lane: 'auto-file',
      evidenceUrl: `evidence/${prefix}/${pid}.png`,
      kind: asset.kind,
      source: i === 0 ? 'Search' : source(),
      detectedAt: detectedAt(i),
      thumbVariant: i % 8,
    }
  })

  /* Review: perceptual matches. Never eligible for auto-file. */
  const reviewNames = [
    `${N} Robbery Tycoon`,
    `${N} Heist Simulator`,
    `Grab the ${N}`,
    `${N} Thief Obby`,
    `Rob a ${N}`,
    `${N} Snatchers`,
    `${N} Raid Tycoon`,
    `Sneaky ${N} Club`,
    `${N} Bandits`,
    `${N} Grabbers 2`,
    `Steal My ${N}`,
    `${N} Burglars`,
    `${N} Smugglers`,
    `${N} Loot Tycoon`,
    `${N} Takers`,
    `Pet ${N} Heist`,
    `${N} Rush`,
    `${N} Panic`,
    `${N} Vault`,
  ]
  const review: Candidate[] = reviewNames.map((name, i) => {
    const kind: AssetKind = i === 0 ? 'audio' : rng.pick(['image', 'mesh', 'audio'] as const)
    const asset = assets.find((a) => a.kind === kind && (i === 0 ? a.name.endsWith('_SFX') : true)) ?? assets[0]
    const sim = i === 0 ? 0.91 : Math.round(rng.float(0.78, 0.95) * 100) / 100
    return {
      id: `review-${i}`,
      placeId: placeId(),
      universeId: universeId(),
      name,
      creator: rng.pick(CREATORS),
      matchedAssetId: asset.assetId,
      match: 'perceptual',
      similarity: sim,
      licensed: i === 2,
      lane: 'review',
      kind,
      source: source(),
      detectedAt: detectedAt(i + 3),
      licenseNote: i === 2 ? 'Re-upload of a licensed Creator Store model under a new asset id' : undefined,
      thumbVariant: (i + 3) % 8,
    }
  })

  /* Cleared: the match is a licensed Toolbox / Creator Store asset. */
  const clearedNames = [`${sfx} Simulator`, `${N} Clicker`, `${N} Farm Idle`, `${N} Tower Obby`, `My ${N} Shop`, `${N} Collector`, `${N} Factory`, `${N} Merge`, `${N} Hunt`, `${N} Party`, `${N} Racers`]
  const packs = [`Farm ${N} Pack`, `${N} Starter Kit`, `Free ${N} Models`, `${sfx} Sound Pack`]
  const cleared: Candidate[] = clearedNames.map((name, i) => {
    const storeId = rng.int(4_000_000_000, 9_900_000_000)
    return {
      id: `cleared-${i}`,
      placeId: placeId(),
      universeId: universeId(),
      name,
      creator: rng.pick(CREATORS),
      matchedAssetId: storeId,
      match: 'perceptual',
      similarity: Math.round(rng.float(0.8, 0.97) * 100) / 100,
      licensed: true,
      lane: 'cleared',
      kind: i === 0 ? 'audio' : rng.pick(['image', 'mesh', 'audio'] as const),
      source: source(),
      detectedAt: detectedAt(i + 6),
      licenseNote: `Creator Store free model "${packs[i % packs.length]}" (asset ${storeId})`,
      thumbVariant: (i + 5) % 8,
    }
  })

  const noneNames = ['Obby but Every Second', 'Pet Hatch Legends', 'Mega Tycoon 3', 'Speed Run Islands', 'Find the Ducks', 'Backrooms Escape']
  const none: Candidate[] = noneNames.map((name, i) => ({
    id: `none-${i}`,
    placeId: placeId(),
    universeId: universeId(),
    name,
    creator: rng.pick(CREATORS),
    match: 'none',
    licensed: false,
    lane: 'none',
    source: source(),
    detectedAt: detectedAt(i + 9),
    thumbVariant: (i + 2) % 8,
  }))

  /* Ten cards cross the beam: 4 auto-file, 3 review, 1 cleared, 2 no match. */
  const order = [auto[0], none[0], review[0], auto[1], cleared[0], none[1], auto[2], review[1], auto[3], review[2]]
  const showcase: ShowcaseItem[] = order.map((c, i) => ({
    c,
    arrive: AT.match + SHOW_LEAD + i * SHOW_GAP,
    asset: c.matchedAssetId ? assetById.get(c.matchedAssetId) : undefined,
  }))

  const runDecisions = [
    { id: review[0].id, decision: 'approved' as const, reviewer: REVIEWERS[0] },
    { id: review[1].id, decision: 'approved' as const, reviewer: REVIEWERS[1] },
    { id: review[2].id, decision: 'dismissed' as const, reviewer: REVIEWERS[0] },
  ]

  const all6 = [true, true, true, true, true, true]
  const lastWeek: RemovalRequest = {
    name: `${prefix}-2026-10-19-A`,
    links: 35,
    maxLinks: 250,
    submittedAt: '2026-10-19T08:06:00-06:00',
    status: 'Approved',
    basis: 'standing-attestation',
    checklist512c3: all6,
    approved: 31,
    rejected: 4,
    note: '4 links rejected: places already removed or set private before review',
  }
  const requests: RemovalRequest[] = [
    { name: requestA, links: 37, maxLinks: 250, submittedAt: '2026-10-26T08:05:00-06:00', status: 'Pending', basis: 'standing-attestation', checklist512c3: all6 },
    { name: requestR, links: 2, maxLinks: 250, submittedAt: '2026-10-26T08:05:00-06:00', status: 'Pending', basis: 'manual-review', checklist512c3: all6, note: 'Two lookalikes approved by a reviewer and signed per item' },
    lastWeek,
    { name: `${prefix}-2026-10-12-A`, links: 41, maxLinks: 250, submittedAt: '2026-10-12T08:04:00-06:00', status: 'Approved', basis: 'standing-attestation', checklist512c3: all6, approved: 38, rejected: 3 },
    { name: `${prefix}-2026-10-12-R`, links: 3, maxLinks: 250, submittedAt: '2026-10-12T11:30:00-06:00', status: 'Rejected', basis: 'manual-review', checklist512c3: all6, approved: 0, rejected: 3, note: 'Roblox found the similarity insufficient; no re-file' },
    { name: `${prefix}-2026-10-05-A`, links: 250, maxLinks: 250, submittedAt: '2026-10-05T08:05:00-06:00', status: 'Approved', basis: 'standing-attestation', checklist512c3: all6, approved: 234, rejected: 16, note: 'Cap reached: 313 links split into -A and -B' },
    { name: `${prefix}-2026-10-05-B`, links: 63, maxLinks: 250, submittedAt: '2026-10-05T08:05:00-06:00', status: 'Approved', basis: 'standing-attestation', checklist512c3: all6, approved: 57, rejected: 6, note: 'Overflow from -A past the 250-link cap' },
  ]

  const claim: CounterNotice = {
    id: 'CN-20261021-0447',
    request: `${prefix}-2026-10-12-A`,
    placeId: placeId(),
    game: `${N} Tycoon Classic`,
    creator: 'BloxForge Studios',
    receivedAt: '2026-10-21T13:12:00-06:00',
    restoreAfter: '2026-11-04',
    claim: `Creator states the ${game.noun} mesh was modelled independently and attaches a Blender file dated 2026-06-30.`,
    status: 'Open',
  }

  const families: IpFamily[] = [
    { name: family, images: 4, meshes: 2, audio: 2, approvedImages: 12, matchesThisWeek: 54, filedThisWeek: 39 },
    { name: `${S}: ${N} skins`, images: 9, meshes: 3, audio: 0, approvedImages: 7, matchesThisWeek: 6, filedThisWeek: 0 },
    { name: 'Do Big brand marks', images: 5, meshes: 0, audio: 1, approvedImages: 15, matchesThisWeek: 2, filedThisWeek: 0 },
  ]

  const funnel = {
    weekly: [
      { key: 'detected', label: 'Detected', value: 48 },
      { key: 'evidenced', label: 'Evidenced', value: 37 },
      { key: 'filed', label: 'Filed', value: 35 },
      { key: 'removed', label: 'Removed', value: 31 },
    ] satisfies FunnelStep[],
    monthly: [
      { key: 'detected', label: 'Detected', value: 512 },
      { key: 'evidenced', label: 'Evidenced', value: 431 },
      { key: 'filed', label: 'Filed', value: 428 },
      { key: 'removed', label: 'Removed', value: 360 },
    ] satisfies FunnelStep[],
    weeklyRemoved: [12, 18, 15, 22, 27, 19, 33, 41, 291, 38, 31],
  }

  /* The daemon log, revealed on the timeline. */
  const a0 = assets[0]
  const a1 = assets[1]
  const a2 = assets[2]
  const q = encodeURIComponent(S.toLowerCase())
  const log: LogEntry[] = [
    { at: 60, level: 'cmd', text: `dmca-daemon run --universe ${game.universeId} --family "${family}"` },
    { at: 260, level: 'info', text: `GET /asset-delivery-api/v1/assetId/${a0.assetId} 200 (legacy-asset:manage)` },
    { at: 520, level: 'ok', text: `sha256 ${a0.name} ${shortHash(a0.sha256)}` },
    { at: 820, level: 'info', text: `GET /asset-delivery-api/v1/assetId/${a1.assetId} 200` },
    { at: 1040, level: 'ok', text: `sha256 ${a1.name} ${shortHash(a1.sha256)}, phash ${a1.phash?.slice(0, 8)}` },
    { at: 1320, level: 'info', text: `GET /asset-delivery-api/v1/assetId/${a2.assetId} 200` },
    { at: 1520, level: 'ok', text: `sha256 ${a2.name} ${shortHash(a2.sha256)}, audio fingerprint stored` },
    { at: 1820, level: 'dim', text: `Rights Manager: "${family}" has 12 approved images, Roblox-side matching active` },
    { at: 2100, level: 'info', text: `GET apis.roblox.com/search-api/omni-search?searchQuery=${q} 200` },
    { at: 2700, level: 'info', text: `GET games.roblox.com/v1/games/recommendations/game/${game.universeId} 200` },
    { at: 3300, level: 'dim', text: 'candidates 128 search, 61 similar games' },
    { at: 4100, level: 'info', text: 'GET games.roblox.com/v1/games?universeIds=… (batch 3 of 3) 200' },
    { at: 4800, level: 'ok', text: `${TOTALS.crawled} candidates queued (128 search, 61 similar, 25 recommended)` },
    { at: 5080, level: 'cmd', text: `match ${TOTALS.crawled} experiences against ${assets.length} fingerprints` },
    ...showcase.map((s): LogEntry => {
      const c = s.c
      if (c.lane === 'auto-file') return { at: s.arrive + 60, level: 'ok', text: `exact sha256 ${shortHash(s.asset?.sha256 ?? '')} place ${c.placeId}, lane auto-file` }
      if (c.lane === 'review') return { at: s.arrive + 60, level: 'warn', text: `perceptual ${c.kind} ${c.similarity?.toFixed(2)} place ${c.placeId}, lane review (never auto-filed)` }
      if (c.lane === 'cleared') return { at: s.arrive + 60, level: 'dim', text: `Creator Store licensed match place ${c.placeId}, cleared` }
      return { at: s.arrive + 60, level: 'dim', text: `place ${c.placeId}: no fingerprint within threshold` }
    }),
    { at: 9840, level: 'ok', text: `match done: ${TOTALS.auto} auto-file, ${TOTALS.review} review, ${TOTALS.cleared} cleared, ${TOTALS.none} no match` },
    { at: 10120, level: 'info', text: `capture www.roblox.com/games/${auto[0].placeId} screenshot 1280x720` },
    { at: 10500, level: 'info', text: `GET /asset-delivery-api/v1/assetId/${a0.assetId} 200, evidence for place ${auto[0].placeId}` },
    { at: 11400, level: 'dim', text: 'evidence 24 of 37 stamped' },
    { at: 12300, level: 'ok', text: `${TOTALS.auto} evidence bundles stored (screenshot + asset-delivery record)` },
    { at: 12700, level: 'info', text: `review queue: ${TOTALS.review} perceptual matches assigned` },
    { at: 13300, level: 'ok', text: `${review[0].name}: approved by ${REVIEWERS[0]} for manual filing` },
    { at: 13900, level: 'ok', text: `${review[1].name}: approved by ${REVIEWERS[1]} for manual filing` },
    { at: 14500, level: 'warn', text: `${review[2].name}: dismissed, licensed from Creator Store (false positive)` },
    { at: 15080, level: 'cmd', text: 'Rights Manager: Intellectual Property > Removal Requests > New Removal Request' },
    { at: 15500, level: 'dim', text: '512(c)(3) checklist (i) to (vi) attached' },
    { at: 17200, level: 'info', text: `submit ${requestA}: 37 of 250 links, basis standing attestation (${ATTESTATION.short}, ${ATTESTATION.signedAt})` },
    { at: 17600, level: 'ok', text: `${requestA} status Pending; no edits after submit` },
    { at: 17800, level: 'dim', text: `bus: takedown-filed emitted for ${S}` },
    { at: 18200, level: 'info', text: `Rights Manager: poll ${lastWeek.name}` },
    { at: 19100, level: 'ok', text: `${lastWeek.name} Approved: 31 links removed, 4 rejected` },
    { at: 19600, level: 'dim', text: 'bus: takedown-approved emitted; next crawl in 7 days' },
  ]

  return { prefix, requestA, requestR, lastWeek, assets, auto, review, cleared, none, showcase, requests, claim, families, funnel, reviewers: REVIEWERS, runDecisions, log }
}
