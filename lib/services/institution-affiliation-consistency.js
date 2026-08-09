/**
 * Institution consistency for identity corroboration and mismatch alerts.
 *
 * This helper is intentionally separate from COI. Direct identity equality and
 * one-hop OpenAlex associated-institution links are acceptable evidence that
 * two affiliation labels can describe the same person's appointment. The same
 * associated links MUST NOT be consumed by the COI hard-drop matcher.
 */

const { DeduplicationService } = require('./deduplication-service');
const { createInstitutionIdentityResolver } = require('./institution-identity-resolver');
const { institutionSegments } = require('./discovery/affiliation');

// Stage 1 segment-comparison tuning (docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md):
// cap how many segments per side get resolved, and only resolve segments that
// look substantial enough to be an institution name (not "Nashville" or "USA").
const MAX_RESOLVED_SEGMENTS_PER_SIDE = 4;
const MIN_SEGMENT_LETTER_COUNT_FOR_RESOLVE = 8;

function letterCount(value) {
  return ((value || '').match(/[A-Za-z]/g) || []).length;
}

function promisingSegmentsForResolve(segments) {
  return segments
    .filter((segment) => letterCount(segment) >= MIN_SEGMENT_LETTER_COUNT_FOR_RESOLVE)
    .slice(0, MAX_RESOLVED_SEGMENTS_PER_SIDE);
}

function associatedIdentityMatches(source, target) {
  return (Array.isArray(source?.associatedInstitutions)
    ? source.associatedInstitutions
    : [])
    .some((associated) => DeduplicationService.institutionDirectMatch(associated, target));
}

function institutionsConsistent(left, right) {
  if (!left || !right) return false;
  if (DeduplicationService.institutionDirectMatch(left, right)) return true;
  return associatedIdentityMatches(left, right) || associatedIdentityMatches(right, left);
}

