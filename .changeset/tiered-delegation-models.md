---
'@fission-ai/openspec': minor
---

Add tiered multi-agent delegation across OpenSpec workflows, with a `/opsx:models` calibration command.

Workflow skills and commands now decompose work into three tiers — planner (scope, architecture, dependency decomposition), coordinator (dispatch, joins, shared-state updates, verification), and worker (one bounded execution unit, never delegates) — with independent units fanned out concurrently and dependent units handed off sequentially. Spec drafting runs independent capabilities concurrently, and apply now verifies a task's stated completion criteria before its checkbox is checked.

`/opsx:models` (and `openspec models`) calibrates the model and reasoning effort per tier, persisted to project-local `openspec/models.json` and consulted by every delegation. Effort ladders are model-specific and the workflow only offers efforts a model actually supports. When the file is absent, advisory defaults apply.

For OpenCode, `openspec init`/`update` also install managed tier agents and a model-routing plugin that rereads `openspec/models.json` on each delegated prompt, so calibration takes effect on subsequent delegations in the same session (one restart is needed when the integration itself is first installed).