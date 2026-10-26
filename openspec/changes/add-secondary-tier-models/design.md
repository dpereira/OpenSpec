# Design

## Context

`openspec/models.json` is currently version 1 and stores one `{ model, effort, note? }` selection for each entry in the explicit `AGENT_TIER_IDS` list. The CLI shows, sets, and resets those primary selections. The OpenCode tier assets are generated from `src/core/templates/opencode-tiers.ts`; their plugin currently selects a model only in `chat.message`, before a delegated prompt enters the model loop. It has no retry lifecycle or failure observation. The shared delegation guidance is generated from `src/core/templates/workflows/delegation.ts`.

The config resolver already uses `path.resolve`, `path.join`, and canonicalization for existing paths. Runtime health identity must build on a canonical config identity with platform-correct path semantics on macOS, Linux, and Windows. Tier and managed-asset enumeration must continue to use explicit lists/lookups (`AGENT_TIER_IDS` and existing managed asset constants), not regex-based or newly inferred detection.

The official OpenCode plugins documentation exposes a `session.error` event, but that alone does not establish retry control, safe resume, or a typed contract for a supported version. There is no SDK dependency installed that proves such a contract. Accordingly, the first implementation prerequisite is to identify and verify the supported version's typed lifecycle contract, including error data, retry/resume control, and safe continuation semantics. If that contract cannot be proven, stop native adapter work and report the blocker; do not invent a retry API or call config-only behavior completion of this change.

## Goals / Non-Goals

### Goals

- Preserve version 1 and every existing primary `{ model, effort, note? }`; add optional `secondary: { model, effort, note? }` per tier. Secondary effort is explicitly supplied when creating a secondary. Do not select provider defaults automatically, and reject identical primary and secondary model IDs.
- Give CLI/workflow users independent primary and secondary selection, inspection, and clearing. Show both slots, the fixed policy, and an honest capability status, without implying live health state. Preserve unrelated slot/tier selections on patch; retain reset behavior.
- Define a deterministic, bounded policy independently from host integration. Separate pure policy from the native adapter's lifecycle interpretation, retry ownership, quiescence, replay-safety check, structured error extraction, correlation, and probe-lease coordination.
- Generate managed host assets from source templates; do not hand-edit generated `.opencode` assets. Preserve explicit managed asset lists and lookups.
- Preserve delegation ownership/progress across routing only when the host proves continuation safe. Never replay uncertain tool side effects or silently claim partial output is safe.
- Provide observable, secret-free transition notifications and truthful capability reporting; no durable health file or user-tunable policy.

### Non-Goals

- Choosing or provisioning a default secondary/provider, guessing provider-specific model IDs, or changing primary-only host behavior.
- User-configurable retry/cooldown values, durable health persistence, answer-quality routing, or a general-purpose retry framework.
- In-dispatch model switching, retry/resume of a failed dispatch, or automatic resubmission of failed work.
- Capping or replacing the host's native retry ladder, or asking upstream hosts to change their APIs.

## Decisions

1. **Configuration and commands.** Keep config `version: 1`. Each tier has its existing primary fields and optional `secondary`. Add `--slot primary|secondary` (default `primary`) to `set`; `openspec models set --clear-secondary --tier <tier>` clears only that tier's secondary and rejects model, effort, note, or explicit slot options. Creating a secondary requires both model and explicit effort; updating an existing secondary preserves unspecified fields. Set/clear patches preserve all other tiers and slots. `show` in human and JSON forms includes both slots, the fixed policy, and a capability statement distinguishing configured/advisory/native support; it must not expose or imply live health state. `reset` continues to remove the project config and restore advisory defaults. Reject a primary/secondary pair with the same model ID.

2. **Availability evidence and persistence.** Each dispatch runs entirely on one admitted model using the host's own retry sequence. Failure evidence accumulates per pairing: host retry observations and dispatch terminal failures are normalized into categories (authentication, credits/quota, unavailable model, transport, rate limit, overload, server). The pairing moves to secondary only with persistent evidence in one category — consistent observations across the host's retries within one dispatch (a retried dispatch already supplies several), or two consecutive failed dispatches when the host does not retry (authentication, credits/quota, model unavailable). One un-retried failure never triggers the move. A success clears the accumulated evidence. Category changes and non-qualifying failures (task/tool, refusal, quality, invalid request, context limits, cancellation, unknown) never cool a pairing down.

3. **Dispatch attempt bounds.** A dispatch has exactly one attempt loop: the host's native retry sequence on its admitted model. Routing adds no overlapping retry budget, no mid-dispatch model switch, no switch back to primary within a pairing transition, and no tertiary model. The host's ladder is the bound (OpenCode 1.19.x performs an initial attempt plus up to five retries); that count is accepted and absorbed by the persistence rule rather than controlled. Provider retry delays are honored by the host's own sequence; routing introduces no delays of its own.

4. **Cooldown and recovery.** After persistent primary evidence, mark that primary pairing unavailable for 300 seconds in session memory and use the secondary for new dispatches in that scope. After expiry, allow one real dispatch to probe primary; concurrent work continues on secondary while that probe is leased. A successful probe clears cooldown. A qualifying availability failure of the probe reopens cooldown for 300 seconds immediately and is reported — the probe is the single bounded recovery check and does not wait for the two-dispatch threshold. A nonqualifying probe failure returns its blocker and releases the lease while leaving primary probe-eligible. Keep state keyed by canonical config identity, tier, and primary/secondary pairing fingerprint — shared across sessions in that configuration, since cooldown reflects provider health and must cover subsequent and concurrent work. A config edit resets state only for the changed tier on subsequent dispatch; in-flight dispatches retain their captured pair. Process/session restart clears state and never replays work.

   *Event correlation.* A session executes one dispatch at a time, so each `chat.message` admission records (sessionID, tier, pairing fingerprint) as that session's current dispatch scope; subsequent status/error events carrying that sessionID are recorded against it, and a later admission supersedes the record. Observations for a session with no admission record (auxiliary title/compaction activity that emits no session error) are ignored rather than attributed to a pairing.

