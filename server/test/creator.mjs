// Creator Dox against REAL Roblox, Discord and web search (no LLM, no key needed):
//   node server/test/creator.mjs [steal|mm2|all]
// For each game it runs the analyzer with a fake RunContext, prints the first findings, and checks:
//   every URL is well formed and on an expected host class, every email appears verbatim in text this run fetched,
//   every Discord finding was resolved or is marked expired, people are unique by userId, leaders are exactly the members
//   of the top-ranked or name-matched roles, a rerun marks nothing New that run 1 already had, no em dashes or middle dots,
//   and no private-data words or phone numbers in anything shown.
// CREATOR_DUMP=<file> also writes run 1's events as JSON.
import { writeFileSync } from 'node:fs'
import { tool } from '../tools/creator.ts'
import { extractEmails, extractInvites, extractLinks, findAltUsernames, parseLooseJson, pickLeaderRoles } from '../tools/creator-contacts.ts'

const GAMES = {
  steal: { universeId: 10563114921, placeId: 107778070777162, name: 'Steal An Egg' },
  mm2: { universeId: 66654135, placeId: 142823291, name: 'Murder Mystery 2' },
}
const which = process.argv[2] ?? 'all'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

/* ---- unit-level checks on the pure helpers ---- */
{
  const t = "Hi I'm Ben. My other roblox accounts are MisfitsBS, MisfitsBStoo, and MisfitsBStheFourth! twitter: @misfitsbs join discord.gg/abc-DEF or https://discord.com/invite/Xy12 and discordapp.com/invite/zzz9. mail ben@example.org. Not an email: name at gmail dot com. x.com/share x.com/home youtube.com/@Cool_Chan"
  check('invites: three forms, case kept', JSON.stringify(extractInvites(t).map((h) => h.value.code)) === JSON.stringify(['abc-DEF', 'Xy12', 'zzz9']))
  check('emails: verbatim only, no guesses', JSON.stringify(extractEmails(t).map((h) => h.value)) === JSON.stringify(['ben@example.org']))
  const links = extractLinks(t).map((h) => `${h.value.kind}:${h.value.handle}`)
  check('links: handle, keyword form and youtube; share and home are not handles', links.includes('twitter:misfitsbs') && links.includes('youtube:@Cool_Chan') && !links.some((l) => /share|home/.test(l)), links.join(' '))
  check('alt accounts: list after "my other roblox accounts are"', JSON.stringify(findAltUsernames(t)) === JSON.stringify(['MisfitsBS', 'MisfitsBStoo', 'MisfitsBStheFourth']))
  check('loose JSON: raw newline inside a string', parseLooseJson('{"description":"a\nb"}')?.description === 'a\nb')
  const roles = [
    { id: 1, name: 'Guest', rank: 0, memberCount: 0 },
    { id: 2, name: 'Member', rank: 1, memberCount: 1000, isBase: true },
    { id: 3, name: 'Owner', rank: 1, memberCount: 1 },
    { id: 4, name: 'Misfits', rank: 18, memberCount: 3 },
    { id: 5, name: 'Admin', rank: 254, memberCount: 0 },
    { id: 6, name: 'Lead Animator', rank: 5, memberCount: 2 },
    { id: 7, name: 'Fans', rank: 3, memberCount: 900 },
  ]
  check('leader roles: name match, top rank with members, never empty or mass roles', JSON.stringify(pickLeaderRoles(roles).map((l) => l.role.name).sort()) === JSON.stringify(['Lead Animator', 'Misfits', 'Owner']))
}

/* ---- record every body the run fetches ---- */
let corpus = ''
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const res = await realFetch(input, init)
  try {
    const type = res.headers.get('content-type') ?? ''
    if (/text|json|xml/i.test(type)) corpus += '\n' + (await res.clone().text()).slice(0, 1_500_000)
  } catch {
    /* body unreadable */
  }
  return res
}

