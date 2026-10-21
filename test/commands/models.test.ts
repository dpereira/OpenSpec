import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { modelsCommand } from '../../src/commands/models.js';
import { DEFAULT_TIER_SELECTIONS } from '../../src/core/agent-models.js';

/**
 * `openspec models` is the deterministic persistence surface behind
 * `/opsx:models`. The workflow does the conversation; this command validates
 * and writes the file, so these tests pin the file contract rather than the
 * prompt text.
 */
describe('openspec models command', () => {
  let project: string;
  let cwd: string;
  let output: string;
  const originalLog = console.log;

  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-models-cli-'));
    await fs.mkdir(path.join(project, 'openspec'), { recursive: true });
    await fs.writeFile(path.join(project, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
    cwd = process.cwd();
    process.chdir(project);
    output = '';
    console.log = (...args: unknown[]) => {
      output += `${args.map(String).join(' ')}\n`;
    };
  });

  afterEach(async () => {
    console.log = originalLog;
    process.chdir(cwd);
    await fs.rm(project, { recursive: true, force: true });
  });

  async function readConfig(): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(path.join(project, 'openspec', 'models.json'), 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  it('reports the advisory defaults without creating a file', async () => {
    await modelsCommand('show', {});
    expect(output).toContain('defaults');
    expect(output).toContain(DEFAULT_TIER_SELECTIONS.planner.model);

    await expect(fs.access(path.join(project, 'openspec', 'models.json'))).rejects.toThrow();
  });

  it('writes one tier and preserves the others', async () => {
    await modelsCommand('set', {
      tier: 'planner',
      model: 'anthropic/claude-opus-5-5',
      effort: 'max',
    });

    const config = await readConfig();
    const tiers = config.tiers as Record<string, { model: string; effort: string }>;
    expect(tiers.planner).toMatchObject({ model: 'anthropic/claude-opus-5-5', effort: 'max' });
    expect(tiers.coordinator.model).toBe(DEFAULT_TIER_SELECTIONS.coordinator.model);
    expect(tiers.worker.model).toBe(DEFAULT_TIER_SELECTIONS.worker.model);
  });

  it('emits machine-readable JSON when asked', async () => {
    output = '';
    await modelsCommand('set', {
      tier: 'worker',
      model: 'anthropic/claude-haiku-5-5',
      effort: 'high',
      json: true,
    });
    const payload = JSON.parse(output) as { source: string; tiers: Record<string, { model: string }> };
    expect(payload.source).toBe('project');
    expect(payload.tiers.worker.model).toBe('anthropic/claude-haiku-5-5');
  });

  it('rejects an unknown tier, unknown effort, and empty model', async () => {
    await expect(modelsCommand('set', { tier: 'wizard', model: 'm', effort: 'high' })).rejects.toThrow(
      /--tier must be one of/
    );
    await expect(
      modelsCommand('set', { tier: 'planner', model: 'm', effort: 'ultra' })
    ).rejects.toThrow(/--effort must be one of/);
    await expect(modelsCommand('set', { tier: 'planner', model: '   ' })).rejects.toThrow(
      /--model must be/
    );
    await expect(fs.access(path.join(project, 'openspec', 'models.json'))).rejects.toThrow();
  });

  it('accepts any host model id but only documented efforts', async () => {
    await modelsCommand('set', {
      tier: 'coordinator',
      model: 'some-obscure/provider-42',
      effort: 'xhigh',
    });
    const config = await readConfig();
    const tiers = config.tiers as Record<string, { model: string; effort: string }>;
    expect(tiers.coordinator).toMatchObject({ model: 'some-obscure/provider-42', effort: 'xhigh' });
  });

  it('reset removes the file and restores defaults', async () => {
    await modelsCommand('set', { tier: 'planner', model: 'm', effort: 'high' });
    await expect(fs.access(path.join(project, 'openspec', 'models.json'))).resolves.toBeUndefined();

    output = '';
    await modelsCommand('reset', { json: true });
    const payload = JSON.parse(output) as { removed: boolean; source: string };
    expect(payload.removed).toBe(true);
    expect(payload.source).toBe('defaults');

    await expect(fs.access(path.join(project, 'openspec', 'models.json'))).rejects.toThrow();
  });

  it('reset is a no-op when there is nothing to remove', async () => {
    output = '';
    await modelsCommand('reset', { json: true });
    const payload = JSON.parse(output) as { removed: boolean };
    expect(payload.removed).toBe(false);
  });
});