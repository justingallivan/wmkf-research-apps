/**
 * Grantee publication-waiver policy resolution + fail-closed error mapping.
 *
 * The grantee portal fails CLOSED on the waiver policy (owner decision,
 * 2026-07-09): if the `grantee-waiver` slot cannot be resolved, the portal must
 * refuse rather than fall back to un-versioned text. This module is the single
 * place that resolves the slot and classifies a failure into an operator- and
 * client-meaningful reason so context (render) and submit share one contract.
 *
 * Reason mapping (Codex adversarial review, Finding 3):
 *   - `policy_misconfigured` — the slot is missing / has no active version / the
 *     active version is inactive or mismatched. A deploy/seed problem: an
 *     operator must fix Dataverse. Deterministic; retrying will not help.
 *   - `policy_unavailable` — Dynamics is unreachable / a transient/unknown
 *     failure. Retrying may help.
 *
 * `getActivePolicy` throws plain Errors; we classify by message shape (it is the
 * only signal available). The misconfiguration messages are authored in
 * lib/external/policy-fetcher.js and are matched here; anything else is treated
 * as unavailable (transient) so a slot that IS provisioned is never mislabeled
 * as misconfigured on a network blip.
 */

import { getActivePolicy } from './policy-fetcher.js';

export const WAIVER_SLOT_CODE = 'grantee-waiver';

// Substrings of the deterministic misconfiguration throws in policy-fetcher.js
// (`not found or inactive`, `no active version configured`, `is not in Active
// state`, `does not belong to its parent`). Kept as a list so a wording change
// in one place is a one-line update here, guarded by a unit test.
const MISCONFIG_SIGNALS = [
  'not found or inactive',
  'no active version',
  'not in active state',
  'does not belong to its parent',
];

function classifyPolicyError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return MISCONFIG_SIGNALS.some((s) => msg.includes(s)) ? 'policy_misconfigured' : 'policy_unavailable';
}

/**
 * Resolve the active grantee-waiver policy, fail-closed.
 *
 * @returns {Promise<{ ok: true, policy: object } | { ok: false, reason: 'policy_unavailable'|'policy_misconfigured' }>}
 */
export async function resolveActiveWaiverPolicy() {
  try {
    const policy = await getActivePolicy(WAIVER_SLOT_CODE);
    if (!policy?.activeVersionId || !(policy.body || '').trim()) {
      // Resolved but unusable — treat as misconfigured (deterministic).
      return { ok: false, reason: 'policy_misconfigured' };
    }
    return { ok: true, policy };
  } catch (err) {
    return { ok: false, reason: classifyPolicyError(err) };
  }
}
