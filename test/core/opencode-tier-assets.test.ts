import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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