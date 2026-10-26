---
name: openspec-models
description: Calibrate which models and reasoning efforts OpenSpec uses for planner, coordinator, and worker delegation. Use when the user says "openspec models", "opsx models", "opsx-models", or wants to configure delegation tier models.
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
---

Calibrate which models and reasoning efforts OpenSpec delegation uses in this project.

**Store selection:** If the user names a store (a store is a standalone OpenSpec repo registered on this machine) or the work lives in one, run `openspec store list --json` to discover registered store ids, then pass `--store <id>` on the commands that read or write specs and changes (`new change`, `status`, `instructions`, `list`, `show`, `validate`, `archive`, `doctor`, `context`, `schemas`, `view`). Once selected, treat `--store <id>` as sticky for the rest of the workflow. Every unscoped example of those commands below is shorthand: before running it, append the flag. For example, run `openspec status --change "<name>" --json --store "<id>"`, not the unscoped form shown below. Other commands do not take the flag. Hints printed by commands already carry the flag; keep it on follow-ups. Without a store, commands act on the nearest local `openspec/` root.

**Project check:** These steps expect a project that already uses OpenSpec. Before the first step that writes anything (`new change`, `archive`, `sync specs`, or authoring an artifact file), confirm the project has a root: run `openspec list --json` (with `--store <id>` when a store is selected, since the store is then the root) and read `root`. A root object means the project is set up. `"root": null` means it is not - there is no `openspec/` directory here, and a write such as `openspec new change` would create one as a side effect. The command also exits non-zero, which is that answer rather than a broken CLI, so read the JSON instead of retrying or working around it.

One `"root": null` is not about setup: when a `status` error message starts with `Declared in` or `Invalid store declaration in` and names this project's `openspec/config.yaml` (or `config.yml`), the project does use OpenSpec through a store it declares, which this machine cannot resolve (the store is not registered, or the `store:` line is malformed). Do not treat it as uninitialized and skip the branches below: stop before writing and show the user that error's `message` and `fix`.

Otherwise, with no root, what happens next depends on how this workflow was reached:

- **Auto-selected**: you chose this workflow yourself, without the user naming OpenSpec, naming this skill, or running its slash command. Stop using OpenSpec and answer the request normally, as you would with no OpenSpec installed. Do not ask them to set anything up and do not mention OpenSpec setup.
- **Explicit OpenSpec request**: the user named OpenSpec, named this skill, or ran its slash command. Stop before writing and ask how to proceed: set this project up (`openspec init`), target a store they already have (`--store <id>`), or continue without OpenSpec for this request. Wait for their answer.

In both branches, never create the root as a side effect: do not run `openspec init` until the user asks for it, do not hand-create `openspec/` files, and do not let a command create it.

**Input**: Optional free-text guidance (e.g. `/openspec-models planner=opus high, worker=luna`, `/openspec-models show`, `/openspec-models reset`). With no arguments, run the interactive calibration below.

**Configuration file**: `models.json` in the resolved OpenSpec root's `openspec/` directory (the same `root.path` the other workflows use, so a store-selected root wins over a repo-local guess). Schema:

```json
{
  "version": 1,
  "updated": "<ISO timestamp>",
  "tiers": {
    "planner":     { "model": "openai/gpt-6.1-sol", "effort": "high", "secondary": { "model": "deepinfra/XiaomiMiMo/MiMo-V2.6-Pro", "effort": "high" } },
    "coordinator": { "model": "openai/gpt-6.1-sol", "effort": "medium", "secondary": { "model": "deepinfra/XiaomiMiMo/MiMo-V2.6-Pro", "effort": "high" } },
    "worker":      { "model": "openai/gpt-6-luna", "effort": "max", "secondary": { "model": "deepinfra/XiaomiMiMo/MiMo-V2.6-Flash", "effort": "high" } }
  }
}
```

