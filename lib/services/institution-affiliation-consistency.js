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
//    a differently-resolving one. Used where the caller is about to accept a
//    STRING-IDENTITY match alone (step 1's direct segment match, and
//    `wholeIsParentWithin`'s whole-vs-whole shape check) — with no positive
//    identity evidence backing the match yet, decoration must be PROVEN, not
//    assumed.
//  - 'admit': an abstaining extension does NOT demote — it is treated as
//    unproven-but-tolerated decoration. Used only in step 2's pool build,
//    where the fragment is about to be tested via `institutionsConsistent`
//    against an INDEPENDENTLY RESOLVED identity on the other operand, so a
//    missing extension lookup (S400: decorated/compound strings routinely
//    return zero results) doesn't need to block a fragment whose own name
//    resolved cleanly.
// In both policies: an extension that resolves to a DIFFERENT openAlexId
// always demotes to 'parent' (positive proof of a more specific institution
// under this fragment), and a fragment that is itself unresolvable while
// extensions exist is always 'parent' — 'admit' never manufactures identity
// evidence, it only tolerates a missing extension lookup.
//
// Wave 3d (extension-cap overflow, Codex HIGH): 'decoration' means PROVEN —
// EVERY extension resolved to the fragment's own identity. When
// `fragmentExtensions` reports `overflow` (more than the 3 checked exist),
// the unchecked ones were never looked at, so 'decoration' can never be
// certified regardless of what the checked 3 show: under 'demote', overflow
// forces 'parent' (an unchecked extension is exactly as unproven as an
// abstaining one); under 'admit', overflow forces `anyAbstained: true` (the
// fragment may still be admitted, but only as unproven — never as a proof
// that would license associated-link credit).
// Returns { kind, extensions, anyAbstained }. `anyAbstained` is true whenever
// kind === 'decoration' cannot be treated as a genuine proof — either because
// an extension actually abstained, or because `overflow` left extensions
// unchecked — i.e. the 'admit' policy (or an incomplete check) is the reason
// this fragment wasn't demoted, not proof. Consumed by buildPool (Wave 3c) to
// tag pool entries `admittedUnproven`, so the crossing step can withhold
// associated-link credit specifically from unproven admissions while still
// allowing genuinely, fully proven decoration/standalone fragments full
// evidence.
async function classifyFragment(fragment, ownOperandSegments, resolve, {
  signal,
  fragmentIdentity,
  unprovenExtensionPolicy = 'demote',
} = {}) {
  const { extensions, overflow } = fragmentExtensions(fragment, ownOperandSegments);
  if (extensions.length === 0) return { kind: 'standalone', extensions, anyAbstained: false };

  const identity = fragmentIdentity !== undefined ? fragmentIdentity : await resolve(fragment, { signal });
  if (!identity) return { kind: 'parent', extensions, anyAbstained: false };

  // Unchecked extensions beyond the resolver-call cap are unproven by
  // construction — seed `anyAbstained` from `overflow` so a fragment can
  // never leave this function certified 'decoration' (proven) when part of
  // its own extension list was never examined.
  let anyAbstained = overflow;
  for (const extension of extensions) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, mirrors step 1's original loop
    const extensionIdentity = await resolve(extension, { signal });
    if (extensionIdentity) {
      if (extensionIdentity.openAlexId !== identity.openAlexId) {
        return { kind: 'parent', extensions, anyAbstained: false };
      }
      // Proven decoration for this extension; keep checking the rest.
    } else if (unprovenExtensionPolicy === 'demote') {
      return { kind: 'parent', extensions, anyAbstained: false };
    } else {
      // unprovenExtensionPolicy === 'admit' and this extension abstained:
      // unproven but tolerated — do not demote, keep checking the rest, but
      // remember this fragment's decoration status was never actually proven.
      anyAbstained = true;
    }
  }
  if (overflow && unprovenExtensionPolicy === 'demote') {
    // All 3 checked extensions matched, but unchecked ones remain — under
    // 'demote' an incomplete check is as good as an abstaining one.
    return { kind: 'parent', extensions, anyAbstained: false };
  }
  return { kind: 'decoration', extensions, anyAbstained };
}

