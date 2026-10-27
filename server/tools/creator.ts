/* Creator Dox: how to reach the people behind a Roblox game, from PUBLIC text they wrote or linked.
   1. Resolve the game and who owns it (a user, or a group whose owner is a user).
   2. Read the group, its roles and the members of the leadership roles; read every person's public profile text and
      the channels they listed on their Roblox profile; follow "my other accounts are ..." one level deep.
   3. Pull Discord invites, X / Twitter and other channels, and emails out of that text, read the link pages the owner
      linked, and run a few web searches for the game's own pages (marked as unconfirmed matches).
   4. Resolve every invite through Discord's public invite lookup and rank the contact points.
   Only text the owner or team published is used. Nothing is guessed: an email appears only when it is written out in
   public text, and a search match is never presented as confirmed. */
import type {
  CreatorChannelKind,
  CreatorConfidence,
  CreatorDetail,
  CreatorInvite,
  CreatorLinkRow,
  CreatorPerson,
  CreatorProvenance,
  CreatorRelation,
  CreatorRoleHeld,
  CreatorRoleRow,
} from '../../src/lib/details/creator.ts'
import type { Finding, RunSummary } from '../../src/lib/runTypes.ts'
import { apiBase } from '../discord/client.ts'
import { takeRobloxToken } from '../roblox.ts'
import {
  type ChannelKind,
  type GroupRole,
  type SearchResult,
  classifyUrl,
  decodeEntities,
  excerptAround,
  extractEmails,
  extractInvites,
  extractLinks,
  findAltUsernames,
  handleMatches,
  houseStyle,
  htmlToText,
  KIND_LABEL,
  mentions,
  nearName,
  normalizeName,
  parseLooseJson,
  parseSearchRss,
  pickLeaderRoles,
  rankOf,
} from './creator-contacts.ts'
import { RunError, type RunContext, type ToolModule } from './types.ts'

const NOT_COLLECTED = 'Not collected: home address, phone, family, private data. Contacts only if the owner published them.'
const NOT_COLLECTED_BODY = 'home address, phone, family, private data. Contacts only if the owner published them.'
const MEMORY_KEY = 'seen'
const MAX_PEOPLE = 25
const MAX_ALTS = 8
const MAX_HUBS = 4
const MAX_PAGES = 6
const MAX_INVITES = 30
const PAGE_TIMEOUT_MS = 10_000
const PAGE_MAX_BYTES = 1_000_000
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const num = (n: number): string => n.toLocaleString('en-US')
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const nnum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const fatal = (e: unknown): boolean => e instanceof RunError && ['aborted', 'credits'].includes(e.code)

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

/* ------------------------------------------------------------------ Roblox (public endpoints, shared limiter) */

interface Reply {
  status: number
  json: unknown
}

async function rbx(url: string, signal: AbortSignal, post?: unknown): Promise<Reply> {
  let retry = 5
  let serverErrors = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    await takeRobloxToken(signal).catch(() => {
      throw new RunError('aborted', 'The run was cancelled.')
    })
    let res: Response
    try {
      res = await fetch(url, {
        method: post === undefined ? 'GET' : 'POST',
        headers: post === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: post === undefined ? undefined : JSON.stringify(post),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      })
    } catch {
      if (signal.aborted) throw new RunError('aborted', 'The run was cancelled.')
      throw new RunError('upstream', 'Roblox did not answer. Check your connection and run again in a moment.')
    }
    if (res.status === 429) {
      const header = Number(res.headers.get('retry-after'))
      retry = Math.min(Number.isFinite(header) && header > 0 ? header : 5, 30)
      await res.arrayBuffer().catch(() => undefined)
      await sleep(retry * 1000, signal)
      continue
    }
    if (res.status >= 500) {
      await res.arrayBuffer().catch(() => undefined)
      if (++serverErrors < 2) {
        await sleep(1500, signal)
        continue
      }
      throw new RunError('upstream', 'Roblox is having trouble right now. Try again in a minute.')
    }
    return { status: res.status, json: parseLooseJson(await res.text().catch(() => '')) }
  }
  throw new RunError('rate-limited', `Roblox is rate limiting lookups. Wait ${retry} seconds and run again.`, { kind: 'retry', label: 'Retry' })
}

/** Runs one Roblox lookup that may fail without ending the run; cancellation still propagates. */
async function soft<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    if (fatal(e)) throw e
    return null
  }
}

/* ------------------------------------------------------------------ plain web (search results and a few pages) */

async function fetchText(url: string, signal: AbortSignal, timeoutMs = PAGE_TIMEOUT_MS): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5', 'accept-language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  })
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || !/text|json|xml/i.test(type)) {
    await res.body?.cancel().catch(() => undefined)
    return { status: res.status, text: '' }
  }
  const reader = res.body?.getReader()
  if (!reader) return { status: res.status, text: '' }
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < PAGE_MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => undefined)
  return { status: res.status, text: Buffer.concat(chunks).subarray(0, PAGE_MAX_BYTES).toString('utf8') }
}

/** The one place a search engine is named. Bing's keyless RSS answer; swap this function to change engines. */
async function webSearch(query: string, signal: AbortSignal): Promise<{ results: SearchResult[]; ok: boolean }> {
  const url = `https://www.bing.com/search?${new URLSearchParams({ q: query, format: 'rss', count: '20', mkt: 'en-US', setlang: 'en-US' })}`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { status, text } = await fetchText(url, signal, 12_000)
      const results = status === 200 ? parseSearchRss(text, query) : []
      if (results.length > 0) return { results, ok: true }
      if (status !== 200 && status !== 429) return { results: [], ok: false }
    } catch (e) {
      if (signal.aborted) throw new RunError('aborted', 'The run was cancelled.')
      void e
    }
    if (attempt === 0) await sleep(2500, signal)
  }
  return { results: [], ok: false }
}

/* ------------------------------------------------------------------ what the run collects */

interface Person {
  userId: number
  username: string
  displayName: string
  verified: boolean
  relation: CreatorRelation
  roles: CreatorRoleHeld[]
  reason: string
  description: string
  profileRead: boolean
}

interface Source {
  where: string
  url: string
  text: string
  /** Who wrote it: a person, or null for the game or group text (credited to the owner). */
  personId: number | null
  from: CreatorRelation
}

interface Acc {
  kind: ChannelKind
  handle: string
  url: string
  provs: CreatorProvenance[]
  pubs: Map<number, CreatorRelation>
  team: boolean
  /** The strongest team relation that published it. */
  from: CreatorRelation | null
}

const FROM_ORDER: Record<CreatorRelation, number> = { owner: 0, alt: 1, leader: 2 }
const profileUrl = (id: number): string => `https://www.roblox.com/users/${id}/profile`

class Collector {
  channels = new Map<string, Acc>()
  invites = new Map<string, Acc>()
  emails = new Map<string, Acc>()
  /** Where a link-hub page was linked from, so the hub's own links are credited to the right person. */
  hubs: { url: string; source: Source }[] = []

