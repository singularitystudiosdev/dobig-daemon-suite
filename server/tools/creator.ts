/* Creator Dox: real YouTube creator dossiers for one Roblox game, from PUBLIC channel data only.
   1. Resolve the game, search YouTube for the creators already covering it (exploit promoters excluded).
   2. Read each creator's channel page, sample recent uploads for exact views, descriptions and paid-promotion flags.
   3. Compute reach, cadence, sponsorship and a transparent fit score; ask the LLM only to read real text
      (brand-safety flags, sponsor brand names, talking points) and validate its answers against that text.
   Nothing is modelled: a number that cannot be read is null and the view says so. */
import type {
  BrandSafetyCategory,
  CreatorDetail,
  CreatorTier,
  CreatorVideoRef,
  FlagConfidence,
} from '../../src/lib/details/creator.ts'
import type { Finding } from '../../src/lib/runTypes.ts'
import { resolveGame } from '../roblox.ts'
import { ytSearch, type YtVideo } from '../youtube.ts'
import { fetchChannel, watchVideo, type ChannelPage, type WatchRead } from './creator-youtube.ts'
import {
  cadenceDays,
  cleanGameName,
  compact,
  detectSponsored,
  gameMatcher,
  groupedInt,
  isExploitTitle,
  mean,
  median,
  parseContact,
  plain,
  scoreFit,
  sponsoredDeltaPct,
} from './creator-score.ts'
import { RunError, type RunContext, type ToolModule } from './types.ts'

const NOT_COLLECTED = 'Not collected: home address, phone, family, private data. Contacts only if the creator published them.'
const MAX_CHANNELS = 8
const UPLOADS_READ = 24
const STATS_WINDOW = 12
const WATCH_SAMPLES = 6
const KNOWN_KEY = 'known-channels'

const CATEGORIES: BrandSafetyCategory[] = [
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
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new RunError('aborted', 'The run was cancelled.'))
    }, { once: true })
  })
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
/** Key, credit and cancel errors end the run; anything else is one soft failure. */
const fatal = (e: unknown): e is RunError => e instanceof RunError && ['no-llm-key', 'credits', 'aborted'].includes(e.code)

interface Candidate {
  id: string
  name: string
  /** On-topic, non-exploit videos found by the searches. */
  videos: Map<string, YtVideo>
  titles: number
  exploitTitles: number
}

interface Sample {
  upload: ChannelPage['uploads'][number]
  watch: WatchRead
  sponsored: boolean
  disclosure: string
}

const noLinks = (s: string): string => s.replace(/https?:\/\/\S+|\bwww\.\S+/gi, '').replace(/\s+/g, ' ').trim()

/* --------------------------------------------------------------------- LLM */

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

