import { RunError, type ToolModule } from './types.ts'

// Placeholder until the creator tool worker builds the real analyzer.
export const tool: ToolModule = {
  async analyze() {
    throw new RunError('internal', 'The creator analyzer is not built yet.')
  },
}
