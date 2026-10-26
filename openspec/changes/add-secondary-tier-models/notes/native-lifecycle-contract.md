# Native lifecycle contract gate — BLOCKED

## Verdict

**BLOCKED on the installed host.** The check pins **OpenCode `1.19.4`** (OpenCode 1 line), the binary actually running (`opencode --version`, `opencode debug info`, `/home/diego/.opencode/bin/opencode`). The disposable harness ran against it on 2026-10-25 and proved that three of the six required lifecycle capabilities are missing and one is only partial. Task 1.1 stays unchecked; tasks 6.1–6.3 stay unreachable.

Harness: `scripts/manual/opencode-lifecycle-check.mjs` (manual, outside the `test/**/*.test.ts` CI glob). It starts two local fake OpenAI-compatible endpoints, writes a disposable project with a probe plugin, runs one `opencode run` dispatch, and prints a JSON verdict plus hook/request transcripts. No real provider is contacted.

## Harness result (2026-10-25T14:00Z, OpenCode 1.19.4)

Command: `node scripts/manual/opencode-lifecycle-check.mjs`

```json
{
  "hostVersion": "1.19.4",
  "exitCode": 1,
  "requestCounts": { "primary": 9 },
  "hookSummary": {
    "v1.server.invoked": 1,
    "v1.event": 80,
    "v1.chat.message": 1,
    "v1.chat.params": 7,
    "wrap.setup": 1,
    "wrap.session.absent": 1,
    "wrap.registered": 1
  },
  "verdict": "BLOCKED: required native lifecycle capabilities are missing or unproven on this host"
}
```

Transcripts were written under `/tmp/openspec-lifecycle-check-*`: `hook-log.jsonl` (92 entries), `request-log.jsonl` (9 provider calls), `verdict.json`.

Observed behavior in the transcript:

- The probe plugin loaded through **both** surfaces: the v1 `server()` hooks object and the v2-style `default.setup(ctx)` adapter.
- The v2 plugin context keys are exactly `options, agent, aisdk, catalog, command, integration, plugin, reference, skill` — **no `session` domain**. `ctx.session.hook("retry", …)` is therefore unavailable (`wrap.session.absent`).
- `ctx.aisdk.language(...)` registration succeeds (`wrap.registered`) but the callback is **never invoked** for normal dispatches (`wrap.install` absent). The active 1.19.x session loop builds its language model on the legacy provider stack (`provider.getLanguage` → `sdk.languageModel`), which does not consult the v2 AISDK hook registry. The hook only serves the experimental v2 session runner.
- `chat.message` fires once per user message with `sessionID`, `agent`, `model`; `chat.params` and `chat.headers` fire **once per retry attempt** with the same correlation. `event` delivers `session.status` per retry, `session.error` at halt, and message/part events.
- The host's own retry ladder is visible on the wire: 6 same-model attempts for the main dispatch (initial + 5, `RETRY_MAX_RETRIES = 5` in `packages/opencode/src/session/retry.ts`) plus 3 title-generation attempts, then a halt with the provider error. No hook can veto, shorten, or redirect that ladder.

## Required-capability assessment

| Required capability | Evidence / result |
| --- | --- |
| Dispatch/session correlation | **PRESENT.** `chat.message`/`chat.params`/`chat.headers` carry `sessionID`, `agent`, `model` (harness `v1.chat.*` entries). |
| Structured success/error outcomes | **PRESENT.** `event` stream delivers `session.status` (retry attempts), `session.error`, `session.idle`, `message.updated`/`message.part.*` (harness `v1.event` entries). |
| Retry ownership and host-internal attempt accounting | **MISSING.** No `session.retry` hook exists in the 1.19.x plugin API (v1 `Hooks` and v2 plugin context both lack it). The host runs a fixed same-model ladder (initial + 5 retries) that plugins can neither veto, cap, nor count into a shared budget. |
| Model-selecting retry/resume | **MISSING.** `chat.params` output has no model field; `chat.message` runs once per user message (admission only); the v2 `aisdk.language` model-replacement hook does not fire on the active session path (harness: `wrap.registered` but no `wrap.install`). Nothing lets a plugin switch models inside a failing dispatch. |
| Cancellation and quiescence | **MISSING.** No typed quiescence/stopped-inference signal is exposed to plugins; `session.abort` semantics are not observable from plugin surfaces. |
| Partial output and tool-side-effect visibility | **PARTIAL.** Message/part and tool events are observable after the fact, but no plugin-visible boundary marks "current attempt produced no output and no tool effect yet", which the safe-retry rule needs. |