// Is `wholeComparableStr` (already comparable()'d) a parent-fragment SHAPE
// within `otherSegments` — the OTHER operand's own segment list? True when
// otherSegments contains a segment textually equal to wholeComparableStr,
// and classifying that segment against otherSegments' own extensions yields
// 'parent'. Always uses classifyFragment's default 'demote' policy: this
// check exists to WITHHOLD associated-link credit, so an abstaining
// extension must not be waved through — that would let a shape we can't
// disprove quietly keep the very evidence this guard exists to restrict.
// (A directOnly-restricted pairing can still clear via a genuine direct
// identity match — see the accepted-residual test in
// tests/unit/institution-pair-segment-comparison.test.js.) Used both inside
// step 2's pair crossing (to withhold associated-link credit for a whole
// operand that is itself a bare parent of the other operand) and inside
// areConsistent's post-segment fallback (Wave 3 CHANGE 2 guard).
async function wholeIsParentWithin(wholeComparableStr, otherWholeComparableStr, otherSegments, resolve, signal) {
  if (!wholeComparableStr || wholeComparableStr === otherWholeComparableStr) return false;
  const matchingSegment = otherSegments.find((segment) => comparable(segment) === wholeComparableStr);
  if (!matchingSegment) return false;
  const classification = await classifyFragment(matchingSegment, otherSegments, resolve, { signal });
  return classification.kind === 'parent';
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
    // shape), but an extension that merely abstains does not: a missing
    // decoration lookup shouldn't block a fragment whose own name resolved
    // cleanly (live evidence: real decoration extensions — city/state/zip —
    // routinely abstain). Whole operands themselves ALWAYS stay in the pool.
    //
    // Wave 3c tag: an admitted fragment whose admission relied on ≥1
    // abstaining extension (not proof — see classifyFragment's
    // `anyAbstained`) is tagged `admittedUnproven: true`. This is NOT proof
    // the fragment represents its own operand's institution and nothing
    // else — it's the same string that would, under the DEMOTE policy, be a
    // suspected parent fragment; 'admit' only declines to punish it for a
    // missing lookup. The crossing step below restricts what evidence such a
    // tagged entry may contribute (see the closure-argument comment there).
    // Whole operands and proven-decoration/standalone fragments are never
    // tagged.
    const buildPool = async (candidates, resolvedCandidates, segments, wholeComparableStr) => {
      const entries = await Promise.all(candidates.map(async (text, index) => {
        const identity = resolvedCandidates[index];
        if (!identity) return null;
        if (comparable(text) === wholeComparableStr) return { text, identity, admittedUnproven: false };
        const classification = await classifyFragment(text, segments, resolve, {
          signal,
          fragmentIdentity: identity,
          unprovenExtensionPolicy: 'admit',
        });
        if (classification.kind === 'parent') return null;
        return { text, identity, admittedUnproven: Boolean(classification.anyAbstained) };
      }));
      return entries.filter(Boolean);
    };

    const leftPool = await buildPool(leftCandidates, resolvedLeftCandidates, leftSegments, leftWhole);
    const rightPool = await buildPool(rightCandidates, resolvedRightCandidates, rightSegments, rightWhole);
    if (leftPool.length === 0 || rightPool.length === 0) return false;

    // Wave 3 CHANGE 1 (cross-operand leak, adversarial-review follow-up): pool
    // exclusion alone does not stop a WHOLE operand that is itself a bare
    // parent shape (present verbatim as a fragment of the OTHER operand, with
    // a differently-resolving/unresolvable extension there) from clearing via
    // associated-link evidence — the whole always stays pooled. Detect that
    // shape once per direction and restrict such a pairing to direct-identity
    // evidence only (no one-hop associated-institution credit).
    const rightWholeIsParentOfLeft = await wholeIsParentWithin(
      rightWhole,
      leftWhole,
      leftSegments,
      resolve,
      signal,
    );
    const leftWholeIsParentOfRight = await wholeIsParentWithin(
      leftWhole,
      rightWhole,
      rightSegments,
      resolve,
      signal,
    );

    // A pair whose candidate STRINGS are identical shared fragments proves only
    // that the fragment resolves — it matches the fragment against itself, not
    // one operand against the other. Sibling-campus names both contain the bare
    // parent fragment ("University of California"), so without this exclusion a
    // resolvable parent fragment would auto-clear a sibling pair (safety
    // invariant 1). The pair still counts when the shared string IS one of the
    // whole operands, because then it genuinely represents that operand.
    //
    // CLOSURE ARGUMENT (Wave 3c, extended Wave 3d — falsifiable, adversarial
    // review target): after this change, a pairing may draw on
    // associated-link evidence (`institutionsConsistent`'s one-hop
    // `associatedIdentityMatches`) ONLY when BOTH crossing entries are
    // PROVEN: either a whole operand, or a fragment whose EVERY extension —
    // all of them, with none left unchecked by the resolver-call cap
    // (`fragmentExtensions`' `overflow`) — resolved to its own identity
    // (`admittedUnproven === false`). An `admittedUnproven` entry — a
    // fragment admitted to the pool despite an abstaining extension OR an
    // incomplete (overflowed) extension check — is never disproven to be a
    // bare parent, so it participates in identity-EQUALITY evidence only
    // (`institutionDirectMatch`), in either direction, composing with (not
    // replacing) the existing whole-parent `directOnly` restriction and the
    // `sharedFragmentSelfPair` exclusion. This closes the sibling-campus leak
    // where an admitted-unproven bare fragment (e.g. "University of
    // California", identity SYSTEM) crossed a sibling campus's WHOLE operand
    // via SYSTEM's presence in that campus's `associatedInstitutions` —
    // SYSTEM was never proven to represent the fragment's own operand
    // exclusively, so it must not spend associated-link credit on the other
    // operand's behalf. It also closes the extension-cap variant of the same
    // leak (Wave 3d): a fragment with 4+ extensions where the checked 3 all
    // happen to prove same-identity decoration no longer certifies
    // 'decoration' when a longer, unchecked extension could have been the
    // contradictory one. A residual remains where the SAME bare string
    // resolves identically on both sides (identity EQUALITY, not an
    // associated link) — see the accepted-residual test in
    // tests/unit/institution-pair-segment-comparison.test.js.
    return leftPool.some((resolvedLeft) => (
      rightPool.some((resolvedRight) => {
        const sharedFragmentSelfPair = comparable(resolvedLeft.text) === comparable(resolvedRight.text)
          && comparable(resolvedLeft.text) !== leftWhole
          && comparable(resolvedLeft.text) !== rightWhole;
        if (sharedFragmentSelfPair) return false;

        const leftIsWhole = comparable(resolvedLeft.text) === leftWhole;
        const rightIsWhole = comparable(resolvedRight.text) === rightWhole;
        const wholeParentShape = (rightIsWhole && rightWholeIsParentOfLeft)
          || (leftIsWhole && leftWholeIsParentOfRight);
        const identityOnly = wholeParentShape
          || resolvedLeft.admittedUnproven
          || resolvedRight.admittedUnproven;
        if (identityOnly) {
          return DeduplicationService.institutionDirectMatch(resolvedLeft.identity, resolvedRight.identity);
        }
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

    // Wave 3 CHANGE 2 (adversarial-review probe C): only under segmentComparison
    // — the default/off path below must stay byte-identical for enrichment and
    // identity-evidence consumers (owner decision 3). When one whole operand is
    // itself a bare parent-fragment shape of the OTHER operand (same classifier
    // as CHANGE 1), the fallback may clear the pair via direct identity match
    // only — associated-link evidence (in either direction) is not admissible
    // for that pair shape, matching step 2's restriction. This closes the leak
    // where a null/abstained resolve substitutes the raw operand string
    // (`resolvedX || x`) and matches an associated institution BY NAME alone.
    if (segmentComparison) {
      const leftName = DeduplicationService.institutionDisplayName(left);
      const rightName = DeduplicationService.institutionDisplayName(right);
      const leftSegments = typeof leftName === 'string' ? institutionSegments(leftName) : [];
      const rightSegments = typeof rightName === 'string' ? institutionSegments(rightName) : [];
      const leftWhole = comparable(leftName);
      const rightWhole = comparable(rightName);
      const parentShape = (await wholeIsParentWithin(rightWhole, leftWhole, leftSegments, resolve, signal))
        || (await wholeIsParentWithin(leftWhole, rightWhole, rightSegments, resolve, signal));
      if (parentShape) {
        return DeduplicationService.institutionDirectMatch(resolvedLeft || left, resolvedRight || right);
      }
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
