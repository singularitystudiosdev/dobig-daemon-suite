import { RunError, type ToolModule } from './types.ts'

// Placeholder until the discord tool worker builds the real analyzer.
export const tool: ToolModule = {
  async analyze() {
    throw new RunError('internal', 'The discord analyzer is not built yet.')
  },
}
