---
name: openspec-update-change
description: Update an OpenSpec change by revising its existing planning artifacts and keeping them coherent with one another. Use when the user wants to revise a change's plan, fold new decisions into it, or reconcile its artifacts after an edit. Also use when the user says "openspec update change" or "opsx update". If the user means the openspec update CLI command, which refreshes generated files, run that command instead. Never edits code.
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
---

Revise a change's existing planning artifacts and keep them coherent. Never edit code.

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

**Model calibration** — read `models.json` from the resolved OpenSpec root's `openspec/` directory first (the same `root.path` this workflow already resolved; when a store is selected the store root wins). Each tier contains its existing primary `{ model, effort, note? }` and may independently contain `secondary: { model, effort, note? }`. The secondary has its own explicit effort (never inherit the primary's effort); primary and secondary model IDs must differ. A note is optional for each pairing. If the file is absent, use these advisory defaults. Do not choose a default secondary. If no secondary is configured, the tier remains primary-only with existing host behavior; never substitute the nearest available or unconfigured model. If a configured model is unavailable, report that fact.

**Fixed routing policy (only enforced by a verified native host)** — Each dispatch runs entirely on one admitted model using the host's own retry sequence; routing adds no retry budget or in-dispatch model switching. Persistent consistent availability failures move later dispatches to the configured secondary: consistent observations within a retried dispatch, or two consecutive un-retried failed dispatches. A single un-retried failure never moves the tier. The pairing then enters a 300-second cooldown so later dispatches use secondary; after expiry exactly one real dispatch probes primary recovery. Failed work is reported and never replayed or resubmitted. There is no tertiary or nearest-unconfigured substitute. Availability categories: authentication, credits/quota, unavailable model, transport, rate limit, overload, server failure. Task/tool failures, refusals, answer quality, invalid requests, context limits, cancellation, and unknown errors never move the tier.

**Activation truth** — Report `advisory` when the host cannot enforce the policy, `restart-required` when native assets were just installed or changed, and `native` only when a verified host contract enforces it. On-disk assets prove installation readiness only; they do not prove that a running host loaded or enforces them. Report runtime enforcement only when attested, and never fabricate runtime health. Advisory guidance does not promise automatic fallback or cooldown.

| Tier | Default model | Effort | Effort ladder for the default |
| --- | --- | --- | --- |
| planner | `openai/gpt-6.1-sol` | high | low · medium · high · xhigh · **max** |
| coordinator | `deepinfra/XiaomiMiMo/MiMo-V2.6-Pro` | high | toggle-only on native providers; where an effort ladder exists its ceiling is **high** (no max) |
| worker | `openai/gpt-6-luna` | max | none · low · medium · high · xhigh · **max** |

Alternatives that fit the same tier, with their verified ceilings: **Claude Opus 5.5** (low→max), **Gemini 4 Argon** (low·medium·**high** — no max, so "high" is its top), **Claude Haiku 5.5** (low→max), **DeepSeek V4.1 Flash 1017** (none·low·high·**max** — no medium), **MiMo-V2.6-Flash** (same ceiling as MiMo-V2.6-Pro: **high** where an effort ladder exists). Never claim an effort the model's ladder does not list; when unsure, use `high` or the model's `default`.

**Handoffs**

Every delegated prompt must be self-contained. Workers do not see the conversation. Include: the tier and the unit's goal; absolute paths for the project root, the change root, the exact input files, and the exact output file(s); the relevant context, rules, and acceptance criteria; any files the unit owns or must NOT touch; how to verify completion; and an explicit stop condition. Say in one line what to return: a changed-path list, evidence, or a blocker.

**Parallel opportunity**: gather read-only review of how a proposed change affects each artifact concurrently, then reconcile the combined impact centrally before touching any artifact. Land the changes one artifact at a time in dependency order, pausing for the user's confirmation as this workflow requires — a dependent artifact must never be touched before its predecessor's change is confirmed.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

This workflow revises artifacts that already exist; `/openspec-continue-change` is what creates the ones that do not.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes sorted by most recently modified, and ask the user to select one

   When prompting, present the top 3-4 most recently modified changes as options, showing:
   - Change name
   - Status (e.g., "0/5 tasks", "complete", "no tasks")
   - How recently it was modified (from `lastModified` field)

   Mark the most recently modified change as "(Recommended)" since it's likely what the user wants to update.

   Always announce: "Using change: <name>" and how to override (e.g., `/openspec-update-change <other>`).

2. **Get the change's artifacts**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to understand current state. The response includes:
   - `schemaName`: The workflow schema being used (e.g., "spec-driven")
   - `artifacts`: Array of artifacts with their status ("done", "skipped", "ready", "blocked")
   - `isPlanningComplete`: Boolean indicating if all planning artifacts are complete. Older CLI versions expose the same value as `isComplete`.
   - `planningHome`, `changeRoot`, `artifactPaths`, and `actionContext`: path and scope context. Use these instead of assuming repo-local paths.

   The artifact ids and paths come from the active schema - do NOT assume them, and do NOT branch on hardcoded artifact names. Custom schemas must work unchanged.

   The files to edit are `artifactPaths.<id>.existingOutputPaths` - the concrete files that exist on disk, already glob-expanded for glob artifacts (e.g. `specs/**/*.md`), plus any confirmed concrete path allowed under a partly populated glob artifact (step 4). Do NOT write to `resolvedOutputPath`: for a glob artifact it is still the glob pattern, not a real file.

