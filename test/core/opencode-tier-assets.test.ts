import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

import {
  OPENCODE_AGENT_TIER,
  OPENCODE_TIER_AGENTS,
  getOpenCodeModelRouterPluginSource,
  getOpenCodeTierAgentSource,
} from '../../src/core/templates/opencode-tiers.js';
import {
  installOpenCodeTierAssets,
  readOpenCodeTierAssetStatus,
  removeOpenCodeTierAssets,
} from '../../src/core/opencode-tier-assets.js';

describe('opencode tier assets', () => {
  let project: string;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-opencode-tiers-'));
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  describe('agent sources', () => {
    it('cover every tier exactly once', () => {
      expect(Object.keys(OPENCODE_TIER_AGENTS).sort()).toEqual([
        'coordinator',
        'planner',
        'worker',
      ]);
      for (const [agent, tier] of Object.entries(OPENCODE_AGENT_TIER)) {
        expect(OPENCODE_TIER_AGENTS[tier]).toBe(agent);
      }
    });

    it('declare subagent mode and a startup fallback model', () => {
      for (const tier of ['planner', 'coordinator', 'worker'] as const) {
        const source = getOpenCodeTierAgentSource(tier);
        expect(source).toContain('mode: subagent');
        expect(source).toMatch(/^model: \S+/m);
      }
    });

    it('forbid the worker from delegating', () => {
      const worker = getOpenCodeTierAgentSource('worker');
      expect(worker).toMatch(/never delegat/i);
      expect(worker).toMatch(/never spawn agents/i);
      // The prohibition on further skills must be stated in the negative.
      expect(worker).toMatch(/\*\*Never spawn agents, never invoke other skills/i);
    });

    it('keep planners and coordinators distinct in responsibility', () => {
      expect(getOpenCodeTierAgentSource('planner')).toMatch(/scope, architecture/);
      expect(getOpenCodeTierAgentSource('coordinator')).toMatch(/dispatch/i);
      expect(getOpenCodeTierAgentSource('coordinator')).toMatch(/join/i);
    });
  });

  describe('model router plugin source', () => {
    it('routes every managed agent and reads models.json per dispatch', () => {
      const plugin = getOpenCodeModelRouterPluginSource();
      for (const agent of Object.values(OPENCODE_TIER_AGENTS)) {
        expect(plugin).toContain(`'${agent}'`);
      }
      expect(plugin).toContain('models.json');
      expect(plugin).toContain('chat.message');
    });

    it('passes the effort through as the native variant, skipping default', () => {
      const plugin = getOpenCodeModelRouterPluginSource();
      expect(plugin).toContain('next.variant = selection.effort');
      expect(plugin).toContain(`selection.effort !== 'default'`);
    });

    it('splits host model ids on the first slash, as the host does', () => {
      const plugin = getOpenCodeModelRouterPluginSource();
      expect(plugin).toContain(`selection.model.indexOf('/')`);
      expect(plugin).not.toContain(`selection.model.lastIndexOf('/')`);
    });
  });

  describe('model router plugin behavior', () => {
    let cwd: string;

    beforeEach(() => {
      cwd = process.cwd();
    });

    afterEach(() => {
      process.chdir(cwd);
    });

    async function routeModel(
      model: string,
      effort: string,
      agent: string = OPENCODE_TIER_AGENTS.worker
    ): Promise<unknown> {
      installOpenCodeTierAssets(project);
      fs.mkdirSync(path.join(project, 'openspec'), { recursive: true });
      fs.writeFileSync(
        path.join(project, 'openspec', 'models.json'),
        `${JSON.stringify({
          version: 1,
          updated: '2026-01-01T00:00:00.000Z',
          tiers: {
            planner: { model: 'openai/gpt-6.1-sol', effort: 'high' },
            coordinator: { model: 'openai/gpt-6.1-sol', effort: 'high' },
            worker: { model, effort },
          },
        })}\n`
      );
      fs.writeFileSync(path.join(project, 'package.json'), '{"type":"module"}\n');
      process.chdir(project);

      const pluginPath = path.join(project, '.opencode', 'plugins', 'openspec-model-router.js');
      const mod = (await import(/* @vite-ignore */ pathToFileURL(pluginPath).href)) as {
        OpenSpecModelRouter: () => Promise<{
          'chat.message': (
            input: unknown,
            output: { message: Record<string, unknown> }
          ) => Promise<void>;
        }>;
      };
      const plugin = await mod.OpenSpecModelRouter();
      const message: Record<string, unknown> = { role: 'user', agent };
      await plugin['chat.message'](null, { message });
      return message.model;
    }

    it('routes nested ids with the provider as the first segment', async () => {
      expect(await routeModel('deepinfra/XiaomiMiMo/MiMo-V2.6-Flash', 'high')).toEqual({
        providerID: 'deepinfra',
        modelID: 'XiaomiMiMo/MiMo-V2.6-Flash',
        variant: 'high',
      });
      expect(await routeModel('openrouter/openai/gpt-5.6-sol', 'medium')).toEqual({
        providerID: 'openrouter',
        modelID: 'openai/gpt-5.6-sol',
        variant: 'medium',
      });
    });

    it('routes plain provider/model ids unchanged', async () => {
      expect(await routeModel('openai/gpt-6-luna', 'max')).toEqual({
        providerID: 'openai',
        modelID: 'gpt-6-luna',
        variant: 'max',
      });
    });

    it('omits the variant when the effort is the model default', async () => {
      expect(await routeModel('deepinfra/XiaomiMiMo/MiMo-V2.6-Flash', 'default')).toEqual({
        providerID: 'deepinfra',
        modelID: 'XiaomiMiMo/MiMo-V2.6-Flash',
      });
    });

    it('leaves unmanaged agents and unusable ids untouched', async () => {
      expect(
        await routeModel('deepinfra/XiaomiMiMo/MiMo-V2.6-Flash', 'high', 'general')
      ).toBeUndefined();
      expect(await routeModel('nslash', 'high')).toBeUndefined();
      expect(await routeModel('/x', 'high')).toBeUndefined();
      expect(await routeModel('x/', 'high')).toBeUndefined();
    });
  });

  describe('install/remove/status', () => {
    it('writes every asset and reports the installation as complete', () => {
      const written = installOpenCodeTierAssets(project);
      expect(written).toHaveLength(4);

      for (const agent of Object.values(OPENCODE_TIER_AGENTS)) {
        expect(fs.existsSync(path.join(project, '.opencode', 'agents', `${agent}.md`))).toBe(true);
      }
      expect(
        fs.existsSync(path.join(project, '.opencode', 'plugins', 'openspec-model-router.js'))
      ).toBe(true);

      const status = readOpenCodeTierAssetStatus(project);
      expect(status.agentsInstalled).toBe(true);
      expect(status.pluginInstalled).toBe(true);
      expect(status.installed).toBe(true);
      expect(status.advisoryOnly).toBe(false);
    });

    it('refuses to escape the project root', () => {
      const agentFile = path.join(project, '.opencode', 'agents', 'openspec-worker.md');
      fs.mkdirSync(path.dirname(agentFile), { recursive: true });
      const outside = path.join(os.tmpdir(), 'openspec-outside-target.md');
      fs.writeFileSync(outside, 'outside\n');
      try {
        fs.symlinkSync(outside, agentFile, 'file');
        expect(() => installOpenCodeTierAssets(project)).toThrow();
      } finally {
        fs.rmSync(outside, { force: true });
      }
    });

    it('reports advisory when the plugin is missing or stale', () => {
      installOpenCodeTierAssets(project);
      fs.writeFileSync(
        path.join(project, '.opencode', 'plugins', 'openspec-model-router.js'),
        '// edited by hand\n'
      );
      const status = readOpenCodeTierAssetStatus(project);
      expect(status.pluginInstalled).toBe(false);
      expect(status.installed).toBe(false);
      expect(status.advisoryOnly).toBe(true);
    });

    it('reports advisory when an agent file is missing', () => {
      installOpenCodeTierAssets(project);
      fs.rmSync(path.join(project, '.opencode', 'agents', 'openspec-planner.md'));
      const status = readOpenCodeTierAssetStatus(project);
      expect(status.agentsInstalled).toBe(false);
      expect(status.advisoryOnly).toBe(true);
    });

    it('removes only managed assets', () => {
      installOpenCodeTierAssets(project);
      const userFile = path.join(project, '.opencode', 'agents', 'my-reviewer.md');
      fs.writeFileSync(userFile, 'mine\n');

      const removed = removeOpenCodeTierAssets(project);
      expect(removed).toBe(4);
      expect(fs.existsSync(path.join(project, '.opencode', 'plugins', 'openspec-model-router.js')))
        .toBe(false);
      expect(fs.existsSync(userFile)).toBe(true);

      // Idempotent.
      expect(removeOpenCodeTierAssets(project)).toBe(0);
    });
  });
});