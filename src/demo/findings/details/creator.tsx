import type { ReactNode } from 'react'
import { Check, Copy, ExternalLink, Undo2 } from 'lucide-react'
import { Badge, Button, KeyValue, Table, Td, Th, useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { CreatorConfidence, CreatorDetail, CreatorInvite, CreatorProvenance, CreatorRelation } from '@/lib/details/creator'
import { fmtInt } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import type { DetailViewProps } from './types'

/* Creator Dox detail: one way to reach the people behind a game, or one person on the team. Everything shown was read
   from public text the owner or team wrote, from Discord's public invite lookup, or from a public web search during the
   run. Each contact says exactly where it was found, with the link and a short quote. */

const confTone: Record<CreatorConfidence, Tone> = { 'Linked by the owner': 'live', 'Verified invite': 'accent', 'Found by search': 'muted' }
const confMeaning: Record<CreatorConfidence, string> = {
  'Linked by the owner': 'The owner or a team member wrote or linked this themselves, in a profile, a group or game description, or a channel they listed.',
  'Verified invite': 'Discord resolved this invite, and the server name or the person who made the invite matches the game or its team.',
  'Found by search': 'A public web search matched it by name. It has not been confirmed to belong to the team.',
}
const personMeaning: Record<CreatorRelation, string> = {
  owner: 'Listed by Roblox as the registered owner of the group that made the game, or as its publisher.',
  leader: 'Listed by Roblox as a member of a leadership role in the group that made the game.',
  alt: 'The owner wrote this account name in their own profile text as one of their accounts.',
}
const relationWord: Record<CreatorRelation, string> = { owner: 'Owner', leader: 'Leader', alt: 'Account named by the owner' }

function Section({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-8', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-12 gap-y-2">
        <h3 className="text-label font-medium text-muted">{label}</h3>
        {hint && <span className="text-micro text-subtle">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function ExactLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" title={href} className="inline-flex min-w-0 max-w-full items-start gap-6 rounded-8 text-micro text-accent-ink hover:underline">
      <ExternalLink aria-hidden className="mt-2 size-12 shrink-0" />
      <span className="min-w-0 break-all">{children ?? href}</span>
    </a>
  )
}

function Provenance({ items }: { items: CreatorProvenance[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((p) => (
        <li key={`${p.url}|${p.where}`} className="flex min-w-0 flex-col gap-6 border-b border-line py-8 first:pt-0 last:border-b-0">
          <span className="text-label text-ink">{p.where}</span>
          {p.excerpt && <p className="max-w-prose break-words rounded-8 bg-raised px-12 py-8 text-label text-ink">&ldquo;{p.excerpt}&rdquo;</p>}
          <ExactLink href={p.url} />
        </li>
      ))}
    </ul>
  )
}

const dayTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' })

function InviteFacts({ invite }: { invite: CreatorInvite }) {
  if (invite.state === 'expired') {
    return (
      <p className="max-w-prose text-label text-ink">
        Discord says this invite is gone: it expired or was deleted. It is still listed because the team once linked it, and the server may have a newer invite somewhere else.
      </p>
    )
  }
  if (invite.state === 'unknown') return <p className="max-w-prose text-label text-warn">Discord did not answer for this invite, so its server details are not available. Run again to retry.</p>
  return (
    <div className="flex flex-col gap-8">
      <dl>
        <KeyValue label="Server" value={invite.name ?? 'Not available'} />
        <KeyValue label="Members" value={<span className="tabular">{invite.members === null ? 'Not available' : fmtInt(invite.members)}</span>} />
        <KeyValue label="Online now" value={<span className="tabular">{invite.online === null ? 'Not available' : fmtInt(invite.online)}</span>} />
        <KeyValue
          label="Discord status"
          value={
            invite.verified || invite.partnered || invite.community ? (
              <span className="flex flex-wrap justify-end gap-6">
                {invite.verified && <Badge tone="accent">Verified</Badge>}
                {invite.partnered && <Badge tone="accent">Partnered</Badge>}
                {invite.community && <Badge tone="muted">Community</Badge>}
              </span>
            ) : (
              'Not verified or partnered'
            )
          }
        />
        <KeyValue label="Invite" value={invite.expiresAt ? `Stops working ${dayTime(invite.expiresAt)}` : 'Does not expire'} />
        <KeyValue label="Made by" value={invite.inviter ? (invite.inviter.displayName && invite.inviter.displayName.toLowerCase() !== invite.inviter.username.toLowerCase() ? `${invite.inviter.displayName} (${invite.inviter.username})` : invite.inviter.username) : 'Discord did not say'} />
      </dl>
      {invite.inviterMatch && (
        <p className="max-w-prose rounded-8 bg-raised px-12 py-8 text-label text-ink">
          The inviter&apos;s Discord name is the same text as the Roblox name {invite.inviterMatch.username}, a member of the team. That is a name match only. Nothing confirms it is the same person.
        </p>
      )}
      {invite.description && <p className="max-w-prose text-label text-muted">{invite.description}</p>}
      {invite.otherCodes.length > 0 && (
        <div className="flex flex-col gap-4">
          <span className="text-label text-muted">Other invite links to the same server</span>
          {invite.otherCodes.map((c) => (
            <ExactLink key={c} href={`https://discord.gg/${c}`} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function CreatorDetailView({ detail: d, state, act }: DetailViewProps<CreatorDetail>) {
  const toast = useToast()
  const contacted = state === 'contacted'
  const fetched = d.fetchedAt.slice(0, 16).replace('T', ' ')

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.push({ title: `${what} copied`, description: text, tone: 'ok' })
    } catch {
      toast.push({ title: 'Could not copy', description: 'Select the text and copy it by hand.', tone: 'warn' })
    }
  }

  const person = d.person
  const channel = d.channel
  const copyText = channel ? (channel.kind === 'email' ? channel.handle : channel.url) : null
  const copyWhat = channel ? (channel.kind === 'email' ? 'Email address' : channel.kind === 'discord' ? 'Invite link' : 'Link') : ''

  return (
    <div className="flex flex-col gap-16">
      <header className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-center gap-x-12 gap-y-6">
          <h3 className="min-w-0 break-words text-title font-medium text-ink">{person ? (person.displayName && person.displayName !== person.username ? `${person.displayName} (${person.username})` : person.username) : channel ? `${channel.label}: ${channel.kind === 'discord' ? (d.invite?.name ?? channel.handle) : channel.handle}` : ''}</h3>
          <Badge tone={confTone[d.confidence]}>{d.confidence}</Badge>
          {person && <Badge tone="ink">{relationWord[person.relation]}</Badge>}
          {d.changed && <Badge tone="warn">Changed link</Badge>}
          {contacted && (
            <Badge tone="live" dot pulse={false}>
              Contacted
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-12 gap-y-6">
          <ExactLink href={person ? person.profileUrl : (channel?.url ?? '')} />
          {copyText && (
            <Button size="sm" icon={Copy} aria-label={`Copy ${copyWhat.toLowerCase()} ${copyText}`} onClick={() => void copy(copyText, copyWhat)}>
              Copy {copyWhat.toLowerCase()}
            </Button>
          )}
        </div>
        <p className="max-w-prose text-label text-muted">{person ? personMeaning[person.relation] : confMeaning[d.confidence]}</p>
        {d.changed && <p className="max-w-prose text-label text-warn">Different from the last run. It was {d.changed.was}.</p>}
        <p className="text-micro text-subtle">
          Read from public pages at {fetched} UTC for {d.game}. {d.rankReason}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-24 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-16">
          <Section label="Where it was found" hint={`${d.provenance.length} ${d.provenance.length === 1 ? 'place' : 'places'}`}>
            <Provenance items={d.provenance} />
            {d.unconfirmed && <p className="max-w-prose text-label text-warn">This is a search match by name and is not confirmed. Check the page before you write to anyone.</p>}
          </Section>

          {d.channel && (
            <Section label="Who published it">
              {d.publishedBy.length === 0 ? (
                <p className="text-label text-muted">No one on the team is tied to it. It came from a public web page.</p>
              ) : (
                <ul className="flex flex-col">
                  {d.publishedBy.map((p) => (
                    <li key={p.userId} className="flex flex-wrap items-baseline justify-between gap-x-12 gap-y-2 border-b border-line py-8 first:pt-0 last:border-b-0">
                      <span className="text-label text-ink">
                        {p.displayName && p.displayName !== p.username ? `${p.displayName} (${p.username})` : p.username}
                        <span className="text-muted">, {relationWord[p.relation].toLowerCase()}</span>
                      </span>
                      <ExactLink href={p.profileUrl} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {person && (
            <Section label="Roles held">
              {person.roles.length === 0 ? (
                <p className="text-label text-muted">{person.relation === 'alt' ? 'No group role is attached to this account.' : 'No group role.'}</p>
              ) : (
                <ul className="flex flex-col">
                  {person.roles.map((r) => (
                    <li key={`${r.group}|${r.role}`} className="flex items-baseline justify-between gap-12 border-b border-line py-8 first:pt-0 last:border-b-0">
                      <span className="min-w-0 text-label text-ink">
                        {r.role} <span className="text-muted">in {r.group}</span>
                      </span>
                      <span className="tabular shrink-0 text-label text-muted">Rank {r.rank}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="max-w-prose text-label text-muted">{person.reason}</p>
            </Section>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-16">
          {d.invite && (
            <Section label="Discord server" hint="Resolved through Discord's public invite lookup">
              <InviteFacts invite={d.invite} />
            </Section>
          )}

          {person && (
            <Section label="Channels found for this person" hint={`${d.channels.length} found`}>
              {d.channels.length === 0 ? (
                <p className="max-w-prose text-label text-muted">None. Nothing on their Roblox profile, in their profile text or on the pages they linked names a public channel.</p>
              ) : (
                <ul className="flex flex-col">
                  {d.channels.map((c) => (
                    <li key={`${c.kind}|${c.url}`} className="flex min-w-0 flex-col gap-2 border-b border-line py-8 first:pt-0 last:border-b-0">
                      <span className="flex flex-wrap items-center gap-8">
                        <span className="text-label text-ink">{c.label}</span>
                        <Badge tone={confTone[c.confidence]}>{c.confidence}</Badge>
                      </span>
                      <ExactLink href={c.url} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {d.roles && d.roles.length > 0 && (
            <Section label="Group roles checked" hint="Highest rank first">
              <Table caption="Roles in the owning group and whether their members were read as leaders">
                <thead>
                  <tr>
                    <Th>Role</Th>
                    <Th numeric>Rank</Th>
                    <Th numeric>Members</Th>
                    <Th>Read as leaders</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.roles.map((r) => (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap text-ink">{r.name}</Td>
                      <Td numeric>{r.rank}</Td>
                      <Td numeric>{fmtInt(r.memberCount)}</Td>
                      <Td className="min-w-160 whitespace-normal text-muted">{r.leader ? `Yes. ${r.why}` : `No. ${r.why}`}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="text-micro text-subtle">Roles with no members are not listed. Leaders are the members of the roles marked yes. Roblox hides the top Owner role, so the registered owner of the group is added separately.</p>
            </Section>
          )}

          {channel && !d.invite && (
            <Section label="Link">
              <dl>
                <KeyValue label="Channel" value={channel.label} />
                <KeyValue label={channel.kind === 'email' ? 'Address' : 'Handle'} value={channel.handle} mono />
                <KeyValue label="Exact link" value={<span className="break-all">{channel.url}</span>} mono />
              </dl>
              {channel.kind === 'email' && <p className="max-w-prose text-micro text-subtle">This address is written out in public text, quoted on the left. It was never guessed or built from a name.</p>}
            </Section>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-12 border-t border-line pt-12">
        {contacted ? (
          <>
            <Badge tone="live" dot pulse={false}>
              Contacted
            </Badge>
            <Button size="sm" icon={Undo2} onClick={() => act('open')}>
              Reopen
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" icon={Check} onClick={() => act('contacted')}>
            Mark contacted
          </Button>
        )}
        <span className="text-micro text-subtle">Kept in this list only. Nothing is sent to anyone.</span>
      </div>
      <p className="text-micro text-subtle">{d.notCollected}</p>
    </div>
  )
}
