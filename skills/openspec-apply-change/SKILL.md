---
name: openspec-apply-change
description: Implement tasks from an OpenSpec change. Use when the user wants to start implementing, continue implementation, or work through tasks. Also use when the user says "openspec apply", "opsx apply", or "openspec implement".
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
---

Implement tasks from an OpenSpec change.

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

**Model calibration** — read `models.json` from the resolved OpenSpec root's `openspec/` directory first (the same `root.path` this workflow already resolved; when a store is selected the store root wins). Each tier contains a primary `{ model, effort, note? }` and may independently contain a `secondary: { model, effort, note? }`. When the file is absent, the advisory defaults below include both pairings; they remain advisory until the user confirms persistence. Existing project files without a secondary remain primary-only until the user configures one. Each pairing has its own effort; the model IDs in a tier's pair must differ. If a configured model is unavailable, report that fact.

**Fixed routing policy (only enforced by a verified native host)** — Each dispatch runs entirely on one admitted model using the host's own retry sequence; routing adds no retry budget or in-dispatch model switching. Persistent consistent availability failures move later dispatches to the configured secondary: consistent observations within a retried dispatch, or two consecutive un-retried failed dispatches. A single un-retried failure never moves the tier. The pairing then enters a 300-second cooldown so later dispatches use secondary; after expiry exactly one real dispatch probes primary recovery. Failed work is reported and never replayed or resubmitted. There is no tertiary or nearest-unconfigured substitute. Availability categories: authentication, credits/quota, unavailable model, transport, rate limit, overload, server failure. Task/tool failures, refusals, answer quality, invalid requests, context limits, cancellation, and unknown errors never move the tier.

**Activation truth** — Report `advisory` when the host cannot enforce the policy, `restart-required` when native assets were just installed or changed, and `native` only when a verified host contract enforces it. On-disk assets prove installation readiness only; they do not prove that a running host loaded or enforces them. Report runtime enforcement only when attested, and never fabricate runtime health. Advisory guidance does not promise automatic fallback or cooldown.

| Tier | Default primary | Effort | Default secondary | Effort | Verified effort ladders |
| --- | --- | --- | --- | --- | --- |
| planner | `openai/gpt-6.1-sol` | high | `deepinfra/XiaomiMiMo/MiMo-V2.6-Pro` | high | OpenAI: low · medium · high · xhigh · **max**; MiMo ceiling is **high** (no max) |
| coordinator | `openai/gpt-6.1-sol` | medium | `deepinfra/XiaomiMiMo/MiMo-V2.6-Pro` | high | OpenAI: low · medium · high · xhigh · **max**; MiMo ceiling is **high** (no max) |
| worker | `openai/gpt-6-luna` | max | `deepinfra/XiaomiMiMo/MiMo-V2.6-Flash` | high | Luna: none · low · medium · high · xhigh · **max**; MiMo Flash ceiling is **high** |

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

