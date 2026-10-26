# Spec Delta

## Purpose

Define independent primary and secondary model pairings for each delegation tier, the bounded availability-based routing and recovery behavior, and truthful reporting of whether a host enforces that behavior.

## ADDED Requirements

### Requirement: Tier model pairings

The system SHALL allow each planner, coordinator, and worker tier to have its existing primary model selection and an optional independent secondary selection, each with its own model, explicit reasoning effort, and optional note.

#### Scenario: Preserve primary and configure a secondary
- WHEN a user configures a secondary selection for one tier
- THEN that tier retains its primary selection and stores the secondary's own model, effort, and optional note without changing any other tier

#### Scenario: Secondary selection requires an explicit effort
- WHEN a user creates a secondary selection without specifying its effort
- THEN the system rejects the incomplete selection rather than inventing an effort default

#### Scenario: Reject identical pairing IDs
- WHEN a tier's primary and secondary model IDs are identical
- THEN the system rejects the pairing

#### Scenario: Preserve opaque model IDs
- WHEN a model ID contains provider-specific text or embedded slashes
- THEN configuration preserves the complete ID verbatim, including embedded slashes in the model name

### Requirement: Model configuration commands

The `openspec models set` command SHALL support `--slot primary|secondary` with `primary` as the default and `--clear-secondary --tier`; existing `show`, `set`, and `reset` meanings SHALL remain compatible, and updates SHALL preserve unrelated selections.

#### Scenario: Set a secondary explicitly
- WHEN a user runs `openspec models set --tier worker --slot secondary` with a model and explicit effort
- THEN only the worker secondary pairing changes

#### Scenario: Default slot remains primary
- WHEN a user runs an existing `set` command without `--slot`
- THEN it updates the primary selection and preserves any configured secondary

#### Scenario: Clear one secondary
- WHEN a user runs `openspec models set --clear-secondary --tier coordinator`
- THEN only the coordinator secondary is removed and its primary and other tiers remain unchanged

#### Scenario: Conflicting clear options
- WHEN a user combines `--clear-secondary` with model, effort, note, or explicit slot options
- THEN the command rejects the conflicting request without modifying configuration

#### Scenario: Patch an existing secondary
- WHEN a user updates only the effort or model of an existing secondary
- THEN the unspecified fields and all unrelated selections are preserved

#### Scenario: Legacy configuration remains valid
- WHEN a version-1 configuration contains only the existing primary selections
- THEN it remains usable without migration and has no automatically selected secondary

#### Scenario: Show and reset remain available
- WHEN a user invokes existing `show` or `reset` actions
- THEN the command preserves their established meanings and reports or resets both slots without silently leaving secondary state behind

#### Scenario: Resolve configuration paths cross-platform
- WHEN the project configuration is read or written on Windows or another supported platform
- THEN path resolution and persistence use that platform's valid project-local configuration path without assuming POSIX separators

#### Scenario: Windows configuration path
- WHEN a project is located under a Windows drive path containing backslashes
- THEN the models command reads or writes that project's `openspec/models.json` and does not treat backslashes as model-ID or path separators from another platform

### Requirement: Routing availability classification

The system SHALL move a tier to its secondary for subsequent dispatches only after persistent evidence of provider/model availability failures in one normalized category — consistent retry observations within a dispatch or consecutive failed dispatches. One un-retried failure SHALL NOT trigger the move.

#### Scenario: Persistent retried availability failure
- WHEN a dispatch's host retry observations and its terminal failure report the same normalized availability category
- THEN the pairing enters cooldown and the next dispatch for that tier starts on the configured secondary

#### Scenario: Persistent seemingly permanent availability failure
- WHEN authentication, credits, quota, or model-unavailable failures repeat across consecutive dispatches in the same category
- THEN the tier moves to secondary only after the second consecutive failure, not the first

#### Scenario: Availability categories include transient failures
- WHEN structured errors report timeout, connection failure, rate limit (429), overload, or server failure (5xx)
- THEN they qualify as provider/model availability categories for consistency evaluation

#### Scenario: Changed availability category
- WHEN recorded observations differ in normalized category
- THEN the pairing does not enter cooldown, later dispatches remain on primary, and a diagnostic is recorded

#### Scenario: Successful dispatch
- WHEN a dispatch completes on primary
- THEN no fallback state is recorded and later dispatches stay on primary

#### Scenario: Non-availability failure
- WHEN a dispatch reports a request error, context limit, refusal, task or tool failure, poor answer, cancellation, or unknown error
- THEN it does not qualify for fallback and the dispatch reports the failure

### Requirement: Dispatch attempt bounds

Each dispatch SHALL run entirely on one admitted model using the host's own retry sequence; routing SHALL add no overlapping retry budget, switch models within a dispatch, or try a tertiary model.

