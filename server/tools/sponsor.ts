import { RunError, type ToolModule } from './types.ts'

/* Sponsor Daemon analyzer. Owned by the Sponsor Daemon worker: replace this skeleton. */
export const tool: ToolModule = {
  async analyze() {
    throw new RunError('upstream', 'Sponsor Daemon is not built yet.')
  },
}
