import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  AGENT_MODEL_CONFIG_VERSION,
  AGENT_TIER_IDS,
  DEFAULT_TIER_SELECTIONS,
  REASONING_EFFORTS,
  type AgentTierId,
  type ReasoningEffort,
  AgentModelConfigError,
  canonicalAgentModelConfigIdentity,
  isReasoningEffort,
  parseAgentModelConfig,
  readEffectiveAgentModels,
  resolveAgentModelConfigPath,
  saveAgentModels,
} from '../../src/core/agent-models.js';

describe('agent-models', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-agent-models-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function openSpecHome(): string {
    const dir = path.join(tempDir, 'openspec');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  describe('isReasoningEffort', () => {
    it('accepts every documented effort', () => {
      for (const effort of REASONING_EFFORTS) {
        expect(isReasoningEffort(effort)).toBe(true);
      }
    });

    it('rejects unknown values', () => {
      expect(isReasoningEffort('ultra')).toBe(false);
      expect(isReasoningEffort(7)).toBe(false);
      expect(isReasoningEffort(undefined)).toBe(false);
    });
  });

  describe('resolveAgentModelConfigPath', () => {
    it('places the file in the nearest openspec home when nothing exists', () => {
      const dir = openSpecHome();
      expect(resolveAgentModelConfigPath(tempDir)).toBe(path.join(dir, 'models.json'));
    });

    it('prefers an existing models.json in a nested project over an ancestor', () => {
      const outer = path.join(tempDir, 'openspec');
      fs.mkdirSync(outer, { recursive: true });
      const inner = path.join(tempDir, 'sub', 'openspec');
      fs.mkdirSync(inner, { recursive: true });
      fs.writeFileSync(path.join(inner, 'models.json'), '{}');

      expect(resolveAgentModelConfigPath(path.join(tempDir, 'sub'))).toBe(
        path.join(inner, 'models.json')
      );
    });

    it('falls back to the starting directory when no openspec home exists', () => {
      expect(resolveAgentModelConfigPath(tempDir)).toBe(
        path.join(tempDir, 'openspec', 'models.json')
      );
    });

    it('canonicalises symlinked spellings of the same home', () => {
      const dir = openSpecHome();
      const target = path.join(dir, 'models.json');
      fs.writeFileSync(target, '{}');
      expect(resolveAgentModelConfigPath(path.join(tempDir, '.'))).toBe(
        fs.realpathSync.native(target)
      );
    });
  });

  describe('canonicalAgentModelConfigIdentity', () => {
    it('uses one identity for symlink, trailing separator, and dot-segment aliases', () => {
      const dir = openSpecHome();
      fs.writeFileSync(path.join(dir, 'models.json'), '{}');
      const alias = path.join(tempDir, 'alias');
      fs.symlinkSync(tempDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
      const expected = canonicalAgentModelConfigIdentity(tempDir);
      expect(canonicalAgentModelConfigIdentity(`${alias}${path.sep}`)).toBe(expected);
      expect(canonicalAgentModelConfigIdentity(path.join(alias, 'child', '..'))).toBe(expected);
    });

    it('resolves Windows-shaped inputs through the host path module', () => {
      const shaped = path.win32.join('C:', 'project', 'openspec', '..');
      expect(canonicalAgentModelConfigIdentity(shaped)).toBe(
        canonicalAgentModelConfigIdentity(path.resolve(shaped))
      );
    });

    it('folds case aliases only when the filesystem is case-insensitive', () => {
      const dir = openSpecHome();
      fs.writeFileSync(path.join(dir, 'models.json'), '{}');
      const variant = tempDir.toUpperCase();
      const probe = path.join(tempDir, 'CaseProbe');
      fs.writeFileSync(probe, 'probe');
      const insensitive = fs.existsSync(path.join(tempDir, 'caseprobe'));
      if (insensitive) expect(canonicalAgentModelConfigIdentity(variant)).toBe(canonicalAgentModelConfigIdentity(tempDir));
    });
  });

  describe('parseAgentModelConfig', () => {
    const configPath = '/tmp/openspec-models.json';

    it('accepts a complete document', () => {
      const parsed = parseAgentModelConfig(
        JSON.stringify({
          version: 1,
          updated: '2026-01-01T00:00:00.000Z',
          tiers: {
            planner: { model: 'openai/gpt-6.1-sol', effort: 'high' },
            coordinator: { model: 'deepinfra/XiaomiMiMo/MiMo-V2.6-Pro', effort: 'high' },
            worker: { model: 'openai/gpt-6-luna', effort: 'max' },
          },
        }),
        configPath
      );
      expect(parsed.version).toBe(1);
      expect(parsed.tiers.planner.model).toBe('openai/gpt-6.1-sol');
      expect(parsed.tiers.worker.effort).toBe('max');
      expect(parsed.tiers.worker.secondary).toBeUndefined();
    });

    it('round-trips independent secondary pairings for every tier', () => {
      const tiers = Object.fromEntries(AGENT_TIER_IDS.map((tier) => [tier, {
        model: `primary/${tier}`, effort: 'high',
        secondary: { model: `secondary/${tier}`, effort: 'low', note: `alternate ${tier}` },
      }]));
      const parsed = parseAgentModelConfig(JSON.stringify({ version: 1, tiers }), configPath);
      expect(parsed.tiers.planner.secondary).toEqual({ model: 'secondary/planner', effort: 'low', note: 'alternate planner' });
      expect(parsed.tiers.coordinator.secondary?.effort).toBe('low');
      expect(parsed.tiers.worker.secondary?.effort).toBe('low');
    });

    it('preserves opaque model IDs with nested slashes and backslashes verbatim', () => {
      const model = 'provider/nested\\namespace/family\\variant/model';
      const parsed = parseAgentModelConfig(JSON.stringify({ tiers: {
        planner: { model, effort: 'high', secondary: { model: `${model}/backup\\slot`, effort: 'low' } },
        coordinator: { model: 'c', effort: 'high' },
        worker: { model: 'w', effort: 'max' },
      } }), configPath);
      expect(parsed.tiers.planner.model).toBe(model);
      expect(parsed.tiers.planner.secondary?.model).toBe(`${model}/backup\\slot`);
    });

    it('keeps legacy primary model and note normalization behavior', () => {
      const parsed = parseAgentModelConfig(JSON.stringify({ tiers: {
        planner: { model: '  primary/model  ', effort: 'high', note: '   ' },
        coordinator: { model: 'c', effort: 'high', note: 42 },
        worker: { model: 'w', effort: 'max' },
      } }), configPath);
      expect(parsed.tiers.planner.model).toBe('primary/model');
      expect(parsed.tiers.planner.note).toBeUndefined();
      expect(parsed.tiers.coordinator.note).toBeUndefined();
    });

    it('rejects malformed secondary pairings with field-specific errors', () => {
      const config = (secondary: unknown) => ({ tiers: {
        planner: { model: 'primary', effort: 'high', secondary },
        coordinator: { model: 'c', effort: 'high' },
        worker: { model: 'w', effort: 'max' },
      } });
      expect(() => parseAgentModelConfig(JSON.stringify(config({ model: 'alternate' })), configPath))
        .toThrow('tiers.planner.secondary.effort');
      expect(() => parseAgentModelConfig(JSON.stringify(config({ effort: 'low' })), configPath))
        .toThrow('tiers.planner.secondary.model');
      expect(() => parseAgentModelConfig(JSON.stringify(config(null)), configPath))
        .toThrow('tiers.planner.secondary must be an object');
      expect(() => parseAgentModelConfig(JSON.stringify(config({ model: 'alternate', effort: 'low', note: 7 })), configPath))
        .toThrow('tiers.planner.secondary.note');
      expect(() => parseAgentModelConfig(JSON.stringify(config({ model: 'alternate', effort: 'ultra' })), configPath))
        .toThrow('tiers.planner.secondary.effort');
    });

    it('rejects identical primary and secondary model IDs', () => {
      const raw = JSON.stringify({ tiers: {
        planner: { model: 'same/model', effort: 'high', secondary: { model: 'same/model', effort: 'low' } },
        coordinator: { model: 'c', effort: 'high' },
        worker: { model: 'w', effort: 'max' },
      } });
      expect(() => parseAgentModelConfig(raw, configPath)).toThrow('tiers.planner.secondary.model must differ');
    });

    it('rejects invalid JSON', () => {
      expect(() => parseAgentModelConfig('{', configPath)).toThrow(AgentModelConfigError);
    });

    it('rejects a non-object root', () => {
      expect(() => parseAgentModelConfig('[]', configPath)).toThrow('must contain a JSON object');
    });

    it('rejects a missing tier', () => {
      const raw = JSON.stringify({
        tiers: {
          planner: { model: 'm', effort: 'high' },
          coordinator: { model: 'm', effort: 'high' },
        },
      });
      expect(() => parseAgentModelConfig(raw, configPath)).toThrow('missing tiers.worker');
    });

    it('rejects an effort outside the vocabulary', () => {
      const raw = JSON.stringify({
        tiers: {
          planner: { model: 'm', effort: 'ultra' },
          coordinator: { model: 'm', effort: 'high' },
          worker: { model: 'm', effort: 'max' },
        },
      });
      expect(() => parseAgentModelConfig(raw, configPath)).toThrow('tiers.planner.effort');
    });

    it('rejects an empty model id', () => {
      const raw = JSON.stringify({
        tiers: {
          planner: { model: '   ', effort: 'high' },
          coordinator: { model: 'm', effort: 'high' },
          worker: { model: 'm', effort: 'max' },
        },
      });
      expect(() => parseAgentModelConfig(raw, configPath)).toThrow('tiers.planner.model');
    });
  });

  describe('readEffectiveAgentModels', () => {
    it('returns the advisory defaults when no file exists', () => {
      const effective = readEffectiveAgentModels(tempDir);
      expect(effective.source).toBe('defaults');
      expect(effective.stale).toBe(false);
      expect(effective.tiers).toEqual(DEFAULT_TIER_SELECTIONS);
    });

    it('returns the project file when it parses', () => {
      openSpecHome();
      saveAgentModels({
        startPath: tempDir,
        now: '2026-01-01T00:00:00.000Z',
        patch: { worker: { model: 'anthropic/claude-haiku-5-5', effort: 'high' } },
      });

      const effective = readEffectiveAgentModels(tempDir);
      expect(effective.source).toBe('project');
      expect(effective.tiers.worker.model).toBe('anthropic/claude-haiku-5-5');
      expect(effective.tiers.planner).toEqual(DEFAULT_TIER_SELECTIONS.planner);
    });

    it('degrades to defaults and reports the problem when the file is corrupt', () => {
      const dir = openSpecHome();
      fs.writeFileSync(path.join(dir, 'models.json'), '{not json');

      const effective = readEffectiveAgentModels(tempDir);
      expect(effective.source).toBe('defaults');
      expect(effective.stale).toBe(true);
      expect(effective.problem).toContain('not valid JSON');
      expect(effective.tiers).toEqual(DEFAULT_TIER_SELECTIONS);
    });
  });

  describe('saveAgentModels', () => {
    it('creates secondaries only with model and explicit effort; updates and clears independently', () => {
      openSpecHome();
      expect(() => saveAgentModels({ startPath: tempDir, patch: { worker: { secondary: { model: 'backup' } } } }))
        .toThrow('requires model and explicit effort');
      saveAgentModels({ startPath: tempDir, patch: {
        planner: { secondary: { model: 'planner-backup', effort: 'low', note: 'backup note' } },
        worker: { secondary: { model: 'worker-backup', effort: 'medium', note: 'worker note' } },
      } });
      const changed = saveAgentModels({ startPath: tempDir, patch: {
        planner: { secondary: { effort: 'high' } },
        worker: { clearSecondary: true },
      } });
      expect(changed.tiers.planner.secondary).toEqual({ model: 'planner-backup', effort: 'high' });
      expect(changed.tiers.worker.secondary).toBeUndefined();
      expect(changed.tiers.planner.model).toBe(DEFAULT_TIER_SELECTIONS.planner.model);
      expect(changed.tiers.coordinator).toEqual(DEFAULT_TIER_SELECTIONS.coordinator);
    });

    it('preserves a secondary across primary patches and rejects duplicate IDs on every write', () => {
      openSpecHome();
      saveAgentModels({ startPath: tempDir, patch: { worker: { secondary: { model: 'backup', effort: 'low' } } } });
      expect(saveAgentModels({ startPath: tempDir, patch: { worker: { model: 'new-primary' } } }).tiers.worker.secondary)
        .toEqual({ model: 'backup', effort: 'low' });
      expect(() => saveAgentModels({ startPath: tempDir, patch: { worker: { model: 'backup' } } }))
        .toThrow('must differ');
      expect(() => saveAgentModels({ startPath: tempDir, patch: { worker: { secondary: { model: 'new-primary', effort: 'high' } } } }))
        .toThrow('must differ');
    });

    it('retains legacy files with or without secondaries', () => {
      openSpecHome();
      saveAgentModels({ startPath: tempDir });
      expect(readEffectiveAgentModels(tempDir).tiers.worker.secondary).toBeUndefined();
      saveAgentModels({ startPath: tempDir, patch: { planner: { secondary: { model: 'alternate', effort: 'low' } } } });
      expect(readEffectiveAgentModels(tempDir).tiers.planner.secondary?.model).toBe('alternate');
    });

    it('round-trips every tier and effort', () => {
      openSpecHome();
      const patch = {} as Partial<Record<AgentTierId, { model: string; effort: ReasoningEffort }>>;
      for (const tier of AGENT_TIER_IDS) {
        patch[tier] = { model: `host/${tier}`, effort: 'high' };
      }
      const saved = saveAgentModels({ startPath: tempDir, now: '2026-01-01T00:00:00.000Z', patch });
      expect(saved.version).toBe(AGENT_MODEL_CONFIG_VERSION);

      const effective = readEffectiveAgentModels(tempDir);
      expect(effective.source).toBe('project');
      for (const tier of AGENT_TIER_IDS) {
        expect(effective.tiers[tier].model).toBe(`host/${tier}`);
        expect(effective.tiers[tier].effort).toBe('high');
      }
    });

    it('keeps untouched tiers and drops a stale note when the pairing changes', () => {
      openSpecHome();
      saveAgentModels({
        startPath: tempDir,
        patch: { planner: { model: 'openai/gpt-6.1-sol', effort: 'high', note: 'for Sol' } },
      });
      const afterFirst = readEffectiveAgentModels(tempDir);
      expect(afterFirst.tiers.planner.note).toBe('for Sol');

      saveAgentModels({
        startPath: tempDir,
        patch: { planner: { model: 'anthropic/claude-opus-5-5', effort: 'max' } },
      });
      const afterSecond = readEffectiveAgentModels(tempDir);
      expect(afterSecond.tiers.planner.model).toBe('anthropic/claude-opus-5-5');
      expect(afterSecond.tiers.planner.note).toBeUndefined();
      // Untouched tiers survive the merge.
      expect(afterSecond.tiers.worker).toEqual(DEFAULT_TIER_SELECTIONS.worker);
    });

    it('refuses to overwrite an unparsable file', () => {
      const dir = openSpecHome();
      fs.writeFileSync(path.join(dir, 'models.json'), 'not json');
      expect(() => saveAgentModels({ startPath: tempDir })).toThrow(AgentModelConfigError);
    });

    it('accepts arbitrary host model ids but rejects unknown efforts', () => {
      openSpecHome();
      const saved = saveAgentModels({
        startPath: tempDir,
        patch: { worker: { model: 'some-obscure/provider-42', effort: 'xhigh' } },
      });
      expect(saved.tiers.worker.model).toBe('some-obscure/provider-42');
      expect(saved.tiers.worker.effort).toBe('xhigh');

      expect(() =>
        saveAgentModels({
          startPath: tempDir,
          patch: { worker: { model: 'some-obscure/provider-42', effort: 'ultra' as ReasoningEffort } },
        })
      ).toThrow('tiers.worker.effort');
    });
  });

  describe('default tier selections', () => {
    it('are internally consistent and complete', () => {
      for (const tier of AGENT_TIER_IDS) {
        const selection = DEFAULT_TIER_SELECTIONS[tier];
        expect(selection.model).toBeTruthy();
        expect(isReasoningEffort(selection.effort)).toBe(true);
      }
    });

    it('use only efforts within each default model ladder', () => {
      // Verified against the providers' published reasoning ladders.
      expect(DEFAULT_TIER_SELECTIONS.planner.effort).toBe('high'); // Sol: low..max
      expect(DEFAULT_TIER_SELECTIONS.coordinator.effort).toBe('high'); // MiMo Pro: ceiling high
      expect(DEFAULT_TIER_SELECTIONS.worker.effort).toBe('max'); // Luna: none..max
    });
  });
});
