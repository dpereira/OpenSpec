import { describe, it, expect } from 'vitest';

import {
  DELEGATION_ARTIFACT_WAVES,
  DELEGATION_GUIDANCE,
  DELEGATION_ONE_ARTIFACT,
  DELEGATION_PARALLEL_READONLY,
  DELEGATION_PARALLEL_WRITES,
  DELEGATION_PREFLIGHT,
  DELEGATION_SEQUENTIAL_WRITES,
  DELEGATION_TASK_EXECUTION,
  DELEGATION_TIERS,
  DELEGATION_VERIFICATION,
} from '../../../src/core/templates/workflows/delegation.js';
import {
  getCommandContents,
  getSkillTemplates,
  generateSkillContent,
} from '../../../src/core/shared/skill-generation.js';
import {
  DEFAULT_TIER_SELECTIONS,
  REASONING_EFFORTS,
  isReasoningEffort,
} from '../../../src/core/agent-models.js';

/**
 * The tier contract and the model calibration table are load-bearing for every
 * delegation workflow. These assertions keep a workflow from being added or
 * edited without them, and keep the prose table honest about effort ladders.
 */
describe('delegation guidance', () => {
  function renderedBodies(): Array<[string, string]> {
    // `models` is the calibration utility itself: it configures delegation,
    // it does not perform it, so it carries no tier contract or fan-out policy.
    const isModels = (id: string): boolean => id === 'models' || id === 'openspec-models';
    return [
      ...getSkillTemplates()
        .filter(({ workflowId }) => !isModels(workflowId))
        .map(
          ({ template, dirName }): [string, string] => [
            `skill ${dirName}`,
            generateSkillContent(template, 'DELEGATION-BASELINE'),
          ]
        ),
      ...getCommandContents()
        .filter((entry) => !isModels(entry.id))
        .map((entry): [string, string] => [`command ${entry.id}`, entry.body]),
    ];
  }

  it('names all three tiers and their constraints', () => {
    expect(DELEGATION_TIERS).toContain('**Planner**');
    expect(DELEGATION_TIERS).toContain('**Coordinator**');
    expect(DELEGATION_TIERS).toContain('**Worker**');
    expect(DELEGATION_TIERS).toMatch(/\*\*Workers never delegate\*\*/);
    expect(DELEGATION_TIERS).toContain('returns blockers instead of guessing');
  });

  it('teaches parallel fan-out and sequential handoff for dependencies', () => {
    expect(DELEGATION_GUIDANCE).toContain('**Parallelism**');
    expect(DELEGATION_GUIDANCE).toContain('**Fan out** every independent unit concurrently');
    expect(DELEGATION_GUIDANCE).toMatch(/\*\*Sequence\*\* dependent units/);
    expect(DELEGATION_GUIDANCE).toContain('A dependency is a reason to await a previous agent');
    expect(DELEGATION_GUIDANCE).toContain('join every started worker');
  });

  it('requires self-contained handoffs and coordinator-owned tracking', () => {
    expect(DELEGATION_TIERS).toContain('Workers do not see the conversation');
    expect(DELEGATION_TIERS).toContain('absolute paths');
    expect(DELEGATION_GUIDANCE).toContain('The coordinator owns all checkbox/status updates');
  });

  it('matches the machine-readable defaults in the calibration table', () => {
    for (const [tier, selection] of Object.entries(DEFAULT_TIER_SELECTIONS)) {
      expect(DELEGATION_TIERS, tier).toContain(selection.model);
      expect(isReasoningEffort(selection.effort)).toBe(true);
    }
    // Ladder facts pinned in prose, checked against the vocabulary.
    expect(DELEGATION_TIERS).toContain('low · medium · high · xhigh · **max**');
    expect(DELEGATION_TIERS).toMatch(/ceiling is \*\*high\*\* \(no max\)/);
    expect(DELEGATION_TIERS).toContain('low·medium·**high** — no max');
    expect(DELEGATION_TIERS).toContain('none·low·high·**max** — no medium');
    for (const effort of REASONING_EFFORTS) {
      expect(['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).toContain(effort);
    }
  });

  it('carries the tier contract into every workflow surface', () => {
    for (const [label, body] of renderedBodies()) {
      expect(body, label).toContain('**Delegation tiers**');
      expect(body, label).toContain('openspec/');
      expect(body, label).toMatch(/\*\*Workers never delegate\*\*/);
    }
  });

  it('carries a parallelism policy into every workflow surface', () => {
    for (const [label, body] of renderedBodies()) {
      expect(body, label).toContain('**Parallel opportunity**');
    }
  });

  it('keeps each per-workflow fragment non-empty and distinct in intent', () => {
    const fragments = [
      DELEGATION_PARALLEL_READONLY,
      DELEGATION_ARTIFACT_WAVES,
      DELEGATION_TASK_EXECUTION,
      DELEGATION_VERIFICATION,
      DELEGATION_PARALLEL_WRITES,
      DELEGATION_SEQUENTIAL_WRITES,
      DELEGATION_ONE_ARTIFACT,
      DELEGATION_PREFLIGHT,
    ];
    for (const fragment of fragments) {
      expect(fragment.startsWith('**Parallel opportunity**')).toBe(true);
      expect(fragment.length).toBeGreaterThan(120);
    }
    expect(new Set(fragments).size).toBe(fragments.length);
  });

  it('keeps the tier contract free of mutation verbs for gated workflows', () => {
    // update-change (#1836) gates every artifact edit behind a confirmation
    // step and forbids write vocabulary outside it; the tier contract is the
    // part that workflow carries, so it must stay verb-safe.
    expect(DELEGATION_TIERS).not.toMatch(
      /(?:over|re)?writ(?:e|es|ing|ten)\b|(?:re)?appl(?:y|ies|ied|ying)\b/i
    );
  });
});