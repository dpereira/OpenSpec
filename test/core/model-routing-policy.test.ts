import { describe, expect, it } from 'vitest';
import {
  FailureEvidenceTracker,
  RoutingStateStore,
} from '../../src/core/model-routing-policy.js';

const stateKey = (parts: Partial<{configIdentity:string;sessionId:string;tier:string;pairingFingerprint:string}> = {}) => ({
  configIdentity: parts.configIdentity ?? 'config-a', sessionId: parts.sessionId ?? 'session-a',
  tier: parts.tier ?? 'worker', pairingFingerprint: parts.pairingFingerprint ?? 'pair-a',
});
const pairing = { primary: { model: 'p' }, secondary: { model: 's' } };

const make = (now = 123) => {
  const store = new RoutingStateStore(() => now);
  return { store, tracker: new FailureEvidenceTracker(store, stateKey()) };
};

describe('FailureEvidenceTracker', () => {
  it('routes cooldown dispatches to secondary then leases one primary probe after 300 seconds', () => {
    let now = 10;
    const store = new RoutingStateStore(() => now);
    const key = stateKey();
    store.markPrimaryExhausted(key);
    expect(store.admit(key, pairing).slot).toBe('secondary');
    now += 299_999;
    expect(store.admit(key, pairing).slot).toBe('secondary');
    now++;
    const probe = store.admit(key, pairing);
    expect(probe).toMatchObject({ slot: 'primary', probeLease: expect.any(String) });
    expect(store.admit(key, pairing).slot).toBe('secondary');
  });

  it('handles probe success, qualifying cooldown reset, and nonqualifying lease release', () => {
    let now = 0;
    const store = new RoutingStateStore(() => now);
    const key = stateKey();
    store.markPrimaryExhausted(key);
    now = 300_000;
    const successful = store.admit(key, pairing);
    expect(store.reportProbe(key, successful.probeLease!, { category: 'success' })).toBe('primary');
    expect(store.admit(key, pairing)).toMatchObject({ slot: 'primary' });

    store.markPrimaryExhausted(key);
    now += 300_000;
    const qualifying = store.admit(key, pairing);
    expect(store.reportProbe(key, qualifying.probeLease!, { category: 'transport' })).toBe('secondary');
    expect(store.admit(key, pairing).slot).toBe('secondary');

    now += 300_000;
    const blocked = store.admit(key, pairing);
    expect(store.reportProbe(key, blocked.probeLease!, { category: 'task-tool' })).toBeUndefined();
    expect(store.admit(key, pairing).slot).toBe('primary');
  });

  it('isolates state by config, tier, and pairing across sessions while preserving admitted snapshots', () => {
    const store = new RoutingStateStore(() => 0);
    const key = stateKey();
    store.markPrimaryExhausted(key);
    const old = store.admit(key, pairing);
    const changedPair = stateKey({ pairingFingerprint: 'pair-b' });
    const changed = store.admit(changedPair, { primary: { model: 'p2' }, secondary: { model: 's2' } });
    expect(old.slot).toBe('secondary');
    expect(old.pairing.primary).toEqual({ model: 'p' });
    expect(changed.slot).toBe('primary');
    expect(store.admit(stateKey({ sessionId: 'session-b' }), pairing).slot).toBe('secondary');
    for (const isolated of [stateKey({ configIdentity: 'config-b' }), stateKey({ tier: 'planner' })]) {
      expect(store.admit(isolated, pairing).slot).toBe('primary');
    }
    const fresh = new RoutingStateStore(() => 0);
    expect(fresh.admit(key, pairing).slot).toBe('primary');
  });

  it('marks a consistent retried dispatch immediately', () => {
    const { tracker, store } = make();
    tracker.observeRetryFailure('transport');
    expect(tracker.observeDispatchFailure('transport').marked).toBe(true);
    expect(store.admit(stateKey(), pairing).slot).toBe('secondary');
  });

  it('requires two consecutive un-retried failures and resets on category change', () => {
    const { tracker, store } = make();
    expect(tracker.observeDispatchFailure('transport').marked).toBe(false);
    expect(tracker.observeDispatchFailure('transport').marked).toBe(true);
    expect(store.admit(stateKey(), pairing).slot).toBe('secondary');
    const other = make().tracker;
    other.observeDispatchFailure('transport');
    expect(other.observeDispatchFailure('server')).toMatchObject({ marked: false, diagnostic: expect.stringMatching(/changed/) });
  });

  it.each(['authentication', 'credits-quota', 'unavailable-model'] as const)('%s requires two dispatch failures', category => {
    const { tracker } = make();
    expect(tracker.observeDispatchFailure(category).marked).toBe(false);
    expect(tracker.observeDispatchFailure(category).marked).toBe(true);
  });

  it('never marks nonqualifying failures and success clears evidence', () => {
    const { tracker, store } = make();
    tracker.observeDispatchFailure('transport');
    tracker.observeDispatchSuccess();
    expect(tracker.observeDispatchFailure('transport').marked).toBe(false);
    for (const category of ['task-tool', 'refusal', 'quality', 'invalid-request', 'context-limit', 'cancellation', 'unknown'] as const) {
      expect(tracker.observeDispatchFailure(category).marked).toBe(false);
    }
    expect(store.admit(stateKey(), pairing).slot).toBe('primary');
  });
});
