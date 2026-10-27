import type { DaemonSlug } from './daemons'

/* The toolkit catalogue: what the hub, the detail page and the demo dashboard all read.
   Art is 16:9 (960x540 WebP in /public/tools). Credits live on the server, per tool; the numbers here are the
   starting scale and what a run costs, which the server reads too. */

export interface ToolMeta {
  slug: DaemonSlug
  name: string
  /** One line under the tile on the hub. */
  blurb: string
  art: string
  /** Detail page body: what it is, in two short paragraphs. */
  description: string[]
  /** Detail page bullets: what a run does. */
  steps: string[]
  /** Small facts shown under the description. */
  facts: { label: string; value: string }[]
  /** Label for the demo input. */
  inputLabel: string
  inputHint: string
  /** The verb on the Generate button. */
  runVerb: string
  /** Credits a new visitor starts with for this tool. */
  startCredits: number
  /** Credits one top-up adds. */
  topUp: number
  /** What the findings list is called for this tool. */
  resultsTitle: string
  /** One muted sentence under the daemon bar: what this tool's daemon does on every rerun. */
  daemonNote: string
  thinking: string[]
}

export const tools: ToolMeta[] = [
  {
    slug: 'creator-dox',
    name: 'Creator Dox',
    blurb: 'Vet any creator before you pay them.',
    art: '/tools/creator-dox.webp',
    description: [
      'Creator Dox searches YouTube for creators already covering your game and builds a partnership dossier from public channel data only: reach, how viewers respond, past sponsorships and a business contact if the creator published one.',
      'Creators are ranked so the best partnership fit comes first, and every figure says where it came from.',
    ],
    steps: ['Finds creators already featuring your game', 'Reads their public channel statistics', 'Spots sponsorship disclosures in recent uploads', 'Ranks creators by partnership fit'],
    facts: [
      { label: 'Data used', value: 'Public channel analytics' },
      { label: 'Never collected', value: 'Address, phone, family, private data' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link to find the creators covering it.',
    runVerb: 'Find creators',
    startCredits: 5000,
    topUp: 2500,
    resultsTitle: 'Creators ranked by partnership fit',
    daemonNote: 'Every rerun re-reads the creators\' channel stats and sponsorship disclosures and flags anyone new.',
    thinking: ['Searching public videos about the game', 'Reading channel statistics', 'Detecting paid placements', 'Scoring audience credibility', 'Ranking partnership fit'],
  },
  {
    slug: 'thumbnail-daemon',
    name: 'Thumbnail Daemon',
    blurb: 'Fresh angles on every thumbnail you ship.',
    art: '/tools/thumbnail-daemon.webp',
    description: [
      'Thumbnail Daemon reads every thumbnail on your game page. When you press the button it asks Nano Banana 2.1 for three new takes on each one, each from a novel perspective.',
      'Its daemon only watches your gallery for new or changed thumbnails. It never generates by itself and never spends credits on its own.',
    ],
    steps: ['Fetches every gallery thumbnail on your game', 'Generates 3 variants of each with Nano Banana 2.1 when you press the button', 'Shows originals beside their variants', 'Costs 250 credits per variant; the gallery watch is free'],
    facts: [
      { label: 'Model', value: 'Nano Banana 2.1' },
      { label: 'Per thumbnail', value: '3 variants, 16:9' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link. Every thumbnail on the page is used.',
    runVerb: 'Generate',
    startCredits: 10000,
    topUp: 5000,
    resultsTitle: 'Variants',
    daemonNote: 'Every rerun checks the gallery for new or changed thumbnails. It spends nothing and generates nothing by itself.',
    thinking: [],
  },
  {
    slug: 'discord-daemon',
    name: 'Discord Daemon',
    blurb: 'What your community actually thinks.',
    art: '/tools/discord-daemon.webp',
    description: [
      'Discord Daemon reads recent messages in a community server your own bot has joined and flags sentiment by counting people, not messages, so one loud poster cannot swing the result.',
      'Topics are ranked by how much negative sentiment they carry, and every quote is a short excerpt from your own server.',
    ],
    steps: ['Reads recent messages within Discord rate limits', 'Counts each person once and sets staff and bots aside', 'Groups conversation into topics', 'Ranks topics by negative sentiment'],
    facts: [
      { label: 'Counts', value: 'People, not messages' },
      { label: 'Needs', value: 'Your bot token and the Message Content intent' },
    ],
    inputLabel: 'Discord invite link',
    inputHint: 'Paste a discord.gg invite to your community server. Your bot must already be in it.',
    runVerb: 'Read community',
    startCredits: 5000,
    topUp: 2500,
    resultsTitle: 'Community topics by sentiment',
    daemonNote: 'Every rerun rereads the recent messages and flags sentiment shifts since the last run.',
    thinking: ['Connecting to the community server', 'Backfilling seven days of history', 'Counting people and excluding raids', 'Clustering topics', 'Ranking by urgency'],
  },
  {
    slug: 'description-daemon',
    name: 'Description Daemon',
    blurb: 'Descriptions that earn more Home clicks.',
    art: '/tools/description-daemon.webp',
    description: [
      'Description Daemon reads your live Roblox description and drafts new versions of it. Roblox has no description A/B test, so the drafts are suggestions you apply yourself.',
      'Every draft is linted for misleading claims, giveaway wording and keyword stuffing before you see it.',
    ],
    steps: ['Reads your current description', 'Drafts new variants', 'Lints each for Roblox policy', 'Ranks the drafts'],
    facts: [
      { label: 'Applied by', value: 'You, on the Roblox game page' },
      { label: 'Needs', value: 'An OpenRouter key' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link to rewrite its description.',
    runVerb: 'Draft variants',
    startCredits: 5000,
    topUp: 2500,
    resultsTitle: 'Drafts, best first',
    daemonNote: 'Every rerun drafts a fresh iteration from what changed on the game page since the last run.',
    thinking: ['Reading the live description', 'Drafting three variants', 'Linting for Roblox policy', 'Estimating play-through lift'],
  },
  {
    slug: 'dmca-daemon',
    name: 'DMCA Daemon',
    blurb: 'Find and remove copies of your assets.',
    art: '/tools/dmca-daemon.webp',
    description: [
      'DMCA Daemon searches Roblox for experiences that look like copies of your game and links each one so you can check it yourself. It prepares the evidence and a draft notice.',
      'Filing is always a human step: Roblox Rights Manager has no public API, and a wrong takedown carries legal liability.',
    ],
    steps: ['Searches Roblox for candidate copies', 'Compares each candidate with your game', 'Prepares evidence and a draft notice', 'Leaves the filing to you, one click away'],
    facts: [
      { label: 'Never does', value: 'File anything for you' },
      { label: 'Every match', value: 'Linked and reviewed by a person' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link of a game you own.',
    runVerb: 'Scan for copies',
    startCredits: 5000,
    topUp: 2500,
    resultsTitle: 'Candidate copies by similarity',
    daemonNote: 'Every rerun searches Roblox again for new copies and flags the ones that were not there last time.',
    thinking: ['Fingerprinting registered assets', 'Crawling candidate experiences', 'Comparing hashes', 'Capturing evidence', 'Sorting into lanes'],
  },
  {
    slug: 'hack-daemon',
    name: 'Hack Daemon',
    blurb: 'Catch exploits before your players do.',
    art: '/tools/hack-daemon.webp',
    description: [
      'Hack Daemon searches YouTube for videos advertising exploits for your game, filters out the bait, and groups what is real by vulnerability class.',
      'Each group is mapped to the game system it abuses, with a plain-language server-side fix for your developers. Briefs name the class of problem, never working code.',
    ],
    steps: ['Searches YouTube for exploit videos about your game', 'Filters bait and unrelated videos', 'Groups real exploits by class', 'Maps each to a game system with a fix'],
    facts: [
      { label: 'Output', value: 'Class, system and fix' },
      { label: 'Never contains', value: 'Exploit code or links' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link of a game you operate.',
    runVerb: 'Scan for exploits',
    startCredits: 5000,
    topUp: 2500,
    resultsTitle: 'Exploits by severity',
    daemonNote: 'Every rerun searches YouTube again and flags new exploit videos since the last run.',
    thinking: ['Composing the watchlist query', 'Crawling public videos', 'Filtering bait and malware', 'Clustering real exploits', 'Mapping to game systems', 'Writing developer briefs'],
  },
]

export const toolsBySlug: Record<DaemonSlug, ToolMeta> = Object.fromEntries(tools.map((t) => [t.slug, t])) as Record<DaemonSlug, ToolMeta>

/** Credits per Nano Banana 2.1 variant. */
export const CREDITS_PER_VARIANT = 250

/** Credits one run costs. Thumbnails scale with the gallery (3 variants each); the other tools are flat per run,
 *  and a daemon's scheduled rerun costs the same as a manual one. */
export function runCost(slug: DaemonSlug, galleryCount = 0, perThumb = 3): number {
  if (slug === 'thumbnail-daemon') return Math.max(1, galleryCount) * perThumb * CREDITS_PER_VARIANT
  if (slug === 'hack-daemon' || slug === 'dmca-daemon') return 1500
  return 1000
}
