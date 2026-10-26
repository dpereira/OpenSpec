/**
 * Shared tiered-delegation guidance for skill and command templates.
 *
 * One body serves both surfaces so they cannot drift (same approach as
 * project-root.ts / store-selection.ts). It is intentionally self-contained:
 * generated skills ship as a single SKILL.md and cannot import a helper.
 */

/**
 * The three-tier delegation contract plus model calibration and handoff
 * shape. Written to avoid mutation vocabulary so workflows that gate every
 * edit behind a confirmation step (update-change, #1836) can carry the tier
 * teaching without weakening that gate.
 */
export const DELEGATION_TIERS = `**Delegation tiers**

Use three agent tiers. Pick the smallest tier that fits the unit of work.

- **Planner** — high-end model at high reasoning effort. Owns scope, architecture, dependency decomposition, acceptance criteria, semantic merge/conflict decisions, and final synthesis. Use for ambiguity, cross-cutting choices, and deciding *what* is true or in scope.
- **Coordinator** — advanced/intermediate model at medium reasoning effort. Owns the authoritative progress state, task ownership, dispatch, joining results, serialized updates to shared state, verification of returned work, and workflow transitions. Use for orchestrating work the planner has already decomposed.
- **Worker** — economical model at high reasoning effort (or its own default). Executes ONE bounded, fully specified unit: a lookup, a draft, an edit, or a check. **Workers never delegate**, never spawn agents, never select another workflow, never expand scope, and never make unresolved planning decisions. A worker returns blockers instead of guessing.

**Model calibration** — read \`models.json\` from the resolved OpenSpec root's \`openspec/\` directory first (the same \`root.path\` this workflow already resolved; when a store is selected the store root wins). Each tier contains its existing primary \`{ model, effort, note? }\` and may independently contain \`secondary: { model, effort, note? }\`. The secondary has its own explicit effort (never inherit the primary's effort); primary and secondary model IDs must differ. A note is optional for each pairing. If the file is absent, use these advisory defaults. Do not choose a default secondary. If no secondary is configured, the tier remains primary-only with existing host behavior; never substitute the nearest available or unconfigured model. If a configured model is unavailable, report that fact.

**Fixed routing policy (only enforced by a verified native host)** — Each dispatch runs entirely on one admitted model using the host's own retry sequence; routing adds no retry budget or in-dispatch model switching. Persistent consistent availability failures move later dispatches to the configured secondary: consistent observations within a retried dispatch, or two consecutive un-retried failed dispatches. A single un-retried failure never moves the tier. The pairing then enters a 300-second cooldown so later dispatches use secondary; after expiry exactly one real dispatch probes primary recovery. Failed work is reported and never replayed or resubmitted. There is no tertiary or nearest-unconfigured substitute. Availability categories: authentication, credits/quota, unavailable model, transport, rate limit, overload, server failure. Task/tool failures, refusals, answer quality, invalid requests, context limits, cancellation, and unknown errors never move the tier.

**Activation truth** — Report \`advisory\` when the host cannot enforce the policy, \`restart-required\` when native assets were just installed or changed, and \`native\` only when a verified host contract enforces it. On-disk assets prove installation readiness only; they do not prove that a running host loaded or enforces them. Report runtime enforcement only when attested, and never fabricate runtime health. Advisory guidance does not promise automatic fallback or cooldown.

| Tier | Default model | Effort | Effort ladder for the default |
| --- | --- | --- | --- |
| planner | \`openai/gpt-6.1-sol\` | high | low · medium · high · xhigh · **max** |
| coordinator | \`deepinfra/XiaomiMiMo/MiMo-V2.6-Pro\` | high | toggle-only on native providers; where an effort ladder exists its ceiling is **high** (no max) |
| worker | \`openai/gpt-6-luna\` | max | none · low · medium · high · xhigh · **max** |

Alternatives that fit the same tier, with their verified ceilings: **Claude Opus 5.5** (low→max), **Gemini 4 Argon** (low·medium·**high** — no max, so "high" is its top), **Claude Haiku 5.5** (low→max), **DeepSeek V4.1 Flash 1017** (none·low·high·**max** — no medium), **MiMo-V2.6-Flash** (same ceiling as MiMo-V2.6-Pro: **high** where an effort ladder exists). Never claim an effort the model's ladder does not list; when unsure, use \`high\` or the model's \`default\`.

**Handoffs**

Every delegated prompt must be self-contained. Workers do not see the conversation. Include: the tier and the unit's goal; absolute paths for the project root, the change root, the exact input files, and the exact output file(s); the relevant context, rules, and acceptance criteria; any files the unit owns or must NOT touch; how to verify completion; and an explicit stop condition. Say in one line what to return: a changed-path list, evidence, or a blocker.`;