  add(into: Map<string, Acc>, key: string, kind: ChannelKind, handle: string, url: string, prov: CreatorProvenance, source: { personId: number | null; from: CreatorRelation } | null, ownerId: number | null): void {
    let a = into.get(key)
    if (!a) {
      a = { kind, handle, url, provs: [], pubs: new Map(), team: false, from: null }
      into.set(key, a)
    }
    if (!a.provs.some((p) => p.url === prov.url && p.where === prov.where) && a.provs.length < 6) a.provs.push(prov)
    if (source) {
      a.team = true
      const who = source.personId ?? ownerId
      if (who !== null && !a.pubs.has(who)) a.pubs.set(who, source.from)
      if (a.from === null || FROM_ORDER[source.from] < FROM_ORDER[a.from]) a.from = source.from
    }
  }
}

/* ------------------------------------------------------------------ the analyzer */

const tool: ToolModule = {
  async analyze(ctx: RunContext) {
    if (ctx.target.kind !== 'roblox-game') throw new RunError('bad-input', 'Creator Dox works on a Roblox game. Paste a roblox.com/games link.')
    const { signal } = ctx
    const target = ctx.target
    const fetchedAt = new Date().toISOString()
    const col = new Collector()
    const people = new Map<number, Person>()
    const sources: Source[] = []
    const channelRows = new Map<number, CreatorLinkRow[]>()
    const notes: string[] = []
    const warnings: string[] = []
    let pagesRead = 0
    let searchesRun = 0
    let searchesOk = 0
    let resultsKept = 0
    let resultsSkipped = 0

    /* 1. the game */
    ctx.step('game', 'Resolving the game', 'active', `Universe ${target.universeId}`)
    const g = await rbx(`https://games.roblox.com/v1/games?universeIds=${target.universeId}`, signal)
    const game = obj(arr(obj(g.json).data)[0])
    if (g.status !== 200 || !str(game.name)) {
      ctx.step('game', 'Resolving the game', 'failed', 'Roblox did not return this game')
      throw new RunError('not-found', 'Roblox did not return this game. Check the link and run again.', { kind: 'retry', label: 'Retry' })
    }
    const gameName = str(game.name)
    const placeId = nnum(game.rootPlaceId) || target.placeId
    const gameUrl = `https://www.roblox.com/games/${placeId}`
    const creator = obj(game.creator)
    const creatorType = str(creator.type)
    const creatorId = nnum(creator.id)
    const creatorName = str(creator.name)
    ctx.step('game', 'Resolving the game', 'done', `${gameName} is made by ${creatorType === 'Group' ? `the group ${creatorName}` : `the user ${creatorName}`}`)
    const gameDescription = str(game.description)
    if (gameDescription.trim()) sources.push({ where: 'Game description', url: gameUrl, text: gameDescription, personId: null, from: 'owner' })

    const addPerson = (p: Omit<Person, 'description' | 'profileRead'>): Person => {
      const have = people.get(p.userId)
      if (have) {
        for (const r of p.roles) if (!have.roles.some((x) => x.group === r.group && x.role === r.role)) have.roles.push(r)
        if (p.relation === 'owner') have.relation = 'owner'
        if (p.reason && !have.reason.includes(p.reason)) have.reason = `${have.reason} ${p.reason}`.trim()
        return have
      }
      const fresh: Person = { ...p, roles: [...p.roles], description: '', profileRead: false }
      people.set(p.userId, fresh)
      return fresh
    }

    /* 2. the group (or the user who owns the game) */
    let groupName = ''
    let groupId = 0
    let ownerId = 0
    let roleRows: CreatorRoleRow[] = []
    let rolesTotal = 0
    let rolesRead = 0
    if (creatorType === 'Group' && creatorId) {
      groupId = creatorId
      ctx.step('group', 'Reading the group', 'active', creatorName)
      const gr = await soft(() => rbx(`https://groups.roblox.com/v1/groups/${groupId}`, signal))
      const grp = obj(gr?.json)
      if (!gr || gr.status !== 200 || !str(grp.name)) {
        ctx.step('group', 'Reading the group', 'warn', 'Roblox did not return the group, so its owner and roles are missing from this run')
        warnings.push('The group page could not be read, so the group owner and leaders are missing from this run.')
      } else {
        groupName = str(grp.name)
        const owner = obj(grp.owner)
        const groupUrl = `https://www.roblox.com/communities/${groupId}`
        if (str(grp.description).trim()) sources.push({ where: `Description of the group ${groupName}`, url: groupUrl, text: str(grp.description), personId: null, from: 'owner' })
        if (nnum(owner.userId)) {
          ownerId = nnum(owner.userId)
          addPerson({
            userId: ownerId,
            username: str(owner.username),
            displayName: str(owner.displayName) || str(owner.username),
            verified: owner.hasVerifiedBadge === true,
            relation: 'owner',
            roles: [{ group: groupName, role: 'Group owner', rank: 255 }],
            reason: `Registered owner of the group ${groupName}, which makes ${gameName}.`,
          })
          ctx.step('group', 'Reading the group', 'done', `${groupName}: ${num(nnum(grp.memberCount))} members, owned by ${str(owner.username)}`)
        } else {
          ctx.step('group', 'Reading the group', 'warn', `${groupName} has no owner account listed`)
          warnings.push(`The group ${groupName} lists no owner account.`)
        }
      }
    } else if (creatorType === 'User' && creatorId) {
      ownerId = creatorId
      addPerson({ userId: ownerId, username: creatorName, displayName: creatorName, verified: creator.hasVerifiedBadge === true, relation: 'owner', roles: [], reason: `Publisher of ${gameName}.` })
      ctx.step('group', 'Reading the group', 'done', `${gameName} is published by the user ${creatorName}, not a group, so there is no group to read`)
    } else {
      ctx.step('group', 'Reading the group', 'warn', 'Roblox did not say who made this game')
      warnings.push('Roblox did not say who made this game.')
    }

    /* social links the game and group show to signed-in users only */
    const socialUrls: { url: string; where: string; page: string }[] = [
      { url: `https://games.roblox.com/v1/games/${target.universeId}/social-links/list`, where: 'Social links on the game page', page: gameUrl },
    ]
    if (groupId) socialUrls.push({ url: `https://groups.roblox.com/v1/groups/${groupId}/social-links`, where: `Social links on the group ${groupName}`, page: `https://www.roblox.com/communities/${groupId}` })
    let socialSignedIn = 0
    for (const s of socialUrls) {
      const r = await soft(() => rbx(s.url, signal))
      if (r && r.status === 200) {
        for (const it of arr(obj(r.json).data)) {
          const link = str(obj(it).url)
          if (link) sources.push({ where: s.where, url: s.page, text: link, personId: null, from: 'owner' })
        }
      } else socialSignedIn++
    }

    /* 3. roles and members */
    if (groupId && groupName) {
      ctx.step('roles', 'Reading roles and members', 'active', 'Listing the group roles')
      const rr = await soft(() => rbx(`https://groups.roblox.com/v1/groups/${groupId}/roles`, signal))
      const roles: GroupRole[] = arr(obj(rr?.json).roles).map((r) => {
        const o = obj(r)
        return { id: nnum(o.id), name: str(o.name), rank: nnum(o.rank), memberCount: nnum(o.memberCount), isBase: o.isBase === true }
      })
      if (!rr || rr.status !== 200 || roles.length === 0) {
        ctx.step('roles', 'Reading roles and members', 'warn', 'Roblox did not list the roles of this group')
        warnings.push('The group roles could not be read, so only the registered owner is listed as a leader.')
      } else {
        rolesTotal = roles.length
        const leaders = pickLeaderRoles(roles)
        const leaderIds = new Set(leaders.map((l) => l.role.id))
        const whyOf = new Map(leaders.map((l) => [l.role.id, l.why]))
        let truncated = 0
        for (const [i, l] of leaders.entries()) {
          ctx.step('roles', 'Reading roles and members', 'active', `${l.role.name}: ${i + 1} of ${leaders.length} leader roles`)
          const mr = await soft(() => rbx(`https://groups.roblox.com/v1/groups/${groupId}/roles/${l.role.id}/users?limit=25&sortOrder=Asc`, signal))
          if (!mr || mr.status !== 200) {
            warnings.push(`The members of the role ${l.role.name} could not be read.`)
            continue
          }
          rolesRead++
          const members = arr(obj(mr.json).data)
          if (obj(mr.json).nextPageCursor) truncated++
          for (const m of members) {
            const o = obj(m)
            const user = nnum(o.userId) ? o : obj(o.user)
            const userId = nnum(user.userId) || nnum(user.id)
            if (!userId) continue
            addPerson({
              userId,
              username: str(user.username) || str(user.name),
              displayName: str(user.displayName) || str(user.username) || str(user.name),
              verified: user.hasVerifiedBadge === true,
              relation: userId === ownerId ? 'owner' : 'leader',
              roles: [{ group: groupName, role: l.role.name, rank: l.role.rank }],
              reason: `Holds the role ${l.role.name} (rank ${l.role.rank}) in ${groupName}. ${l.why}.`,
            })
          }
        }
        roleRows = roles
          .filter((r) => r.memberCount > 0 || leaderIds.has(r.id))
          .sort((a, b) => b.rank - a.rank || a.id - b.id)
          .map((r) => ({
            id: r.id,
            name: r.name,
            rank: r.rank,
            memberCount: r.memberCount,
            leader: leaderIds.has(r.id),
            why: leaderIds.has(r.id) ? `Members read as leaders. ${whyOf.get(r.id)}.` : r.isBase ? 'The base role everyone starts with.' : r.memberCount > 25 ? 'Too many members to be a team role.' : 'Not a leadership role.',
          }))
        const hidden = roles.filter((r) => r.memberCount === 0).length
        ctx.step('roles', 'Reading roles and members', 'done', `${roles.length} roles listed, ${leaders.length} read as leadership (${leaders.map((l) => l.role.name).join(', ') || 'none'}), ${hidden} empty${truncated ? `, ${truncated} with more members than were read` : ''}`)
      }
    } else {
      ctx.step('roles', 'Reading roles and members', 'done', creatorType === 'User' ? 'No group, so no roles to read' : 'No group to read roles from')
    }
    // Everyone beyond the cap is named in the notes instead of silently dropped.
    const everyone = [...people.values()]
    if (everyone.length > MAX_PEOPLE) {
      for (const p of everyone.slice(MAX_PEOPLE)) people.delete(p.userId)
      notes.push(`${everyone.length - MAX_PEOPLE} more people hold leader roles. The first ${MAX_PEOPLE} were read.`)
    }

    /* 4. profiles */
    const readProfile = async (p: Person): Promise<void> => {
      const r = await soft(() => rbx(`https://users.roblox.com/v1/users/${p.userId}`, signal))
      if (!r || r.status !== 200) return
      const u = obj(r.json)
      p.profileRead = true
      p.description = str(u.description)
      if (str(u.name)) p.username = str(u.name)
      if (str(u.displayName)) p.displayName = str(u.displayName)
      if (u.hasVerifiedBadge === true) p.verified = true
      if (p.description.trim()) sources.push({ where: `Profile description of ${p.username}`, url: profileUrl(p.userId), text: p.description, personId: p.userId, from: p.relation })
    }
    ctx.step('profiles', 'Reading profiles', 'active', `${people.size} people`)
    const toRead = [...people.values()]
    for (const [i, p] of toRead.entries()) {
      await readProfile(p)
      if (i % 3 === 2) ctx.step('profiles', 'Reading profiles', 'active', `${i + 1} of ${toRead.length} profiles`)
    }
    const unread = toRead.filter((p) => !p.profileRead).length
    ctx.step('profiles', 'Reading profiles', unread ? 'warn' : 'done', `${toRead.length - unread} of ${toRead.length} profiles read${unread ? `, ${unread} would not load` : ''}`)

    /* accounts the owner or a leader says are theirs, one level deep */
    let altNamed = 0
    let altFound = 0
    const altMissing: string[] = []
    {
      const named = new Map<string, number>()
      for (const p of toRead) for (const n of findAltUsernames(p.description, MAX_ALTS)) if (!named.has(n.toLowerCase())) named.set(n.toLowerCase(), p.userId)
      const names = [...named.keys()].slice(0, MAX_ALTS)
      altNamed = names.length
      if (names.length > 0) {
        ctx.step('alts', 'Reading accounts the owner says are theirs', 'active', names.join(', '))
        const r = await soft(() => rbx('https://users.roblox.com/v1/usernames/users', signal, { usernames: names, excludeBannedUsers: true }))
        const found = arr(obj(r?.json).data).map(obj)
        const foundLower = new Set(found.map((f) => str(f.requestedUsername).toLowerCase()))
        for (const n of names) if (!foundLower.has(n)) altMissing.push(n)
        const fresh: Person[] = []
        for (const f of found) {
          const userId = nnum(f.id)
          if (!userId) continue
          const namedBy = people.get(named.get(str(f.requestedUsername).toLowerCase()) ?? 0)
          const known = people.has(userId)
          const p = addPerson({
            userId,
            username: str(f.name),
            displayName: str(f.displayName) || str(f.name),
            verified: f.hasVerifiedBadge === true,
            relation: 'alt',
            roles: [],
            reason: `Named in the profile text of ${namedBy?.username ?? 'the owner'} as one of their accounts.`,
          })
          altFound++
          if (!known) fresh.push(p)
        }
        for (const p of fresh) await readProfile(p)
        ctx.step('alts', 'Reading accounts the owner says are theirs', r ? 'done' : 'warn', r ? `${altFound} of ${names.length} found on Roblox${altMissing.length ? `; not found: ${altMissing.join(', ')}` : ''}` : 'Roblox did not answer the username lookup')
      } else ctx.step('alts', 'Reading accounts the owner says are theirs', 'done', 'No profile says "my other accounts are ..."')
    }

    /* 5. channels listed on Roblox profiles */
    ctx.step('channels', 'Reading profile channels', 'active', `${people.size} profiles`)
    let channelFields = 0
    let channelFailed = 0
    for (const p of people.values()) {
      const r = await soft(() => rbx(`https://accountinformation.roblox.com/v1/users/${p.userId}/promotion-channels`, signal))
      if (!r || r.status !== 200) {
        channelFailed++
        continue
      }
      for (const [field, value] of Object.entries(obj(r.json))) {
        const v = str(value).trim()
        if (!v) continue
        channelFields++
        const text = /[/.]/.test(v) ? v : `${field}: @${v.replace(/^@/, '')}`
        sources.push({ where: `Promotion channels on the Roblox profile of ${p.username}`, url: profileUrl(p.userId), text, personId: p.userId, from: p.relation })
      }
    }
    ctx.step('channels', 'Reading profile channels', channelFailed ? 'warn' : 'done', `${channelFields} channels listed on ${people.size - channelFailed} profiles${channelFailed ? `, ${channelFailed} would not load` : ''}`)

    /* 6. invites, handles and emails in the text the team wrote */
    ctx.step('text', 'Finding invites and links in text', 'active', `${sources.length} pieces of text`)
    const gameNames = [gameName, groupName].filter((n) => normalizeName(n).length >= 3)
    const ingest = (src: Source, text: string, opts: { hub?: boolean } = {}): void => {
      const credit = { personId: src.personId, from: src.from }
      for (const h of extractInvites(text)) {
        col.add(col.invites, h.value.code, 'discord', h.value.code, h.value.url, { where: src.where, url: src.url, excerpt: houseStyle(excerptAround(text, h.index, h.value.raw.length)) }, credit, ownerId || null)
      }
      for (const h of extractEmails(text)) {
        const addr = h.value
        col.add(col.emails, addr.toLowerCase(), 'email', addr, `mailto:${addr}`, { where: src.where, url: src.url, excerpt: houseStyle(excerptAround(text, h.index, addr.length)) }, credit, ownerId || null)
      }
      for (const h of extractLinks(text)) {
        const l = h.value
        const prov = { where: src.where, url: src.url, excerpt: houseStyle(excerptAround(text, h.index, l.raw.length)) }
        col.add(col.channels, `${l.kind}:${l.handle.toLowerCase()}`, l.kind, l.handle, l.url, prov, credit, ownerId || null)
        if (l.kind === 'linkhub' && !opts.hub) col.hubs.push({ url: l.url, source: src })
      }
    }
    for (const s of sources) ingest(s, s.text)
    ctx.step('text', 'Finding invites and links in text', 'done', `${col.invites.size} invite codes, ${col.channels.size} links and handles, ${col.emails.size} emails written out in ${sources.length} pieces of text`)

    /* link pages the owner linked (Linktree and similar) */
    if (col.hubs.length > 0) {
      ctx.step('hubs', 'Reading link pages the owner linked', 'active', col.hubs[0].url)
      let opened = 0
      const done = new Set<string>()
      for (const hub of col.hubs) {
        if (done.size >= MAX_HUBS) break
        if (done.has(hub.url)) continue
        done.add(hub.url)
        const page = await soft(() => fetchText(hub.url, signal))
        if (!page || !page.text) continue
        opened++
        const pageText = htmlToText(page.text)
        const own = new URL(hub.url).hostname
        const via: Source = { where: `Link page ${hub.url}, linked in the ${hub.source.where.toLowerCase()}`, url: hub.url, text: pageText, personId: hub.source.personId, from: hub.source.from }
        ingest(via, pageText, { hub: true })
        for (const [k, a] of col.channels) if (new URL(a.url).hostname === own && a.provs.every((p) => p.url === hub.url)) col.channels.delete(k)
      }
      ctx.step('hubs', 'Reading link pages the owner linked', opened < done.size ? 'warn' : 'done', `${opened} of ${done.size} link pages opened`)
    }

    /* 7. web search */
    const owner = people.get(ownerId)
    // The search engine often drops everything after the first word of a long query, so the first group is a ladder of
    // short forms of the game name that stops at the first one that returns pages naming the game.
    const initials = gameName.split(/\s+/).filter(Boolean).map((w) => (/^\d+$/.test(w) ? w : w[0]?.toUpperCase() ?? '')).join('')
    const ladder = [`"${gameName}" roblox`, `${gameName} wiki`, ...(gameName.split(/\s+/).length >= 2 && initials.length >= 3 ? [`${initials} roblox`] : []), `${gameName} roblox game`]
    const targeted: string[] = [`"${gameName}" roblox discord invite`, `site:discord.gg "${gameName}"`]
    if (owner) targeted.push(`site:x.com "${owner.username}"`)
    if (groupName) targeted.push(`site:twitter.com "${groupName}"`)
    if (owner && owner.displayName.toLowerCase() !== owner.username.toLowerCase()) targeted.push(`"${owner.displayName}" "${gameName}" twitter`)
    else if (owner) targeted.push(`"${owner.username}" roblox discord`)
    const MAX_SEARCHES = 8
    ctx.step('search', 'Running web searches', 'active', 'Starting')
    const seenUrls = new Set<string>()
    const kept: SearchResult[] = []
    const ownerNames = [owner?.username ?? '', groupName].filter((n) => normalizeName(n).length >= 6)
    const handleNames = [gameName, groupName, owner?.username ?? '', owner?.displayName ?? '']
    const queryHits: { query: string; results: number; kept: number }[] = []
    const runSearch = async (q: string): Promise<number> => {
      if (searchesRun > 0) await sleep(1200, signal)
      ctx.step('search', 'Running web searches', 'active', `Search ${searchesRun + 1}: ${q}`)
      searchesRun++
      const res = await webSearch(q, signal)
      if (res.ok) searchesOk++
      let keptHere = 0
      for (const r of res.results) {
        if (seenUrls.has(r.url)) continue
        seenUrls.add(r.url)
        const blob = `${r.title} ${r.snippet}`
        const hasGame = mentions(blob, gameName) && /roblox/i.test(`${blob} ${r.url}`)
        const hasOwner = ownerNames.some((n) => mentions(`${blob} ${r.url.replace(/[/._-]/g, ' ')}`, n))
        if (hasGame || hasOwner) {
          kept.push(r)
          keptHere++
        } else resultsSkipped++
      }
      resultsKept += keptHere
      queryHits.push({ query: q, results: res.results.length, kept: keptHere })
      return keptHere
    }
    for (const q of ladder) {
      if (searchesRun >= MAX_SEARCHES) break
      if ((await runSearch(q)) > 0) break
    }
    for (const q of targeted) {
      if (searchesRun >= MAX_SEARCHES) break
      await runSearch(q)
    }
    // What the results themselves say: invites and handles in titles, snippets and result addresses.
    const searchSource = (r: SearchResult): Source => ({ where: `Web search result "${r.title.slice(0, 80)}"`, url: r.url, text: `${r.title}\n${r.snippet}`, personId: null, from: 'owner' })
    const searchAdd = (text: string, where: string, url: string, onlyNear: boolean): void => {
      for (const h of extractInvites(text)) {
        if (onlyNear && !nearName(text, h.index, gameNames)) continue
        col.add(col.invites, h.value.code, 'discord', h.value.code, h.value.url, { where, url, excerpt: houseStyle(excerptAround(text, h.index, h.value.raw.length)) }, null, null)
      }
      for (const h of extractLinks(text, { keywords: false })) {
        const l = h.value
        if (l.kind === 'website' || l.kind === 'linkhub') continue
        if (onlyNear && !nearName(text, h.index, gameNames)) continue
        if (!handleMatches(l.handle, handleNames)) continue
        col.add(col.channels, `${l.kind}:${l.handle.toLowerCase()}`, l.kind, l.handle, l.url, { where, url, excerpt: houseStyle(excerptAround(text, h.index, l.raw.length)) }, null, null)
      }
    }
    for (const r of kept) {
      const s = searchSource(r)
      searchAdd(s.text, s.where, r.url, false)
      const direct = classifyUrl(r.url)
      if (direct && direct.kind !== 'website' && direct.kind !== 'linkhub' && handleMatches(direct.handle, handleNames)) {
        col.add(col.channels, `${direct.kind}:${direct.handle.toLowerCase()}`, direct.kind, direct.handle, direct.url, { where: `Web search result "${r.title.slice(0, 80)}"`, url: r.url, excerpt: houseStyle(`${r.title}. ${r.snippet}`.slice(0, 200)) }, null, null)
      }
    }
    // A few pages that are plainly about the game (wikis, fan pages). Only links that sit next to the game's name count.
    const skipHost = /(?:^|\.)(?:youtube\.com|youtu\.be|bing\.com|google\.com|facebook\.com|x\.com|twitter\.com|instagram\.com|tiktok\.com|roblox\.com|reddit\.com|discord\.com|discord\.gg)$/i
    const pageCandidates = kept
      .filter((r) => {
        try {
          return !skipHost.test(new URL(r.url).hostname) && mentions(`${r.title} ${r.snippet}`, gameName)
        } catch {
          return false
        }
      })
      .sort((a, b) => Number(/wiki|fandom|fan/i.test(b.url)) - Number(/wiki|fandom|fan/i.test(a.url)))
      .slice(0, MAX_PAGES)
    let pageFailed = 0
    for (const r of pageCandidates) {
      const page = await soft(() => fetchText(r.url, signal))
      if (!page || !page.text) {
        pageFailed++
        continue
      }
      pagesRead++
      const text = htmlToText(page.text)
      const own = new URL(r.url).hostname.replace(/^www\./, '')
      const where = `Web page "${r.title.slice(0, 80)}"`
      for (const h of extractInvites(text)) {
        if (!nearName(text, h.index, gameNames)) continue
        col.add(col.invites, h.value.code, 'discord', h.value.code, h.value.url, { where, url: r.url, excerpt: houseStyle(excerptAround(text, h.index, h.value.raw.length)) }, null, null)
      }
      for (const h of extractLinks(text, { keywords: false })) {
        const l = h.value
        if (l.kind === 'website' || l.kind === 'linkhub' || l.url.includes(own)) continue
        if (!nearName(text, h.index, gameNames) || !handleMatches(l.handle, handleNames)) continue
        col.add(col.channels, `${l.kind}:${l.handle.toLowerCase()}`, l.kind, l.handle, l.url, { where, url: r.url, excerpt: houseStyle(excerptAround(text, h.index, l.raw.length)) }, null, null)
      }
    }
    const productive = queryHits.filter((q) => q.kept > 0).length
    ctx.step(
      'search',
      'Running web searches',
      searchesOk === 0 ? 'warn' : searchesOk < searchesRun ? 'warn' : 'done',
      searchesOk === 0
        ? 'The search engine did not answer, so no web matches were added'
        : `${searchesOk} of ${searchesRun} searches answered, ${resultsKept} results kept and ${resultsSkipped} set aside for not naming the game, ${pagesRead} pages read${pageFailed ? `, ${pageFailed} would not open` : ''}`,
    )

    /* 8. resolve every invite through Discord's public lookup */
    const resolved = new Map<string, ResolvedInvite>()
    const codes = [...col.invites.keys()].slice(0, MAX_INVITES)
    if (col.invites.size > codes.length) notes.push(`${col.invites.size - codes.length} more invite codes were found than the ${MAX_INVITES} that were checked.`)
    ctx.step('invites', 'Resolving Discord invites', 'active', `${codes.length} invites`)
    for (const [i, code] of codes.entries()) {
      if (i > 0) await sleep(300, signal)
      resolved.set(code, await resolveInvite(code, signal))
      if (i % 4 === 3) ctx.step('invites', 'Resolving Discord invites', 'active', `${i + 1} of ${codes.length} invites`)
    }
    const liveCount = [...resolved.values()].filter((r) => r.state === 'live').length
    const expiredCount = [...resolved.values()].filter((r) => r.state === 'expired').length
    const unknownCount = [...resolved.values()].filter((r) => r.state === 'unknown').length
    ctx.step('invites', 'Resolving Discord invites', unknownCount ? 'warn' : 'done', codes.length === 0 ? 'No invites to resolve' : `${liveCount} live, ${expiredCount} expired${unknownCount ? `, ${unknownCount} that Discord did not answer` : ''}`)

    /* 9. assemble */
    ctx.step('assemble', 'Ranking contact points', 'active')
    const memory = ctx.memory.get<{ ids?: string[]; links?: Record<string, string[]> }>(MEMORY_KEY)
    const knownIds = new Set<string>([...(memory?.ids ?? []), ...ctx.previous.map((f) => f.id)])
    const hasHistory = memory !== undefined || ctx.previous.length > 0
    const oldLinks = memory?.links ?? {}
    const newLinks: Record<string, string[]> = {}
    const peopleList = [...people.values()]
    const personOf = (id: number): Person | undefined => people.get(id)
    const publishers = (a: Acc) =>
      [...a.pubs.entries()].flatMap(([id, relation]) => {
        const p = personOf(id)
        return p ? [{ userId: id, username: p.username, displayName: p.displayName, relation, profileUrl: profileUrl(id) }] : []
      })
    const teamNames = peopleList.map((p) => ({ userId: p.userId, username: p.username }))

    type Row = { rank: number; finding: Finding; desc: string; kind: ChannelKind | 'person'; confidence: CreatorConfidence }
    const rows: Row[] = []
    const statusOf = (id: string, changed: boolean) => (changed ? { label: 'Changed', tone: 'warn' as const } : hasHistory && !knownIds.has(id) ? { label: 'New', tone: 'accent' as const } : { label: 'Tracked', tone: 'muted' as const })
    const confTone = (c: CreatorConfidence) => (c === 'Linked by the owner' ? ('live' as const) : c === 'Verified invite' ? ('accent' as const) : ('muted' as const))
    const whoText = (pubs: ReturnType<typeof publishers>, fallback: string) => (pubs.length === 0 ? fallback : pubs.length === 1 ? pubs[0].username : `${pubs[0].username} and ${pubs.length - 1} more`)
    const where1 = (a: Acc) => a.provs[0]?.where ?? 'public text'

    // Discord servers: one row per server, however many invite codes point to it.
    interface Server {
      guildId: string | null
      codes: string[]
      acc: Acc[]
      r: ResolvedInvite
    }
    // An invite found only by search stays when Discord says the server is about the game (its name or description names the game or group) or an owner or leader made it.
    const relatedToTeam = (r: ResolvedInvite): boolean => {
      if (r.state !== 'live') return false
      const text = `${r.name ?? ''} ${r.description ?? ''}`
      const inviter = r.inviter?.username.toLowerCase()
      return gameNames.some((n) => mentions(text, n)) || (inviter !== undefined && teamNames.some((t) => t.username.toLowerCase() === inviter))
    }
    const setAside: string[] = []
    const shownCodes = codes.filter((code) => {
      if (col.invites.get(code)!.team) return true
      const r = resolved.get(code)!
      if (relatedToTeam(r)) return true
      setAside.push(r.state === 'live' ? (r.name ?? code) : `${code} (${r.state})`)
      return false
    })
    if (setAside.length > 0) notes.push(`${setAside.length} ${setAside.length === 1 ? 'invite' : 'invites'} found on web pages ${setAside.length === 1 ? 'was' : 'were'} set aside because ${setAside.length === 1 ? 'the server is' : 'the servers are'} not about the game: ${setAside.slice(0, 6).join(', ')}.`)
    const servers = new Map<string, Server>()
    for (const code of shownCodes) {
      const a = col.invites.get(code)!
      const r = resolved.get(code)!
      const key = r.guildId ? `g:${r.guildId}` : `c:${code}`
      const have = servers.get(key)
      if (have) {
        have.codes.push(code)
        have.acc.push(a)
      } else servers.set(key, { guildId: r.guildId, codes: [code], acc: [a], r })
    }
    const serverRows: { server: Server; fp: string }[] = []
    for (const s of servers.values()) serverRows.push({ server: s, fp: s.guildId ?? s.codes[0] })

    for (const { server: s } of serverRows) {
      const first = s.acc[0]
      const merged: Acc = { ...first, provs: [], pubs: new Map(), team: false, from: null }
      for (const a of s.acc) {
        for (const p of a.provs) if (merged.provs.length < 6 && !merged.provs.some((x) => x.url === p.url && x.where === p.where)) merged.provs.push(p)
        for (const [id, rel] of a.pubs) if (!merged.pubs.has(id)) merged.pubs.set(id, rel)
        if (a.team) merged.team = true
        if (a.from && (merged.from === null || FROM_ORDER[a.from] < FROM_ORDER[merged.from])) merged.from = a.from
      }
      const r = s.r
      const inviterName = r.inviter?.username.toLowerCase() ?? ''
      const inviterGlobal = r.inviter?.displayName?.toLowerCase() ?? ''
      const match = r.inviter ? teamNames.find((t) => t.username.toLowerCase() === inviterName || (inviterGlobal && t.username.toLowerCase() === inviterGlobal)) : undefined
      const nameHit = r.name ? gameNames.some((n) => mentions(r.name!, n)) : false
      let confidence: CreatorConfidence
      if (merged.team) confidence = 'Linked by the owner'
      else if (r.state === 'live' && (nameHit || match)) confidence = 'Verified invite'
      else confidence = 'Found by search'
      const expired = r.state === 'expired'
      const pubs = publishers(merged)
      const fp = s.guildId ?? s.codes[0]
      const id = expired ? `discord-expired:${s.codes[0]}` : `discord:${fp}`
      const primary = s.codes[0]
      const flags = r.features
      const invite: CreatorInvite = {
        code: primary,
        url: `https://discord.gg/${primary}`,
        state: r.state,
        guildId: r.guildId,
        name: r.name,
        description: r.description,
        members: r.members,
        online: r.online,
        verified: flags.includes('VERIFIED'),
        partnered: flags.includes('PARTNERED'),
        community: flags.includes('COMMUNITY'),
        inviter: r.inviter,
        inviterMatch: match ? { userId: match.userId, username: match.username } : null,
        expiresAt: r.expiresAt,
        otherCodes: s.codes.slice(1),
      }
      const unconfirmed = confidence === 'Found by search'
      const rank = rankOf({ kind: 'discord', from: merged.from ?? 'search', confidence, inviterIsTeam: Boolean(match), expired, members: r.members })
      const title = expired ? `Expired Discord invite ${primary}` : r.state === 'unknown' ? `Discord invite ${primary}` : `${r.name}`
      const where = where1(merged)
      const sn = expired ? `Discord says this invite no longer works. It was found in ${where.charAt(0).toLowerCase()}${where.slice(1)}.` : `${r.description ? `${clip(r.description, 90)} ` : ''}Found in ${where.charAt(0).toLowerCase()}${where.slice(1)}${unconfirmed ? ', not confirmed to belong to the team' : ''}.`
      const detail: CreatorDetail = {
        kind: 'creator',
        subject: 'channel',
        game: gameName,
        fetchedAt,
        channel: { kind: 'discord', label: KIND_LABEL.discord, handle: primary, url: invite.url },
        person: null,
        publishedBy: pubs,
        confidence,
        unconfirmed,
        provenance: merged.provs,
        invite,
        channels: [],
        changed: null,
        roles: null,
        rankReason: rankReason('discord', merged.from, confidence, Boolean(match), expired),
        notCollected: NOT_COLLECTED,
      }
      rows.push({
        rank,
        kind: 'discord',
        confidence,
        desc: expired ? `an expired Discord invite (${invite.url}) that ${whoText(pubs, 'the team')} linked` : `the Discord server ${r.name}${r.members !== null ? ` (${num(r.members)} members)` : ''}, invite ${invite.url}`,
        finding: {
          id,
          badge: { label: expired ? 'Expired invite' : KIND_LABEL.discord, tone: expired ? 'warn' : confTone(confidence) },
          title: houseStyle(title),
          snippet: [{ text: houseStyle(sn) }],
          meta: expired
            ? [
                { label: 'Confidence', value: confidence },
                { label: 'Invite', value: 'Expired' },
              ]
            : [
                { label: 'Confidence', value: confidence },
                { label: 'Members', value: r.members === null ? 'Not available' : num(r.members) },
                { label: 'Online', value: r.online === null ? 'Not available' : num(r.online) },
              ],
          status: statusOf(id, false),
          states: { contacted: { label: 'Contacted', tone: 'live' } },
          group: 'discord',
          url: invite.url,
          detail,
        },
      })
    }

    // Emails and channels.
    const channelAccs = [...col.emails.entries(), ...col.channels.entries()]
    for (const [, a] of channelAccs) {
      const pubs = publishers(a)
      const confidence: CreatorConfidence = a.team ? 'Linked by the owner' : 'Found by search'
      const unconfirmed = !a.team
      const id = a.kind === 'email' ? `email:${a.handle.toLowerCase()}` : `social:${a.kind}:${a.handle.toLowerCase()}`
      // A different link than last run for the same person and kind.
      let changed: { was: string } | null = null
      if (a.team && !['email', 'website', 'discord'].includes(a.kind)) {
        for (const pub of pubs) {
          const key = `${pub.userId}:${a.kind}`
          newLinks[key] = [...new Set([...(newLinks[key] ?? []), a.url])]
        }
      }
      const rank = rankOf({ kind: a.kind, from: a.from ?? 'search', confidence })
      const label = KIND_LABEL[a.kind]
      const who = whoText(pubs, 'Search match')
      const handleText = a.kind === 'website' ? a.handle : a.kind === 'email' ? a.handle : a.handle.startsWith('@') || a.kind === 'linkhub' ? a.handle : `@${a.handle}`
      const title = a.kind === 'email' ? `${a.handle}, published by ${who}` : unconfirmed ? `${handleText} on ${label}, unconfirmed` : `${who} on ${label} (${handleText})`
      const where = where1(a)
      const detail: CreatorDetail = {
        kind: 'creator',
        subject: 'channel',
        game: gameName,
        fetchedAt,
        channel: { kind: a.kind, label, handle: a.handle, url: a.url },
        person: null,
        publishedBy: pubs,
        confidence,
        unconfirmed,
        provenance: a.provs,
        invite: null,
        channels: [],
        changed,
        roles: null,
        rankReason: rankReason(a.kind, a.from, confidence, false, false),
        notCollected: NOT_COLLECTED,
      }
      rows.push({
        rank,
        kind: a.kind,
        confidence,
        desc: a.kind === 'email' ? `the email ${a.handle}, written out by ${who}` : `${label} ${handleText}${unconfirmed ? ', a search match that is not confirmed' : `, linked by ${who}`}`,
        finding: {
          id,
          badge: { label, tone: confTone(confidence) },
          title: houseStyle(title),
          snippet: [{ text: houseStyle(`${a.kind === 'email' ? 'Written out in' : 'Found in'} ${where.charAt(0).toLowerCase()}${where.slice(1)}${unconfirmed ? '. A search match by name, not confirmed' : ''}.`) }],
          meta: [
            { label: 'Confidence', value: confidence },
            { label: 'From', value: pubs[0] ? roleWord(pubs[0].relation) : 'Web search' },
          ],
          status: statusOf(id, false),
          states: { contacted: { label: 'Contacted', tone: 'live' } },
          group: a.kind === 'email' ? 'email' : a.kind === 'discord' ? 'discord' : ['twitter', 'youtube', 'twitch', 'tiktok', 'instagram', 'facebook'].includes(a.kind) ? 'social' : 'other',
          url: a.url,
          detail,
        },
      })
    }

    // Per-person channel lists (for the people rows).
    for (const r of rows) {
      for (const pub of r.finding.detail.kind === 'creator' ? r.finding.detail.publishedBy : []) {
        const list = channelRows.get(pub.userId) ?? []
        const d = r.finding.detail as CreatorDetail
        if (d.channel) list.push({ kind: d.channel.kind, label: d.channel.kind === 'email' ? d.channel.handle : `${d.channel.label}: ${d.channel.handle}`, url: d.channel.url, confidence: d.confidence })
        channelRows.set(pub.userId, list)
      }
    }
    // Changed links are decided now that every channel is known.
    for (const r of rows) {
      const d = r.finding.detail as CreatorDetail
      if (d.subject !== 'channel' || !d.channel || ['email', 'website', 'discord'].includes(d.channel.kind)) continue
      for (const pub of d.publishedBy) {
        const was = oldLinks[`${pub.userId}:${d.channel.kind}`]
        if (was && was.length > 0 && !was.includes(d.channel.url)) {
          d.changed = { was: was.join(', ') }
          r.finding.status = { label: 'Changed', tone: 'warn' }
          r.finding.snippet = [{ text: houseStyle(`${r.finding.snippet[0].text.replace(/\.$/, '')}. It was ${was.join(', ')} on the last run.`) }]
        }
      }
    }

    // People.
    for (const p of peopleList) {
      const id = `person:${p.userId}`
      const list = channelRows.get(p.userId) ?? []
      const relationWord = p.relation === 'owner' ? 'Owner' : p.relation === 'leader' ? 'Leader' : 'Owner account'
      const rank = rankOf({ kind: 'person', from: p.relation === 'owner' ? 'owner' : p.relation === 'alt' ? 'alt' : 'leader', confidence: 'Linked by the owner' })
      const person: CreatorPerson = { userId: p.userId, username: p.username, displayName: p.displayName, verified: p.verified, profileUrl: profileUrl(p.userId), relation: p.relation, roles: p.roles, reason: p.reason }
      const prov: CreatorProvenance[] = []
      if (groupName && p.relation === 'owner') prov.push({ where: `Registered owner of the group ${groupName}`, url: `https://www.roblox.com/communities/${groupId}`, excerpt: null })
      else if (groupName && p.roles.length > 0) prov.push({ where: `Member of the role ${p.roles[0].role} in the group ${groupName}`, url: `https://www.roblox.com/communities/${groupId}`, excerpt: null })
      else if (p.relation === 'owner') prov.push({ where: 'Publisher of the game', url: gameUrl, excerpt: null })
      if (p.description.trim()) prov.push({ where: `Profile description of ${p.username}`, url: profileUrl(p.userId), excerpt: houseStyle(excerptAround(p.description, 0, 0, 200)) })
      if (p.relation === 'alt') prov.unshift({ where: 'Named by the owner as their account', url: profileUrl(p.userId), excerpt: null })
      const roleText = p.roles.length > 0 ? p.roles.map((r) => `${r.role} (rank ${r.rank})`).join(', ') : p.relation === 'alt' ? 'Account named by the owner' : 'No group role'
      const detail: CreatorDetail = {
        kind: 'creator',
        subject: 'person',
        game: gameName,
        fetchedAt,
        channel: null,
        person,
        publishedBy: [],
        confidence: 'Linked by the owner',
        unconfirmed: false,
        provenance: prov,
        invite: null,
        channels: list,
        changed: null,
        roles: p.relation === 'owner' && roleRows.length > 0 ? roleRows : null,
        rankReason: p.relation === 'owner' ? 'The person who owns the game. Channels they published are separate rows, ranked above this profile.' : p.relation === 'leader' ? 'Holds a leadership role in the owning group. Channels they published are separate rows, ranked above this profile.' : 'An account the owner says is theirs.',
        notCollected: NOT_COLLECTED,
      }
      rows.push({
        rank,
        kind: 'person',
        confidence: 'Linked by the owner',
        desc: `${p.username}, ${relationWord === 'Owner' ? 'the owner' : relationWord === 'Leader' ? `a leader (${roleText})` : 'an account the owner named'}, on Roblox`,
        finding: {
          id,
          badge: { label: relationWord, tone: 'ink' },
          title: houseStyle(`${p.username}${p.displayName && p.displayName.toLowerCase() !== p.username.toLowerCase() ? ` (${p.displayName})` : ''}, ${p.relation === 'owner' ? `owner of ${groupName || gameName}` : p.relation === 'leader' ? `leader of ${groupName}` : 'account named by the owner'}`),
          snippet: [{ text: houseStyle(`${roleText}. ${list.length === 0 ? 'No public channels found for them' : `${list.length} ${list.length === 1 ? 'channel' : 'channels'} published`}${p.profileRead ? '' : '. The profile text could not be read'}.`) }],
          meta: [
            { label: 'Role', value: relationWord },
            { label: 'Confidence', value: 'Linked by the owner' },
          ],
          status: statusOf(id, false),
          states: { contacted: { label: 'Contacted', tone: 'live' } },
          group: p.relation === 'leader' ? 'leadership' : 'owner',
          url: profileUrl(p.userId),
          detail,
        },
      })
    }

    rows.sort((a, b) => a.rank - b.rank || a.finding.title.localeCompare(b.finding.title))
    const count = (k: (r: Row) => boolean) => rows.filter(k).length
    const discordRows = rows.filter((r) => r.kind === 'discord')
    const liveServers = discordRows.filter((r) => (r.finding.detail as CreatorDetail).invite?.state === 'live').length
    const socialCount = count((r) => ['twitter', 'youtube', 'twitch', 'tiktok', 'instagram', 'facebook', 'guilded', 'linkhub'].includes(r.kind))
    const emailCount = count((r) => r.kind === 'email')
    const fresh = rows.filter((r) => r.finding.status.label === 'New' || r.finding.status.label === 'Changed').length

    // Notes: how this was counted.
    const sourceSummary = `Read the game description, ${groupName ? 'the group description, ' : ''}${peopleList.filter((p) => p.profileRead).length} profile descriptions and ${channelFields} profile channel fields on Roblox, ${pagesRead} web pages and ${searchesRun} web searches (Bing).`
    notes.unshift(sourceSummary)
    notes.push(
      socialSignedIn > 0
        ? 'Roblox only shows game and group social links to signed-in users, so these were read from public text and search instead.'
        : 'Roblox showed the game and group social links without a sign-in this time, and they were read as team text.',
    )
    if (altNamed > 0) notes.push(`Accounts the owner named were read one level deep: ${altFound} of ${altNamed} found on Roblox${altMissing.length ? ` (not found: ${altMissing.join(', ')})` : ''}.`)
    if (searchesRun > 0) {
      const withHits = queryHits.filter((q) => q.kept > 0).map((q) => q.query)
      notes.push(
        productive === 0
          ? `Web searches ran (${searchesOk} of ${searchesRun} answered) but none of the results named the game, so nothing from search was added. The search engine often returns unrelated pages for game names.`
          : `Searches that returned results naming the game: ${withHits.join(' | ')}. Search matches are marked unconfirmed unless the team's own text or Discord's invite lookup backs them.`,
      )
    }
    notes.push(`Discord invite lookups: ${liveCount} live, ${expiredCount} expired${unknownCount ? `, ${unknownCount} not answered` : ''}. An expired invite in the owner's own text is still listed.`)
    if (hasHistory) {
      const nowIds = new Set(rows.map((r) => r.finding.id))
      const gone = [...knownIds].filter((id) => !nowIds.has(id)).length
      if (gone > 0) notes.push(`${gone} ${gone === 1 ? 'item' : 'items'} from the last run ${gone === 1 ? 'was' : 'were'} not found this time.`)
    }
    for (const w of warnings) notes.push(w)

    const summary: RunSummary = {
      items: [
        { label: 'People found', value: String(peopleList.length), tone: peopleList.length > 0 ? 'live' : undefined },
        { label: 'Roles checked', value: rolesTotal ? `${rolesRead} of ${rolesTotal}` : 'No group' },
        { label: 'Discord servers', value: `${liveServers} of ${discordRows.length}`, tone: liveServers > 0 ? 'accent' : undefined },
        { label: 'Social links', value: String(socialCount) },
        { label: 'Emails published', value: String(emailCount), tone: emailCount > 0 ? 'live' : undefined },
        { label: 'New this run', value: hasHistory ? String(fresh) : 'First run', tone: fresh > 0 ? 'accent' : undefined },
      ],
      sortLabel: 'Best way to reach first',
      groups: [
        { id: 'owner', label: 'Owner' },
        { id: 'leadership', label: 'Leadership' },
        { id: 'discord', label: 'Discord' },
        { id: 'social', label: 'Social' },
        { id: 'email', label: 'Email' },
        { id: 'other', label: 'Other' },
      ],
      notes: notes.map(houseStyle),
      notices: [{ lead: 'Not collected:', body: NOT_COLLECTED_BODY }],
    }
    if (rows.length > 0) summary.notices!.push({ lead: 'Best route', body: houseStyle(`Start with ${rows[0].desc}. ${rows[0].confidence === 'Found by search' ? 'This is a search match and is not confirmed.' : rows[0].confidence === 'Verified invite' ? 'Discord resolved the invite and the server name or inviter matches the game.' : 'It comes from text the owner or team wrote themselves.'}`) })
    ctx.summary(summary)
    ctx.step('assemble', 'Ranking contact points', 'done', `${rows.length} contact points: ${peopleList.length} people, ${discordRows.length} Discord, ${socialCount} social, ${emailCount} email${hasHistory ? `, ${fresh} new` : ''}`)

    for (const r of rows) ctx.finding(r.finding)
    ctx.memory.set(MEMORY_KEY, { ids: rows.map((r) => r.finding.id), links: newLinks, at: fetchedAt })
    if (rows.length === 0) ctx.step('result', 'Result', 'done', `No contact points found for ${gameName}`)
  },
}

