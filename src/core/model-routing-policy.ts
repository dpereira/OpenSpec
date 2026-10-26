/** Host-independent decision logic. The host adapter owns execution and delays. */
export type AvailabilityCategory =
  | 'authentication'
  | 'credits-quota'
  | 'unavailable-model'
  | 'transport'
  | 'rate-limit'
  | 'overload'
  | 'server';

export type FailureCategory = AvailabilityCategory
  | 'task-tool'
  | 'refusal'
  | 'quality'
  | 'invalid-request'
  | 'context-limit'
  | 'cancellation'
  | 'unknown';
export type ModelSlot = 'primary' | 'secondary';

const availability = new Set<FailureCategory>([
  'authentication',
  'credits-quota',
  'unavailable-model',
  'transport',
  'rate-limit',
  'overload',
  'server',
]);
const isAvailability = (category: FailureCategory): category is AvailabilityCategory => availability.has(category);

export interface EvidenceResult { marked: boolean; diagnostic?: string }

/** Cross-dispatch evidence tracker. Each terminal observation closes one dispatch. */
export class FailureEvidenceTracker {
  private streakCategory?: AvailabilityCategory;
  private streak = 0;
  private retryCategory?: AvailabilityCategory;
  private retryCount = 0;

  constructor(private readonly store: RoutingStateStore, private readonly key: RoutingStateKey) {}

  observeRetryFailure(category: FailureCategory): EvidenceResult {
    if (!isAvailability(category)) {
      this.clear();
      return { marked: false, diagnostic: `Non-qualifying failure: ${category}.` };
    }
    if (this.retryCategory && this.retryCategory !== category) {
      this.clear();
      this.retryCategory = category;
      this.retryCount = 1;
      return { marked: false, diagnostic: `Category changed from ${this.streakCategory ?? 'unknown'} to ${category}.` };
    }
    this.retryCategory = category;
    this.retryCount++;
    return { marked: false };
  }

  observeDispatchFailure(category: FailureCategory): EvidenceResult {
    if (!isAvailability(category)) {
      this.clear();
      return { marked: false, diagnostic: `Non-qualifying failure: ${category}.` };
    }
    const retried = this.retryCount > 0;
    const retryCategory = this.retryCategory;
    this.retryCount = 0;
    this.retryCategory = undefined;
    if (retried && retryCategory !== category) {
      const prior = this.streakCategory;
      this.streakCategory = category;
      this.streak = 0;
      return { marked: false, diagnostic: `Category changed from ${retryCategory} to ${category}${prior ? ` (streak was ${prior})` : ''}.` };
    }
    if (this.streakCategory !== category) {
      const prior = this.streakCategory;
      this.streakCategory = category;
      this.streak = 0;
      if (prior) {
        this.streak = retried ? 1 : 1;
        if (!retried) return { marked: false, diagnostic: `Category changed from ${prior} to ${category}.` };
      }
    }
    this.streak++;
    if (retried || this.streak >= 2) {
      this.store.markPrimaryExhausted(this.key);
      this.streak = 0;
      return { marked: true };
    }
    return { marked: false };
  }

  observeDispatchSuccess(): void { this.clear(); }

  private clear(): void {
    this.streakCategory = undefined;
    this.streak = 0;
    this.retryCategory = undefined;
    this.retryCount = 0;
  }
}

/** Caller-provided stable scope parts; configIdentity is already canonicalized by its owner. */
export interface RoutingStateKey {
  configIdentity: string;
  sessionId?: string;
  tier: string;
  pairingFingerprint: string;
}

export interface PairingSnapshot {
  primary: Readonly<Record<string, unknown>>;
  secondary: Readonly<Record<string, unknown>>;
}

export interface RoutingAdmission {
  slot: ModelSlot;
  pairing: PairingSnapshot;
  probeLease?: string;
}

export type ProbeResult =
  | { category: 'success' }
  | { category: FailureCategory };

interface ScopeState {
  cooldownUntil?: number;
  probeLease?: string;
}

/** Session-local cooldown and single recovery-probe lease coordinator. */
export class RoutingStateStore {
  private readonly states = new Map<string, ScopeState>();
  private nextLease = 0;
  private readonly now: () => number;

  constructor(now: () => number) { this.now = now; }

  /** Admission captures the supplied pairing; callers must execute this snapshot even if config changes later. */
  admit(key: RoutingStateKey, pairing: PairingSnapshot): RoutingAdmission {
    const stateKey = this.identity(key);
    const state = this.states.get(stateKey);
    const snapshot = Object.freeze({
      primary: Object.freeze({ ...pairing.primary }),
      secondary: Object.freeze({ ...pairing.secondary }),
    });
    if (!state || state.cooldownUntil === undefined) return { slot: 'primary', pairing: snapshot };
    if (this.now() < state.cooldownUntil || state.probeLease) return { slot: 'secondary', pairing: snapshot };
    const lease = `probe-${++this.nextLease}`;
    state.probeLease = lease;
    return { slot: 'primary', pairing: snapshot, probeLease: lease };
  }

  /** Record exhaustion of the three-attempt primary sequence. */
  markPrimaryExhausted(key: RoutingStateKey): void {
    this.states.set(this.identity(key), { cooldownUntil: this.now() + 300_000 });
  }

  /** Complete a probe lease. Stale or already-released leases cannot alter state. */
  reportProbe(key: RoutingStateKey, lease: string, result: ProbeResult): RoutingAdmission['slot'] | undefined {
    const state = this.states.get(this.identity(key));
    if (!state || state.probeLease !== lease) return undefined;
    if (result.category === 'success') {
      this.states.delete(this.identity(key));
      return 'primary';
    }
    state.probeLease = undefined;
    if (availability.has(result.category)) {
      state.cooldownUntil = this.now() + 300_000;
      return 'secondary';
    }
    // Preserve expired cooldown so primary remains eligible on the next admission.
    return undefined;
  }

  private identity(key: RoutingStateKey): string {
    return JSON.stringify([key.configIdentity.trim(), key.tier.trim(), key.pairingFingerprint.trim()]);
  }
}
