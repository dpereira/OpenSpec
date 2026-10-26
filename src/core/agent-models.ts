/**
 * Agent-tier model routing configuration (`openspec/models.json`).
 *
 * OpenSpec skills delegate across three tiers — planner, coordinator, worker —
 * and each tier is meant to run on a different model/reasoning-effort budget.
 * The user calibrates those choices with `/opsx-models` (or `openspec models`);
 * every delegation skill reads the effective selections back from here.
 *
 * Location is project-local: `openspec/models.json` beside the project's other
 * OpenSpec configuration, found by walking up from the working directory. When
 * the file is absent the advisory defaults in DEFAULT_TIER_SELECTIONS apply
 * (they are the machine-readable form of the guidance table in
 * templates/workflows/delegation.ts, which is the prose fallback skills show).
 *
 * Model IDs are host- and provider-specific opaque strings; only the tier keys
 * and the effort vocabulary are fixed here.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { FileSystemUtils } from '../utils/file-system.js';

/** File name of the project-local tier model configuration. */
export const AGENT_MODEL_FILE_NAME = 'models.json';

/** Schema version written into new configuration files. */
export const AGENT_MODEL_CONFIG_VERSION = 1;

/** The three delegation tiers, in decreasing expected reasoning budget. */
export const AGENT_TIER_IDS = ['planner', 'coordinator', 'worker'] as const;
export type AgentTierId = (typeof AGENT_TIER_IDS)[number];

/**
 * Effort vocabulary shared across providers.
 *
 * `default` keeps the model's own reasoning setting (the right choice for
 * models that expose only a thinking toggle, such as MiMo on its native
 * providers). The remaining values are the effort ladder observed across
 * providers; a given model/provider exposes only a subset, and `max` in
 * particular is not universal.
 */
