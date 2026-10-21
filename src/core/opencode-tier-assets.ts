/**
 * Installation of OpenCode tier assets (managed agents + model router plugin).
 *
 * Called from init/update whenever the OpenCode tool is configured. Files live
 * under the project's `.opencode/` and are fully regenerated: they are managed
 * artifacts, not user-authored ones. The status reader backs the
 * `/opsx:models` activation report (active now / restart required / advisory).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  OPENCODE_TIER_AGENTS,
  getOpenCodeModelRouterPluginSource,
  getOpenCodeTierAgentSource,
  type OpenCodeTier,
} from './templates/opencode-tiers.js';
import { FileSystemUtils } from '../utils/file-system.js';

export const OPENCODE_AGENTS_DIR = path.join('.opencode', 'agents');
export const OPENCODE_PLUGINS_DIR = path.join('.opencode', 'plugins');
export const OPENCODE_ROUTER_PLUGIN_FILE = 'openspec-model-router.js';

export interface OpenCodeTierAssetStatus {
  /** Managed agent files present and current. */
  agentsInstalled: boolean;
  /** Routing plugin present and current. */
  pluginInstalled: boolean;
  /** All managed assets are on disk and match the current generator. */
  installed: boolean;
  /**
   * No managed assets (or only stale ones) are present, so skills should fall
   * back to requesting models in delegation prompts.
   */
  advisoryOnly: boolean;
}

function agentFile(projectPath: string, tier: OpenCodeTier): string {
  return path.join(projectPath, OPENCODE_AGENTS_DIR, `${OPENCODE_TIER_AGENTS[tier]}.md`);
}

function pluginFile(projectPath: string): string {
  return path.join(projectPath, OPENCODE_PLUGINS_DIR, OPENCODE_ROUTER_PLUGIN_FILE);
}

/**
 * Write (or refresh) the managed tier agents and the model router plugin.
 * Returns the paths written, so the caller can report the restart requirement.
 */
export function installOpenCodeTierAssets(projectPath: string): string[] {
  const written: string[] = [];

  for (const tier of ['planner', 'coordinator', 'worker'] as const) {
    const target = agentFile(projectPath, tier);
    FileSystemUtils.assertPathWithin(projectPath, target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, getOpenCodeTierAgentSource(tier), 'utf-8');
    written.push(target);
  }

  const plugin = pluginFile(projectPath);
  FileSystemUtils.assertPathWithin(projectPath, plugin);
  fs.mkdirSync(path.dirname(plugin), { recursive: true });
  fs.writeFileSync(plugin, getOpenCodeModelRouterPluginSource(), 'utf-8');
  written.push(plugin);

  return written;
}

/**
 * Remove the managed tier assets (used when the OpenCode tool is deselected).
 * Returns the number of files removed.
 */
export function removeOpenCodeTierAssets(projectPath: string): number {
  let removed = 0;
  for (const tier of ['planner', 'coordinator', 'worker'] as const) {
    const target = agentFile(projectPath, tier);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
      removed++;
    }
  }
  const plugin = pluginFile(projectPath);
  if (fs.existsSync(plugin)) {
    fs.rmSync(plugin, { force: true });
    removed++;
  }
  return removed;
}

/**
 * Report the activation state the `/opsx:models` workflow shows the user.
 *
 * Whether the running host has actually loaded the plugin cannot be observed
 * from the CLI, so the workflow distinguishes three states on its own
 * knowledge: assets just written → "restart required"; assets already on disk
 * and current → "active now"; no assets → "advisory only". This reader only
 * reports what is on disk.
 */
export function readOpenCodeTierAssetStatus(projectPath: string): OpenCodeTierAssetStatus {
  let agentsInstalled = true;
  for (const tier of ['planner', 'coordinator', 'worker'] as const) {
    const target = agentFile(projectPath, tier);
    if (!fs.existsSync(target)) {
      agentsInstalled = false;
      break;
    }
    try {
      if (fs.readFileSync(target, 'utf-8') !== getOpenCodeTierAgentSource(tier)) {
        agentsInstalled = false;
        break;
      }
    } catch {
      agentsInstalled = false;
      break;
    }
  }

  let pluginInstalled = false;
  const plugin = pluginFile(projectPath);
  if (fs.existsSync(plugin)) {
    try {
      pluginInstalled = fs.readFileSync(plugin, 'utf-8') === getOpenCodeModelRouterPluginSource();
    } catch {
      pluginInstalled = false;
    }
  }

  const both = agentsInstalled && pluginInstalled;
  return {
    agentsInstalled,
    pluginInstalled,
    installed: both,
    advisoryOnly: !both,
  };
}