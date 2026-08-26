/**
 * Dependency-free invitation-link validation shared by browser previews,
 * template editing, and the send service.
 *
 * A valid reviewer JWT is exactly three base64url segments. The boundary check
 * prevents a four-segment or otherwise extended token from passing via a valid
 * three-segment prefix, while still tolerating ordinary trailing prose
 * punctuation (a sentence period, a query string) directly after the token.
 *
 * Repeated IDENTICAL copies of the same link are valid — invitation HTML
 * generation has always tolerated a repeated identical link (button + plain-
 * text fallback, or a PD duplicating the link line while editing) and the
 * send-time substitution replaces every occurrence. Only DISTINCT tokens are
 * ambiguous.
 */

export const INVITATION_LINK_INVALID_REASON = Object.freeze({
  EXPECTATION_MISSING: 'external_link_expectation_missing',
  MISSING: 'missing_external_link',
  MALFORMED: 'malformed_external_link',
  MULTIPLE: 'multiple_external_links',
  UNEXPECTED: 'unexpected_external_link',
  UNRESOLVED_PLACEHOLDER: 'unresolved_placeholder',
});

export const INVALID_SECURE_LINK_SKIP_REASON = 'invalid_secure_link';
export const EXTERNAL_LINK_PLACEHOLDER = '{{externalLink}}';

const EXTERNAL_REVIEW_OCCURRENCE_PATTERN = /\/external\/review\//g;
// Boundary: the token must not continue with another base64url char, nor with
// a `.` that starts a fourth segment — but `.` followed by anything else is
// ordinary prose punctuation and stays outside the token.
const EXTERNAL_REVIEW_JWT_PATTERN = /\/external\/review\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?![A-Za-z0-9_-])(?!\.[A-Za-z0-9_-])/g;
const UNRESOLVED_PLACEHOLDER_PATTERN = /\{\{[^}]+\}\}/;

function matchExternalReviewJwts(text) {
  EXTERNAL_REVIEW_JWT_PATTERN.lastIndex = 0;
  return [...String(text || '').matchAll(EXTERNAL_REVIEW_JWT_PATTERN)].map((match) => match[1]);
}

/** Distinct JWTs — repeated identical copies dedupe to one (see header). */
export function extractExternalReviewJwts(text) {
  return [...new Set(matchExternalReviewJwts(text))];
}

export function replaceExternalReviewJwts(text, replacementJwt) {
  EXTERNAL_REVIEW_JWT_PATTERN.lastIndex = 0;
  return String(text || '').replace(
    EXTERNAL_REVIEW_JWT_PATTERN,
    (fullMatch, priorJwt) => fullMatch.replace(priorJwt, replacementJwt),
  );
}

export function classifyInvitationLinks({ subject = '', body = '', externalLinkExpected } = {}) {
  const text = `${String(subject || '')}\n${String(body || '')}`;
  const occurrenceCount = (text.match(EXTERNAL_REVIEW_OCCURRENCE_PATTERN) || []).length;
  const matches = matchExternalReviewJwts(text);
  const jwts = [...new Set(matches)];

  if (UNRESOLVED_PLACEHOLDER_PATTERN.test(text)) {
    return {
      valid: false,
      reason: INVITATION_LINK_INVALID_REASON.UNRESOLVED_PLACEHOLDER,
      occurrenceCount,
      jwts,
    };
  }

  if (occurrenceCount === 0) {
    if (externalLinkExpected === false) return { valid: true, reason: null, occurrenceCount, jwts };
    return {
      valid: false,
      reason: externalLinkExpected === true
        ? INVITATION_LINK_INVALID_REASON.MISSING
        : INVITATION_LINK_INVALID_REASON.EXPECTATION_MISSING,
      occurrenceCount,
      jwts,
    };
  }

  // Every /external/review/ occurrence must carry a well-formed JWT — one
  // valid link plus one malformed occurrence is still a broken email.
  if (matches.length < occurrenceCount) {
    return {
      valid: false,
      reason: INVITATION_LINK_INVALID_REASON.MALFORMED,
      occurrenceCount,
      jwts,
    };
  }

  // Repeated identical copies are fine; only DISTINCT tokens are ambiguous.
  if (jwts.length > 1) {
    return {
      valid: false,
      reason: INVITATION_LINK_INVALID_REASON.MULTIPLE,
      occurrenceCount,
      jwts,
    };
  }

  if (typeof externalLinkExpected !== 'boolean') {
    return {
      valid: false,
      reason: INVITATION_LINK_INVALID_REASON.EXPECTATION_MISSING,
      occurrenceCount,
      jwts,
    };
  }

  if (externalLinkExpected === false) {
    return {
      valid: false,
      reason: INVITATION_LINK_INVALID_REASON.UNEXPECTED,
      occurrenceCount,
      jwts,
    };
  }

  return { valid: true, reason: null, occurrenceCount, jwts };
}

export function validateInvitationTemplateForSave(template = {}) {
  const text = `${String(template.subject || '')}\n${String(template.body || '')}`;
  return text.includes(EXTERNAL_LINK_PLACEHOLDER)
    ? { valid: true, reason: null }
    : { valid: false, reason: 'external_link_placeholder_required' };
}
