/**
 * Shared closed contract for the per-PD scheduled-email override
 * (docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md Decision 6).
 *
 * Automatic labeled sending is the system default; per-recipient review comes
 * from the PD's VIP flags. This preference is the single coarse override:
 * reviewAll = true makes EVERY automated email for that PD wait for explicit
 * approval regardless of VIP flags. Absence of the preference means the
 * default (VIP-only review) — onboarding is a rollout precondition, never a
 * runtime compatibility state.
 */

export function normalizeEmailAutomationPreference(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (typeof parsed.reviewAll !== 'boolean') return null;
  return { reviewAll: parsed.reviewAll };
}

export function serializeEmailAutomationPreference(value) {
  const normalized = normalizeEmailAutomationPreference(value);
  if (!normalized) throw new TypeError('Invalid email automation preference');
  return JSON.stringify(normalized);
}
