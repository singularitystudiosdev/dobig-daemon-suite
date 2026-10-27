/* Detail payload for one sponsor finding. Owned by the Sponsor Daemon worker: replace this skeleton with the real shape.
   Imported by the analyzer (server/tools/sponsor.ts) and the client view (src/demo/findings/details/sponsor.tsx), so this
   file has no imports and stays JSON-serialisable. */

export interface SponsorDetail {
  kind: 'sponsor'
  /** ISO time the public data was read. */
  fetchedAt: string
}
