/* Content Creator Daemon: which YouTube creators should sponsor this Roblox game, and what to send them. From PUBLIC data only.
   1. Resolve the game and ask the LLM for a few words that describe games like it (genre, mechanics).
   2. Search YouTube for creators who cover the game and games like it (exploit and script channels excluded).
   3. Read each shortlisted channel: subscribers, recent uploads, median views, how often it covers the game, paid-promotion
      labels and disclosure words on recent videos, and a brand-safety read of the real titles.
   4. Score partnership fit (server/tools/content-creator-score.ts) and write a draft message for each good match
      (server/tools/content-creator-draft.ts): a subject and a body that refers to one real recent video, with bracketed
      placeholders for every term the owner has not given us.
   5. Keep a pipeline across reruns: New, Drafted, Ready (a public business email was found), Contacted, Replied.
   This tool sends nothing. A number that cannot be read is null and the view says so. */
import type { ContentCreatorDetail, ContentCreatorMark, ContentCreatorSafetyCategory, ContentCreatorStatus, ContentCreatorTier, ContentCreatorVideoRef } from '../../src/lib/details/content-creator.ts'
import type { Finding } from '../../src/lib/runTypes.ts'
import { resolveGame } from '../roblox.ts'
import { ytSearch, type YtVideo } from '../youtube.ts'
import { writeDraft } from './content-creator-draft.ts'
import { findPublicContact } from './content-creator-contacts.ts'
import { pipelineRoutes, readMarks } from './content-creator-pipeline.ts'
import {
  cleanGameName,
  compact,
  detectSponsored,
  gameMatcher,
  genreMatcher,
  groupedInt,
  isExploitChannel,
  isExploitTitle,
  median,
  pctChange,
  plain,
  scoreFit,
} from './content-creator-score.ts'
import { fetchAbout, fetchChannel, watchVideo, type ChannelPage, type WatchRead } from './content-creator-youtube.ts'
import { RunError, type RunContext, type ToolModule } from './types.ts'

const NOT_COLLECTED = 'Not collected: private details. Contacts only if the creator published them.'
const MAX_CHANNELS = 10
const UPLOADS_READ = 24
const STATS_WINDOW = 12
const WATCH_SAMPLES = 5
const SEEN_KEY = 'seen'
/** A rerun flags a creator whose typical views moved by this share, or whose subscribers moved by the second one. */
const CHANGED_VIEWS = 0.35
const CHANGED_SUBS = 0.1

const CATEGORIES: ContentCreatorSafetyCategory[] = [
  'gambling-style promotions',
  'Robux/free-item giveaways',
  'exploit or cheat promotion',
  'profanity-heavy',
  'adult themes',
  'misleading thumbnails/clickbait',
]

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new RunError('aborted', 'The run was cancelled.'))
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new RunError('aborted', 'The run was cancelled.'))
      },
      { once: true },
    )
  })
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
/** Key, credit and cancel errors end the run; anything else is one soft failure. */
const fatal = (e: unknown): e is RunError => e instanceof RunError && ['no-llm-key', 'credits', 'aborted'].includes(e.code)
const noLinks = (s: string): string => s.replace(/https?:\/\/\S+|\bwww\.\S+/gi, '').replace(/\s+/g, ' ').trim()

interface Candidate {
  id: string
  name: string
  /** Videos about the game the searches found, by id. */
  gameVideos: Map<string, YtVideo>
  genreVideos: number
  /** Every title seen for this channel, for the exploit filter. */
  titles: string[]
}

interface Sample {
  upload: ChannelPage['uploads'][number]
  watch: WatchRead
  sponsored: boolean
  disclosure: string
}

interface Seen {
  name: string
  first: string
  subs: number | null
  median: number | null
  score: number
}

/* --------------------------------------------------------------------- LLM */

const TERMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['phrases', 'keywords'],
  properties: { phrases: { type: 'array', items: { type: 'string' } }, keywords: { type: 'array', items: { type: 'string' } } },
}