3. **Understand the request**
   - If the user asked for a specific revision ("the design now uses X"), that is the starting edit.
   - If they only said "update" / "make this coherent", treat it as a coherence review: read the existing artifacts and check them against each other for contradictions, gaps, and duplication.

4. **Read and reconcile**
   - Read the artifact(s) the request touches and the change's other existing artifacts.
   - Draft the requested edit in the conversation, not in files. Work out exactly what it changes; step 5 owns every write. Then check every other existing artifact against the drafted edit - in ANY direction: an edit to a later artifact may require revising an earlier one, not only the other way around. Build order is a useful reading order, not a constraint on which artifacts may be revised.
   - Note everything that is now inconsistent, missing, or contradictory.
   - Propose revisions to files that already exist (`existingOutputPaths`). If an artifact has no existing output files and status `ready` or `blocked`, note it and point the user to `/openspec-continue-change` to create them. Leave `skipped` artifacts untouched; do not treat them as missing or defer them to the continue workflow.
   - A glob artifact (e.g. `specs/**/*.md`) is marked `done` after at least one file matches, and the continue workflow only handles `ready` artifacts. When reconciliation identifies a missing file for a glob artifact whose `existingOutputPaths` is non-empty:
     1. Run `openspec instructions "<artifact-id>" --change "<name>" --json` and use its `instruction` and `template`. Treat `context` and `rules` as constraints; do not copy them into the file. If instructions report `skipped: true`, do not create the file. Read current dependency files from disk; if a required non-skipped dependency is missing, stop and ask the user to restore it first.
     2. Choose a concrete path inside `changeRoot` that matches `artifactPaths.<id>.outputPath` and does not already exist. Verify it remains inside `changeRoot` after resolving any symlinked parent directories. The glob `resolvedOutputPath` is not a valid target.
     3. Include the new file in step 5's proposed revisions and create it only after the user confirms.
     4. After confirmation, immediately before creation, refresh status and instructions. Verify the artifact is still in scope, not skipped, and partially populated; repeat the concrete-path checks above.
     5. Use a create operation that fails if the target already exists. If `instruction` delegates creation to another skill or command, invoke it only if it can honor the confirmed path and these guardrails; otherwise stop. If any check fails or the confirmed draft is no longer valid, stop and reconcile with the user rather than replacing existing content or choosing a different path.
   - If the change is already coherent, say so and propose no revisions.

5. **Confirm and apply, one artifact at a time**
   - This step performs every artifact write in this workflow; no earlier step edits an artifact.
   - Show each proposed revision and why - including the requested edit drafted in step 4. Write only after the user confirms.
   - If the user rejects a revision, do not write it - leave that artifact unchanged.
   - When a substantial rewrite is needed, get that artifact's rules and template first:
     ```bash
     openspec instructions "<artifact-id>" --change "<name>" --json
     ```

6. **Point to the next step (guidance only - NEVER act on it)**
   - Artifacts with empty `existingOutputPaths` and status `ready` or `blocked` -> suggest `/openspec-continue-change` to create them.
   - Change already implemented (tasks checked off / already applied) -> the code may no longer match the revised plan; suggest `/openspec-apply-change` to carry the delta into code.
   - Everything done and implemented -> suggest `/openspec-archive-change`.

**Output**

After each invocation, show:
- Which artifacts were revised (and which proposed revisions were rejected)
- Any file created under a glob artifact that was already partially populated
- Anything deferred to `/openspec-continue-change` (artifacts with no files yet and status `ready` or `blocked`, never `skipped` artifacts)
- Where the change stands and the recommended next command

**Guardrails**
- Planning artifacts only - NEVER edit implementation code. If the revised plan implies code changes, stop and point to `/openspec-apply-change`.
- Use the artifact ids and paths reported by `openspec status`; never branch on hardcoded artifact names.
- Edit only the concrete files in `existingOutputPaths`, plus any confirmed concrete path allowed under a partly populated glob artifact (step 4); never write to a glob `resolvedOutputPath`.
- Do not advance the build frontier: if an artifact has empty `existingOutputPaths` and status `ready` or `blocked`, that is `/openspec-continue-change`'s job. Leave `skipped` artifacts untouched. The only new-file scope is a confirmed concrete path under a glob artifact whose `existingOutputPaths` is non-empty.
- Confirm every edit with the user before writing.
- If the request changes the change's *intent* rather than refining it, recommend starting fresh with `/openspec-new-change` (the "Update vs. Start Fresh" heuristic).
