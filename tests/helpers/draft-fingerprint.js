/**
 * Test-only fingerprint stamper for Reviewer Lifecycle Stage 6D send-emails
 * fixtures.
 *
 * DELIBERATELY does NOT import lib/services/review-manager/draft-fingerprint.js
 * (Codex round-1 finding, accepted in the build plan): a fixture helper built
 * from the production module would make a canonicalization bug in that module
 * invisible to every test that stamps a fixture through it. This file
 * reimplements the same canonical shape and hash from literal fixture values
 * using Node's `crypto` directly, so a drift between the two independent
 * implementations shows up as a real (and diagnosable) `draft_stale` in a
 * send-emails-service test, not a silently-passing suite.
 *
 * Canonicalization rules (must match lib/services/review-manager/draft-fingerprint.js
 * exactly — see tests/unit/draft-fingerprint.test.js "projection-divergence"
 * cross-check, which pins the two implementations against each other):
 *   - `undefined` and `null` both normalise to `null`;
 *   - a string is trimmed, but an EMPTY string stays `''` (never `null`);
 *   - object keys are sorted recursively; arrays keep their original order;
 *   - SHA-256 hex digest of the resulting canonical JSON.
 *
 * `stampFingerprint(draft, { templateType, suggestion, person, request,
 * coPINames, cycle, honorariumAmount })` returns a NEW draft object with
 * `draftFingerprint` set, computed from the same resolution
 * render-emails-service.js uses (candidate/proposal fields), so a fixture
 * built this way matches whatever the send-time mocks resolve to.
 */

const { createHash } = require('crypto');

// Mirrors lib/utils/format-name-list.js stripHonorific without importing it,
// for the same "independent implementation" reason as the whole file.
const LEADING_HONORIFIC = /^\s*(?:Dr|Prof|Mr|Mrs|Ms|Mx)\.?\s+|^\s*Professor\s+/i;
function stripHonorific(name) {
  let out = String(name ?? '').trim();
  let prev;
  do {
    prev = out;
    out = out.replace(LEADING_HONORIFIC, '').trim();
  } while (out !== prev);
  return out;
}

// Mirrors ContactParser.normalizeDisplayName (lib/utils/contact-parser.js)
// without importing it: collapse internal whitespace runs, trim, null for a
// non-string or empty result.
function normalizeDisplayName(name) {
  if (typeof name !== 'string') return null;
  const cleaned = name.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

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

function hashFingerprintInputs(inputs) {
  const canonicalJson = JSON.stringify(normalizeForFingerprint(inputs));
  return createHash('sha256').update(canonicalJson).digest('hex');
}

/**
 * Build the canonical fingerprint-input object from literal fixture values
 * (the same shape as buildDraftFingerprintInputs, reimplemented).
 */
function buildFingerprintInputsFromFixture({
  templateType,
  suggestionId,
  suggestion,
  person,
  request,
  coPINames = [],
  cycle = {},
  honorariumAmount = null,
}) {
  const candidateName = normalizeDisplayName(person?.wmkf_name);
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

/**
 * Compute the fingerprint a fixture SHOULD carry, given the exact values the
 * test's mocks will resolve to at send time (or render time).
 */
function computeFixtureFingerprint(args) {
  return hashFingerprintInputs(buildFingerprintInputsFromFixture(args));
}

/**
 * Stamp `draftFingerprint` onto a draft fixture object, returning a new
 * object (does not mutate the input).
 */
function stampFingerprint(draft, args) {
  return { ...draft, draftFingerprint: computeFixtureFingerprint(args) };
}

module.exports = {
  computeFixtureFingerprint,
  stampFingerprint,
  buildFingerprintInputsFromFixture,
};