export { tool }

/* ------------------------------------------------------------------ small pieces */

/** Cuts at a word boundary and says so with an ellipsis; keeps a closing full stop. */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return /[.!?]$/.test(flat) ? flat : `${flat}.`
  const cut = flat.slice(0, max).replace(/\s+\S*$/, '').replace(/[.,;:!?-]+$/, '')
  return `${cut}...`
}

const roleWord = (r: CreatorRelation): string => (r === 'owner' ? 'Owner' : r === 'leader' ? 'Leader' : 'Owner account')

function rankReason(kind: ChannelKind, from: CreatorRelation | null, confidence: CreatorConfidence, inviterIsTeam: boolean, expired: boolean): string {
  if (expired) return 'Listed after working contacts: the invite no longer works, but it still shows what the team once linked.'
  if (kind === 'email') return 'Ranked first: an email address written out in public text is the most direct way to reach someone.'
  if (from === null) return kind === 'discord' ? (confidence === 'Verified invite' ? 'Ranked after the team\'s own links: found on a web page about the game, and Discord says the server is about the game or was made by a team member.' : 'Ranked after the team\'s own links: found by search, so it may belong to a fan community.') : 'Ranked last: found only by search and matched by name, so it is not confirmed.'
  if (kind === 'twitter' && from === 'owner') return 'Ranked high: the owner linked this X / Twitter account themselves.'
  if (kind === 'discord') return inviterIsTeam ? 'Ranked high: an owner or leader made this invite, or linked it, so staff are likely to be in it.' : confidence === 'Linked by the owner' ? 'Ranked high: the owner or a leader linked this server themselves.' : 'Ranked after the team\'s own links.'
  return from === 'leader' ? 'A leader published this channel, so it ranks after the owner\'s own channels.' : 'The owner published this channel themselves.'
}

