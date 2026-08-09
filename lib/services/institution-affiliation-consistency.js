/**
 * Institution consistency for identity corroboration and mismatch alerts.
 *
 * This helper is intentionally separate from COI. Direct identity equality and
 * one-hop OpenAlex associated-institution links are acceptable evidence that
 * two affiliation labels can describe the same person's appointment. The same
 * associated links MUST NOT be consumed by the COI hard-drop matcher.
 *
 * Wave 3e (owner-directed, 2026-08-08, overriding the prior wave's stop-rule):
 * live-verified root cause for a family of forbidden system/campus and
 * cross-institution auto-clears — "University of California System" resolves
 * live (OpenAlex I2803209242, 15 associated institutions) — is that
 * associated-link evidence, consumed as WHOLE-OPERAND corroboration, clears
 * pairs the plan's Stage 2 relationship-policy table requires to SURFACE
 * (Harvard <-> Harvard Medical School, Dana-Farber <-> Harvard, etc.). Rather
 * than add a further guard, this wave REMOVES the mechanism from the staged
 * path: when the `segmentComparison` flag is on, associated-link evidence
 * (`institutionsConsistent`'s one-hop `associatedIdentityMatches`) is
 * consulted NOWHERE — not in step 2's crossing, not in the post-segment
 * fallback. Only `DeduplicationService.institutionDirectMatch` (identity
 * equality) clears a pair on the staged path. The default/off path
 * (`segmentComparison` false or omitted) is untouched and stays
 * byte-identical: `institutionsConsistent` with associated links remains the
 * pre-existing identity-corroboration semantics for enrichment/identity-
 * evidence consumers (owner decision 3) — typed relationship classification
 * for the staged path is explicitly Stage 2 scope.
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

function comparable(value) {
  return String(value || '').trim().toLowerCase();
}

// Contiguous extensions of `fragment` within its OWN operand's segment list:
// other segments of the same operand that start with `${fragment},` (e.g.
// "University of California" -> "University of California, Los Angeles").
// Shared by step 1's direct-match guard, step 2's pool exclusion, and the
// areConsistent fallback guard (Wave 3 requirement: one classifier, no
// divergent copies).
//
// The resolver-call cap (3 shortest extensions) bounds live cost, but that
// cap must never silently become a proof gap: with 4+ extensions, the
// UNCHECKED ones (the longest — sorted-ascending, sliced off the end) are
// exactly where a genuinely contradictory extension (e.g. the campus-name
// extension on a bare-parent fragment) is most likely to land, since real
// decoration extensions (city/state/zip) tend to be short and a full campus
// name tends to be long. Returns `overflow: true` whenever extensions beyond
// the capped list exist, so classifyFragment (Wave 3d) can refuse to certify
// 'decoration' — i.e. PROVEN — on the strength of an incomplete check.
function fragmentExtensions(fragment, ownOperandSegments) {
  const prefix = `${fragment.toLowerCase()},`;
  const matches = ownOperandSegments
    .filter((candidate) => candidate !== fragment && candidate.toLowerCase().startsWith(prefix))
    .sort((a, b) => a.length - b.length);
  return { extensions: matches.slice(0, 3), overflow: matches.length > 3 };
}

// Classifies `fragment` against its own operand's segments. `unprovenExtensionPolicy`
// picks how an ABSTAINING (unresolvable) extension is treated — the two live
// call-site policies, empirically reconciled after the 2026-08-08 live gate
// (145 -> 141/145; the 'demote'-everywhere rule pool-excluded exactly the
// clean-fragment candidates that cleared request-1002903 rows 1-4, because
// their real decoration extensions — city/state/zip strings — definitively
// abstain on the live resolver rather than resolving to anything):
//  - 'demote' (default): an abstaining extension classifies 'parent', same as
//    a differently-resolving one. Used by step 1's direct segment match,
//    which is about to accept a STRING-IDENTITY match alone with no
//    independent identity evidence yet — decoration must be PROVEN, not
//    assumed.
//  - 'admit': an abstaining extension does NOT demote — it is treated as
//    unproven-but-tolerated decoration. Used only in step 2's pool build. As
//    of Wave 3e, EVERY step-2 crossing (whether the fragment's decoration was
//    proven or merely tolerated) contributes identity-EQUALITY evidence only
//    (`institutionDirectMatch`) — associated-link evidence is never consulted
//    on the staged path at all (see the file-header comment) — so 'admit'
//    only decides POOL MEMBERSHIP (does this fragment get a chance to
//    directly match the other operand?), not what evidence it may use once
//    admitted. A missing extension lookup (S400: decorated/compound strings
//    routinely return zero results) shouldn't block a fragment whose own
//    name resolved cleanly from that chance.
// In both policies: an extension that resolves to a DIFFERENT openAlexId
// always demotes to 'parent' (positive proof of a more specific institution
// under this fragment — this is what still keeps a bare parent like
// "University of California" out of the pool when a sibling campus's
// extension proves it's the parent of a DIFFERENT, more specific campus),
// and a fragment that is itself unresolvable while extensions exist is
// always 'parent'.
//
// Extension-cap overflow: `fragmentExtensions` checks only the 3 shortest
// contiguous extensions (resolver-call cap). Under 'demote', a fragment with
// unchecked extensions (`overflow`) can never classify 'decoration' — an
// unchecked extension is exactly as unproven as an abstaining one. Under
// 'admit' this no longer changes anything (Wave 3e): pool membership for an
// 'admit'-policy fragment was never conditioned on proof, only on the
// checked extensions not proving a DIFFERENT identity, so overflow's effect
// is now fully absorbed by 'admit' already tolerating unchecked/abstaining
// extensions.
async function classifyFragment(fragment, ownOperandSegments, resolve, {
  signal,
  fragmentIdentity,
  unprovenExtensionPolicy = 'demote',
} = {}) {
  const { extensions, overflow } = fragmentExtensions(fragment, ownOperandSegments);
  if (extensions.length === 0) return { kind: 'standalone', extensions };

  const identity = fragmentIdentity !== undefined ? fragmentIdentity : await resolve(fragment, { signal });
  if (!identity) return { kind: 'parent', extensions };

  for (const extension of extensions) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, mirrors step 1's original loop
    const extensionIdentity = await resolve(extension, { signal });
    if (extensionIdentity) {
      if (extensionIdentity.openAlexId !== identity.openAlexId) {
        return { kind: 'parent', extensions };
      }
      // Proven decoration for this extension; keep checking the rest.
    } else if (unprovenExtensionPolicy === 'demote') {
      return { kind: 'parent', extensions };
    }
    // unprovenExtensionPolicy === 'admit' and this extension abstained:
    // unproven but tolerated — do not demote, keep checking the rest.
  }
  if (overflow && unprovenExtensionPolicy === 'demote') {
    // All checked extensions matched, but unchecked ones remain — under
    // 'demote' an incomplete check is as good as an abstaining one.
    return { kind: 'parent', extensions };
  }
  return { kind: 'decoration', extensions };
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
        // FAIL CLOSED (default 'demote' policy): the match stands only when
        // the segment classifies as 'standalone' or 'decoration' — i.e. it
        // has no contiguous extension, or every extension is PROVEN to be
        // decoration (resolves to the SAME identity as the segment). This is
        // a STRING-ONLY match with no independent identity evidence yet, so
        // an abstaining extension is NOT tolerated here (unlike step 2's pool
        // build) — a 'parent' classification (a differently-resolving OR
        // unresolvable extension) means the segment is a parent fragment of
        // a more specific institution and must not auto-clear on string
        // identity alone; the pair falls through to step 2's
        // positive-evidence path instead. (First live gate run: fail-open
        // here auto-cleared campus-vs-parent rows whenever the extension
        // lookup failed.)
        // eslint-disable-next-line no-await-in-loop -- sequential by design
        const classification = await classifyFragment(segment, segments, resolve, { signal });
        if (classification.kind !== 'parent') return true;
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

    const leftWhole = comparable(leftName);
    const rightWhole = comparable(rightName);

    // Pool exclusion (Wave 3 CHANGE 1, policy tuned post-live-gate 2026-08-08):
    // a candidate that is a PROPER fragment of its own operand (i.e. not the
    // whole operand string itself) is only admitted to the pool when it
    // classifies as 'standalone' or 'decoration' UNDER THE 'admit' POLICY —
    // the fragment's own identity is always resolved here (candidates without
    // one are already filtered above), so an extension that resolves to a
    // DIFFERENT identity still excludes it (positive proof of a parent
    // shape — e.g. a sibling campus's extension proves the bare
    // "University of California" fragment is that OTHER campus's parent, not
    // this operand's own institution), but an extension that merely abstains
    // does not: a missing decoration lookup shouldn't block a fragment whose
    // own name resolved cleanly (live evidence: real decoration extensions —
    // city/state/zip — routinely abstain). Whole operands themselves ALWAYS
    // stay in the pool.
    //
    // Wave 3e: admission here decides pool MEMBERSHIP only — a chance to be
    // tested for identity equality against the other operand. It is not, and
    // was never meant to be, a certificate that licenses associated-link
    // evidence: the staged path (`segmentComparison` on) never consults
    // associated-link evidence at all (see the file-header comment), so there
    // is nothing left to gate on "proven" vs "admitted-unproven" — every pool
    // entry, whole or fragment, crosses via `institutionDirectMatch` only.
    const buildPool = async (candidates, resolvedCandidates, segments, wholeComparableStr) => {
      const entries = await Promise.all(candidates.map(async (text, index) => {
        const identity = resolvedCandidates[index];
        if (!identity) return null;
        if (comparable(text) === wholeComparableStr) return { text, identity };
        const classification = await classifyFragment(text, segments, resolve, {
          signal,
          fragmentIdentity: identity,
          unprovenExtensionPolicy: 'admit',
        });
        if (classification.kind === 'parent') return null;
        return { text, identity };
      }));
      return entries.filter(Boolean);
    };

    const leftPool = await buildPool(leftCandidates, resolvedLeftCandidates, leftSegments, leftWhole);
    const rightPool = await buildPool(rightCandidates, resolvedRightCandidates, rightSegments, rightWhole);
    if (leftPool.length === 0 || rightPool.length === 0) return false;

    // A pair whose candidate STRINGS are identical shared fragments proves only
    // that the fragment resolves — it matches the fragment against itself, not
    // one operand against the other. Sibling-campus names both contain the bare
    // parent fragment ("University of California"), so without this exclusion a
    // resolvable parent fragment would auto-clear a sibling pair (safety
    // invariant 1). The pair still counts when the shared string IS one of the
    // whole operands, because then it genuinely represents that operand.
    //
    // CLOSURE ARGUMENT (Wave 3e, owner-directed — falsifiable, adversarial
    // review target): every crossing below uses
    // `DeduplicationService.institutionDirectMatch` (identity equality)
    // UNCONDITIONALLY — never `institutionsConsistent`'s associated-link
    // evidence, for ANY pairing, proven-decoration or admitted-unproven,
    // fragment or whole. This is a strictly stronger guarantee than the prior
    // waves' `admittedUnproven`/`directOnly` restrictions (which withheld
    // associated-link credit only from specific SHAPES) — it removes the
    // capability outright on the staged path, so no future shape of the same
    // leak (system/campus, cross-institution corroboration the plan's Stage 2
    // relationship-policy table requires to SURFACE, or anything not yet
    // enumerated) can reopen it here. The `sharedFragmentSelfPair` exclusion
    // above remains necessary even under identity-only crossing: without it,
    // a bare parent fragment that resolves identically on BOTH operands
    // (e.g. "University of California" -> SYSTEM on both a UCLA and a UCSD
    // byline) would trivially direct-match itself and auto-clear a sibling
    // pair — see the accepted-residual test in
    // tests/unit/institution-pair-segment-comparison.test.js for the one
    // narrow shape (SAME bare string on both WHOLE operands) that legitimately
    // still clears this way.
    return leftPool.some((resolvedLeft) => (
      rightPool.some((resolvedRight) => {
        const sharedFragmentSelfPair = comparable(resolvedLeft.text) === comparable(resolvedRight.text)
          && comparable(resolvedLeft.text) !== leftWhole
          && comparable(resolvedLeft.text) !== rightWhole;
        if (sharedFragmentSelfPair) return false;

        return DeduplicationService.institutionDirectMatch(resolvedLeft.identity, resolvedRight.identity);
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

    // Wave 3e (owner-directed — supersedes the prior wave's shape-conditional
    // CHANGE 2 guard): under segmentComparison, the fallback is
    // UNCONDITIONALLY direct-identity-only, matching step 2's crossing —
    // associated-link evidence is never consulted anywhere on the staged
    // path (see the file-header comment). This must be unconditional, not
    // shape-gated: a live-verified probe showed a pair (e.g. "University of
    // California System" vs a sibling campus) that clears via associated
    // link at this fallback even though the SYSTEM string is not a
    // comma-fragment of the other operand at all — the shape-detection the
    // prior guard relied on (`wholeIsParentWithin`) never fires for a bare
    // WHOLE-operand vs WHOLE-operand pairing with no parent/child string
    // relationship between them, so a shape-conditional guard cannot close
    // this; only an unconditional one can. The default/off path below (this
    // block skipped) stays byte-identical for enrichment and
    // identity-evidence consumers (owner decision 3) — typed relationship
    // classification for associated-link corroboration on the staged path is
    // Stage 2 scope.
    if (segmentComparison) {
      return DeduplicationService.institutionDirectMatch(resolvedLeft || left, resolvedRight || right);
    }

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
