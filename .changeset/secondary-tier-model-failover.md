---
'@fission-ai/openspec': minor
---

Add advisory default primary/secondary models per delegation tier, with cross-dispatch failover on a persistent-failure cooldown.

Each planner/coordinator/worker pairing can now carry a `secondary` with its own explicit reasoning effort and a distinct model ID, set or cleared via `openspec models set --slot secondary` / `--clear-secondary` (primary-only configurations and legacy invocations are unchanged). When `models.json` is absent, advisory defaults supply the pairings below but are not written automatically. `openspec models show` reports both slots, the fixed routing policy, and a truthful capability line.

When `models.json` is absent, the advisory defaults are planner `openai/gpt-6.1-sol`/high → `deepinfra/XiaomiMiMo/MiMo-V2.6-Pro`/high, coordinator `openai/gpt-6.1-sol`/medium → `deepinfra/XiaomiMiMo/MiMo-V2.6-Pro`/high, and worker `openai/gpt-6-luna`/max → `deepinfra/XiaomiMiMo/MiMo-V2.6-Flash`/high. The defaults are not written automatically; existing primary-only project files stay unchanged.

When a tier's primary fails persistently — consistent availability observations within a retried dispatch, or two consecutive un-retried failed dispatches; one un-retried failure never moves the tier — the pairing enters a 300-second cooldown and subsequent dispatches use the secondary. After the cooldown one real dispatch probes primary recovery while concurrent work stays on secondary. Each dispatch runs entirely on one admitted model using the host's own retry sequence: no in-dispatch switching, and failed work is never replayed, resumed, or resubmitted.

For OpenCode, the managed model-routing plugin now learns failures from host status/error events and admits each dispatch to primary, secondary, or the single recovery probe; transitions are reported without prompts or credentials, and installation readiness is kept separate from live activation.
