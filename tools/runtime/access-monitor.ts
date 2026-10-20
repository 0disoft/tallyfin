import { closed } from '@tallyfin/core';

export type MonitorPolicy = { failureThreshold: number; recoveryThreshold: number; maxGapSeconds: number };
export type MonitorState = {
  schemaVersion: 'tallyfin.access-monitor-state/v1'; targetFingerprint: string; policy: MonitorPolicy;
  checkedAt: string; consecutiveFailures: number; consecutivePasses: number; incidentOpen: boolean;
};
const integer = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
export function monitorPolicy(value: unknown): MonitorPolicy {
  if (!closed(value, ['failureThreshold', 'recoveryThreshold', 'maxGapSeconds']) ||
    !integer(value.failureThreshold, 100) || value.failureThreshold < 1 ||
    !integer(value.recoveryThreshold, 100) || value.recoveryThreshold < 1 ||
    !integer(value.maxGapSeconds, 86400) || value.maxGapSeconds < 1) throw Error('invalid-monitor-policy');
  return { failureThreshold: value.failureThreshold, recoveryThreshold: value.recoveryThreshold, maxGapSeconds: value.maxGapSeconds };
}
export function monitorState(value: unknown, target: string, policy: MonitorPolicy): MonitorState | null {
  monitorPolicy(policy);
  if (target.length !== 64 || !/^[a-f0-9]{64}$/.test(target)) throw Error('invalid-monitor-target');
  if (value === null) return null;
  if (!closed(value, ['schemaVersion', 'targetFingerprint', 'policy', 'checkedAt', 'consecutiveFailures', 'consecutivePasses', 'incidentOpen']) ||
    value.schemaVersion !== 'tallyfin.access-monitor-state/v1' || value.targetFingerprint !== target ||
    typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) || new Date(value.checkedAt).toISOString() !== value.checkedAt ||
    typeof value.incidentOpen !== 'boolean' || !integer(value.consecutiveFailures, policy.failureThreshold) ||
    !integer(value.consecutivePasses, policy.recoveryThreshold) ||
    (value.consecutiveFailures > 0 && value.consecutivePasses > 0) || (value.consecutiveFailures === 0 && value.consecutivePasses === 0) ||
    (!value.incidentOpen && value.consecutiveFailures >= policy.failureThreshold) ||
    (value.incidentOpen && value.consecutivePasses >= policy.recoveryThreshold)) throw Error('invalid-monitor-state');
  const saved = monitorPolicy(value.policy);
  if (saved.failureThreshold !== policy.failureThreshold || saved.recoveryThreshold !== policy.recoveryThreshold ||
    saved.maxGapSeconds !== policy.maxGapSeconds) throw Error('monitor-policy-mismatch');
  return { schemaVersion: 'tallyfin.access-monitor-state/v1', targetFingerprint: target, policy: saved,
    checkedAt: value.checkedAt, consecutiveFailures: value.consecutiveFailures, consecutivePasses: value.consecutivePasses, incidentOpen: value.incidentOpen };
}

/** A failed read is unverified access, never evidence of an outage of the entire service. */
export function advanceAccessMonitor(previous: unknown, target: string, policy: MonitorPolicy, passed: boolean, now: number) {
  const before = monitorState(previous, target, policy);
  if (typeof passed !== 'boolean' || !Number.isSafeInteger(now) || now < 0 || now > 8640000000000000 ||
    (before && now <= Date.parse(before.checkedAt))) throw Error('invalid-monitor-observation');
  const checkedAt = new Date(now).toISOString();
  const sampleGapExceeded = !!before && now - Date.parse(before.checkedAt) > policy.maxGapSeconds * 1000;
  const failures = Math.min(policy.failureThreshold, passed ? 0 : (sampleGapExceeded ? 0 : before?.consecutiveFailures ?? 0) + 1);
  const passes = Math.min(policy.recoveryThreshold, passed ? (sampleGapExceeded ? 0 : before?.consecutivePasses ?? 0) + 1 : 0);
  const wasOpen = before?.incidentOpen ?? false;
  const incidentOpen = wasOpen ? !(passed && passes >= policy.recoveryThreshold) : !passed && failures >= policy.failureThreshold;
  const event = !wasOpen && incidentOpen ? 'incident_opened' : wasOpen && !incidentOpen ? 'incident_resolved' :
    incidentOpen ? passed ? 'recovery_pending' : 'incident_ongoing' : passed ? 'healthy' : 'failure_pending';
  const nextState: MonitorState = { schemaVersion: 'tallyfin.access-monitor-state/v1', targetFingerprint: target,
    policy: { ...policy }, checkedAt, consecutiveFailures: failures, consecutivePasses: passes, incidentOpen };
  return { nextState, event, notify: event === 'incident_opened' || event === 'incident_resolved', sampleGapExceeded };
}
