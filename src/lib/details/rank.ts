/* Detail payload for one rank finding. Owned by the Rank Daemon worker: replace this skeleton with the real shape.
   Imported by the analyzer (server/tools/rank.ts) and the client view (src/demo/findings/details/rank.tsx), so this
   file has no imports and stays JSON-serialisable. */

export interface RankDetail {
  kind: 'rank'
  /** ISO time the public data was read. */
  fetchedAt: string
}
