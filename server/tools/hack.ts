import { RunError, type ToolModule } from './types.ts'

// Placeholder until the hack tool worker builds the real analyzer.
export const tool: ToolModule = {
  async analyze() {
    throw new RunError('internal', 'The hack analyzer is not built yet.')
  },
}