/** A few words that describe games like this one, so creators of similar games can be found. Checked, never trusted. */
async function similarTerms(ctx: RunContext, game: string, genre: string, description: string): Promise<{ phrases: string[]; keywords: string[] }> {
  const res = await ctx.llm.json<{ phrases: string[]; keywords: string[] }>(
    {
      name: 'content_creator_similar_terms',
      system: [
        'A Roblox game owner wants YouTube creators who cover games like theirs. From the game name, genre and description, write:',
        '- phrases: 2 or 3 YouTube search phrases of 2 to 4 words that players use for this kind of game (its type and mechanics, for example "egg hatching simulator"). Do not include the word roblox or the game name.',
        '- keywords: 4 to 6 single lowercase words that titles of videos about this kind of game contain (mechanics, items). Not generic words like game, roblox, new, best.',
        'Use only what the text supports.',
      ].join('\n'),
      user: [`Game: ${game}`, `Genre: ${genre || 'not stated'}`, `Description: ${noLinks(description).slice(0, 400)}`].join('\n'),
      schema: TERMS_SCHEMA,
      maxTokens: 1000,
      temperature: 0.2,
    },
    ctx.signal,
  )
  const gameWords = new Set(game.toLowerCase().split(/\W+/).filter(Boolean))
  const phrases = (res.data.phrases ?? [])
    .map((p) => plain(String(p)).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\broblox\b/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((p) => {
      const w = p.split(' ')
      return w.length >= 2 && w.length <= 4 && !w.every((x) => gameWords.has(x))
    })
  const keywords = (res.data.keywords ?? []).map((k) => plain(String(k)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')).filter((k) => k.length >= 4 && k !== 'roblox')
  return { phrases: [...new Set(phrases)].slice(0, 3), keywords: [...new Set(keywords)].slice(0, 6) }
}

const SAFETY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['flags'],
  properties: {
    flags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'titleIndex', 'confidence'],
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          titleIndex: { type: 'integer' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
  },
}

async function brandSafety(ctx: RunContext, c: ChannelPage, titles: { title: string; url: string }[], snippets: string[]): Promise<ContentCreatorDetail['safety']['flags']> {
  const user = [
    `Channel: ${c.name}`,
    'Recent video titles (index: title):',
    ...titles.map((t, i) => `${i}: ${t.title}`),
    snippets.length ? 'Description snippets of some of these videos (links removed):' : '',
    ...snippets,
  ]
    .filter(Boolean)
    .join('\n')
  const res = await ctx.llm.json<{ flags: { category: string; titleIndex: number; confidence: string }[] }>(
    {
      name: 'content_creator_brand_safety',
      system: [
        'You review a YouTube channel for a Roblox game studio that is deciding whether to sponsor it.',
        'Flag a category only when a title or description snippet itself clearly shows it. Categories:',
        '- gambling-style promotions: casino, betting, gambling sites, loot-box or gamble-for-prizes promotion',
        '- Robux/free-item giveaways: giveaways of Robux, free items or accounts, "free Robux" claims',
        '- exploit or cheat promotion: promoting scripts, hacks, executors, cheats, dupes sold or shared as exploits',
        '- profanity-heavy: strong profanity in the text',
        '- adult themes: sexual or mature content',
        '- misleading thumbnails/clickbait: titles that promise something the video cannot deliver, fake claims',
        'Ordinary Roblox gameplay titles, in-game "free" items, loud titles and normal hype are NOT flags. Be conservative.',
        'Use high confidence only for unmistakable cases, medium when likely, low when arguable. Return an empty list when the titles are clean.',
        'titleIndex is the index of the single title that is your evidence. At most 6 flags.',
      ].join('\n'),
      user,
      schema: SAFETY_SCHEMA,
      maxTokens: 1200,
    },
    ctx.signal,
  )
  const out: ContentCreatorDetail['safety']['flags'] = []
  const seen = new Set<string>()
  for (const f of res.data.flags ?? []) {
    const t = titles[f.titleIndex]
    if (!t || !CATEGORIES.includes(f.category as ContentCreatorSafetyCategory)) continue
    if (!['low', 'medium', 'high'].includes(f.confidence)) continue
    const key = `${f.category}|${f.titleIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ category: f.category as ContentCreatorSafetyCategory, evidenceTitle: t.title, url: t.url, confidence: f.confidence as 'low' | 'medium' | 'high' })
  }
  return out.slice(0, 6)
}

/* --------------------------------------------------------------- the run */

const TIER_TONE: Record<ContentCreatorTier, 'live' | 'accent' | 'muted' | 'danger'> = { 'Strong fit': 'live', 'Good fit': 'accent', 'Weak fit': 'muted', Risky: 'danger' }
const TIER_GROUP: Record<ContentCreatorTier, string> = { 'Strong fit': 'strong', 'Good fit': 'good', 'Weak fit': 'weak', Risky: 'risky' }
const STATUS_TONE: Record<ContentCreatorStatus, 'accent' | 'live' | 'muted'> = { New: 'accent', Drafted: 'muted', Ready: 'live', Contacted: 'live', Replied: 'live', 'Not drafted': 'muted' }

async function analyze(ctx: RunContext): Promise<void> {
  const target = ctx.target
  if (target.kind !== 'roblox-game') throw new RunError('bad-input', 'Content Creator Daemon needs a Roblox game.')
  if (!ctx.llm.available) {
    throw new RunError('no-llm-key', 'Content Creator Daemon needs an OpenRouter key to read titles and write the drafts. Add one in the key dialog.', { kind: 'add-key', label: 'Add a key' })
  }
  const fetchedAt = ctx.now.toISOString()
  const videosRead = new Set<string>()

  /* 1. the game and what it is like */
  ctx.step('game', 'Resolving the game', 'active')
  let game = cleanGameName(target.name)
  let genre = ''
  let description = ''
  try {
    const r = await resolveGame(String(target.placeId))
    game = cleanGameName(r.game.name)
    genre = [r.game.subgenre, r.game.genre].find((g) => g && !/^all$/i.test(g)) ?? ''
    description = r.game.description
    ctx.step('game', 'Resolving the game', 'done', `${r.game.name} (searching as "${game}"${genre ? `, genre ${genre}` : ''})`)
  } catch (e) {
    ctx.step('game', 'Resolving the game', 'warn', `Roblox did not answer (${errMsg(e)}); searching with the saved name "${game}"`)
  }
  const aboutGame = gameMatcher(game)

  ctx.step('terms', 'Describing games like it', 'active')
  let phrases: string[] = []
  let keywords: string[] = []
  try {
    ;({ phrases, keywords } = await similarTerms(ctx, game, genre, description))
    ctx.step('terms', 'Describing games like it', phrases.length ? 'done' : 'warn', phrases.length ? `Searching also for: ${phrases.join(', ')}` : 'No similar-game words came back; only the game itself is searched')
  } catch (e) {
    if (fatal(e)) throw e
    ctx.step('terms', 'Describing games like it', 'warn', `Unavailable (${errMsg(e)}); only the game itself is searched`)
  }
  const aboutGenre = genreMatcher(phrases, keywords)

  /* 2. discovery */
  const queries: { q: string; sort: 'relevance' | 'date' }[] = [
    { q: `${game} roblox gameplay`, sort: 'relevance' },
    { q: `${game} roblox review`, sort: 'relevance' },
    { q: `${game} roblox update`, sort: 'date' },
    { q: `${game} roblox guide tips`, sort: 'relevance' },
    ...phrases.map((p) => ({ q: `${p} roblox`, sort: 'relevance' as const })),
  ]
  ctx.step('discover', 'Searching YouTube for creators', 'active', `${queries.length} searches`)
  const candidates = new Map<string, Candidate>()
  let searchOk = 0
  let resultsRead = 0
  let excludedVideos = 0
  for (const [i, { q, sort }] of queries.entries()) {
    try {
      const results = await ytSearch(q, { sort, limit: 30, signal: ctx.signal })
      searchOk++
      resultsRead += results.length
      for (const v of results) {
        videosRead.add(v.id)
        if (!v.channelId) continue
        const c: Candidate = candidates.get(v.channelId) ?? { id: v.channelId, name: v.channelName ?? v.channelId, gameVideos: new Map(), genreVideos: 0, titles: [] }
        candidates.set(v.channelId, c)
        c.titles.push(v.title)
        if (isExploitTitle(v.title)) {
          excludedVideos++
          continue
        }
        if (aboutGame(v.title) || aboutGame(v.descriptionSnippet)) c.gameVideos.set(v.id, v)
        else if (aboutGenre(v.title)) c.genreVideos++
      }
    } catch (e) {
      if (fatal(e)) throw e
    }
    ctx.step('discover', 'Searching YouTube for creators', 'active', `${i + 1} of ${queries.length} searches, ${resultsRead} videos read`)
    if (i < queries.length - 1) await sleep(700, ctx.signal)
  }
  if (searchOk === 0) {
    ctx.step('discover', 'Searching YouTube for creators', 'failed', 'YouTube did not answer any search')
    throw new RunError('upstream', 'YouTube did not answer. Try again in a few minutes.', { kind: 'retry', label: 'Retry' })
  }
  let exploitChannels = 0
  const gameChannels: Candidate[] = []
  const genreChannels: Candidate[] = []
  const topViews = (c: Candidate): number => Math.max(0, ...[...c.gameVideos.values()].map((v) => v.views ?? 0))
  for (const c of candidates.values()) {
    if (isExploitChannel(c.name, c.titles)) {
      exploitChannels++
      continue
    }
    if (c.gameVideos.size >= 2 || topViews(c) >= 50_000 || (c.gameVideos.size >= 1 && c.genreVideos >= 1)) gameChannels.push(c)
    else if (c.genreVideos >= 2) genreChannels.push(c)
  }
  const strength = (c: Candidate): number => c.gameVideos.size * 3 + c.genreVideos
  const byStrength = (a: Candidate, b: Candidate): number => strength(b) - strength(a) || topViews(b) - topViews(a)
  gameChannels.sort(byStrength)
  genreChannels.sort(byStrength)
  // Mostly creators who already cover the game; a few who cover games like it but not this one yet.
  const picked = [...gameChannels.slice(0, MAX_CHANNELS - Math.min(3, genreChannels.length)), ...genreChannels.slice(0, 3)].slice(0, MAX_CHANNELS)
  for (const c of [...gameChannels.slice(picked.length), ...genreChannels.slice(3)]) if (picked.length < MAX_CHANNELS && !picked.includes(c)) picked.push(c)
  ctx.step(
    'discover',
    'Searching YouTube for creators',
    'done',
    `${resultsRead} videos from ${candidates.size} channels; ${excludedVideos} script or exploit titles and ${exploitChannels} such channels excluded; ${gameChannels.length + genreChannels.length} channels qualify, ${picked.length} read`,
  )

  /* 3. each creator */
  const seen = ctx.memory.get<Record<string, Seen>>(SEEN_KEY) ?? {}
  const marks = readMarks(ctx.daemonId)
  const rows: { detail: ContentCreatorDetail; tierRank: number }[] = []
  let draftsWritten = 0

  for (const [n, cand] of picked.entries()) {
    if (n > 0) await sleep(900, ctx.signal)
    const stepId = `ch:${cand.id}`
    const label = `Reading ${cand.name}`
    ctx.step(stepId, label, 'active', 'Channel page')
    try {
      const page = await fetchChannel(cand.id, ctx.signal)
      if (!page || page.uploads.length === 0) {
        ctx.step(stepId, label, 'warn', 'Could not read this channel page, skipped')
        continue
      }
      if (isExploitChannel(page.name, [])) {
        ctx.step(stepId, label, 'warn', 'Channel name promotes scripts or exploits, excluded')
        continue
      }
      const uploads = page.uploads.slice(0, UPLOADS_READ)
      uploads.forEach((u) => videosRead.add(u.id))

      /* the About page: the full public description, where a business email may be written */
      let aboutText: string | null = null
      try {
        aboutText = (await fetchAbout(cand.id, ctx.signal))?.description ?? null
      } catch (e) {
        if (fatal(e)) throw e
      }

      /* sample recent uploads: exact views, dates, descriptions, paid-promotion label */
      const samples: Sample[] = []
      let watchFailed = 0
      let watchError = ''
      let consecutiveFails = 0
      const toSample = Math.min(WATCH_SAMPLES, uploads.length)
      for (const [k, u] of uploads.slice(0, toSample).entries()) {
        ctx.step(stepId, label, 'active', `Video pages ${k + 1} of ${toSample}`)
        try {
          const w = await watchVideo(u.id, ctx.signal)
          if (w) {
            videosRead.add(u.id)
            const s = detectSponsored(w.title || u.title, w.description, w.paidPromotion)
            samples.push({ upload: u, watch: w, sponsored: s.sponsored, disclosure: s.disclosure })
          } else watchFailed++
          consecutiveFails = w ? 0 : consecutiveFails + 1
        } catch (e) {
          if (fatal(e)) throw e
          watchFailed++
          watchError = errMsg(e)
          consecutiveFails++
        }
        // YouTube throttles video pages after many requests: stop asking for this channel rather than hammering it.
        if (consecutiveFails >= 2) {
          watchFailed += Math.max(0, toSample - k - 1)
          await sleep(4000, ctx.signal)
          break
        }
        await sleep(800, ctx.signal)
      }
      const exact = new Map(samples.filter((s) => s.watch.views !== null).map((s) => [s.upload.id, s.watch.views as number]))
      const viewsFor = (u: ChannelPage['uploads'][number]): number | null => exact.get(u.id) ?? u.views

      /* numbers, all from what was read */
      const windowViews = uploads.slice(0, STATS_WINDOW).map(viewsFor).filter((v): v is number => v !== null)
      const med = median(windowViews)
      const subs = page.subscribers
      const vps = med !== null && subs ? med / subs : null
      const usable = uploads.filter((u) => !isExploitTitle(u.title))
      const gameUploads = usable.filter((u) => aboutGame(u.title))
      const similarUploads = usable.filter((u) => !aboutGame(u.title) && aboutGenre(u.title))
      const cutoff = ctx.now.getTime() - 30 * 864e5
      const gameUploads30d = gameUploads.filter((u) => u.publishedApprox && Date.parse(u.publishedApprox) >= cutoff).length

      /* the real video the message will refer to */
      const refFrom = (u: ChannelPage['uploads'][number], about: ContentCreatorVideoRef['about']): ContentCreatorVideoRef => ({ title: u.title.trim(), url: u.url, views: viewsFor(u), publishedText: u.publishedText, about })
      let video: ContentCreatorVideoRef | null = null
      if (gameUploads[0]) video = refFrom(gameUploads[0], 'game')
      else {
        const found = [...cand.gameVideos.values()].sort((a, b) => (b.publishedApprox ?? '').localeCompare(a.publishedApprox ?? ''))[0]
        if (found) video = { title: found.title.trim(), url: found.url, views: found.views, publishedText: found.publishedText, about: 'game' }
        else if (similarUploads[0]) video = refFrom(similarUploads[0], 'similar')
        else if (usable[0]) video = refFrom(usable[0], 'latest')
      }

      /* sponsorship */
      const sponsoredS = samples.filter((s) => s.sponsored)
      const sViews = sponsoredS.map((s) => s.watch.views).filter((v): v is number => v !== null)

      /* LLM reading of the real titles */
      ctx.step(stepId, label, 'active', 'Reading titles for brand safety')
      const safetyTitles = uploads.map((u) => ({ title: u.title, url: u.url }))
      let flags: ContentCreatorDetail['safety']['flags'] = []
      let unavailable: string | undefined
      try {
        flags = await brandSafety(ctx, page, safetyTitles, samples.map((s) => `- ${s.watch.title}: ${noLinks(s.watch.description).slice(0, 240)}`))
      } catch (e) {
        if (fatal(e)) throw e
        unavailable = errMsg(e)
      }

      const fit = scoreFit({
        game,
        uploadsRead: uploads.length,
        gameUploads: gameUploads.length,
        gameUploads30d,
        similarUploads: similarUploads.length,
        median: med,
        subscribers: subs,
        viewsPerSub: vps,
        sampled: samples.length,
        sponsored: sponsoredS.length,
        sponsoredMedian: median(sViews),
        channelMedian: med,
        flags: unavailable ? null : flags,
        titlesChecked: safetyTitles.length,
      })

      const contact = findPublicContact([
        { where: 'the channel About text', text: aboutText ?? '' },
        { where: 'the channel description', text: page.description },
      ])

      /* the draft, for good matches only */
      let draft: ContentCreatorDetail['draft'] = null
      let draftNote = ''
      if ((fit.tier === 'Strong fit' || fit.tier === 'Good fit') && video) {
        ctx.step(stepId, label, 'active', 'Writing the draft message')
        try {
          const w = await writeDraft(ctx, { game, genre, channelName: page.name, video })
          draft = w.draft
          draftsWritten++
          if (!w.usedModel) draftNote = '; draft uses the fixed wording'
        } catch (e) {
          if (fatal(e)) throw e
          draftNote = `; draft failed (${errMsg(e)})`
        }
      }

      /* the pipeline and what changed since the last run */
      const before = seen[page.id]
      const viewsMove = pctChange(before?.median, med)
      const subsMove = pctChange(before?.subs, subs)
      const moved: string[] = []
      if (before && viewsMove !== null && Math.abs(viewsMove) >= CHANGED_VIEWS * 100) moved.push(`Typical views are ${viewsMove > 0 ? 'up' : 'down'} ${Math.abs(viewsMove)}% since the last run (${compact(before.median)} to ${compact(med)})`)
      if (before && subsMove !== null && Math.abs(subsMove) >= CHANGED_SUBS * 100) moved.push(`Subscribers are ${subsMove > 0 ? 'up' : 'down'} ${Math.abs(subsMove)}% since the last run (${compact(before.subs)} to ${compact(subs)})`)
      const mark = marks[page.id]?.mark as ContentCreatorMark | undefined
      const status: ContentCreatorStatus = mark === 'contacted' ? 'Contacted' : mark === 'replied' ? 'Replied' : mark === 'new' || !before ? 'New' : !draft ? 'Not drafted' : contact.email ? 'Ready' : 'Drafted'

      const detail: ContentCreatorDetail = {
        kind: 'content-creator',
        game,
        fetchedAt,
        channel: { id: page.id, name: page.name, handle: page.handle, url: page.url, aboutUrl: `${page.url}/about`, subscribers: subs },
        stats: { median: med, viewsPerSub: vps, uploadsRead: uploads.length, gameUploads: gameUploads.length, similarUploads: similarUploads.length, gameUploads30d },
        fit: { score: fit.score, tier: fit.tier, components: fit.components },
        sponsorship: { sampled: samples.length, sponsored: sponsoredS.length, examples: sponsoredS.slice(0, 2).map((s) => ({ title: s.watch.title, url: s.upload.url, disclosure: s.disclosure })) },
        safety: { checked: safetyTitles.length, flags, ...(unavailable ? { unavailable } : {}) },
        contact,
        video,
        draft,
        status,
        firstSeen: before?.first ?? fetchedAt,
        changed: moved.length ? `${moved.join('. ')}.` : null,
        notCollected: NOT_COLLECTED,
      }
      rows.push({ detail, tierRank: fit.tier === 'Risky' ? -1 : fit.score })
      seen[page.id] = { name: page.name, first: detail.firstSeen, subs, median: med, score: fit.score }
      ctx.step(
        stepId,
        label,
        watchFailed ? 'warn' : 'done',
        `${subs === null ? 'Subscribers hidden' : `${compact(subs)} subscribers`}, ${uploads.length} uploads, ${samples.length} video pages${watchFailed ? ` (${watchFailed} unavailable${watchError ? `: ${watchError}` : ''}; sponsorship read from fewer videos)` : ''}, fit ${fit.score}${draft ? ', draft written' : ''}${contact.email ? ', public email found' : ''}${draftNote}`,
      )
    } catch (e) {
      if (fatal(e)) throw e
      ctx.step(stepId, label, 'warn', `Skipped: ${errMsg(e)}`)
    }
  }

  /* 4. rank and report */
  rows.sort((a, b) => b.tierRank - a.tierRank || (b.detail.stats.median ?? 0) - (a.detail.stats.median ?? 0))
  const good = rows.filter((r) => r.detail.fit.tier === 'Strong fit' || r.detail.fit.tier === 'Good fit').length
  const emails = rows.filter((r) => r.detail.contact.email).length
  const fresh = rows.filter((r) => r.detail.status === 'New').length
  ctx.summary({
    items: [
      { label: 'Videos read', value: groupedInt(videosRead.size) },
      { label: 'Creators read', value: String(rows.length) },
      { label: 'Strong or good fits', value: String(good), tone: good > 0 ? 'live' : undefined },
      { label: 'Messages drafted', value: String(draftsWritten) },
      { label: 'Public emails found', value: String(emails) },
      { label: 'New creators', value: String(fresh), tone: fresh > 0 ? 'accent' : undefined },
    ],
    sortLabel: 'Best fit first',
    groups: [
      { id: 'strong', label: 'Strong fit' },
      { id: 'good', label: 'Good fit' },
      { id: 'weak', label: 'Weak fit' },
      { id: 'risky', label: 'Risky' },
    ],
    notes: [
      `Public YouTube data read at ${ctx.now.toISOString().slice(0, 16).replace('T', ' ')} UTC. Audience age and location are not public and are not shown.`,
      'A fit number is out of 100: how much the creator covers the game, how much they cover games like it, views for their size, past sponsorships and brand safety.',
      'Messages are drafts. This tool sends nothing, and every term in brackets is for you to fill in.',
    ],
    notices: [{ lead: 'Not collected:', body: 'private details. Contacts only if the creator published them.' }],
  })

  for (const { detail: d } of rows) {
    const sentence =
      d.stats.gameUploads30d > 0
        ? `${d.stats.gameUploads30d} ${d.stats.gameUploads30d === 1 ? 'video' : 'videos'} about ${d.game} in the last 30 days.`
        : d.stats.gameUploads > 0
          ? `${d.stats.gameUploads} of the last ${d.stats.uploadsRead} uploads are about ${d.game}.`
          : d.stats.similarUploads > 0
            ? `Covers games like ${d.game}: ${d.stats.similarUploads} of the last ${d.stats.uploadsRead} uploads.`
            : `Found by searching for ${d.game}.`
    const finding: Finding = {
      id: `content-creator:${d.channel.id}`,
      badge: { label: d.fit.tier, tone: TIER_TONE[d.fit.tier] },
      title: d.channel.name,
      snippet: [{ text: d.changed ? `${d.changed.split('. ')[0].replace(/\.$/, '')}. ${sentence}` : sentence }],
      meta: [
        { label: 'Subscribers', value: compact(d.channel.subscribers) },
        { label: 'Median views', value: d.stats.median === null ? 'n/a' : compact(d.stats.median) },
        { label: 'Fit', value: String(d.fit.score) },
      ],
      status: { label: d.status, tone: STATUS_TONE[d.status] },
      states: { new: { label: 'New', tone: 'accent' }, contacted: { label: 'Contacted', tone: 'live' }, replied: { label: 'Replied', tone: 'live' } },
      group: TIER_GROUP[d.fit.tier],
      url: d.channel.url,
      detail: d,
    }
    ctx.finding(finding)
  }

  ctx.memory.set(SEEN_KEY, seen)
  if (rows.length === 0) {
    ctx.step('result', 'Result', 'done', `No qualifying creators for "${game}": ${candidates.size} channels seen in ${resultsRead} videos, none with 2 or more videos about it, or one with 50,000 views`)
  }
}

export const tool: ToolModule = { analyze, routes: pipelineRoutes }
