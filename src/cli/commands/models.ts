import { Command, Option } from 'commander';
import { COMMAND_REGISTRY } from '../../core/completions/command-registry.js';
import type { ModelsAction, ModelsOptions } from '../../commands/models.js';

export function registerModelsCommand(program: Command): void {
  const description =
    COMMAND_REGISTRY.find((entry) => entry.name === 'models')?.description ??
    'Show or calibrate agent-tier model selection';

  program
    .command('models')
    .description(description)
    .argument('[action]', 'show | set | reset', 'show')
    .option('--tier <tier>', 'Tier to set: planner | coordinator | worker')
    .option('--model <id>', 'Host model id for --tier')
    .option('--effort <effort>', 'Reasoning effort for --tier')
    .option('--note <text>', 'Optional note recorded with the selection')
    .addOption(new Option('--json', 'Output as JSON').hideHelp())
    .action(async (action: string, options: ModelsOptions) => {
      const { modelsCommand } = await import('../../commands/models.js');
      const normalized: ModelsAction =
        action === 'set' || action === 'reset' ? action : 'show';
      if (action !== 'show' && action !== 'set' && action !== 'reset') {
        throw new Error(`Unknown action '${action}'. Use show, set, or reset.`);
      }
      await modelsCommand(normalized, options);
    });
}