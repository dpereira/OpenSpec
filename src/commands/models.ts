/**
 * `openspec models` — show, set, or reset the project's agent-tier model
 * configuration (`openspec/models.json`).
 *
 * This is the deterministic persistence surface behind the `/opsx:models`
 * workflow: the skill guides the conversation and confirms with the user,
 * then calls here so the file is validated and written by one implementation
 * rather than by prose.
 */
import * as fs from 'node:fs';

import {
  AGENT_MODEL_CONFIG_VERSION,
  AGENT_TIER_IDS,
  DEFAULT_TIER_SELECTIONS,
  REASONING_EFFORTS,
  type AgentTierId,
  type ReasoningEffort,
  isReasoningEffort,
  readEffectiveAgentModels,
  saveAgentModels,
} from '../core/agent-models.js';
import { printJson } from './shared-output.js';

export interface ModelsOptions {
  tier?: string;
  model?: string;
  effort?: string;
  note?: string;
  json?: boolean;
}

export type ModelsAction = 'show' | 'set' | 'reset';

function isTier(value: string): value is AgentTierId {
  return (AGENT_TIER_IDS as readonly string[]).includes(value);
}

function effectivePayload(startPath: string): Record<string, unknown> {
  const effective = readEffectiveAgentModels(startPath);
  return {
    version: AGENT_MODEL_CONFIG_VERSION,
    source: effective.source,
    configPath: effective.configPath,
    ...(effective.problem ? { problem: effective.problem } : {}),
    tiers: effective.tiers,
  };
}

function renderHuman(payload: Record<string, unknown>): void {
  const tiers = payload.tiers as Record<AgentTierId, { model: string; effort: string; note?: string }>;
  console.log(`Model tier configuration (${String(payload.source)})`);
  console.log(`  file: ${String(payload.configPath)}`);
  if (typeof payload.problem === 'string') {
    console.log(`  problem: ${payload.problem}`);
  }
  for (const tier of AGENT_TIER_IDS) {
    const selection = tiers[tier];
    const note = selection.note ? `  (${selection.note})` : '';
    console.log(`  ${tier.padEnd(12)} ${selection.model} @ ${selection.effort}${note}`);
  }
  console.log('');
  console.log(`Valid efforts: ${REASONING_EFFORTS.join(', ')}`);
}

/**
 * Action handler. `action` comes from the slash command's step or the CLI
 * subcommand; the CLI itself exposes `set`/`reset` as flags to keep one
 * command definition.
 */
export async function modelsCommand(action: ModelsAction, options: ModelsOptions): Promise<void> {
  const startPath = process.cwd();

  if (action === 'show') {
    const payload = effectivePayload(startPath);
    if (options.json) {
      printJson(payload);
    } else {
      renderHuman(payload);
    }
    return;
  }

  if (action === 'reset') {
    const payload = effectivePayload(startPath);
    const configPath = payload.configPath as string;
    let removed = false;
    if (fs.existsSync(configPath)) {
      fs.rmSync(configPath);
      removed = true;
    }
    if (options.json) {
      printJson({ reset: true, removed, configPath, ...effectivePayload(startPath) });
    } else {
      console.log(removed ? `Removed ${configPath}; the advisory defaults apply again.` : `${configPath} did not exist; the advisory defaults are already in effect.`);
    }
    return;
  }

  // set
  const { tier, model, effort } = options;
  if (!tier || !isTier(tier)) {
    throw new Error(`--tier must be one of: ${AGENT_TIER_IDS.join(', ')}.`);
  }
  if (!model || model.trim() === '') {
    throw new Error('--model must be a non-empty host model id.');
  }
  let resolvedEffort: ReasoningEffort = 'default';
  if (effort !== undefined) {
    if (!isReasoningEffort(effort)) {
      throw new Error(`--effort must be one of: ${REASONING_EFFORTS.join(', ')}.`);
    }
    resolvedEffort = effort;
  }

  const patch: Partial<Record<AgentTierId, { model: string; effort: ReasoningEffort; note?: string }>> = {
    [tier]: {
      model: model.trim(),
      effort: resolvedEffort,
      ...(options.note ? { note: options.note } : {}),
    },
  };
  const saved = saveAgentModels({ patch, startPath });
  const payload = {
    version: saved.version,
    updated: saved.updated,
    source: 'project' as const,
    configPath: readEffectiveAgentModels(startPath).configPath,
    tiers: saved.tiers,
    defaults: DEFAULT_TIER_SELECTIONS,
  };
  if (options.json) {
    printJson(payload);
  } else {
    renderHuman({ ...payload, problem: undefined });
  }
}