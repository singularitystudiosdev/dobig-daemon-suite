import { Mail, Megaphone } from 'lucide-react'
import { Badge, EmptyState, KeyValue } from '@/components/ui'
import { fmtPct } from '@/lib/format'
import { CopyButton } from '../bits'
import { fmtReach } from '../data'
import type { TabProps } from './Overview'

export function Outreach({ creator, game, onNavigate }: TabProps) {
  const d = creator.dossier
  const email = d.publicBusinessEmail
  const points = creator.talkingPoints

  return (
    <div className="flex flex-col gap-24">
      <div className="grid gap-24 md:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-title font-bold text-ink">Public business contact</h3>
          <p className="mt-4 max-w-prose text-label text-muted">
            Taken from the channel About page only. Creator Dox never guesses an address, and it never uses a personal inbox.
          </p>
          {email ? (
            <div className="mt-12 rounded-8 border border-line bg-raised p-16">
              <div className="flex flex-wrap items-center justify-between gap-12">
                <span className="min-w-0 break-all font-mono text-label text-ink">{email}</span>
                <CopyButton text={email} />
              </div>
              <dl className="mt-12">
                <KeyValue label="Source" value="Channel About page" />
                <KeyValue label="Scope" value="Business enquiries only" />
                <KeyValue label="Personal inbox" value="Never used" />
              </dl>
            </div>
          ) : (
            <EmptyState
              icon={Mail}
              sentence="This channel lists no business email on its About page, so there is no public contact to copy."
              actionLabel="Check the audience tab"
              onAction={() => onNavigate('audience')}
            />
          )}
        </div>

        <div className="min-w-0">
          <h3 className="text-title font-bold text-ink">The deal at a glance</h3>
          <p className="mt-4 max-w-prose text-label text-muted">
            Everything a partnerships lead needs before the first message, in one block.
          </p>
          <dl className="mt-12">
            <KeyValue label="Grade" value={d.grade} />
            <KeyValue label="Subscribers" value={fmtReach(d.subscribers)} />
            <KeyValue label="Real reach" value={`about ${fmtReach(Math.round(d.subscribers * (d.credibilityPct / 100)))}`} />
            <KeyValue label="Organic ER" value={fmtPct(d.erOrganic)} />
            <KeyValue label="Sponsored ER" value={fmtPct(d.erSponsored)} />
            <KeyValue label="Game fit" value={`${d.gameFitPct[game.id] ?? 0}% ${game.shortName}`} />
          </dl>
          <div className="mt-12 flex flex-wrap items-center gap-8">
            <Badge tone={d.cqs.total >= 74 ? 'live' : 'warn'}>{d.cqs.total >= 74 ? 'Worth a paid test' : 'Vet before paying'}</Badge>
            <Badge tone="muted">Risk checked</Badge>
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-8">
          <h3 className="text-title font-bold text-ink">Suggested brief talking points</h3>
          <Megaphone aria-hidden className="size-16 text-muted" />
        </div>
        {points.length > 0 ? (
          <ul className="mt-12 flex list-disc flex-col gap-8 pl-16 text-label text-muted">
            {points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Megaphone}
            sentence="No talking points survived the dossier, so there is no brief to send."
            actionLabel="Open the overview tab"
            onAction={() => onNavigate('overview')}
          />
        )}
      </div>

    </div>
  )
}
