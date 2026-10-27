import type { DaemonSlug } from './daemons'

/* The toolkit catalogue: what the hub, the detail page and the demo dashboard all read.
   Each tool is shown by its icon (src/data/daemons.ts) and a real picture from a captured example run
   (public/examples). Credits live on the server, per tool; the numbers here are the starting scale and what a run costs,
   which the server reads too. */

export interface ToolMeta {
  slug: DaemonSlug
  name: string
  /** One line under the tile on the hub. */
  blurb: string
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
    blurb: 'Find the people behind any game.',
    description: [
      'Creator Dox answers one question: how do you reach the people behind this game? It finds the game owner, the leaders of the owning group, every Discord server tied to the game, and every public channel they published: X / Twitter, YouTube, Twitch, TikTok, Instagram, link pages and websites, plus an email only when one is written out in their own text.',
      'Contacts are ordered with the best way to reach someone first. Each one shows exactly where it was found, with the link and a short quote, and is marked as linked by the owner, a verified Discord invite, or an unconfirmed search match.',
    ],
    steps: ['Finds the owner and the leaders of the owning group', 'Reads their public profiles and the channels they listed', 'Collects Discord invites and resolves each one through Discord', 'Searches the web and ranks the best way to reach each person'],
    facts: [
      { label: 'Data used', value: 'Public profile text, Discord invites, web search' },
      { label: 'Never collected', value: 'Address, phone, family, private data' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link to find the owner, the team and their Discord servers.',
    runVerb: 'Find the team',
    startCredits: 5000,
    topUp: 2500,
    resultsTitle: 'Ways to reach the team, best first',
    daemonNote: 'Every rerun reads the owner, the leaders, their profile text and Discord invites again and flags any new leader, invite, social link or changed link.',
    thinking: ['Reading the game and its owner', 'Listing leaders in the owning group', 'Reading public profiles and channels', 'Resolving Discord invites', 'Ranking the best way to reach each person'],
  },
  {
    slug: 'thumbnail-daemon',
    name: 'Thumbnail Daemon',
    blurb: 'Fresh angles on every thumbnail you ship.',
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
    description: [
      'Description Daemon reads your live Roblox description and drafts new versions of it. Roblox has no description A/B test, so the drafts are suggestions you apply yourself.',
      'Every draft is linted for misleading claims, giveaway wording and keyword stuffing before you see it.',
      'It does not measure whether a draft earns more clicks. Roblox shares a game\'s click-through only through an Open Cloud key, and nothing here applies a draft or compares before and after for you; the automate option sets that loop up with our engineers.',
    ],
    steps: ['Reads your current description', 'Drafts new variants', 'Lints each for Roblox policy', 'Ranks the drafts'],
    facts: [
      { label: 'Applied by', value: 'You, on the Roblox game page' },
      { label: 'Click-through', value: 'Not measured here' },
      { label: 'Needs', value: 'An OpenRouter key' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link to rewrite its description.',
    runVerb: 'Draft variants',
    startCredits: 5000,
    topUp: 2500,
    resultsTitle: 'Drafts, best first',
    daemonNote: 'Every rerun drafts a fresh iteration from what changed on the game page since the last run.',
    thinking: ['Reading the live description', 'Drafting three variants', 'Linting for Roblox policy', 'Ranking the drafts'],
  },
  {
    slug: 'dmca-daemon',
    name: 'DMCA Daemon',
    blurb: 'Find and remove copies of your assets.',
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
    description: [
      'Hack Daemon searches YouTube for videos advertising exploits for your game, filters out the bait, and groups what is real by vulnerability class.',
      'Each group is mapped to the game system it abuses, with a plain-language server-side fix for your developers. Briefs name the class of problem, never working code.',
      'It reads a sample, not every video: YouTube search returns the most relevant and newest videos for your game name and its variants, and each run says how many distinct videos it read.',
    ],
    steps: ['Searches YouTube for exploit videos about your game', 'Filters bait and unrelated videos', 'Groups real exploits by class', 'Maps each to a game system with a fix'],
    facts: [
      { label: 'Output', value: 'Class, system and fix' },
      { label: 'Never contains', value: 'Exploit code or links' },
      { label: 'Coverage', value: 'A sample of videos, not all' },
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
  {
    slug: 'content-creator-daemon',
    name: 'Content Creator Daemon',
    blurb: 'Reach the creators who should be playing your game.',
    description: [
      'Content Creator Daemon finds the YouTube creators who already cover games like yours, scores how well each one fits, and writes a personal outreach message for every good match, with their numbers and the video it refers to.',
      'It keeps the pipeline across reruns: who is new, who you have a draft for, who you contacted. Messages are drafted for you to send; sending them automatically is set up with our engineers.',
    ],
    steps: ['Finds creators covering your game and its genre', 'Reads their audience, views and past sponsorships', 'Scores fit and checks brand safety', 'Drafts a personal outreach message for each good match'],
    facts: [
      { label: 'Output', value: 'Ranked creators and drafts' },
      { label: 'Sends', value: 'Nothing on its own' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link of a game you want sponsored coverage for.',
    runVerb: 'Find creators',
    startCredits: 5000,
    topUp: 2500,
    resultsTitle: 'Creators to sponsor',
    daemonNote: 'Every rerun looks for new creators and drafts a message for each new good fit.',
    thinking: ['Searching YouTube for coverage', 'Reading channels and recent uploads', 'Checking paid-promotion history', 'Scoring fit and brand safety', 'Drafting outreach messages'],
  },
  {
    slug: 'rank-daemon',
    name: 'Rank Daemon',
    blurb: 'See where you rank for what players search.',
    description: [
      'Rank Daemon searches Roblox the way players do and finds where your game appears for the words that should lead to it: its name, its genre words and any terms you add.',
      'Every rerun compares with the last one and flags climbs, drops and the games that passed you, so a ranking slide is caught the day it starts, not weeks later in the player count.',
    ],
    steps: ['Builds the search words from your game and the ones you add', 'Searches Roblox for each and finds your position', 'Compares with the last run', 'Flags climbs, drops and who passed you'],
    facts: [
      { label: 'Output', value: 'Position per keyword' },
      { label: 'Source', value: 'Roblox search' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link of a game you operate.',
    runVerb: 'Check rankings',
    startCredits: 5000,
    topUp: 2500,
    resultsTitle: 'Keywords by rank change',
    daemonNote: 'Every rerun searches Roblox again and flags every keyword where your position moved.',
    thinking: ['Building the keyword list', 'Searching Roblox for each keyword', 'Finding your position', 'Comparing with the last run'],
  },
  {
    slug: 'pulse-daemon',
    name: 'Pulse Daemon',
    blurb: 'Catch a sick game before the reviews do.',
    description: [
      'Pulse Daemon reads your game\'s vital signs the way Roblox shows them to players: players now, likes against dislikes, how full and how fast the public servers are, and how long since the last update.',
      'Every rerun compares with the last one and flags what regressed, such as a sudden player drop, a falling like ratio after an update, or servers with low frame rates and high ping.',
    ],
    steps: ['Reads players, votes and the last update', 'Samples the public servers for frame rate and ping', 'Compares with the last run', 'Flags regressions with the numbers'],
    facts: [
      { label: 'Output', value: 'Vitals and regressions' },
      { label: 'Source', value: 'Roblox public data' },
    ],
    inputLabel: 'Roblox game link',
    inputHint: 'Paste a roblox.com/games link of a game you operate.',
    runVerb: 'Check vitals',
    startCredits: 5000,
    topUp: 2500,
    resultsTitle: 'Vitals',
    daemonNote: 'Every rerun reads the vitals again and flags anything that got worse since the last run.',
    thinking: ['Reading players and votes', 'Sampling public servers', 'Comparing with the last run', 'Flagging regressions'],
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
  if (slug === 'rank-daemon' || slug === 'pulse-daemon') return 500
  return 1000
}

/* "Set it up for me": every tool can be automated by our forward deployed engineers. The option opens the contact-us
   panel with this request already written. `{game}` is replaced with the game's name. Nothing here claims the tool
   does it by itself. */
export interface Automation {
  /** The button. */
  label: string
  /** One sentence: what our engineers set up. */
  pitch: string
  /** The request the panel starts with. */
  template: string
}

export const automation: Record<DaemonSlug, Automation> = {
  'creator-dox': {
    label: 'Reach the team for me',
    pitch: 'Our engineers contact the owner and leaders for you, from your accounts, and keep every reply in one thread.',
    template: 'Please set up automatic outreach for {game}: when Creator Dox finds a new owner, leader or Discord server, contact them with our first message and track the replies.',
  },
  'thumbnail-daemon': {
    label: 'Auto-upload and optimize',
    pitch: 'We upload the winning variants to your game page, run the split test and keep the best one live, with a rollback.',
    template: 'Please set up automatic thumbnail upload and optimization for {game}: upload the variants, run the experiment and keep the winner live.',
  },
  'discord-daemon': {
    label: 'Alert my team on sentiment shifts',
    pitch: 'We post sentiment drops to your Slack or Discord and open a task for each topic, with the quotes.',
    template: 'Please set up sentiment alerts for {game}: post sentiment shifts from our Discord to our team channel and open a task per topic.',
  },
  'description-daemon': {
    label: 'Auto-publish winning descriptions',
    pitch: 'We publish the best draft through Open Cloud, watch click-through and roll back if it drops.',
    template: 'Please set up automatic description publishing for {game}: publish the best draft, watch click-through and roll back if it drops.',
  },
  'dmca-daemon': {
    label: 'Send DMCA takedowns for me',
    pitch: 'We file the takedowns for confirmed copies in Rights Manager on your behalf, using your signed attestation, and track every request to the end.',
    template: 'Please set up automatic DMCA takedowns for {game}: file the takedowns for confirmed copies in Rights Manager on our behalf and track each request.',
  },
  'hack-daemon': {
    label: 'Send exploit briefs to my team',
    pitch: 'We open a ticket per exploit class in your tracker, with the server-side fix, and follow it until it is patched.',
    template: 'Please set up exploit tickets for {game}: open one ticket per exploit class in our tracker with the fix and follow it until it is patched.',
  },
  'content-creator-daemon': {
    label: 'Send the outreach for me',
    pitch: 'We send each approved message from your address, follow up, and keep every reply and rate in one place.',
    template: 'Please set up automatic creator outreach for {game}: send the approved sponsorship messages from our address, follow up and track replies and rates.',
  },
  'rank-daemon': {
    label: 'Auto-optimize my ranking',
    pitch: 'We test titles, thumbnails and keywords against your search position and keep what moves you up.',
    template: 'Please set up ranking optimization for {game}: test titles, thumbnails and keywords against our search position and keep what works.',
  },
  'pulse-daemon': {
    label: 'Page my team on regressions',
    pitch: 'We alert your on-call developer with the likely cause and open a rollback ticket when the vitals drop.',
    template: 'Please set up regression alerts for {game}: page our on-call developer with the likely cause and open a rollback ticket when the vitals drop.',
  },
}

/** Real games to try a tool on without owning one. They fill the input; nothing runs until the visitor presses the button. */
export const TRY_GAMES: { name: string; link: string }[] = [
  { name: 'Steal An Egg', link: 'https://www.roblox.com/games/107778070777162/Steal-An-Egg' },
  { name: 'Escape Tsunami For Brainrots', link: 'https://www.roblox.com/games/131623223084840/Escape-Tsunami-For-Brainrots' },
  { name: 'Murder Mystery 2', link: 'https://www.roblox.com/games/142823291/Murder-Mystery-2' },
]