## What upstream has (and what is installed)

- **OpenCode 1** = npm `opencode-ai`, releases through `1.19.4` (installed). Plugin API: v1 `Hooks` + v2 `define()` context (`{options, agent, aisdk, catalog, command, integration, plugin, reference, skill}`).
- **OpenCode 2** = npm `@opencode/cli` (latest `2.1.4`), tags `v2.0.x`–`v2.1.4`. Its plugin context includes a `session` domain with a `retry` hook (`SessionRetry { sessionID, agent, model, error, attempt, decision: {retry:false} | {retry:true, delay} }`, PR [#45999](https://github.com/anomalyco/opencode/pull/45999)) and a `switchModel` session API. Even there the retry decision carries **no model override** (`model` is readonly), so cross-model failover needs the switchModel-from-retry path to be runtime-verified or an upstream extension (see `design.md`).
- `opencode upgrade` on 1.x stays within 1.x. OpenCode 2 is installed via `opencode upgrade --major` (curl method replaces `~/.opencode/bin/opencode`; npm method installs `@opencode/cli`), documented in `packages/opencode/src/installation/index.ts`.

## Earlier static review (2026-10-25, pre-harness)

The first investigation packed `@opencode-ai/plugin@1.19.3` and `@opencode-ai/sdk@1.19.3` and found no retry controller, no typed quiescence, and no model-selecting resume; the v2 SDK's `resume: boolean` and the v2 `aisdk.language` mutable-language hook were noted as partial surfaces. The harness above supersedes those notes with runtime evidence on the installed binary and corrects two points: `resume` exists (it resumes a *queued prompt*, not a failed inference), and `aisdk.language` exists but is not reachable from the active session loop on 1.19.x.

## Stop decision

The missing retry-ownership, model-selecting resume, and quiescence guarantees are mandatory for the routing policy in `specs/agent-model-routing/spec.md`. On OpenCode 1.19.4 no plugin surface provides them, so native failover cannot be implemented or claimed. Admission-time slot selection (`chat.message`) alone would not satisfy the in-dispatch fallback requirement.

Unblock options (require a decision outside this task):

1. **Run the gate on OpenCode 2** (`@opencode/cli`, e.g. `2.1.4`): `opencode upgrade --major`, then re-run `node scripts/manual/opencode-lifecycle-check.mjs`. The `session.retry` hook appears there; model-override/resume semantics still need the harness verdict (the hook's decision has no model field).
2. **Upstream extension**: request/propose a retry decision carrying `modelRef` plus a pre-output/settled flag (see `design.md` → Native Integration Prerequisite).
3. **Revise the change** to admission-time-only routing (cooldown/probe across dispatches) and drop in-dispatch fallback — this changes the spec and needs an artifact update.

## Resolution record (2026-10-25) — superseded

The upstream-extension path was evaluated and then **withdrawn**: feature request [#59000](https://github.com/anomalyco/opencode/issues/59000) was closed without action because upstream changes are out of scope for this repository.

**Chosen road: cross-dispatch failover on the verified seams (Road B).** The change's spec/design/tasks were revised accordingly: each dispatch runs entirely on one admitted model using the host's own retry sequence; persistent consistent availability evidence (consistent observations within a retried dispatch, or two consecutive un-retried failed dispatches) puts the pairing in a 300-second cooldown so subsequent and concurrent dispatches use the secondary; one real dispatch probes recovery after expiry; failed work is never replayed, resumed, or resubmitted. In-dispatch model switching, automatic resubmission, capping the host's retry ladder, and upstream host changes are out of scope by design.

The seam evidence in this note (chat.message admission selection; event failure/status observation) is exactly the contract the implementation uses — see `design.md` → Host Seam Verification. The earlier "Stop decision" section described the superseded in-dispatch design and is retained above only as history.

## Verification findings (integration)

- The change's named focused suites and every other suite pass; `test/core/version-check.test.ts` has 4 failures on this machine that are **pre-existing and unrelated**: the global `@fission-ai/openspec` install is a source symlink, so `getCliInstallInfo` reports `scope: "source"` instead of `npm`/`global`. Verified identical at pristine HEAD (worktree run) with none of this change's files involved.