# Proposal

## Why

A provider outage, exhausted credits, or a repeatedly unstable connection can stop tiered delegation even when another suitable model is available. Users need an explicit secondary choice for each tier that takes over after bounded evidence of persistent failure and stays active long enough to avoid repeatedly hitting an unhealthy primary.

## What Changes

- Allow planner, coordinator, and worker to each configure a secondary model with its own reasoning effort, alongside the existing primary selection. Preserve existing primary-only configurations and commands.
- Set the advisory defaults to the user-approved matrix: planner `openai/gpt-6.1-sol`/high → `deepinfra/XiaomiMiMo/MiMo-V2.6-Pro`/high; coordinator `openai/gpt-6.1-sol`/medium → `deepinfra/XiaomiMiMo/MiMo-V2.6-Pro`/high; worker `openai/gpt-6-luna`/max → `deepinfra/XiaomiMiMo/MiMo-V2.6-Flash`/high. Use these only when `models.json` is absent; do not write them automatically or fill secondaries into existing primary-only files.
- Extend `openspec models` and the models calibration workflow to configure, inspect, and clear secondaries without changing unrelated selections.
- Introduce cross-dispatch failover: each dispatch runs entirely on one admitted model using the host's own retry sequence. Persistent consistent provider/model availability failures put the pairing in cooldown so subsequent dispatches use the configured secondary. A successful dispatch keeps the primary selected; task/tool failures and answer quality do not trigger switching.
- Include persistent authentication, credit/quota, unavailable-model, rate-limit, transport, overload, and server failures in availability classification. A single failure, including a seemingly permanent one, does not immediately move the tier to the secondary.
- Keep an exhausted primary in a five-minute cooldown. Subsequent work uses the secondary; after cooldown, one real dispatch probes primary recovery while concurrent work continues on the secondary.
- Let each dispatch report its failure clearly on its admitted model; routing never replays, resumes, or automatically resubmits failed work — fallback applies to subsequent dispatches.
- Implement routing through the verified host hook seams (per-dispatch model selection at admission and failure/status observation); accurately report advisory-only behavior on hosts lacking those seams. In-dispatch model switching, automatic resubmission, and upstream host changes are out of scope.

## Capabilities

### New Capabilities

- `agent-model-routing`: Tier-specific primary/secondary configuration, persistent-failure failover, cooldown and recovery, and truthful host activation reporting.

### Modified Capabilities

None. Existing `cli-config` covers global configuration and `command-generation` covers adapter contracts; neither defines tier model selection or runtime routing.

## Impact

- Configuration and CLI: `src/core/agent-models.ts`, `src/commands/models.ts`, `src/cli/commands/models.ts`, and models command completion metadata.
- Shared workflow guidance: `src/core/templates/workflows/models.ts` and `src/core/templates/workflows/delegation.ts`.
- Runtime integration: `src/core/templates/opencode-tiers.ts`, `src/core/opencode-tier-assets.ts`, and the dispatch-level routing policy/state modules generated into the router plugin. Existing explicit managed-asset names remain authoritative for generation and removal.
- Verification: model configuration/command tests, generated router behavior tests, deterministic persistence/cooldown/concurrency tests, and the host seam lifecycle check (`scripts/manual/opencode-lifecycle-check.mjs`).
- Documentation: models usage in `docs/commands.md`, including independent secondary effort, cross-dispatch failover, cooldown, and activation support.
- The advisory defaults above are fixed initial pairings; they are recommendations when the file is absent, not automatic writes. The persistence threshold and five-minute session-local cooldown are fixed policy defaults; user-tunable policy and durable health state are outside this change.