function makeCtx(target, memStore, previous = []) {
  const events = { steps: [], findings: [], summary: null }
  const ac = new AbortController()
  const ctx = {
    tool: 'creator-dox',
    target: { kind: 'roblox-game', ...target },
    trigger: 'user',
    runId: 'test',
    daemonId: 'test',
    now: new Date(),
    signal: ac.signal,
    step: (id, label, state, detail) => {
      events.steps.push({ id, label, state, detail })
      if (state !== 'active') console.log(`  step ${state.padEnd(6)} ${label}${detail ? ' :: ' + detail : ''}`)
    },
    summary: (s) => (events.summary = s),
    finding: (f) => events.findings.push(JSON.parse(JSON.stringify(f))),
    llm: { model: 'none', json: async () => { throw new Error('Creator Dox does not use the LLM') } },
    secrets: { get: () => null, has: () => false },
    memory: { get: (k) => (memStore.has(k) ? JSON.parse(memStore.get(k)) : undefined), set: (k, v) => memStore.set(k, JSON.stringify(v)) },
    previous,
  }
  return { ctx, events }
}

const HOSTS = [/(^|\.)roblox\.com$/, /^discord\.gg$/, /^(x|twitter)\.com$/, /(^|\.)youtube\.com$/, /(^|\.)twitch\.tv$/, /(^|\.)tiktok\.com$/, /(^|\.)instagram\.com$/, /(^|\.)facebook\.com$/, /(^|\.)guilded\.(gg|com)$/]
const PRIVATE_WORDS = /\b(home address|street address|phone number|telephone|\bssn\b|social security|password|passwd|cookie|\.roblosecurity|leaked|dox(?:x)?ed)\b/i
const PHONE = /(?:\+\d[\d\s().-]{8,}\d|\(\d{3}\)\s?\d{3}[-.\s]\d{4}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/

async function robloxJson(url) {
  for (let i = 0; i < 4; i++) {
    const r = await realFetch(url, { headers: { accept: 'application/json' } })
    if (r.status === 429) {
      await new Promise((ok) => setTimeout(ok, 5000))
      continue
    }
    return parseLooseJson(await r.text())
  }
  return null
}

async function runGame(label, target) {
  console.log(`\n=== ${label} ===`)
  corpus = ''
  const mem = new Map()
  const t0 = Date.now()
  const { ctx, events } = makeCtx(target, mem)
  await tool.analyze(ctx)
  console.log(`run 1 took ${Math.round((Date.now() - t0) / 1000)}s`)
  if (process.env.CREATOR_DUMP) writeFileSync(process.env.CREATOR_DUMP, JSON.stringify({ summary: events.summary, findings: events.findings, steps: events.steps }, null, 1))
  const F = events.findings
  console.log('summary:', events.summary.items.map((i) => `${i.label}=${i.value}`).join(' | '))
  console.log('sort:', events.summary.sortLabel)
  for (const n of events.summary.notices ?? []) console.log(`notice: ${n.lead} ${n.body}`)
  for (const n of events.summary.notes ?? []) console.log('note:', n)
  console.log(`findings (${F.length}), first 10:`)
  for (const f of F.slice(0, 10)) console.log(`  [${f.badge.label}] ${f.title} | ${f.snippet.map((s) => s.text).join('')} | ${f.meta.map((m) => `${m.label}: ${m.value}`).join('; ')} | ${f.url} | ${f.status.label} | ${f.group}`)

  // steps
  const ids = new Set(events.steps.map((s) => s.id))
  check(`${label}: steps game, group, roles, profiles, channels, text, search, invites, assemble`, ['game', 'group', 'roles', 'profiles', 'channels', 'text', 'search', 'invites', 'assemble'].every((i) => ids.has(i)))
  check(`${label}: every step ends done or warn`, [...ids].every((i) => { const last = [...events.steps].reverse().find((s) => s.id === i); return last && (last.state === 'done' || last.state === 'warn') }))
  check(`${label}: summary has the six items and the sort label`, events.summary.items.map((i) => i.label).join('|') === 'People found|Roles checked|Discord servers|Social links|Emails published|New this run' && events.summary.sortLabel === 'Best way to reach first')
  check(`${label}: Not collected notice kept`, events.summary.notices.some((n) => n.lead === 'Not collected:' && n.body === 'home address, phone, family, private data. Contacts only if the owner published them.'))
  check(`${label}: Best route notice present with findings`, F.length === 0 || events.summary.notices.some((n) => n.lead === 'Best route'))
  check(`${label}: found people`, F.some((f) => f.detail.subject === 'person'))

  // urls
  const badUrl = []
  for (const f of F) {
    const u = f.url
    try {
      if (u.startsWith('mailto:')) {
        if (!/^mailto:[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(u)) badUrl.push(u)
        continue
      }
      const p = new URL(u)
      if (!/^https?:$/.test(p.protocol)) badUrl.push(u)
      else if (f.detail.channel?.kind === 'website') {
        if (!corpus.toLowerCase().includes(p.hostname.toLowerCase())) badUrl.push(u + ' (website not seen in fetched text)')
      } else if (!HOSTS.some((re) => re.test(p.hostname.replace(/^www\./, '')))) badUrl.push(u)
      if (f.detail.channel?.kind === 'discord' && !/^https:\/\/discord\.gg\/[A-Za-z0-9-]+$/.test(u)) badUrl.push(u + ' (discord shape)')
      if (f.detail.channel?.kind === 'twitter' && !/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/.test(u)) badUrl.push(u + ' (x shape)')
    } catch {
      badUrl.push(u)
    }
  }
  check(`${label}: every URL well formed and on an expected host`, badUrl.length === 0, badUrl.join(', '))

  // emails
  const emails = F.filter((f) => f.detail.channel?.kind === 'email')
  const unseen = emails.filter((f) => !corpus.includes(f.detail.channel.handle))
  check(`${label}: ${emails.length} emails, each verbatim in fetched public text`, unseen.length === 0, unseen.map((f) => f.detail.channel.handle).join(', '))
  check(`${label}: every email shows where it was found`, emails.every((f) => f.detail.provenance.length > 0 && f.detail.provenance.every((p) => /^https?:\/\//.test(p.url) && p.excerpt && p.excerpt.includes(f.detail.channel.handle))))

  // discord
  const discord = F.filter((f) => f.detail.channel?.kind === 'discord')
  check(`${label}: ${discord.length} Discord rows each resolved or marked expired`, discord.every((f) => (f.detail.invite.state === 'live' && f.detail.invite.name) || (f.detail.invite.state === 'expired' && f.badge.label === 'Expired invite')), discord.map((f) => f.detail.invite.state).join(','))
  check(`${label}: a Discord invite found only by search is marked unconfirmed`, discord.every((f) => f.detail.confidence !== 'Found by search' || f.detail.unconfirmed))

  // confidence and provenance on every row
  check(`${label}: every row has a confidence word and provenance with a link`, F.every((f) => ['Linked by the owner', 'Verified invite', 'Found by search'].includes(f.detail.confidence) && f.detail.provenance.length > 0 && f.detail.provenance.every((p) => /^https?:\/\//.test(p.url) && (p.excerpt === null || p.excerpt.length <= 200))))
  check(`${label}: search-only rows say unconfirmed`, F.every((f) => (f.detail.confidence === 'Found by search') === f.detail.unconfirmed || f.detail.confidence === 'Verified invite'))

  // people
  const persons = F.filter((f) => f.detail.subject === 'person')
  const idsSeen = persons.map((f) => f.detail.person.userId)
  check(`${label}: ${persons.length} people, unique by userId`, new Set(idsSeen).size === idsSeen.length)
  const leaderIds = persons.filter((f) => f.detail.person.relation === 'leader' || (f.detail.person.relation === 'owner' && f.detail.person.roles.some((r) => r.role !== 'Group owner'))).map((f) => f.detail.person.userId)
  if (target.groupId) {
    const roles = (await robloxJson(`https://groups.roblox.com/v1/groups/${target.groupId}/roles`)).roles.map((r) => ({ id: r.id, name: r.name, rank: r.rank, memberCount: r.memberCount, isBase: r.isBase === true }))
    const expected = new Set()
    for (const l of pickLeaderRoles(roles)) {
      const m = await robloxJson(`https://groups.roblox.com/v1/groups/${target.groupId}/roles/${l.role.id}/users?limit=25&sortOrder=Asc`)
      for (const u of m.data) expected.add(u.userId ?? u.user?.userId)
    }
    const got = new Set(leaderIds)
    const missing = [...expected].filter((id) => !got.has(id))
    const extra = [...got].filter((id) => !expected.has(id))
    check(`${label}: leaders are exactly the members of top-ranked or name-matched roles (${expected.size})`, missing.length === 0 && extra.length === 0, `missing ${missing.join(',')} extra ${extra.join(',')}`)
  } else {
    const owner = persons.find((f) => f.detail.person.relation === 'owner')
    check(`${label}: user-owned game: the owner is the publisher and there are no leaders`, Boolean(owner) && leaderIds.length === 0 && events.steps.some((s) => s.id === 'group' && /not a group/.test(s.detail ?? '')))
  }

  // style and privacy
  const shown = JSON.stringify(F.map((f) => ({ ...f, detail: { ...f.detail, notCollected: '' } })))
  const everything = JSON.stringify({ F, summary: events.summary, steps: events.steps })
  check(`${label}: no em dashes or middle dots in anything generated`, !/[—·]/.test(everything))
  check(`${label}: no private-data words in what is shown`, !PRIVATE_WORDS.test(shown), (PRIVATE_WORDS.exec(shown) ?? [])[0] ?? '')
  check(`${label}: no phone-number shapes in what is shown`, !PHONE.test(shown), (PHONE.exec(shown) ?? [])[0] ?? '')
  check(`${label}: ids are unique`, new Set(F.map((f) => f.id)).size === F.length)

  // rerun: same memory, previous findings
  const { ctx: ctx2, events: ev2 } = makeCtx(target, mem, F)
  const t1 = Date.now()
  await tool.analyze(ctx2)
  console.log(`run 2 took ${Math.round((Date.now() - t1) / 1000)}s`)
  const before = new Set(F.map((f) => f.id))
  const flagged = ev2.findings.filter((f) => before.has(f.id) && (f.status.label === 'New' || f.status.label === 'Changed'))
  check(`${label}: rerun marks nothing New or Changed that run 1 had`, flagged.length === 0, flagged.map((f) => f.id).join(','))
  const fresh2 = ev2.findings.filter((f) => !before.has(f.id))
  console.log(`rerun: ${ev2.findings.length} findings, ${fresh2.length} not in run 1 ${fresh2.map((f) => f.id).join(', ')}`)
  console.log('rerun summary:', ev2.summary.items.map((i) => `${i.label}=${i.value}`).join(' | '))
  check(`${label}: rerun New this run matches its new rows`, ev2.summary.items.find((i) => i.label === 'New this run').value === String(ev2.findings.filter((f) => f.status.label === 'New' || f.status.label === 'Changed').length))
}

const picks = which === 'all' ? ['steal', 'mm2'] : [which]
for (const k of picks) {
  const g = GAMES[k]
  // the owning group, so leaders can be checked independently
  const game = (await robloxJson(`https://games.roblox.com/v1/games?universeIds=${g.universeId}`)).data[0]
  await runGame(g.name, { ...g, groupId: game.creator.type === 'Group' ? game.creator.id : 0 })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
