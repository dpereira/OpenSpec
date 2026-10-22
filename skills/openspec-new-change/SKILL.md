---
name: openspec-new-change
description: Start a new OpenSpec change using the experimental artifact workflow. Use when the user wants to create a new feature, fix, or modification with a structured step-by-step approach. Also use when the user says "openspec new change" or "opsx new".
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
---

Start a new change using the experimental artifact-driven approach.

**Store selection:** If the user names a store (a store is a standalone OpenSpec repo registered on this machine) or the work lives in one, run `openspec store list --json` to discover registered store ids, then pass `--store <id>` on the commands that read or write specs and changes (`new change`, `status`, `instructions`, `list`, `show`, `validate`, `archive`, `doctor`, `context`, `schemas`, `view`). Once selected, treat `--store <id>` as sticky for the rest of the workflow. Every unscoped example of those commands below is shorthand: before running it, append the flag. For example, run `openspec status --change "<name>" --json --store "<id>"`, not the unscoped form shown below. Other commands do not take the flag. Hints printed by commands already carry the flag; keep it on follow-ups. Without a store, commands act on the nearest local `openspec/` root.

**Project check:** These steps expect a project that already uses OpenSpec. Before the first step that writes anything (`new change`, `archive`, `sync specs`, or authoring an artifact file), confirm the project has a root: run `openspec list --json` (with `--store <id>` when a store is selected, since the store is then the root) and read `root`. A root object means the project is set up. `"root": null` means it is not - there is no `openspec/` directory here, and a write such as `openspec new change` would create one as a side effect. The command also exits non-zero, which is that answer rather than a broken CLI, so read the JSON instead of retrying or working around it.

One `"root": null` is not about setup: when a `status` error message starts with `Declared in` or `Invalid store declaration in` and names this project's `openspec/config.yaml` (or `config.yml`), the project does use OpenSpec through a store it declares, which this machine cannot resolve (the store is not registered, or the `store:` line is malformed). Do not treat it as uninitialized and skip the branches below: stop before writing and show the user that error's `message` and `fix`.

Otherwise, with no root, what happens next depends on how this workflow was reached:

- **Auto-selected**: you chose this workflow yourself, without the user naming OpenSpec, naming this skill, or running its slash command. Stop using OpenSpec and answer the request normally, as you would with no OpenSpec installed. Do not ask them to set anything up and do not mention OpenSpec setup.
- **Explicit OpenSpec request**: the user named OpenSpec, named this skill, or ran its slash command. Stop before writing and ask how to proceed: set this project up (`openspec init`), target a store they already have (`--store <id>`), or continue without OpenSpec for this request. Wait for their answer.

In both branches, never create the root as a side effect: do not run `openspec init` until the user asks for it, do not hand-create `openspec/` files, and do not let a command create it.

**Delegation tiers**

Use three agent tiers. Pick the smallest tier that fits the unit of work.

- **Planner** — high-end model at high reasoning effort. Owns scope, architecture, dependency decomposition, acceptance criteria, semantic merge/conflict decisions, and final synthesis. Use for ambiguity, cross-cutting choices, and deciding *what* is true or in scope.
- **Coordinator** — advanced/intermediate model at medium reasoning effort. Owns the authoritative progress state, task ownership, dispatch, joining results, serialized updates to shared state, verification of returned work, and workflow transitions. Use for orchestrating work the planner has already decomposed.
- **Worker** — economical model at high reasoning effort (or its own default). Executes ONE bounded, fully specified unit: a lookup, a draft, an edit, or a check. **Workers never delegate**, never spawn agents, never select another workflow, never expand scope, and never make unresolved planning decisions. A worker returns blockers instead of guessing.

**Model calibration** — read `models.json` from the resolved OpenSpec root's `openspec/` directory first (the same `root.path` this workflow already resolved; when a store is selected the store root wins). It holds the user's per-tier model and effort choices (`tiers.planner|coordinator|worker` → `{ model, effort }`). If that file is absent, use these advisory defaults; if a configured model is unavailable in this host, say so and fall back to the closest available model at the configured effort rather than blocking.

| Tier | Default model | Effort | Effort ladder for the default |
| --- | --- | --- | --- |
| planner | `openai/gpt-6.1-sol` | high | low · medium · high · xhigh · **max** |
| coordinator | `deepinfra/XiaomiMiMo/MiMo-V2.6-Pro` | high | toggle-only on native providers; where an effort ladder exists its ceiling is **high** (no max) |
| worker | `openai/gpt-6-luna` | max | none · low · medium · high · xhigh · **max** |