5. **No-replay routing boundary.** Routing decides only which model a new dispatch admits on; it never retries, resumes, or resubmits a dispatch itself. A failed dispatch is reported once and its work is never re-executed — fallback applies to the next dispatch. This removes replay risk by construction: there is no in-dispatch continuation to duplicate tool effects or partial output. Preserve current primary-only behavior when no secondary is configured: no new controller or behavior on that path.

6. **Verified host seams and generation.** Cross-dispatch routing needs two host hook surfaces, both verified on OpenCode 1.19.4 with `scripts/manual/opencode-lifecycle-check.mjs`: per-dispatch model selection at admission (`chat.message`) and failure/status observation (`event` with session status/error). No retry/resume API is required or used; where a host lacks these seams, report advisory and do not claim enforcement. Change source templates and explicit managed-asset declarations as needed, then regenerate assets through the project generation path; never hand-edit generated `.opencode` files. Keep path operations platform-native with `path.join`/`path.resolve` and canonical identity, without string path assumptions.

7. **Visibility.** Runtime transition notifications identify slot, model, effort, attempt count, normalized category, and cooldown/probe state. They must not include prompts, credentials, or secret-bearing raw errors. `show` reports fixed policy and honest host capability, not mutable runtime state.

8. **Portable generated runtime.** Emit the policy and adapter as self-contained code in the existing generated router plugin through the build/template pipeline. Target projects must not depend on this repository's `src/` layout or a globally installed OpenSpec package import. Execute the emitted plugin in an isolated temporary target project during verification. This preserves the existing explicit managed-asset inventory rather than adding untracked runtime files.

9. **Activation evidence.** Current assets on disk establish installation readiness, not that a running host loaded them. CLI output reports readiness separately from activation; only a running supported adapter can attest active enforcement. A newly installed or changed plugin requires restart. If loaded-version evidence is unavailable, report activation as unverified rather than inferring it from file equality.

### Alternatives considered

- A nested `primary` object or a required format migration would break existing consumers; additive version-1 `secondary` preserves current fields and defaults.
- Immediate failover or unlimited host retries would contradict the requested persistence threshold and bounded retry budget; one initial attempt plus two retries makes both outcomes testable.
- Per-request fallback would repeatedly hit an unhealthy provider; a fixed session-local cooldown with one probe reduces that traffic without introducing durable health files or background requests.
- Arbitrary closest-model substitution would bypass user selection; only the configured secondary is eligible. Primary-only configurations keep their current host behavior.
- Duplicating policy inside an event-only plugin would obscure retry ownership; one testable policy emitted into a verified host adapter keeps native behavior and tests aligned.

## Risks / Trade-offs

- **Host retry ladder is not configurable.** OpenCode 1.19.x runs an initial attempt plus up to five retries per dispatch and exposes no hook to cap them. The persistence rule absorbs that count (a retried dispatch already carries multiple consistent observations), so failover timing differs between retried and un-retried failures — accepted to stay within shipped host behavior.
- **Error normalization is provider-sensitive.** Structured errors may be absent or ambiguous. Unknown/mixed categories therefore never cool a pairing down; this favors avoiding wrong reroutes over availability.
- **Cross-dispatch fallback loses in-flight work.** A failed dispatch is not resumed; its work item must be re-dispatched to land on the secondary. Accepted: replaying or resubmitting failed work is explicitly out of scope.
- **Session-local cooldown is intentionally ephemeral.** Restarts clear health and may retry a degraded primary; durable cross-session health is excluded to avoid persistence and stale-state complexity.
- **Concurrent recovery needs correct lease identity.** Canonical config identity must be stable across symlink/case/platform differences where the filesystem permits. Pairing fingerprints isolate edits; lease coordination and in-flight snapshots prevent duplicate probes or retroactive rerouting.
- **Provider-sensitive host delay behavior.** Retry delays are the host's own contract; routing introduces none, so a hostile or overlong provider delay affects the dispatch but never extends routing state incorrectly.

## Migration Plan

1. Record the verified host seams with the disposable lifecycle harness (per-dispatch model selection at admission, failure/status observation) and keep the advisory path for hosts lacking them.
2. Extend version-1 config parsing/validation and merge/clear operations compatibly: existing files without `secondary` remain valid and their primary selections remain unchanged. Enforce explicit secondary effort and distinct model IDs.
3. Update CLI surfaces and generated models/delegation guidance for independent slots, the cross-dispatch policy, and truthful capability reporting; preserve primary defaults and reset semantics.
4. Implement and deterministically test the dispatch-level persistence policy and session state. Test category classification, observation accumulation, cooldown/probe concurrency, config edits, and restart semantics.
5. Update OpenCode source templates and explicit managed-asset declarations, regenerate generated assets, and verify generated behavior and primary-only compatibility. Report activation honestly: installed assets prove readiness, not live enforcement.

## Host Seam Verification

Cross-dispatch routing depends on exactly two host hook surfaces. `scripts/manual/opencode-lifecycle-check.mjs` verified both on OpenCode 1.19.4 and recorded the transcript in `notes/native-lifecycle-contract.md`:

- `chat.message` carries session identity and can select the dispatch's model — the admission seam.
- `event` delivers session status (host retry attempts) and session error — the failure-observation seam.

The same check documented that no hook can switch models within a dispatch and none can cap the host's retry ladder; those capabilities are out of scope by design, not blockers. Where a host lacks these seams, the workflow reports advisory behavior.