**Input**: Optionally specify a change name (e.g., `/openspec-apply-change add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and ask the user to select one

   Always announce: "Using change: <name>" and how to override (e.g., `/openspec-apply-change <other>`).

2. **Check status to understand the schema**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - `planningHome`, `changeRoot`, and `actionContext`: planning scope and edit constraints
   - Which artifact contains the tasks (typically "tasks" for spec-driven, check status for others)

3. **Get apply instructions**

   ```bash
   openspec instructions apply --change "<name>" --json
   ```

   This returns:
   - `contextFiles`: artifact ID -> array of concrete file paths (varies by schema - could be proposal/specs/design/tasks or spec/tests/implementation/docs)
   - Progress (total, complete, remaining)
   - Task list with status, source path, and source line
   - Dynamic instruction based on current state
   - Optional `context`: current required project instruction input from the selected root
   - Optional `operationGuidance`: current advisory guidance for apply
   - `missingArtifacts` (when present): required artifact ids with no output

   **Handle states:**
   - If `state: "blocked"`: show the message and pause implementation.
     - If `missingArtifacts` is non-empty: suggest using `/openspec-continue-change` to create them.
     - Otherwise, follow the CLI instruction to create or repair the schema-configured tracking file from existing planning artifacts. Do not assume another artifact is ready or start implementation while blocked.
   - If `state: "all_done"`: report that all tracked tasks are complete and suggest review or verification as appropriate before archiving
   - Otherwise: proceed to implementation

   Treat `context` as a required prompt-level input. Read and consider it, and
   apply relevant project facts, conventions, and constraints while implementing.
   Treat `operationGuidance` as optional additive advice. Read and consider every
   entry, and follow entries that are applicable and compatible with the built-in
   workflow.

   Keep both fields separate from CLI-returned state, missing artifacts, tasks,
   progress, `contextFiles`, and the built-in `instruction`. They are not
   evidence of task completion, do not replace the built-in instruction, and do
   not permit bypassing a blocked state. If context conflicts with the built-in
   instruction, an explicit user choice, or a CLI-controlled value, report the
   conflict and preserve the controlling value. If guidance is inapplicable or
   conflicts with those controlling inputs, do not follow it and explain why.
   These are prompt-level behavior contracts, not enforceable checks.

4. **Read context files**

   Read every file path listed under `contextFiles` from the apply instructions output.
   The files depend on the schema being used:
   - **spec-driven**: proposal, specs, design, tasks
   - Other schemas: follow the contextFiles from CLI output

   Do not copy `context` or `operationGuidance` verbatim into implementation
   files or planning artifacts unless the user separately asks for that content.

5. **Show current progress**

   Display:
   - Schema being used
   - Progress: "N/M tasks complete"
   - Remaining tasks overview
   - Dynamic instruction from CLI

6. **Implement tasks (loop until done or blocked)**

   **Parallel opportunity**: before starting the task loop, group the remaining tasks by dependency and file ownership. Independent tasks with disjoint write sets run concurrently as bounded worker units, each handed its task IDs, context files, acceptance criteria, and owned paths. Sequential handoff is the default for dependent tasks (a consumer waits for its producer's output). Serialize tasks that share a file, a test fixture, a running service, or the task checklist itself. The coordinator joins every unit, re-reads its outputs, verifies the task's stated completion criteria, and only then marks its checkbox. Never parallelize two tasks that edit the same file, and never mark a task complete on a partial result.

   For each pending task (or each worker unit covering one or more pending tasks):
   - Show which task is being worked on
   - Make the code changes required
   - Keep changes minimal and focused
   - Before editing, confirm the checkbox at the returned `sourcePath` and `line` still matches the task description; if it does not, rerun the apply instructions and use the refreshed location
   - Verify the task's own stated completion criteria (its test, command, observable behavior, or delivered artifact) before marking it done. The coordinator performs the checkbox update, not the worker
   - Mark the task complete at its returned `sourcePath` and `line`: `- [ ]` → `- [x]`
   - Rerun the apply instructions and confirm that task is now done and progress changed
   - Continue to next task

   **Pause if:**
   - Task is unclear → ask for clarification
   - Implementation reveals a design issue → suggest updating artifacts
   - A task needs work beyond what the spec and tasks describe, or you are tempted to drop, narrow, defer, or accept exceptions to specified behavior to make it fit → surface the added scope and ask; do not absorb it silently
   - Error or blocker encountered → report and wait for guidance
   - User interrupts

7. **Verify before declaring completion**

   After the last task's checkbox is updated (not before), run the project's required checks: the test suites and commands the tasks and project instructions call for, and any build/type/lint checks that gate this codebase. Independent, safe suites run concurrently; serialize suites that share mutable services, ports, browser sessions, or other state. Gather every result; a failing required check means the affected tasks are not done — reopen the work and pause for guidance rather than reporting success.

8. **On completion or pause, show status**

   Display:
   - Tasks completed this session
   - Overall progress: "N/M tasks complete"
   - If all done: report that tracked tasks are complete and suggest review or verification as appropriate before archiving
   - If paused: explain why and wait for guidance

**Output During Implementation**

```
## Implementing: <change-name> (schema: <schema-name>)

Working on task 3/7: <task description>
[...implementation happening...]
✓ Task complete

Working on task 4/7: <task description>
[...implementation happening...]
✓ Task complete
```

**Output On Completion**

```
## Implementation Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 7/7 tasks complete ✓

### Completed This Session
- [x] Task 1
- [x] Task 2
...

All tracked tasks are complete. Review or verify the change as appropriate
before archiving. You can archive this change with `/openspec-archive-change`.
```

**Output On Pause (Issue Encountered)**

```
## Implementation Paused

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 4/7 tasks complete

### Issue Encountered
<description of the issue>

**Options:**
1. <option 1>
2. <option 2>
3. Other approach

What would you like to do?
```

**Guardrails**
- Keep going through tasks until done or blocked
- Always read context files before starting (from the apply instructions output)
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Keep code changes minimal and scoped to each task
- Update task checkbox immediately after completing each task
- Pause on errors, blockers, or unclear requirements - don't guess
- When a task needs work beyond what the spec describes, surface the added scope and pause - never silently narrow, defer, or simplify away specified behavior
- Only mark a task `- [x]` when its specified behavior is fully implemented, not when it is partially done or deferred
- Use contextFiles from CLI output, don't assume specific file names
- Use each task's sourcePath and line to update its exact checkbox
- Do not use context or operation guidance as proof that a task is complete
- Apply relevant project context; report conflicts with controlling workflow inputs
- Consider every guidance entry; explain any inapplicable or conflicting advice
- Do not copy runtime context or operation guidance into implementation files or planning artifacts
- Preserve CLI-controlled blocked/ready/all-done behavior and completion criteria

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