Alternatives that fit the same tier, with their verified ceilings: **Claude Opus 5.5** (low→max), **Gemini 4 Argon** (low·medium·**high** — no max, so "high" is its top), **Claude Haiku 5.5** (low→max), **DeepSeek V4.1 Flash 1017** (none·low·high·**max** — no medium), **MiMo-V2.6-Flash** (same ceiling as MiMo-V2.6-Pro: **high** where an effort ladder exists). Never claim an effort the model's ladder does not list; when unsure, use `high` or the model's `default`.

**Handoffs**

Every delegated prompt must be self-contained. Workers do not see the conversation. Include: the tier and the unit's goal; absolute paths for the project root, the change root, the exact input files, and the exact output file(s); the relevant context, rules, and acceptance criteria; any files the unit owns or must NOT touch; how to verify completion; and an explicit stop condition. Say in one line what to return: a changed-path list, evidence, or a blocker.

**Parallelism**

- **Fan out** every independent unit concurrently. Independence means disjoint file ownership AND no data/state dependency on another in-flight unit.
- **Sequence** dependent units: finish the producer, hand its output to the next tier explicitly, then run the consumer. A dependency is a reason to await a previous agent — not a reason to collapse everything into one agent.
- Dispatch all independent workers in one wave, then **join every started worker** before touching shared state (task checkboxes, status output, spec files, archive moves). Never release dependent work from a partially completed wave.
- Cap concurrency to what the host can actually run in parallel; when in doubt, prefer a few large bounded units over many tiny ones.

**Synchronization rules**

- The coordinator owns all checkbox/status updates and shared tracking files. Workers return evidence; they do not edit tracking state.
- Serialize any two units that write the same file, the same capability's spec, or the same shared resource (services, ports, browser sessions, lockfiles, generated output).
- When a write target cannot be partitioned cleanly, delegate the *analysis* in parallel and serialize the *writes*.
- Never run background work across an archive move; every delegate must be joined before the move.
- A unit that cannot be completed as specified returns a blocker with what it found. Do not silently narrow, defer, or drop specified behavior.

**Parallel opportunity**: after the context above is loaded, fan out read-only investigations — one per subsystem, capability, or factual question — and join the findings before any dependent decision. Keep every investigation bounded and evidence-only; do not let a research worker write files or choose between competing designs. Synthesize the combined findings in one place.

**Input**: The user's request should include a change name (kebab-case) OR a description of what they want to build.

**Steps**

1. **If no clear input provided, ask what they want to build**

   Ask the user (open-ended, no preset options):
   > "What change do you want to work on? Describe what you want to build or fix."

   From their description, derive a kebab-case name (e.g., "add user authentication" → `add-user-auth`).

   **IMPORTANT**: Do NOT proceed without understanding what the user wants to build.

2. **Determine the workflow schema**

   Use the default schema (omit `--schema`) unless the user explicitly requests a different workflow.

   **Use a different schema only if the user mentions:**
   - A specific schema name → use `--schema <name>`
   - "show workflows" or "what workflows" → run `openspec schemas --json` and let them choose

   **Otherwise**: Omit `--schema` to use the default.

3. **Create the change directory**
   ```bash
   openspec new change "<name>"
   ```
   Add `--schema <name>` only if the user requested a specific workflow.
   This creates a scaffolded change in the planning home resolved by the CLI.

4. **Show the artifact status**
   ```bash
   openspec status --change "<name>" --json
   ```
   Use the returned `planningHome`, `changeRoot`, `artifactPaths`, and `nextSteps` instead of assuming repo-local paths.

5. **Get instructions for the first artifact**
   The first artifact depends on the schema (e.g., `proposal` for spec-driven).
   Check the status output to find the first artifact with status "ready".
   ```bash
   openspec instructions <first-artifact-id> --change "<name>"
   ```
   This outputs the template and context for creating the first artifact.

6. **STOP and wait for user direction**

**Output**

After completing the steps, summarize:
- Change name and location
- Schema/workflow being used and its artifact sequence
- Current status (0/N artifacts complete)
- The template for the first artifact
- Prompt: "Ready to create the first artifact? Just describe what this change is about and I'll draft it, or ask me to continue."

**Guardrails**
- Do NOT create any artifacts yet - just show the instructions
- Do NOT advance beyond showing the first artifact template
- If the name is invalid (not kebab-case), ask for a valid name
- If a change with that name already exists, suggest continuing that change instead
- Pass --schema if using a non-default workflow