#### Scenario: Single-model dispatch
- WHEN a dispatch is admitted on primary or secondary
- THEN all of its attempts run on that model and the host's retry sequence is the dispatch's only attempt loop

#### Scenario: Secondary dispatch exhaustion
- WHEN a dispatch on secondary ends in failure
- THEN the failure is reported visibly and no further model is tried for that work item

#### Scenario: No tertiary substitute
- WHEN primary and secondary have both recently failed for a tier
- THEN no nearest or default substitute model is selected

### Requirement: Primary cooldown and recovery probe

After primary exhaustion with a configured secondary, the system SHALL place that primary pairing in a 300-second cooldown; during cooldown, all new dispatches for that tier SHALL use secondary.

#### Scenario: Dispatch during cooldown
- WHEN a new dispatch for the same tier starts before its primary cooldown expires
- THEN it starts on secondary

#### Scenario: Probe after cooldown
- WHEN cooldown expires and a real dispatch arrives
- THEN exactly one dispatch probes primary while concurrent dispatches use secondary

#### Scenario: Successful primary probe
- WHEN the primary probe succeeds
- THEN the primary is considered healthy for routing and the successful dispatch completes

#### Scenario: Qualifying primary probe failure
- WHEN the probe dispatch has a qualifying availability failure
- THEN a new 300-second cooldown starts immediately, the probe's failure is reported, and the next dispatch uses secondary

#### Scenario: Probe is a single bounded recovery check
- WHEN a probe dispatch fails with a qualifying availability failure
- THEN that single failure is sufficient to reopen the cooldown without waiting for the two-dispatch persistence threshold

#### Scenario: Nonqualifying primary probe failure
- WHEN the probe fails with a nonqualifying error
- THEN the probe's blocker is reported without changing the availability decision and primary remains eligible for a later probe

### Requirement: Routing state isolation and configuration changes

Routing state SHALL be scoped to configuration identity, tier, and primary-secondary pairing fingerprint — shared across sessions in that configuration — and unrelated scopes SHALL remain isolated; dispatches SHALL use stable configuration snapshots.

#### Scenario: Isolated tier and project state
- WHEN one tier or configuration identity enters cooldown
- THEN other tiers and configurations continue using their own routing state

#### Scenario: Cooldown applies to later work in other sessions
- WHEN a pairing is in cooldown
- THEN dispatches for that tier use the secondary in every session of that configuration, not only the session that observed the failure

#### Scenario: Changed pairing resets affected state
- WHEN a tier's primary or secondary pairing changes
- THEN its prior health and cooldown state is discarded on its next dispatch without altering other tiers

#### Scenario: In-flight configuration snapshot
- WHEN configuration changes during an in-flight dispatch
- THEN that dispatch continues with its original pairing snapshot and later dispatches use the changed configuration

#### Scenario: Event attribution
- WHEN failure or status observations arrive for a session
- THEN they are recorded against the scope of that session's most recent admitted dispatch and ignored when no dispatch was admitted

#### Scenario: Host restart
- WHEN the host restarts
- THEN session routing state is cleared and no interrupted dispatch or tool action is replayed

### Requirement: No replay of failed work

Fallback SHALL apply only to subsequent dispatches: a failed dispatch is reported once and is never replayed, resumed, or automatically resubmitted by routing, and each dispatch runs entirely on its admitted model.

#### Scenario: Failed dispatch is not replayed
- WHEN a dispatch ends in failure
- THEN routing records state only and does not re-execute or resume any part of that work

#### Scenario: Fallback starts fresh work
- WHEN a dispatch starts on the secondary because the pairing is in cooldown
- THEN it is a new work item on the secondary model, not a continuation of the failed one

### Requirement: Host activation and observability

The system SHALL report configured pairings and the fixed routing policy separately from host activation, distinguish enforced native behavior from advisory guidance, and never fabricate runtime health.

#### Scenario: Native enforcement definition
- WHEN routing is reported as natively enforced
- THEN per-dispatch model selection and failure observation are active at dispatch admission and the routing state is applied to each new dispatch

#### Scenario: Unsupported host
- WHEN a host cannot provide per-dispatch model selection and failure observation
- THEN reporting identifies the policy as advisory and does not claim that fallback or cooldown is enforced

#### Scenario: Configured but not natively enforced
- WHEN pairings and policy are configured on an advisory-only host
- THEN human-readable and JSON output show the pairings and fixed policy while clearly marking activation as advisory

#### Scenario: Report routing transitions
- WHEN a routing transition or cooldown decision occurs
- THEN observable reporting includes the transition, reason, and cooldown information without exposing secrets or prompts

#### Scenario: No fabricated runtime health
- WHEN configuration is shown without observed runtime evidence
- THEN output does not claim a provider is currently healthy or unhealthy

#### Scenario: No secondary configured
- WHEN a tier has only a primary selection
- THEN behavior remains primary-only with existing host behavior and no new fallback or cooldown controller
