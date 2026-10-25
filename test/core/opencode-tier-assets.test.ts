import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
      expect(plugin).toContain('next.variant = pair.effort');
      expect(plugin).toContain(`pair.effort !== 'default'`);
    });

    it('splits host model ids on the first slash, as the host does', () => {
      const plugin = getOpenCodeModelRouterPluginSource();
      expect(plugin).toContain(`pair.model.indexOf('/')`);
      expect(plugin).not.toContain(`pair.model.lastIndexOf('/')`);
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

    it('preserves host-only routing for a legacy primary-only config', async () => {
      installOpenCodeTierAssets(project);
      fs.mkdirSync(path.join(project, 'openspec'), { recursive: true });
      const tiers = {
        planner: { model: 'planner-primary/model', effort: 'high' },
        coordinator: { model: 'coordinator-primary/model', effort: 'medium' },
        worker: { model: 'worker-primary/model', effort: 'low' },
      };
      const config = { version: 1, tiers };
      expect(JSON.stringify(config)).not.toContain('secondary');
      fs.writeFileSync(path.join(project, 'openspec', 'models.json'), JSON.stringify(config));
      fs.writeFileSync(path.join(project, 'package.json'), '{"type":"module"}');
      process.chdir(project);
      const pluginPath = path.join(project, '.opencode', 'plugins', 'openspec-model-router.js');
      const mod = await import(/* @vite-ignore */ `${pathToFileURL(pluginPath).href}?legacy=${Math.random()}`) as any;
      const plugin = await mod.OpenSpecModelRouter();
      for (const [tier, agent] of Object.entries(OPENCODE_TIER_AGENTS) as [keyof typeof tiers, string][]) {
        const message: Record<string, any> = { role: 'user', agent };
        await plugin['chat.message']({ sessionID: tier }, { message });
        const [providerID, ...modelParts] = tiers[tier].model.split('/');
        expect(message.model).toEqual({ providerID, modelID: modelParts.join('/'), variant: tiers[tier].effort });
        expect(JSON.stringify(message.model)).not.toMatch(/nearest|default|substitute/i);
        await plugin.event({ event: { type: 'session.status', properties: { sessionID: tier, status: { retry: true, message: 'overloaded' } } } });
        await plugin.event({ event: { type: 'session.error', properties: { sessionID: tier, error: { message: 'overloaded' } } } });
        const subsequent: Record<string, any> = { role: 'user', agent };
        await plugin['chat.message']({ sessionID: `${tier}-later` }, { message: subsequent });
        expect(subsequent.model).toEqual(message.model);
      }
      expect(plugin.getTransitions()).toEqual([]);
    });

    async function createHarness() {
      installOpenCodeTierAssets(project);
      fs.mkdirSync(path.join(project, 'openspec'), { recursive: true });
      fs.writeFileSync(path.join(project, 'openspec', 'models.json'), JSON.stringify({ version: 1, tiers: {
        worker: { model: 'primary/model', effort: 'high', secondary: { model: 'secondary/model', effort: 'low' } },
      } }));
      fs.writeFileSync(path.join(project, 'package.json'), '{"type":"module"}');
      process.chdir(project);
      const pluginPath = path.join(project, '.opencode', 'plugins', 'openspec-model-router.js');
      const mod = await import(/* @vite-ignore */ `${pathToFileURL(pluginPath).href}?run=${Math.random()}`) as any;
      const plugin = await mod.OpenSpecModelRouter();
      let n = 0;
      async function admit(sessionID = 's') {
        const message: Record<string, any> = { role: 'user', agent: OPENCODE_TIER_AGENTS.worker, text: 'private prompt' };
        await plugin['chat.message']({ sessionID }, { message });
        return message.model;
      }
      async function event(type: string, sessionID = 's', properties: Record<string, unknown> = {}) {
        await plugin.event({ event: { type, properties: { sessionID, ...properties } } });
      }
      return { admit, event, transitions: () => plugin.getTransitions(), nextSession: () => `s${++n}` };
    }

    it('tracks retry-consistent dispatches and secret-free transitions', async () => {
      const h = await createHarness();
      expect(await h.admit()).toMatchObject({ providerID: 'primary', variant: 'high' });
      await h.event('session.status', 's', { status: { retry: true, message: 'overloaded' } });
      await h.event('session.error', 's', { error: { message: 'overloaded', body: 'raw error test-key api key' } });
      expect(await h.admit()).toMatchObject({ providerID: 'secondary', variant: 'low' });
      const all = JSON.stringify(h.transitions());
      expect(all).toMatch(/slot|model|effort|category|cooldown|probe/);
      expect(all).not.toMatch(/private prompt|test-key|api key|raw error/);
    });

    it('requires two same-category un-retried failures', async () => {
      const h = await createHarness();
      await h.admit(); await h.event('session.error', 's', { error: { message: 'overloaded' } });
      expect(await h.admit()).toMatchObject({ providerID: 'primary' });
      await h.event('session.error', 's', { error: { message: 'overloaded' } });
      expect(await h.admit()).toMatchObject({ providerID: 'secondary' });
    });

    it('clears evidence on category changes and non-qualifying failures', async () => {
      const h = await createHarness();
      await h.admit(); await h.event('session.error', 's', { error: { message: 'overloaded' } });
      await h.admit(); await h.event('session.error', 's', { error: { message: 'timeout' } });
      await h.admit(); await h.event('session.error', 's', { error: { message: 'task/tool failure' } });
      await h.admit(); await h.event('session.error', 's', { error: { message: 'overloaded' } });
      expect(await h.admit()).toMatchObject({ providerID: 'primary' });
    });

    it('attributes events only to the most recently admitted session scope', async () => {
      const h = await createHarness();
      await h.event('session.error', 'unknown', { error: { message: 'overloaded' } });
      expect(await h.admit('unknown')).toMatchObject({ providerID: 'primary' });
      await h.admit('new'); await h.event('session.error', 'new', { error: { message: 'overloaded' } });
      expect(await h.admit('new')).toMatchObject({ providerID: 'primary' });
    });

    it('leases one recovery probe and handles probe outcomes', async () => {
      const h = await createHarness();
      const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
      try {
        await h.admit(); await h.event('session.error', 's', { error: { message: 'overloaded' } });
        await h.admit(); await h.event('session.error', 's', { error: { message: 'overloaded' } });
        now.mockReturnValue(302000);
        expect(await h.admit()).toMatchObject({ providerID: 'primary' });
        await h.event('session.status', 's', { status: { completed: true } });
        expect(await h.admit()).toMatchObject({ providerID: 'primary' });
      } finally { now.mockRestore(); }
    });

    it('shares cooldown across sessions and leases a single primary probe', async () => {
      const h = await createHarness();
      const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
      try {
        await h.admit('first'); await h.event('session.error', 'first', { error: { message: 'overloaded' } });
        await h.admit('first'); await h.event('session.error', 'first', { error: { message: 'overloaded' } });
        expect(await h.admit('other')).toMatchObject({ providerID: 'secondary' });
        now.mockReturnValue(301001);
        expect(await h.admit('probe')).toMatchObject({ providerID: 'primary' });
        expect(await h.admit('concurrent')).toMatchObject({ providerID: 'secondary' });
        await h.event('session.status', 'probe', { status: { completed: true } });
        expect(await h.admit('after-success')).toMatchObject({ providerID: 'primary' });
      } finally { now.mockRestore(); }
    });

    it('reopens cooldown after a qualifying probe failure without another primary admission', async () => {
      const h = await createHarness();
      const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
      try {
        await h.admit('s'); await h.event('session.error', 's', { error: { message: 'overloaded' } });
        await h.admit('s'); await h.event('session.error', 's', { error: { message: 'overloaded' } });
        now.mockReturnValue(301001);
        expect(await h.admit('probe')).toMatchObject({ providerID: 'primary' });
        await h.event('session.error', 'probe', { error: { message: 'timeout' } });
        expect(await h.admit('later')).toMatchObject({ providerID: 'secondary' });
      } finally { now.mockRestore(); }
    });

    it('releases the probe lease after a nonqualifying failure without opening cooldown', async () => {
      const h = await createHarness();
      const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
      try {
        await h.admit('s'); await h.event('session.error', 's', { error: { message: 'overloaded' } });
        await h.admit('s'); await h.event('session.error', 's', { error: { message: 'overloaded' } });
        now.mockReturnValue(301001);
        expect(await h.admit('probe')).toMatchObject({ providerID: 'primary' });
        await h.event('session.error', 'probe', { error: { message: 'task/tool failure' } });
        expect(await h.admit('retry-probe')).toMatchObject({ providerID: 'primary' });
      } finally { now.mockRestore(); }
    });

    it('ignores unattributed events and attributes observations only to the latest admission', async () => {
      const h = await createHarness();
      await h.event('session.error', 'no-admission', { error: { message: 'overloaded' } });
      expect(await h.admit('fresh')).toMatchObject({ providerID: 'primary' });
      await h.event('session.error', 'fresh', { error: { message: 'overloaded' } });
      expect(await h.admit('fresh')).toMatchObject({ providerID: 'primary' });
    });

    it('reports transition fields without prompts, credentials, or raw error bodies', async () => {
      const h = await createHarness();
      await h.admit();
      await h.event('session.error', 's', { error: { message: 'overloaded', body: 'raw-error test-key' } });
      const serialized = JSON.stringify(h.transitions());
      expect(h.transitions()[0]).toMatchObject({ slot: 'primary', model: 'primary/model', effort: 'high', category: null });
      expect(serialized).not.toMatch(/private prompt|test-key|raw-error|body/);
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
      expect(status.routingReady).toBe(true);
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
      expect(status.routingReady).toBe(false);
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
