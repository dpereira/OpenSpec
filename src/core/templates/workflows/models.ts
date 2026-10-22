/**
 * Skill Template Workflow Modules
 *
 * `/opsx-models` — calibrate the planner / coordinator / worker model tiers
 * for this project and session. Shares one body across the skill and command
 * surfaces, like the other workflows.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { PROJECT_ROOT_GUARD } from './project-root.js';

export function getModelsInstructions(): string {
  return `Calibrate which models and reasoning efforts OpenSpec delegation uses in this project.

${STORE_SELECTION_GUIDANCE}

${PROJECT_ROOT_GUARD}

**Input**: Optional free-text guidance (e.g. \`/opsx:models planner=opus high, worker=luna\`, \`/opsx:models show\`, \`/opsx:models reset\`). With no arguments, run the interactive calibration below.

**Configuration file**: \`models.json\` in the resolved OpenSpec root's \`openspec/\` directory (the same \`root.path\` the other workflows use, so a store-selected root wins over a repo-local guess). Schema:

\`\`\`json
{
  "version": 1,
  "updated": "<ISO timestamp>",
  "tiers": {
    "planner":     { "model": "<host model id>", "effort": "high", "note": "optional" },
    "coordinator": { "model": "<host model id>", "effort": "high", "note": "optional" },
    "worker":      { "model": "<host model id>", "effort": "max",  "note": "optional" }
  }
}
\`\`\`

Valid efforts: \`default\`, \`none\`, \`minimal\`, \`low\`, \`medium\`, \`high\`, \`xhigh\`, \`max\`. \`default\` keeps the model's own reasoning setting — use it for models that expose only a thinking toggle. Model IDs are host-specific opaque strings (for example \`openai/gpt-6.1-sol\` or \`deepinfra/XiaomiMiMo/MiMo-V2.6-Pro\`).

**Steps**

1. **Locate the configuration.** Resolve the OpenSpec root (\`openspec context --json\`, with \`--store <id>\` when one is selected) and read \`<root.path>/openspec/models.json\`. If no root exists, follow the **Project check** above rather than creating one. If the file is absent, start from these advisory defaults and tell the user the file will be created:

   | Tier | Responsibility | Default model | Effort | Verified effort ladder |
   | --- | --- | --- | --- | --- |
   | planner | scope, architecture, dependency decomposition, acceptance criteria, hard reconciliation | \`openai/gpt-6.1-sol\` | high | low · medium · high · xhigh · max (Claude Opus 5.5: same; Gemini 4 Argon: low · medium · **high only**) |
   | coordinator | dispatch, joins, ownership, shared-state writes, verification | \`deepinfra/XiaomiMiMo/MiMo-V2.6-Pro\` | high | toggle-only natively; **high is the ceiling** where an effort ladder exists (no max) |
   | worker | one bounded execution unit, never delegates | \`openai/gpt-6-luna\` | max | none · low · medium · high · xhigh · max |

   Other verified pairings: Claude Haiku 5.5 (low→max), DeepSeek V4.1 Flash 1017 (none · low · high · **max**, no medium), MiMo-V2.6-Flash (same ceiling as MiMo-V2.6-Pro: **high**).

2. **Discover what this host can actually run.** List the models the current agent/host exposes (its model picker, provider catalogue, or \`opencode models\` / equivalent) and note which support reasoning/effort control and which effort values each accepts. Do not invent IDs and do not probe models with live test prompts — discovery is read-only. Present only models that exist here.

3. **Guide the selection.** For each tier, in order planner → coordinator → worker:
   - Show the current selection and its source (project file or default).
   - Offer 2–4 suitable candidates from step 2 with their effort ladders: high-end/high-effort for planner, mid-tier/variable for coordinator, economical for worker.
   - Let the user pick or type an exact model ID. Ask about effort only after the model is chosen, and offer only values that model actually supports plus \`default\`.
   - Never accept an effort outside the chosen model's ladder: correct it and say what is available.

4. **Confirm the full mapping** in one table (tier → model → effort) before writing.

5. **Persist.** Write the complete \`models.json\` (all three tiers, schema above) to the resolved root. Do not create a missing \`openspec/\` directory as a side effect — that is what the **Project check** guards. If the existing file cannot be parsed, do not overwrite it blindly: report the parse error and ask before replacing it.

6. **Report activation.** State each tier's model/effort, the file path, and one of:
   - **Active now** — the host routes tiered delegation from this file per dispatch (e.g. the OpenCode tier bridge is installed): later delegations in this session use the new selection.
   - **Restart required** — the native integration (agents/plugin) was just installed or changed: the user must restart the host once; after that, editing only this file takes effect on subsequent delegations without restarting.
   - **Advisory only** — this host has no native tier routing: skills will request these models/efforts in delegation prompts and report when the host cannot apply them.

**Commands**

- \`/opsx:models\` (no input) — interactive calibration.
- \`/opsx:models show\` — print the effective mapping and its source; change nothing.
- \`/opsx:models reset\` — delete the project file so defaults apply again; confirm first.
- \`/opsx:models <tier>=<model> [effort]\` — set one tier directly (e.g. \`planner=anthropic/claude-opus-5-5 high\`), then re-confirm and save.

**Guardrails**

- This workflow changes \`models.json\` only. It does not edit \`openspec/config.yaml\`, planning artifacts, project code, or host configuration files.
- Guides, not hard constraints: any model/effort the user names is acceptable if the host offers it. The table above is a recommendation, not an allow-list.
- Capabilities are advisory. Persisting a choice does not guarantee the host applied it; report honestly which of the three activation states applies.
- Do not claim measured calibration or performance benchmarks. Selection is guided preference, not evaluation.
- Preserve the user's existing selections for tiers they did not ask to change.`;
}

export function getOpsxModelsSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-models',
    description: 'Calibrate which models and reasoning efforts OpenSpec uses for planner, coordinator, and worker delegation. Use when the user says "openspec models", "opsx models", "opsx-models", or wants to configure delegation tier models.',
    instructions: getModelsInstructions(),
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxModelsCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Models',
    description: 'Calibrate planner / coordinator / worker model tiers (Experimental)',
    category: 'Workflow',
    tags: ['workflow', 'configuration', 'experimental'],
    content: getModelsInstructions(),
  };
}