/**
 * Parallelism and synchronization rules. Separate from DELEGATION_TIERS so a
 * workflow whose edits are gated behind confirmation can carry the tier
 * teaching alone.
 */
export const DELEGATION_GUIDANCE = `${DELEGATION_TIERS}

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
- A unit that cannot be completed as specified returns a blocker with what it found. Do not silently narrow, defer, or drop specified behavior.`;

/**
 * Per-workflow guidance fragment: when and how to decompose THIS workflow.
 * Workflows import the one that matches their stage structure.
 */

/** Independent research/explore fan-out; synthesis stays centralized. */
export const DELEGATION_PARALLEL_READONLY = `**Parallel opportunity**: after the context above is loaded, fan out read-only investigations — one per subsystem, capability, or factual question — and join the findings before any dependent decision. Keep every investigation bounded and evidence-only; do not let a research worker write files or choose between competing designs. Synthesize the combined findings in one place.`;

/** Ready-sibling artifact drafting in dependency waves. */
export const DELEGATION_ARTIFACT_WAVES = `**Parallel opportunity**: build the artifact set in dependency waves. When two artifacts share no \`requires\` edge and write different paths, draft them concurrently (one worker each, given its own \`openspec instructions <id>\` payload and output path). Reconcile and review the combined results before a dependent artifact reads them, and never mark an artifact complete until every expected output file exists and has been reviewed.`;

/** Task implementation with dependency/file-overlap grouping. */
export const DELEGATION_TASK_EXECUTION = `**Parallel opportunity**: before starting the task loop, group the remaining tasks by dependency and file ownership. Independent tasks with disjoint write sets run concurrently as bounded worker units, each handed its task IDs, context files, acceptance criteria, and owned paths. Sequential handoff is the default for dependent tasks (a consumer waits for its producer's output). Serialize tasks that share a file, a test fixture, a running service, or the task checklist itself. The coordinator joins every unit, re-reads its outputs, verifies the task's stated completion criteria, and only then marks its checkbox. Never parallelize two tasks that edit the same file, and never mark a task complete on a partial result.`;

/** Verification fan-out; findings centralized, no fixes. */
export const DELEGATION_VERIFICATION = `**Parallel opportunity**: fan out read-only verification — task accounting, requirement/operation coverage per capability, scenario evidence, and design adherence can each be checked concurrently. Prefer one evidence lookup that answers both completeness and correctness over duplicate searches. Workers report findings only: no fixes, no checkbox edits, no archive. Join every check, de-duplicate findings, then resolve severity and any contradiction centrally before reporting.`;

/** Per-file spec merge where files are disjoint. */
export const DELEGATION_PARALLEL_WRITES = `**Parallel opportunity**: when the work partitions by output file (for example, delta specs targeting distinct capability paths or main-spec files), delegate one bounded merge per disjoint file and run them concurrently. Group every delta that touches the same file into one serial unit — even when the requirement blocks differ — and join all writers before validation or any move. Ambiguous semantic merges and conflicts go to the planner, not to a worker.`;

/** Read-only cross-artifact review; mutations stay serial and confirmed. */
export const DELEGATION_SEQUENTIAL_WRITES = `**Parallel opportunity**: gather read-only review of how a proposed change affects each artifact concurrently, then reconcile the combined impact centrally before touching any artifact. Land the changes one artifact at a time in dependency order, pausing for the user's confirmation as this workflow requires — a dependent artifact must never be touched before its predecessor's change is confirmed.`;

/** Bounded fan-out inside a single selected artifact. */
export const DELEGATION_ONE_ARTIFACT = `**Parallel opportunity**: work only the one artifact this invocation selected. Inside it, gather evidence and read-only context concurrently, and split writes across disjoint output files when the artifact spans several. Join every unit, then verify every expected output file exists and is complete before reporting done. Do not pick up another ready artifact just because it exists — that is a separate invocation.`;

/** Pre-archive checks and per-capability assessment fan-out. */
export const DELEGATION_PREFLIGHT = `**Parallel opportunity**: after scope is fixed, gather independent checks and per-capability assessments concurrently. Then serialize the mutations: warnings, user confirmation, any requested spec sync (fully joined, stop on failure), the structure/content check of every delta, and only then the move of the change directory. Nothing may still be running when the move happens.`;
