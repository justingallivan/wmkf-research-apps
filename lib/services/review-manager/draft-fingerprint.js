/**
 * Reviewer Lifecycle Stage 6D — server-side draft fingerprint.
 *
 * `render-emails-service.js` stamps each sendable draft with a fingerprint of
 * every SERVER-OBSERVED input the rendered body depends on; `send-emails-
 * service.js` recomputes it from its own (independent) reads immediately
 * before dispatch and refuses a draft whose fingerprint no longer matches —
 * see docs/REVIEWER_LIFECYCLE_STAGE6D_BUILD_PLAN.md for the full contract,
 * the body-input census, and the accepted limits.
 *
 * Both `buildDraftFingerprintInputs` and `fingerprintDraft` are pure and
 * shared by both services so the two sides cannot drift by construction.
 *
 * Deliberately EXCLUDED (see the plan): `wmkf_honorariumoptout` (not a body
 * input — `resolveHonorariumNote` ignores its argument); the recipient email
 * (re-resolved and gated separately at send); composer `settings` and the
 * template subject/body (covered by the existing client materials-modal
 * session key; the previewed body is sent verbatim); the external-link
 * placeholder (non-live by design).
 *
 * Canonicalisation rules (pinned so both callers and the test helper agree):
 *   - `undefined` and `null` both normalise to `null`;
 *   - a string is trimmed, but an EMPTY string stays `''` (never promoted to
 *     `null`) — omitting a field entirely is a `null`, not an empty string;
 *   - object keys are sorted recursively; arrays keep their original order
 *     (co-PI order is part of the body — see the plan);
 *   - the JSON text is hashed with SHA-256 and returned as lowercase hex.
 */

import { createHash } from 'crypto';
import { ContactParser } from '../../utils/contact-parser';
import { stripHonorific } from '../../utils/format-name-list';

/**
 * Build the canonical fingerprint-input object from raw Dataverse reads.
 * Both render and send resolve `candidate`/`proposal` fields EXACTLY as
 * `render-emails-service.js` does today, so the two callers share one
 * resolution — see that file (~lines 278-303) for the mirrored logic.
 *
 * @param {Object} args
 * @param {string} args.templateType
 * @param {string} args.suggestionId
 * @param {Object} args.suggestion - the `wmkf_appreviewersuggestions` row
 * @param {Object} args.person - the `wmkf_potentialreviewer` row
 * @param {Object} args.request - the `akoya_request` row
 * @param {string[]} args.coPINames - co-PI display names, in junction order
 * @param {Object} args.cycle - the loaded cycle config (snake_case shape)
 * @param {number|null} args.honorariumAmount - `getHonorariumAmount()`
 *   result, or `null` on a read failure (symmetric on both sides)
 * @returns {Object} the canonical fingerprint-input object (pre-hash)
 */
export function buildDraftFingerprintInputs({
  templateType,
  suggestionId,
  suggestion,
  person,
  request,
  coPINames,
  cycle,
  honorariumAmount,
}) {
  const candidateName = ContactParser.normalizeDisplayName(person?.wmkf_name);
  const candidateAffiliation = person?.wmkf_primaryaffiliation || person?.wmkf_organizationname || null;
  const authors = stripHonorific(request?._wmkf_projectleader_value_formatted) || null;
  const institution = (request?.wmkf_organizationname || request?._akoya_applicantid_value_formatted || '').trim() || null;
  const coInvestigators = (Array.isArray(coPINames) ? coPINames : []).map(stripHonorific);

  return {
    v: 1,
    templateType: templateType ?? null,
    suggestionId: String(suggestionId || '').toLowerCase(),
    candidate: {
      name: candidateName || null,
      affiliation: candidateAffiliation ?? null,
    },
    proposal: {
      title: request?.akoya_title ?? null,
      abstract: request?.wmkf_abstract ?? null,
      authors,
      institution,
      coInvestigators,
    },
    engagement: {
      reviewDueDateOverride: suggestion?.wmkf_reviewduedateoverride ?? null,
    },
    request: {
      reviewDueDate: request?.wmkf_reviewduedate ?? null,
      meetingDate: request?.wmkf_meetingdate ?? null,
    },
    cycle: {
      programName: cycle?.program_name ?? null,
      reviewDeadline: cycle?.review_deadline ?? null,
      customFields: cycle?.custom_fields ?? null,
    },
    honorariumAmount: honorariumAmount ?? null,
  };
}

// Recursively normalise a value for stable hashing: undefined/null → null,
// strings trimmed (but an empty string stays '', never promoted to null),
// arrays keep their order, object keys are sorted.
function normalizeForFingerprint(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(normalizeForFingerprint);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeForFingerprint(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Hash a fingerprint-input object (from `buildDraftFingerprintInputs`) into a
 * stable SHA-256 hex digest: sorted keys, null-normalised, strings trimmed,
 * arrays kept in order. NOT an HMAC — see the plan's "accepted limits".
 *
 * @param {Object} inputs
 * @returns {string} lowercase 64-hex SHA-256 digest
 */
export function fingerprintDraft(inputs) {
  const canonicalJson = JSON.stringify(normalizeForFingerprint(inputs));
  return createHash('sha256').update(canonicalJson).digest('hex');
}
