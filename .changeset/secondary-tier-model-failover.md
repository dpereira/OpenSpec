---
'@fission-ai/openspec': minor
---

Add optional secondary models per delegation tier, with cross-dispatch failover on a persistent-failure cooldown.

Each planner/coordinator/worker pairing can now carry a `secondary` with its own explicit reasoning effort and a distinct model ID, set or cleared via `openspec models set --slot secondary` / `--clear-secondary` (primary-only configurations and legacy invocations are unchanged). `openspec models show` reports both slots, the fixed routing policy, and a truthful capability line.

When a tier's primary fails persistently — consistent availability observations within a retried dispatch, or two consecutive un-retried failed dispatches; one un-retried failure never moves the tier — the pairing enters a 300-second cooldown and subsequent dispatches use the secondary. After the cooldown one real dispatch probes primary recovery while concurrent work stays on secondary. Each dispatch runs entirely on one admitted model using the host's own retry sequence: no in-dispatch switching, and failed work is never replayed, resumed, or resubmitted.

For OpenCode, the managed model-routing plugin now learns failures from host status/error events and admits each dispatch to primary, secondary, or the single recovery probe; transitions are reported without prompts or credentials, and installation readiness is kept separate from live activation.