export const REASONING_EFFORTS = [
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

/** One model/effort pairing. `model` is an opaque host-specific ID. */
export interface TierModelPairing {
  model: string;
  effort: ReasoningEffort;
  /** Optional free-form record of why this pairing was chosen. */
  note?: string;
}

/** One tier's primary selection and optional independent secondary. */
export interface TierModelSelection extends TierModelPairing {
  secondary?: TierModelPairing;
}

export interface AgentModelConfig {
  version: number;
  /** ISO timestamp of the last calibration. */
  updated: string;
  tiers: Record<AgentTierId, TierModelSelection>;
}

/**
 * Advisory fallbacks, used when `openspec/models.json` is absent.
 *
 * Effort values were checked against the providers' published reasoning
 * ladders at implementation time; where a ladder is shorter than the generic
 * vocabulary the ceiling is noted in templates/workflows/delegation.ts.
 */
export const DEFAULT_TIER_SELECTIONS: Record<AgentTierId, TierModelSelection> = {
  planner: { model: 'openai/gpt-6.1-sol', effort: 'high', note: 'high/xhigh/max; Gemini 4 Argon tops out at high' },
  coordinator: { model: 'deepinfra/XiaomiMiMo/MiMo-V2.6-Pro', effort: 'high', note: 'high is the MiMo ceiling; no max' },
  worker: { model: 'openai/gpt-6-luna', effort: 'max', note: 'none/low/medium/high/xhigh/max' },
};

/** Source of the effective selections reported to callers. */
export type TierSelectionSource = 'project' | 'defaults';

export interface EffectiveAgentModels {
  source: TierSelectionSource;
  /** Absolute path of the project file when one was consulted. */
  configPath: string;
  /** True when a file exists but could not be used. */
  stale: boolean;
  tiers: Record<AgentTierId, TierModelSelection>;
  /** Set when a file existed but was rejected, with a user-facing reason. */
  problem?: string;
}

export class AgentModelConfigError extends Error {
  readonly configPath: string;

  constructor(message: string, configPath: string) {
    super(message);
    this.name = 'AgentModelConfigError';
    this.configPath = configPath;
  }
}

function canonicalDir(startPath: string): string {
  const resolved = path.resolve(startPath);
  try {
    const stat = fs.statSync(resolved);
    return FileSystemUtils.canonicalizeExistingPath(stat.isDirectory() ? resolved : path.dirname(resolved));
  } catch {
    return resolved;
  }
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve where the project's tier model configuration lives (or would live).
 *
 * Preference order:
 * 1. nearest ancestor's existing `openspec/models.json`
 * 2. `openspec/models.json` under the nearest ancestor that has an `openspec/`
 *    directory — the project's normal OpenSpec configuration home
 * 3. `openspec/models.json` under the starting directory (created on demand by
 *    an explicit calibration; never a side effect of another workflow)
 */
export function resolveAgentModelConfigPath(startPath: string = process.cwd()): string {
  const start = canonicalDir(startPath);

  let current = start;
  while (true) {
    const candidate = path.join(current, 'openspec', AGENT_MODEL_FILE_NAME);
    if (fs.existsSync(candidate)) {
      return FileSystemUtils.canonicalizeExistingPath(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  current = start;
  while (true) {
    const openspecDir = path.join(current, 'openspec');
    if (isDirectory(openspecDir)) {
      return FileSystemUtils.canonicalizeExistingPath(path.join(openspecDir, AGENT_MODEL_FILE_NAME));
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.join(start, 'openspec', AGENT_MODEL_FILE_NAME);
}

/** Stable platform-native identity for session state associated with this config location. */
export function canonicalAgentModelConfigIdentity(startPath: string = process.cwd()): string {
  return FileSystemUtils.canonicalizeExistingPath(path.resolve(resolveAgentModelConfigPath(startPath)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTierSelection(
  tier: string,
  value: unknown,
  configPath: string,
  strictNote = false
): TierModelPairing {
  if (!isRecord(value)) {
    throw new AgentModelConfigError(`tiers.${tier} must be an object with model and effort.`, configPath);
  }
  const model = value.model;
  if (typeof model !== 'string' || model.trim() === '') {
    throw new AgentModelConfigError(`tiers.${tier}.model must be a non-empty string.`, configPath);
  }
  const effort = value.effort;
  if (!isReasoningEffort(effort)) {
    throw new AgentModelConfigError(
      `tiers.${tier}.effort must be one of: ${REASONING_EFFORTS.join(', ')}.`,
      configPath
    );
  }
  const selection: TierModelPairing = { model: model.trim(), effort };
  if (strictNote && 'note' in value && (typeof value.note !== 'string' || value.note.trim() === '')) {
    throw new AgentModelConfigError(`tiers.${tier}.note must be a non-empty string when provided.`, configPath);
  }
  if (typeof value.note === 'string' && value.note.trim() !== '') {
    selection.note = value.note.trim();
  }
  return selection;
}

function validateTierWithSecondary(tier: AgentTierId, value: unknown, configPath: string): TierModelSelection {
  const selection: TierModelSelection = validateTierSelection(tier, value, configPath);
  if (isRecord(value) && 'secondary' in value) {
    const secondary = validateTierSelection(`${tier}.secondary`, value.secondary, configPath, true);
    if (selection.model === secondary.model) {
      throw new AgentModelConfigError(
        `tiers.${tier}.secondary.model must differ from tiers.${tier}.model.`,
        configPath
      );
    }
    selection.secondary = secondary;
  }
  return selection;
}

/**
 * Parse and validate a configuration document. Throws AgentModelConfigError
 * with a user-facing message when the document cannot be used.
 */
export function parseAgentModelConfig(raw: string, configPath: string): AgentModelConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AgentModelConfigError('models.json is not valid JSON.', configPath);
  }
  if (!isRecord(parsed)) {
    throw new AgentModelConfigError('models.json must contain a JSON object.', configPath);
  }
  if (!isRecord(parsed.tiers)) {
    throw new AgentModelConfigError('models.json must contain a "tiers" object.', configPath);
  }

  const tiers = {} as Record<AgentTierId, TierModelSelection>;
  for (const tier of AGENT_TIER_IDS) {
    if (!(tier in parsed.tiers)) {
      throw new AgentModelConfigError(`models.json is missing tiers.${tier}.`, configPath);
    }
    tiers[tier] = validateTierWithSecondary(tier, parsed.tiers[tier], configPath);
  }

  const version = typeof parsed.version === 'number' ? parsed.version : AGENT_MODEL_CONFIG_VERSION;
  const updated = typeof parsed.updated === 'string' ? parsed.updated : '';
  return { version, updated, tiers };
}

/**
 * Read the effective tier selections for a project.
 *
 * A missing file is not an error: the advisory defaults are returned with
 * `source: 'defaults'`. A file that exists but cannot be used is reported via
 * `problem`/`stale` so callers can surface it without failing closed.
 */
export function readEffectiveAgentModels(startPath: string = process.cwd()): EffectiveAgentModels {
  const configPath = resolveAgentModelConfigPath(startPath);

  if (!fs.existsSync(configPath)) {
    return {
      source: 'defaults',
      configPath,
      stale: false,
      tiers: { ...DEFAULT_TIER_SELECTIONS },
    };
  }

  try {
    const parsed = parseAgentModelConfig(fs.readFileSync(configPath, 'utf-8'), configPath);
    return { source: 'project', configPath, stale: false, tiers: parsed.tiers };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    return {
      source: 'defaults',
      configPath,
      stale: true,
      problem,
      tiers: { ...DEFAULT_TIER_SELECTIONS },
    };
  }
}

export interface SaveAgentModelOptions {
  /** Replace one tier's selection; other tiers keep their current values. */
  patch?: Partial<Record<AgentTierId, Partial<Omit<TierModelSelection, 'secondary'>> & {
    secondary?: Partial<TierModelPairing>;
    clearSecondary?: boolean;
  }>>;
  /** Timestamp override for deterministic tests. */
  now?: string;
  /** Directory to resolve the configuration path from. */
  startPath?: string;
}

/**
 * Persist tier selections to `openspec/models.json`, merging `patch` over the
 * existing (or default) values. Creates the `openspec/` directory only when a
 * parent OpenSpec home already exists or the caller is explicitly calibrating.
 */
export function saveAgentModels(options: SaveAgentModelOptions = {}): AgentModelConfig {
  const startPath = options.startPath ?? process.cwd();
  const configPath = resolveAgentModelConfigPath(startPath);

  let current: Record<AgentTierId, TierModelSelection> = { ...DEFAULT_TIER_SELECTIONS };
  if (fs.existsSync(configPath)) {
    try {
      current = parseAgentModelConfig(fs.readFileSync(configPath, 'utf-8'), configPath).tiers;
    } catch (error) {
      throw error instanceof AgentModelConfigError
        ? error
        : new AgentModelConfigError(String(error), configPath);
    }
  }

  const tiers = { ...current };
  if (options.patch) {
    for (const tier of AGENT_TIER_IDS) {
      const patch = options.patch[tier];
      if (!patch) continue;
      const existing = tiers[tier];
      const model = patch.model?.trim() || tiers[tier].model;
      const effort = patch.effort ?? tiers[tier].effort;
      // A note describes the model/effort pairing it was written for; drop it
      // when the pairing changes unless the patch supplies a fresh one.
      const note =
        patch.note?.trim() || (model === existing.model && effort === existing.effort
          ? existing.note
          : undefined);
      const merged: TierModelSelection = { model, effort };
      if (note) merged.note = note;
      if (patch.clearSecondary) {
        // Explicit clear takes precedence over a secondary patch.
      } else if (patch.secondary) {
        const secondaryPatch = patch.secondary;
        const oldSecondary = existing.secondary;
        if (!oldSecondary && (!secondaryPatch.model?.trim() || !secondaryPatch.effort)) {
          throw new AgentModelConfigError(`tiers.${tier}.secondary requires model and explicit effort when created.`, configPath);
        }
        const secondaryModel = secondaryPatch.model?.trim() || oldSecondary?.model;
        const secondaryEffort = secondaryPatch.effort ?? oldSecondary?.effort;
        if (!secondaryModel || !secondaryEffort) {
          throw new AgentModelConfigError(`tiers.${tier}.secondary requires model and explicit effort when created.`, configPath);
        }
        const secondaryNote = secondaryPatch.note?.trim() ||
          (secondaryModel === oldSecondary?.model && secondaryEffort === oldSecondary?.effort ? oldSecondary?.note : undefined);
        const secondary: TierModelPairing = { model: secondaryModel, effort: secondaryEffort };
        if (secondaryNote) secondary.note = secondaryNote;
        merged.secondary = validateTierSelection(`${tier}.secondary`, secondary, configPath);
      } else if (existing.secondary) {
        merged.secondary = existing.secondary;
      }
      tiers[tier] = validateTierWithSecondary(tier, merged, configPath);
    }
  }

  const config: AgentModelConfig = {
    version: AGENT_MODEL_CONFIG_VERSION,
    updated: options.now ?? new Date().toISOString(),
    tiers,
  };

  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  return config;
}
