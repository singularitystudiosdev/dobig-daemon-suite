import type { DaemonSlug } from './daemons'

/* The toolkit catalogue: what the hub, the detail page and the demo dashboard all read.
   Art is 16:9 (960x540 WebP in /public/tools). Credits are per tool and per run. */

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
  thinking: string[]
}

export const tools: ToolMeta[] = [
  {
    slug: 'creator-dox',
    name: 'Creator Dox',
    blurb: 'Vet any creator before you pay them.',
    art: '/tools/creator-dox.webp',
    description: [
      'Creator Dox builds a partnership dossier on the creators already covering your game, from public channel data only: reach, audience quality, past sponsorships and a public business contact.',
      'Its headline answer is simple: does this creator\'s audience still engage when the video is sponsored? Creators are ranked so the best partnership fit comes first.',
    ],
    steps: ['Finds creators already featuring your game', 'Detects paid placements across their last 48 uploads', 'Scores audience credibility and engagement on sponsored videos', 'Ranks creators by partnership fit'],
    facts: [
      { label: 'Data used', value: 'Public channel analytics' },
      { label: 'Never collected', value: 'Address, phone, family, private data' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link to find the creators covering it.',
    runVerb: 'Find creators',
    startCredits: 30,
    topUp: 30,
    resultsTitle: 'Creators ranked by partnership fit',
    thinking: ['Searching public videos about the game', 'Reading channel statistics', 'Detecting paid placements', 'Scoring audience credibility', 'Ranking partnership fit'],
  },
  {
    slug: 'thumbnail-daemon',
    name: 'Thumbnail Daemon',
    blurb: 'Fresh angles on every thumbnail you ship.',
    art: '/tools/thumbnail-daemon.webp',
    description: [
      'Thumbnail Daemon reads every thumbnail on your game page and asks Nano Banana 2.1 for three new takes on each one, each from a different perspective.',
      'Drop the variants into Roblox thumbnail personalization and let the bandit find the winner for each player segment.',
    ],
    steps: ['Fetches every gallery thumbnail on your game', 'Generates 3 variants of each with Nano Banana 2.1', 'Shows originals beside their variants', 'Costs 1 credit per variant'],
    facts: [
      { label: 'Model', value: 'Nano Banana 2.1' },
      { label: 'Per thumbnail', value: '3 variants, 16:9' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link. Every thumbnail on the page is used.',
    runVerb: 'Generate',
    startCredits: 60,
    topUp: 60,
    resultsTitle: 'Variants',
    thinking: [],
  },
  {
    slug: 'discord-daemon',
    name: 'Discord Daemon',
    blurb: 'What your community actually thinks.',
    art: '/tools/discord-daemon.webp',
    description: [
      'Discord Daemon connects to a game community server and summarises sentiment by counting people, not messages, so one loud poster or a raid cannot swing the result.',
      'Topics are ranked by how urgently they need a decision, with a trend for each and the likely cause of any mood drop.',
    ],
    steps: ['Reads server history within Discord rate limits', 'Counts each person once and sets staff and raids aside', 'Clusters conversation into topics', 'Ranks topics by urgency with a trend'],
    facts: [
      { label: 'Counts', value: 'People, not messages' },
      { label: 'Needs', value: 'Message Content intent approved' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link to read its community.',
    runVerb: 'Summarise',
    startCredits: 30,
    topUp: 30,
    resultsTitle: 'Community topics by urgency',
    thinking: ['Connecting to the community server', 'Backfilling seven days of history', 'Counting people and excluding raids', 'Clustering topics', 'Ranking by urgency'],
  },
  {
    slug: 'description-daemon',
    name: 'Description Daemon',
    blurb: 'Descriptions that earn more Home clicks.',
    art: '/tools/description-daemon.webp',
    description: [
      'Description Daemon rewrites your game description and tests each version honestly. Roblox has no native description A/B test, so it runs a sequential before-and-after with guardrails.',
      'Every draft is linted for misleading claims, giveaway wording and keyword stuffing before it goes anywhere near your page.',
    ],
    steps: ['Reads your current description', 'Drafts three variants', 'Lints each for Roblox policy', 'Ranks drafts by predicted play-through lift'],
    facts: [
      { label: 'Test', value: 'Sequential, 7 days' },
      { label: 'Metric', value: 'Play-through rate' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link to rewrite its description.',
    runVerb: 'Draft variants',
    startCredits: 30,
    topUp: 30,
    resultsTitle: 'Drafts ranked by predicted lift',
    thinking: ['Reading the live description', 'Drafting three variants', 'Linting for Roblox policy', 'Estimating play-through lift'],
  },
  {
    slug: 'dmca-daemon',
    name: 'DMCA Daemon',
    blurb: 'Find and remove copies of your assets.',
    art: '/tools/dmca-daemon.webp',
    description: [
      'DMCA Daemon fingerprints your game\'s assets and sweeps for experiences reusing them. Byte-identical copies are filed under a standing good-faith statement you sign once.',
      'Lookalikes always go to a person first, and licensed Creator Store assets are cleared, because a wrong takedown carries legal liability.',
    ],
    steps: ['Fingerprints your registered assets', 'Crawls candidate experiences', 'Sorts matches into auto-file, review and cleared', 'Files through Roblox Rights Manager'],
    facts: [
      { label: 'Auto-files', value: 'Exact hash matches only' },
      { label: 'Always reviewed', value: 'Perceptual matches' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link of a game you own.',
    runVerb: 'Scan for copies',
    startCredits: 30,
    topUp: 30,
    resultsTitle: 'Matches by severity',
    thinking: ['Fingerprinting registered assets', 'Crawling candidate experiences', 'Comparing hashes', 'Capturing evidence', 'Sorting into lanes'],
  },
  {
    slug: 'hack-daemon',
    name: 'Hack Daemon',
    blurb: 'Catch exploits before your players do.',
    art: '/tools/hack-daemon.webp',
    description: [
      'Hack Daemon watches YouTube and other public sources advertising exploits for your game, filters out the bait, and groups what is real into clusters.',
      'Each cluster is mapped to the game system it abuses, with a plain-language server-side fix for your developers. Briefs name the class of problem, never working code.',
    ],
    steps: ['Searches public video sources for your game', 'Filters key-system bait, malware and fakes', 'Clusters real exploits by class', 'Maps each to a game system with a fix'],
    facts: [
      { label: 'Output', value: 'Class, system and fix' },
      { label: 'Never contains', value: 'Exploit code or links' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link of a game you operate.',
    runVerb: 'Scan for exploits',
    startCredits: 30,
    topUp: 30,
    resultsTitle: 'Exploits by severity',
    thinking: ['Composing the watchlist query', 'Crawling public videos', 'Filtering bait and malware', 'Clustering real exploits', 'Mapping to game systems', 'Writing developer briefs'],
  },
]

export const toolsBySlug: Record<DaemonSlug, ToolMeta> = Object.fromEntries(tools.map((t) => [t.slug, t])) as Record<DaemonSlug, ToolMeta>

/** Credits one run costs. Thumbnails scale with the gallery; every other tool is flat. */
export function runCost(slug: DaemonSlug, galleryCount = 0, perThumb = 3): number {
  if (slug === 'thumbnail-daemon') return Math.max(1, galleryCount) * perThumb
  if (slug === 'hack-daemon' || slug === 'dmca-daemon') return 3
  return 2
}
