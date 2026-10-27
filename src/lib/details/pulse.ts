/* Detail payload for one pulse finding. Owned by the Pulse Daemon worker: replace this skeleton with the real shape.
   Imported by the analyzer (server/tools/pulse.ts) and the client view (src/demo/findings/details/pulse.tsx), so this
   file has no imports and stays JSON-serialisable. */

export interface PulseDetail {
  kind: 'pulse'
  /** ISO time the public data was read. */
  fetchedAt: string
}