Valid efforts: `default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. `default` keeps the model's own reasoning setting — use it for models that expose only a thinking toggle. Model IDs are host-specific opaque strings (for example `openai/gpt-6.1-sol` or `deepinfra/XiaomiMiMo/MiMo-V2.6-Pro`).

Each tier keeps its primary fields and may configure its own `secondary: { model, effort, note? }`. The advisory defaults below include both pairings when `models.json` is absent; they remain advisory until the user confirms persistence. Existing project files without a secondary remain primary-only until the user configures one. Select primary and secondary independently; each effort belongs to that pairing, and the IDs in a tier's pair must differ.

**Fixed routing policy (where a verified native host enforces it)**: Each dispatch runs entirely on one admitted model using the host's own retry sequence; routing adds no retry budget or in-dispatch model switching. Persistent consistent availability failures move later dispatches to the configured secondary: consistent observations within a retried dispatch, or two consecutive un-retried failed dispatches. A single un-retried failure never moves the tier. The pairing then enters a 300-second cooldown so later dispatches use secondary; after expiry exactly one real dispatch probes primary recovery. Failed work is reported and never replayed or resubmitted. There is no tertiary or nearest-unconfigured substitute. Availability categories are authentication, credits/quota, unavailable model, transport, rate limit, overload, and server failure. Task/tool failures, refusals, answer quality, invalid requests, context limits, cancellation, and unknown errors never move the tier.

**Steps**

1. **Locate the configuration.** Resolve the OpenSpec root (`openspec context --json`, with `--store <id>` when one is selected) and read `<root.path>/openspec/models.json`. If no root exists, follow the **Project check** above rather than creating one. If the file is absent, start from these advisory defaults and tell the user the file will be created:

   | Tier | Responsibility | Default primary | Effort | Default secondary | Effort | Verified effort ladders |
   | --- | --- | --- | --- | --- | --- | --- |
   | planner | scope, architecture, dependency decomposition, acceptance criteria, hard reconciliation | `openai/gpt-6.1-sol` | high | `deepinfra/XiaomiMiMo/MiMo-V2.6-Pro` | high | OpenAI: low · medium · high · xhigh · **max**; MiMo ceiling is **high** (no max) |
   | coordinator | dispatch, joins, ownership, shared-state writes, verification | `openai/gpt-6.1-sol` | medium | `deepinfra/XiaomiMiMo/MiMo-V2.6-Pro` | high | OpenAI: low · medium · high · xhigh · **max**; MiMo ceiling is **high** (no max) |
   | worker | one bounded execution unit, never delegates | `openai/gpt-6-luna` | max | `deepinfra/XiaomiMiMo/MiMo-V2.6-Flash` | high | Luna: none · low · medium · high · xhigh · **max**; MiMo Flash ceiling is **high** |

   Other verified pairings: Claude Haiku 5.5 (low→max), DeepSeek V4.1 Flash 1017 (none · low · high · **max**, no medium), MiMo-V2.6-Flash (same ceiling as MiMo-V2.6-Pro: **high**).

2. **Discover what this host can actually run.** List the models the current agent/host exposes (its model picker, provider catalogue, or `opencode models` / equivalent) and note which support reasoning/effort control and which effort values each accepts. Do not invent IDs and do not probe models with live test prompts — discovery is read-only. Present only models that exist here.

3. **Guide the selection.** For each tier, in order planner → coordinator → worker:
   - Show the current selection and its source (project file or default).
   - Offer 2–4 suitable candidates from step 2 with their effort ladders: high-end/high-effort for planner, mid-tier/variable for coordinator, economical for worker.
   - Let the user pick or type an exact model ID. Ask about effort only after the model is chosen, and offer only values that model actually supports plus `default`.
   - Never accept an effort outside the chosen model's ladder: correct it and say what is available.

4. **Confirm the full mapping** in one table (tier → primary model/effort → secondary model/effort) before writing.

5. **Persist.** Write the complete `models.json` (all three tiers, schema above) to the resolved root. Do not create a missing `openspec/` directory as a side effect — that is what the **Project check** guards. If the existing file cannot be parsed, do not overwrite it blindly: report the parse error and ask before replacing it.

6. **Report activation truthfully.** Distinguish **advisory** (the host cannot enforce the routing policy), **restart required** (native assets were just installed or changed), and **native** only when a verified host contract enforces the policy. On-disk assets prove installation readiness only, not that a running host loaded them or is enforcing anything. Report runtime enforcement only when the host can attest it; never infer or fabricate runtime health. Without verified native enforcement, describe the policy as guidance, not active routing.

**Commands**

- `/openspec-models` (no input) — interactive calibration.
- `/openspec-models show` — print the effective mapping and its source; change nothing.
- `/openspec-models reset` — delete the project file so defaults apply again; confirm first.
- `/openspec-models <tier>=<model> [effort]` — set one tier directly (e.g. `planner=anthropic/claude-opus-5-5 high`), then re-confirm and save.

**Guardrails**

- This workflow changes `models.json` only. It does not edit `openspec/config.yaml`, planning artifacts, project code, or host configuration files.
- Guides, not hard constraints: any model/effort the user names is acceptable if the host offers it. The table above is a recommendation, not an allow-list.
- Capabilities are advisory. Persisting a choice does not guarantee the host applied it; report honestly which of the three activation states applies.
- Do not claim measured calibration or performance benchmarks. Selection is guided preference, not evaluation.
- Preserve the user's existing selections for tiers they did not ask to change.