async function brandSafety(ctx: RunContext, c: ChannelPage, titles: { title: string; url: string }[], snippets: string[]): Promise<CreatorDetail['brandSafety']['flags']> {
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
      name: 'creator_brand_safety',
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
      maxTokens: 1800,
    },
    ctx.signal,
  )
  const out: CreatorDetail['brandSafety']['flags'] = []
  const seen = new Set<string>()
  for (const f of res.data.flags ?? []) {
    const t = titles[f.titleIndex]
    if (!t || !CATEGORIES.includes(f.category as BrandSafetyCategory)) continue
    if (!['low', 'medium', 'high'].includes(f.confidence)) continue
    const key = `${f.category}|${f.titleIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ category: f.category as BrandSafetyCategory, evidenceTitle: t.title, url: t.url, confidence: f.confidence as FlagConfidence })
  }
  return out.slice(0, 6)
}

async function sponsorBrands(ctx: RunContext, samples: Sample[]): Promise<string[]> {
  const docs = samples.map((s, i) => `Video ${i + 1} title: ${s.watch.title}\nDescription: ${noLinks(s.watch.description).slice(0, 700)}`)
  const res = await ctx.llm.json<{ brands: string[] }>(
    {
      name: 'creator_sponsor_brands',
      system: 'You read YouTube video descriptions that carry a sponsorship or paid-promotion disclosure. List the companies, apps, products or games being promoted by the sponsorship. Return names only, exactly as written in the text. Exclude Roblox itself, the creator and their own social accounts, and generic words. Return an empty list when none is named.',
      user: docs.join('\n\n'),
      schema: { type: 'object', additionalProperties: false, required: ['brands'], properties: { brands: { type: 'array', items: { type: 'string' } } } },
      maxTokens: 900,
    },
    ctx.signal,
  )
  const haystack = samples.map((s) => `${s.watch.title}\n${s.watch.description}`).join('\n').toLowerCase()
  const brands: string[] = []
  for (const b of res.data.brands ?? []) {
    const name = plain(String(b)).slice(0, 60)
    // Grounding: a brand must appear in the real text.
    if (name.length >= 2 && haystack.includes(name.toLowerCase()) && !brands.some((x) => x.toLowerCase() === name.toLowerCase())) brands.push(name)
  }
  return brands.slice(0, 6)
}

async function talkingPoints(ctx: RunContext, d: Omit<CreatorDetail, 'talkingPoints'>): Promise<string[]> {
  const facts = [
    `Game: ${d.game}`,
    `Channel: ${d.channel.name}, ${d.channel.subscribers === null ? 'subscriber count hidden' : `${groupedInt(d.channel.subscribers)} subscribers`}`,
    d.channel.description ? `Channel description: ${noLinks(d.channel.description).slice(0, 280)}` : '',
    d.stats.median === null ? '' : `Median views on the last ${d.stats.sampleSize} uploads: ${groupedInt(d.stats.median)}`,
    `${d.stats.gameUploads} of the last ${d.stats.uploadsRead} uploads are about the game`,
    d.gameVideos.length ? `Their videos about the game:\n${d.gameVideos.slice(0, 5).map((v) => `- ${v.title}${v.views === null ? '' : ` (${groupedInt(v.views)} views)`}`).join('\n')}` : 'They have no recent upload about the game.',
    d.sponsorship.sponsored
      ? `Sponsored work: ${d.sponsorship.sponsored} of ${d.sponsorship.sampled} sampled uploads${d.sponsorship.brands.length ? `, brands named: ${d.sponsorship.brands.join(', ')}` : ''}`
      : `No sponsored upload among the ${d.sponsorship.sampled} sampled.`,
  ]
    .filter(Boolean)
    .join('\n')
  const res = await ctx.llm.json<{ points: string[] }>(
    {
      name: 'creator_talking_points',
      system: [
        'You write 3 or 4 short briefing bullets for a game studio about to approach one YouTube creator for a partnership.',
        'Use only the facts supplied. Say what the creator covers and what the studio could offer (early access, a creator code, a sneak peek of an update, a review build) that fits that content.',
        'Each bullet is one plain sentence under 140 characters. No numbers that are not in the facts. No em dashes, no emoji. Never mention contact details, audience age or location.',
      ].join('\n'),
      user: facts,
      schema: { type: 'object', additionalProperties: false, required: ['points'], properties: { points: { type: 'array', items: { type: 'string' } } } },
      maxTokens: 1500,
      temperature: 0.4,
    },
    ctx.signal,
  )
  return (res.data.points ?? [])
    .map((p) => plain(String(p)).slice(0, 160))
    .filter((p) => p.length > 8)
    .slice(0, 4)
}

/* --------------------------------------------------------------- the run */

export const tool: ToolModule = {
  async analyze(ctx) {
    const target = ctx.target
    if (target.kind !== 'roblox-game') throw new RunError('bad-input', 'Creator Dox needs a Roblox game.')
    if (!ctx.llm.available) {
      throw new RunError('no-llm-key', 'Creator Dox needs an OpenRouter key to read titles and descriptions. Add one in the key dialog.', { kind: 'add-key', label: 'Add a key' })
    }
    const fetchedAt = ctx.now.toISOString()
    const videosRead = new Set<string>()

    /* 1. the game */
    ctx.step('game', 'Resolving the game', 'active')
    let game = cleanGameName(target.name)
    try {
      const r = await resolveGame(String(target.placeId))
      game = cleanGameName(r.game.name)
      ctx.step('game', 'Resolving the game', 'done', `${r.game.name} (searching as "${game}")`)
    } catch (e) {
      ctx.step('game', 'Resolving the game', 'warn', `Roblox did not answer (${errMsg(e)}); searching with the saved name "${game}"`)
    }
    const about = gameMatcher(game)

    /* 2. discovery */
    const queries: { q: string; sort: 'relevance' | 'date' }[] = [
      { q: `${game} roblox gameplay`, sort: 'relevance' },
      { q: `${game} roblox review`, sort: 'relevance' },
      { q: `${game} roblox update`, sort: 'date' },
      { q: `${game} roblox guide tips`, sort: 'relevance' },
      { q: `${game} roblox best tier list`, sort: 'relevance' },
      { q: `${game} roblox new`, sort: 'date' },
    ]
    ctx.step('discover', 'Searching YouTube for creators covering the game', 'active', `${queries.length} searches`)
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
          const c = candidates.get(v.channelId) ?? { id: v.channelId, name: v.channelName ?? v.channelId, videos: new Map(), titles: 0, exploitTitles: 0 }
          candidates.set(v.channelId, c)
          c.titles++
          const exploit = isExploitTitle(v.title)
          if (exploit) {
            c.exploitTitles++
            excludedVideos++
          }
          if (!exploit && (about(v.title) || about(v.descriptionSnippet))) c.videos.set(v.id, v)
        }
      } catch (e) {
        if (fatal(e)) throw e
      }
      ctx.step('discover', 'Searching YouTube for creators covering the game', 'active', `${i + 1} of ${queries.length} searches, ${resultsRead} videos read`)
      if (i < queries.length - 1) await sleep(700, ctx.signal)
    }
    if (searchOk === 0) {
      ctx.step('discover', 'Searching YouTube for creators covering the game', 'failed', 'YouTube did not answer any search')
      throw new RunError('upstream', 'YouTube did not answer. Try again in a few minutes.', { kind: 'retry', label: 'Retry' })
    }
    let exploitChannels = 0
    const qualified: Candidate[] = []
    for (const c of candidates.values()) {
      if (c.exploitTitles >= 2 || (c.titles >= 2 && c.exploitTitles / c.titles >= 0.5)) {
        exploitChannels++
        continue
      }
      const topViews = Math.max(0, ...[...c.videos.values()].map((v) => v.views ?? 0))
      if (c.videos.size >= 2 || topViews >= 50_000) qualified.push(c)
    }
    const viewsOf = (c: Candidate): number => [...c.videos.values()].reduce((n, v) => n + (v.views ?? 0), 0)
    qualified.sort((a, b) => b.videos.size - a.videos.size || viewsOf(b) - viewsOf(a))
    const picked = qualified.slice(0, MAX_CHANNELS)
    ctx.step(
      'discover',
      'Searching YouTube for creators covering the game',
      'done',
      `${resultsRead} videos from ${candidates.size} channels; ${excludedVideos} exploit or script promo titles and ${exploitChannels} promo channels excluded; ${qualified.length} channels qualify, top ${picked.length} analysed`,
    )

    /* 3. each creator */
    const known = new Set(ctx.memory.get<string[]>(KNOWN_KEY) ?? [])
    const dossiers: { detail: CreatorDetail; isNew: boolean }[] = []
    let titlesRead = 0

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
        const uploads = page.uploads.slice(0, UPLOADS_READ)
        uploads.forEach((u) => videosRead.add(u.id))

        /* sample recent uploads: exact views, dates, descriptions, paid-promotion flag */
        const samples: Sample[] = []
        let watchFailed = 0
        let watchError = ''
        let consecutiveFails = 0
        for (const [k, u] of uploads.slice(0, WATCH_SAMPLES).entries()) {
          ctx.step(stepId, label, 'active', `Watch pages ${k + 1} of ${Math.min(WATCH_SAMPLES, uploads.length)}`)
          try {
            const w = await watchVideo(u.id, ctx.signal)
            if (w) {
              videosRead.add(u.id)
              const s = detectSponsored(w.title || u.title, w.description, w.paidPromotion)
              samples.push({ upload: u, watch: w, sponsored: s.sponsored, disclosure: s.disclosure })
            }
            else watchFailed++
            consecutiveFails = w ? 0 : consecutiveFails + 1
          } catch (e) {
            if (fatal(e)) throw e
            watchFailed++
            watchError = errMsg(e)
            consecutiveFails++
          }
          // YouTube is rate limiting watch pages: stop asking for this channel rather than hammering it.
          if (consecutiveFails >= 2) {
            watchFailed += Math.max(0, Math.min(WATCH_SAMPLES, uploads.length) - k - 1)
            await sleep(4000, ctx.signal)
            break
          }
          await sleep(800, ctx.signal)
        }
        const exact = new Map(samples.filter((s) => s.watch.views !== null).map((s) => [s.upload.id, s.watch.views as number]))
        const viewsFor = (u: ChannelPage['uploads'][number]): number | null => exact.get(u.id) ?? u.views

        /* numbers, all from what was read */
        const window = uploads.slice(0, STATS_WINDOW)
        const windowViews = window.map(viewsFor).filter((v): v is number => v !== null)
        const med = median(windowViews)
        const avg = mean(windowViews)
        const subs = page.subscribers
        const vps = med !== null && subs ? med / subs : null
        const cad = cadenceDays(uploads.map((u) => u.publishedApprox))
        const gameUploads = uploads.filter((u) => about(u.title))
        const cutoff = ctx.now.getTime() - 30 * 864e5
        const gameUploads30d = gameUploads.filter((u) => u.publishedApprox && Date.parse(u.publishedApprox) >= cutoff).length

        const gameVideos: CreatorVideoRef[] = []
        const seenGame = new Set<string>()
        for (const u of gameUploads) {
          seenGame.add(u.id)
          const w = samples.find((s) => s.upload.id === u.id)?.watch
          gameVideos.push({
            title: u.title,
            url: u.url,
            views: viewsFor(u),
            publishedText: w?.publishDate ? `${w.publishDate.slice(0, 10)}${u.publishedText ? ` (${u.publishedText})` : ''}` : (u.publishedText ?? 'Date not shown'),
          })
        }
        for (const v of cand.videos.values()) {
          if (seenGame.has(v.id)) continue
          seenGame.add(v.id)
          gameVideos.push({ title: v.title, url: v.url, views: v.views, publishedText: v.publishedText ?? 'Date not shown' })
        }

        /* sponsorship */
        const sponsoredS = samples.filter((s) => s.sponsored)
        const organicS = samples.filter((s) => !s.sponsored)
        const sViews = sponsoredS.map((s) => s.watch.views).filter((v): v is number => v !== null)
        const oViews = organicS.map((s) => s.watch.views).filter((v): v is number => v !== null)

        /* LLM reading of real text */
        ctx.step(stepId, label, 'active', 'Reading titles and descriptions')
        const safetyTitles = uploads.map((u) => ({ title: u.title, url: u.url }))
        titlesRead += safetyTitles.length
        const snippets = samples.map((s) => `- ${s.watch.title}: ${noLinks(s.watch.description).slice(0, 280)}`)
        let flags: CreatorDetail['brandSafety']['flags'] = []
        let unavailable: string | undefined
        let brands: string[] = []
        const [safetyRes, brandsRes] = await Promise.allSettled([
          brandSafety(ctx, page, safetyTitles, snippets),
          sponsoredS.length ? sponsorBrands(ctx, sponsoredS) : Promise.resolve<string[]>([]),
        ])
        if (safetyRes.status === 'fulfilled') flags = safetyRes.value
        else {
          if (fatal(safetyRes.reason)) throw safetyRes.reason
          unavailable = errMsg(safetyRes.reason)
        }
        if (brandsRes.status === 'fulfilled') brands = brandsRes.value
        else if (fatal(brandsRes.reason)) throw brandsRes.reason

        const contact = parseContact(page.description)
        const familySafe = samples.map((s) => s.watch.familySafe).find((f) => f !== null) ?? page.familySafe

        const fit = scoreFit({
          game,
          uploadsRead: uploads.length,
          gameUploads: gameUploads.length,
          gameShare: uploads.length ? gameUploads.length / uploads.length : 0,
          median: med,
          subscribers: subs,
          viewsPerSub: vps,
          sampled: samples.length,
          sponsored: sponsoredS.length,
          sponsoredMedian: median(sViews),
          channelMedian: med,
          cadenceDays: cad,
          flags: unavailable ? null : flags,
          titlesChecked: safetyTitles.length,
        })

        const base: Omit<CreatorDetail, 'talkingPoints'> = {
          kind: 'creator',
          game,
          fetchedAt,
          channel: { id: page.id, name: page.name, handle: page.handle, url: page.url, subscribers: subs, description: page.description.slice(0, 280) },
          stats: {
            median: med,
            mean: avg,
            viewsPerSub: vps,
            cadenceDays: cad,
            sampleSize: windowViews.length,
            gameShare: uploads.length ? gameUploads.length / uploads.length : 0,
            uploadsRead: uploads.length,
            gameUploads: gameUploads.length,
            gameUploads30d,
            exactViews: window.filter((u) => exact.has(u.id)).length,
          },
          sponsorship: {
            share: samples.length ? sponsoredS.length / samples.length : null,
            sampled: samples.length,
            sponsored: sponsoredS.length,
            organic: organicS.length,
            sponsoredMedian: median(sViews),
            organicMedian: median(oViews),
            deltaPct: sponsoredDeltaPct(sViews, oViews),
            brands,
            examples: sponsoredS.slice(0, 3).map((s) => ({ title: s.watch.title, url: s.upload.url, views: s.watch.views, disclosure: s.disclosure })),
          },
          brandSafety: { checked: safetyTitles.length, flags, familySafe, ...(unavailable ? { unavailable } : {}) },
          contact,
          gameVideos: gameVideos.slice(0, 10),
          fit,
          notCollected: NOT_COLLECTED,
        }
        let points: string[] = []
        let pointsNote = ''
        try {
          points = await talkingPoints(ctx, base)
          if (!points.length) pointsNote = '; no talking points returned'
        } catch (e) {
          if (fatal(e)) throw e
          pointsNote = `; talking points unavailable (${errMsg(e)})`
        }
        dossiers.push({ detail: { ...base, talkingPoints: points }, isNew: !known.has(page.id) })
        ctx.step(stepId, label, watchFailed ? 'warn' : 'done', `${page.subscribers === null ? 'Subscribers hidden' : `${compact(page.subscribers)} subscribers`}, ${uploads.length} uploads, ${samples.length} watch pages${watchFailed ? ` (${watchFailed} unavailable${watchError ? `: ${watchError}` : ''})` : ''}, fit ${fit.score}${pointsNote}`)
      } catch (e) {
        if (fatal(e)) throw e
        ctx.step(stepId, label, 'warn', `Skipped: ${errMsg(e)}`)
      }
    }

    /* 4. rank and report */
    const rank = (d: CreatorDetail): number => (d.fit.tier === 'Risky' ? -1 : d.fit.score)
    dossiers.sort((a, b) => rank(b.detail) - rank(a.detail) || (b.detail.stats.median ?? 0) - (a.detail.stats.median ?? 0))
    const flagCount = dossiers.reduce((n, d) => n + d.detail.brandSafety.flags.length, 0)
    const good = dossiers.filter((d) => d.detail.fit.tier === 'Strong fit' || d.detail.fit.tier === 'Good fit').length
    const fresh = dossiers.filter((d) => d.isNew).length
    ctx.summary({
      items: [
        { label: 'Videos read', value: groupedInt(videosRead.size) },
        { label: 'Channels analysed', value: String(dossiers.length) },
        { label: 'Strong or good fits', value: String(good), tone: good > 0 ? 'live' : undefined },
        { label: 'Brand-safety flags', value: String(flagCount), tone: flagCount > 0 ? 'warn' : undefined },
        { label: 'New this run', value: String(fresh), tone: fresh > 0 ? 'accent' : undefined },
      ],
      sortLabel: 'Best partnership fit first',
      groups: [
        { id: 'strong', label: 'Strong fit' },
        { id: 'good', label: 'Good fit' },
        { id: 'weak', label: 'Weak fit' },
        { id: 'risky', label: 'Risky' },
      ],
      notes: [`Public YouTube data at ${ctx.now.toISOString().slice(0, 16).replace('T', ' ')} UTC. Audience demographics are not public and are not shown.`],
      notices: [{ lead: 'Not collected:', body: 'home address, phone, family, private data. Contacts only if the creator published them.' }],
    })

    for (const { detail: d, isNew } of dossiers) {
      const tone = { 'Strong fit': 'live', 'Good fit': 'accent', 'Weak fit': 'muted', Risky: 'danger' }[d.fit.tier as CreatorTier] as 'live' | 'accent' | 'muted' | 'danger'
      const group = { 'Strong fit': 'strong', 'Good fit': 'good', 'Weak fit': 'weak', Risky: 'risky' }[d.fit.tier as CreatorTier]
      const medianText = d.stats.median === null ? 'views not readable' : `median ${groupedInt(d.stats.median)} views`
      const sentence =
        d.stats.gameUploads30d > 0
          ? `${d.stats.gameUploads30d} video${d.stats.gameUploads30d === 1 ? '' : 's'} about ${d.game} in the last 30 days, ${medianText}`
          : d.stats.gameUploads > 0
            ? `${d.stats.gameUploads} of the last ${d.stats.uploadsRead} uploads are about ${d.game}, ${medianText}`
            : `${d.gameVideos.length} video${d.gameVideos.length === 1 ? '' : 's'} about ${d.game} found by search, none in the last ${d.stats.uploadsRead} uploads, ${medianText}`
      const finding: Finding = {
        id: `creator:${d.channel.id}`,
        badge: { label: d.fit.tier, tone },
        title: d.channel.name,
        snippet: [{ text: `${sentence}.` }],
        meta: [
          { label: 'Subscribers', value: compact(d.channel.subscribers) },
          { label: 'Median views', value: d.stats.median === null ? 'n/a' : compact(d.stats.median) },
          { label: 'Sponsored share', value: d.sponsorship.share === null ? 'n/a' : `${Math.round(d.sponsorship.share * 100)}%` },
          { label: 'Fit', value: String(d.fit.score) },
        ],
        status: isNew ? { label: 'New', tone: 'accent' } : { label: 'Tracked', tone: 'muted' },
        states: { contacted: { label: 'Contacted', tone: 'live' } },
        group,
        url: d.channel.url,
        detail: d,
      }
      ctx.finding(finding)
    }

    ctx.memory.set(KNOWN_KEY, [...new Set([...known, ...dossiers.map((d) => d.detail.channel.id)])])
    if (dossiers.length === 0) {
      ctx.step('result', 'Result', 'done', `No qualifying creators for "${game}": ${candidates.size} channels seen in ${resultsRead} videos, none with 2 or more videos about the game or one with 50,000 views`)
    }
  },
}
