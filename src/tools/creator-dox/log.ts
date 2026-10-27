/* Scripted daemon log for the Creator Dox run. Each line carries an absolute `at` offset in
   scripted ms; the page filters with revealed(lines, sim) and prints the timestamp with
   fmtLogTime(offset), so the log reads as a real run clock and replays deterministically.
   Every call named here is a YouTube Data API v3 read of public channel data. */

import { fmtCompact, fmtInt } from '@/lib/format'
import type { Creator } from './data'
import type { Game } from '@/data/games'

export interface LogEntry {
  id: string
  at: number
  level: 'info' | 'ok' | 'warn' | 'error' | 'dim' | 'cmd'
  text: string
}

export function logLines(creator: Creator, game: Game): LogEntry[] {
  const d = creator.dossier
  const id = d.channelId
  const shortId = `${id.slice(0, 5)}...${id.slice(-3)}`
  const handle = d.handle
  const playlist = `UU${id.slice(2, 8)}...`
  const apiPaid = creator.uploads.filter((u) => u.hasPaidProductPlacement).length
  const mentions = creator.uploads.filter((u) => u.detectedMention).length
  const sortedViews = creator.uploads.map((u) => u.viewCount).sort((a, b) => a - b)
  const medianViews = sortedViews[Math.floor(sortedViews.length / 2)] ?? 0
  const topViews = sortedViews[sortedViews.length - 1] ?? 0
  const lines: Array<[number, LogEntry['level'], string]> = [
    // resolve, 0 to 1500
    [20, 'cmd', 'GET channels.list?part=snippet,statistics'],
    [130, 'dim', `forHandle=${handle}`],
    [280, 'info', '200 OK channels.list, 1 item, quota 1 unit'],
    [540, 'info', `handle resolved to ${shortId}`],
    [760, 'dim', `socialblade snapshot: grade ${d.grade}, rank #${fmtInt(d.sbRank)}`],
    [1080, 'ok', 'identity locked to one public channel'],
    [1380, 'dim', 'dossier scope: public analytics and the public About page only'],

    // stats, 1500 to 3500
    [1620, 'cmd', 'GET channels.list?part=statistics'],
    [1880, 'info', `statistics.subscriberCount ${fmtInt(d.subscribers)}`],
    [2080, 'info', `statistics.viewCount ${fmtInt(d.totalViews)}`],
    [2280, 'info', `statistics.videoCount ${fmtInt(d.uploads)}`],
    [2560, 'dim', `rank ticks from #${fmtInt(Math.round(d.sbRank * 7.4))} to #${fmtInt(d.sbRank)}`],
    [3020, 'ok', 'channel statistics cached, refreshed weekly'],

    // crawl, 3500 to 7500
    [3620, 'cmd', 'GET playlistItems.list?part=contentDetails'],
    [3740, 'dim', `playlistId=${playlist} maxResults=50`],
    [3920, 'info', '48 uploads in window, 2 private entries skipped'],
    [4280, 'cmd', 'GET videos.list?part=statistics,contentDetails,status'],
    [4610, 'warn', 'videos.list 403 quotaExceeded, retry 1 of 3 in 900ms'],
    [5520, 'info', '200 OK videos.list, 48 items, quota 48 units'],
    [5980, 'info', 'contentDetails.duration parsed, status.madeForKids read'],
    [6420, 'dim', `median views ${fmtInt(medianViews)}, top upload ${fmtInt(topViews)}`],
    [7060, 'ok', 'upload crawl complete, 48 public uploads'],

    // sponsor, 7500 to 12000
    [7620, 'cmd', 'GET videos.list?part=paidProductPlacementDetails'],
    [7980, 'info', `paidProductPlacementDetails.hasPaidProductPlacement true on ${apiPaid}`],
    [8360, 'info', `description scan found ${mentions} undeclared brand ${mentions === 1 ? 'mention' : 'mentions'}`],
    [8840, 'warn', `sponsored ER ${(d.erSponsored * 100).toFixed(1)}% against organic ${(d.erOrganic * 100).toFixed(1)}%`],
    [9420, 'dim', 'paid uploads split out of the organic lane'],
    [10220, 'ok', 'sponsorship split stamped, comparison written to the dossier'],

    // audience, 12000 to 14500
    [12120, 'cmd', `GET search.list?part=snippet&q=${game.shortName}`],
    [12300, 'dim', 'audience model v4, aggregate estimates only, no personal data read'],
    [12540, 'info', `modelled age band 13-17 at ${creator.ageBands[0].pct}%, 18-24 at ${creator.ageBands[1].pct}%`],
    [13140, 'info', `modelled country mix: ${creator.countries[0].name} ${creator.countries[0].pct}%, ${creator.countries[1].name} ${creator.countries[1].pct}%`],
    [13880, 'ok', 'audience estimates tagged modelled, refreshed monthly'],

    // credibility, 14500 to 17500
    [14620, 'cmd', 'GET channels.list?part=statistics'],
    [15100, 'info', '1,000-dot sample drawn from the subscriber field'],
    [15740, 'warn', `${100 - d.credibilityPct}% of the sample carries no watch history, estimated non-human`],
    [16420, 'info', `reach re-read ${fmtCompact(d.subscribers)}, about ${fmtCompact(Math.round(d.subscribers * (d.credibilityPct / 100)))} real`],
    [17060, 'ok', `credibility ${d.credibilityPct}%, sample error 2.1pp`],

    // score, 17500 to 19500
    [17620, 'cmd', 'POST score.compose subscores=[influence,audience,credibility,engagement]'],
    [18220, 'info', `influence ${d.cqs.influence}, audience ${d.cqs.audience}, credibility ${d.cqs.credibility}, engagement ${d.cqs.engagement}`],
    [18960, 'ok', `channel quality score ${d.cqs.total} of 100`],

    // compile, 19500 to 21000
    [19640, 'cmd', `PUT dossiers/${shortId}/refresh`],
    [20120, 'info', 'pages: overview, engagement, uploads, brand collabs, audience, game fit'],
    [20740, 'ok', `dossier compiled for ${game.shortName}, refreshed weekly`],
  ]
  return lines.map(([at, level, text], i) => ({ id: `log-${i}`, at, level, text }))
}