function createInstitutionConsistencyChecker({
  resolver = createInstitutionIdentityResolver(),
  segmentComparison = false,
} = {}) {
  async function resolve(institution, { signal } = {}) {
    if (!institution) return null;
    if (
      typeof institution === 'object'
      && institution.openAlexId
      && institution.displayName
      && Array.isArray(institution.associatedInstitutions)
    ) {
      return institution;
    }
    const name = DeduplicationService.institutionDisplayName(institution);
    if (!name) return null;
    return resolver.resolve(name, { signal });
  }

  // Stage 1 opt-in: segment-wise pair comparison
  // (docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md). A `true` verdict
  // here can only arise from testing a segment of one operand AGAINST THE
  // OTHER OPERAND — never from ranking/extracting a "best" segment in
  // isolation. Falls back to today's whole-string logic when nothing matches.
  async function segmentWiseConsistent(left, right, { signal } = {}) {
    const leftName = DeduplicationService.institutionDisplayName(left);
    const rightName = DeduplicationService.institutionDisplayName(right);

    const leftSegments = typeof leftName === 'string' ? institutionSegments(leftName) : [];
    const rightSegments = typeof rightName === 'string' ? institutionSegments(rightName) : [];

    // 1) Direct segment-vs-other-operand match (string identity), with a
    // parent-fragment guard: when the matched segment has a CONTIGUOUS
    // EXTENSION in its own operand ("University of California" →
    // "University of California, Los Angeles") that resolves to a DIFFERENT
    // identity than the segment itself, the segment is a parent fragment of a
    // more specific institution — matching the other operand on it must
    // surface, not auto-clear (owner decision 2: campus vs system is never
    // auto-cleared). Decoration extensions ("VUMC, Nashville") resolve to
    // null or the same identity and do not block the match.
    const directMatchWithParentGuard = async (segments, otherOperand) => {
      for (const segment of segments) {
        if (!DeduplicationService.institutionDirectMatch(segment, otherOperand)) continue;
        const segmentPrefix = `${segment.toLowerCase()},`;
        const extensions = segments
          .filter((candidate) => candidate !== segment
            && candidate.toLowerCase().startsWith(segmentPrefix))
          .sort((a, b) => a.length - b.length)
          .slice(0, 3);
        // FAIL CLOSED: the match stands only when every extension is PROVEN
        // to be decoration — i.e. it resolves to the SAME identity as the
        // segment. An extension that resolves differently is a parent
        // fragment; an extension that cannot be resolved (ambiguity, provider
        // failure, rate limit) is unproven and must not auto-clear — the pair
        // falls through to step 2's positive-evidence path instead. (First
        // live gate run: fail-open here auto-cleared campus-vs-parent rows
        // whenever the extension lookup failed.)
        let matchStands = extensions.length === 0;
        if (!matchStands) {
          const segmentIdentity = await resolve(segment, { signal });
          if (segmentIdentity) {
            matchStands = true;
            for (const extension of extensions) {
              const extensionIdentity = await resolve(extension, { signal });
              if (!extensionIdentity
                || extensionIdentity.openAlexId !== segmentIdentity.openAlexId) {
                matchStands = false;
                break;
              }
            }
          }
        }
        if (matchStands) return true;
      }
      return false;
    };
    if (await directMatchWithParentGuard(leftSegments, right)) return true;
    if (await directMatchWithParentGuard(rightSegments, left)) return true;

    // 2) Resolve the most promising segments, PLUS each side's own whole
    // trimmed string (so a short/plain operand like "MIT" — which would
    // fail the letter-count filter on its own side — still participates as
    // a resolve candidate, and segment×whole pairs get tested, not only
    // segment×segment and whole×whole), and test the existing
    // identity/associated-link check over every left-candidate ×
    // right-candidate resolved pair.
    const leftCandidates = [...new Set([
      ...promisingSegmentsForResolve(leftSegments),
      ...(leftName ? [leftName] : []),
    ])];
    const rightCandidates = [...new Set([
      ...promisingSegmentsForResolve(rightSegments),
      ...(rightName ? [rightName] : []),
    ])];
    if (leftCandidates.length === 0 && rightCandidates.length === 0) return false;

    const [resolvedLeftCandidates, resolvedRightCandidates] = await Promise.all([
      Promise.all(leftCandidates.map((segment) => resolve(segment, { signal }))),
      Promise.all(rightCandidates.map((segment) => resolve(segment, { signal }))),
    ]);

    const leftPool = leftCandidates
      .map((text, index) => ({ text, identity: resolvedLeftCandidates[index] }))
      .filter((candidate) => Boolean(candidate.identity));
    const rightPool = rightCandidates
      .map((text, index) => ({ text, identity: resolvedRightCandidates[index] }))
      .filter((candidate) => Boolean(candidate.identity));
    if (leftPool.length === 0 || rightPool.length === 0) return false;

    // A pair whose candidate STRINGS are identical shared fragments proves only
    // that the fragment resolves — it matches the fragment against itself, not
    // one operand against the other. Sibling-campus names both contain the bare
    // parent fragment ("University of California"), so without this exclusion a
    // resolvable parent fragment would auto-clear a sibling pair (safety
    // invariant 1). The pair still counts when the shared string IS one of the
    // whole operands, because then it genuinely represents that operand.
    const comparable = (value) => String(value || '').trim().toLowerCase();
    const leftWhole = comparable(leftName);
    const rightWhole = comparable(rightName);
    return leftPool.some((resolvedLeft) => (
      rightPool.some((resolvedRight) => {
        const sharedFragmentSelfPair = comparable(resolvedLeft.text) === comparable(resolvedRight.text)
          && comparable(resolvedLeft.text) !== leftWhole
          && comparable(resolvedLeft.text) !== rightWhole;
        if (sharedFragmentSelfPair) return false;
        return institutionsConsistent(resolvedLeft.identity, resolvedRight.identity);
      })
    ));
  }

  async function areConsistent(left, right, { signal } = {}) {
    if (DeduplicationService.institutionDirectMatch(left, right)) return true;

    if (segmentComparison && await segmentWiseConsistent(left, right, { signal })) {
      return true;
    }

    const [resolvedLeft, resolvedRight] = await Promise.all([
      resolve(left, { signal }),
      resolve(right, { signal }),
    ]);
    return institutionsConsistent(resolvedLeft || left, resolvedRight || right);
  }

  return Object.freeze({
    areConsistent,
    resolve,
  });
}

module.exports = {
  createInstitutionConsistencyChecker,
  institutionsConsistent,
};