interface ResolvedInvite {
  code: string
  state: 'live' | 'expired' | 'unknown'
  guildId: string | null
  name: string | null
  description: string | null
  members: number | null
  online: number | null
  features: string[]
  inviter: CreatorInvite['inviter']
  expiresAt: string | null
}

/** Discord's public invite lookup (no token). 404 means the invite is gone; anything else that fails is "unknown", never "expired". */
async function resolveInvite(code: string, signal: AbortSignal): Promise<ResolvedInvite> {
  const blank: ResolvedInvite = { code, state: 'unknown', guildId: null, name: null, description: null, members: null, online: null, features: [], inviter: null, expiresAt: null }
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response
    try {
      res = await fetch(`${apiBase()}/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`, { headers: { accept: 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) })
    } catch {
      if (signal.aborted) throw new RunError('aborted', 'The run was cancelled.')
      return blank
    }
    if (res.status === 404) {
      await res.arrayBuffer().catch(() => undefined)
      return { ...blank, state: 'expired' }
    }
    if (res.status === 429) {
      const wait = Math.min(Math.ceil(Number(res.headers.get('retry-after')) || 3), 20)
      await res.arrayBuffer().catch(() => undefined)
      if (attempt === 0) {
        await sleep(wait * 1000, signal)
        continue
      }
      return blank
    }
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined)
      return blank
    }
    const body = obj(await res.json().catch(() => null))
    const guild = obj(body.guild)
    if (!str(guild.id) || !str(guild.name)) return { ...blank, state: 'live', name: 'A Discord invite that is not for a server', description: null }
    const inv = obj(body.inviter)
    return {
      code,
      state: 'live',
      guildId: str(guild.id),
      name: decodeEntities(str(guild.name)),
      description: str(guild.description).trim() || null,
      members: typeof body.approximate_member_count === 'number' ? body.approximate_member_count : null,
      online: typeof body.approximate_presence_count === 'number' ? body.approximate_presence_count : null,
      features: arr(guild.features).filter((f): f is string => typeof f === 'string'),
      inviter: str(inv.id) && str(inv.username) ? { id: str(inv.id), username: str(inv.username), displayName: str(inv.global_name) || null } : null,
      expiresAt: str(body.expires_at) || null,
    }
  }
  return blank
}

