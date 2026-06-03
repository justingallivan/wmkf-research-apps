/**
 * ReviewerIdentityResolver — Phase 2, PR1 (docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md).
 *
 * A deterministic, PURE post-enrichment CLASSIFIER. It does NOT fetch anything —
 * it consumes the ORCID/Scholar evidence ContactEnrichmentService.enrichCandidate
 * already gathered and decides an identity status. The status is the single gate
 * that decides whether identity-bearing fields (Scholar id/url, h-index/citations,
 * ORCID id/url) may be persisted or count toward ranking.
 *
 * PR1 rules (§3 of the design):
 *   - Anchors are WEAK only (public ORCID name-match, Scholar profile name-match).
 *     No strong anchors exist yet (authenticated ORCID / faculty page / publication
 *     cluster are later PRs), so `confirmed` is NOT reachable in PR1.
 *   - A lone weak anchor → `unresolved`. Two corroborating weak anchors → `probable`.
 *   - ORCID multi-match (structured ambiguous) → `ambiguous`.
 *   - A name/institution-mismatched Scholar profile is a REJECTED ANCHOR (anchor-level),
 *     never identity rejection — it just fails to support the target.
 *   - `rejected` (identity-level) requires positively cross-identifying a different
 *     human with supporting evidence; PR1's weak-only evidence can't establish that,
 *     so PR1 does not emit `rejected` (kept for the later strong-anchor PR).
 *
 * Principle: unresolved is acceptable; wrong-and-confident is not.
 */

const RESOLVER_VERSION = '1.0.0-pr1';

// status → display-only confidence band (§2.2 locked map). Never a sort key.
const CONFIDENCE_BAND = {
  confirmed: 'high',
  probable: 'medium',
  ambiguous: null,
  unresolved: null,
  rejected: null,
};

/**
 * Normalize the subset of enrichCandidate's `contactEnrichment` the classifier
 * reads into a stable `evidence` contract (so the resolver never reaches into raw
 * enrichment internals). Returns { scholar, orcid, affiliation }.
 */
function evidenceFromEnrichment(contactEnrichment = {}, hypothesis = {}) {
  const tr = contactEnrichment.tierResults || {};
  const sp = tr.scholar_profile || null;
  const orcid = tr.orcid || null;

  const scholar = sp
    ? {
        scholarId: sp.scholarId || null,
        googleScholarUrl: sp.scholarProfileUrl || contactEnrichment.googleScholarUrl || null,
        displayName: sp.scholarDisplayName || null,
        nameMismatch: !!sp.nameMismatch,
        institutionMismatch: !!sp.institutionMismatch,
        skipped: sp.skipped || null,
      }
    : null;

  return {
    scholar,
    // orcid is already the findContact result shape: {status:'resolved'|'ambiguous', orcidId, ...}
    // or null (not found / no name match) or {error}.
    orcid: orcid && !orcid.error ? orcid : null,
    affiliation: hypothesis.claimedInstitution || contactEnrichment.affiliation || null,
  };
}

function scholarAnchor(s) {
  if (!s || !s.scholarId) return null;
  const failReason = s.nameMismatch
    ? 'name_mismatch'
    : s.institutionMismatch
      ? 'institution_mismatch'
      : (typeof s.skipped === 'string' ? s.skipped : null);
  const anchor = {
    type: 'scholar_profile',
    canonicalKey: `scholar:${s.scholarId}`,
    value: s.scholarId,
    weight: 'weak',
    sourceUrl: s.googleScholarUrl || null,
    parserOutput: { displayName: s.displayName || null },
    verifier: `scholarNameMismatch@${RESOLVER_VERSION}`,
    verdict: failReason ? 'fail' : 'pass',
  };
  if (failReason) anchor.reason = failReason;
  return anchor;
}

function orcidEval(o) {
  if (!o) return { anchor: null, ambiguous: false };
  if (o.status === 'ambiguous') {
    return { anchor: null, ambiguous: true, candidateCount: o.candidateCount || null };
  }
  if (o.status === 'resolved' && o.orcidId) {
    return {
      anchor: {
        type: 'orcid_public',
        canonicalKey: `orcid:${o.orcidId}`,
        value: o.orcidId,
        weight: 'weak',
        sourceUrl: o.orcidUrl || null,
        parserOutput: { name: o.name || null },
        verifier: `orcidNameMatch@${RESOLVER_VERSION}`,
        verdict: 'pass',
      },
      ambiguous: false,
    };
  }
  return { anchor: null, ambiguous: false };
}

/**
 * Classify a candidate's identity from already-gathered evidence.
 * @param {object} hypothesis - CandidateHypothesis (name, claimedInstitution, ...)
 * @param {object} evidence   - from evidenceFromEnrichment()
 * @param {object} [opts]     - { now } injectable timestamp for tests
 * @returns {object} ResolvedIdentity (§2.2)
 */
function resolveIdentity(hypothesis = {}, evidence = {}, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const anchors = [];
  const rejectedAnchors = [];

  const sa = scholarAnchor(evidence.scholar);
  if (sa) (sa.verdict === 'pass' ? anchors : rejectedAnchors).push(withStamp(sa, now));

  const oe = orcidEval(evidence.orcid);
  if (oe.anchor) anchors.push(withStamp(oe.anchor, now));

  // STATUS (PR1 rules — confirmed & rejected are not reachable with weak-only evidence).
  let status;
  let competitors = [];
  if (oe.ambiguous) {
    status = 'ambiguous';
    competitors = [{
      name: hypothesis.name || null,
      primaryAnchor: { type: 'orcid_public', canonicalKey: null },
      competingAffiliations: [],
      conflictingEvidence: [`${oe.candidateCount || 'multiple'} plausible ORCID records for this name`],
      whyUnresolved: 'Multiple name-matching ORCID records could not be disambiguated',
    }];
  } else if (anchors.length >= 2) {
    status = 'probable';   // ≥2 corroborating weak anchors agreeing on the target
  } else {
    status = 'unresolved'; // lone weak anchor, or none (incl. only a rejected anchor)
  }

  return {
    status,
    confidenceBand: CONFIDENCE_BAND[status] ?? null,
    anchors,
    rejectedAnchors,
    competitors,
    evidenceSummary: summarize(status, anchors, rejectedAnchors, oe),
    resolverVersion: RESOLVER_VERSION,
    resolvedAt: now,
  };
}

function withStamp(anchor, now) {
  return { retrievedAt: now, fetchResult: 'ok', ...anchor };
}

function summarize(status, anchors, rejectedAnchors, oe) {
  const parts = [];
  if (anchors.length) parts.push(`${anchors.length} weak anchor(s): ${anchors.map((a) => a.type).join(', ')}`);
  if (rejectedAnchors.length) parts.push(`rejected: ${rejectedAnchors.map((a) => `${a.type}(${a.reason})`).join(', ')}`);
  if (oe.ambiguous) parts.push('ORCID ambiguous');
  if (!parts.length) parts.push('no identity evidence');
  return `${status} — ${parts.join('; ')}`;
}

/** The identity-bearing fields PR1 gates/clears (resolver-sourced only; never faculty/website). */
const RESOLVER_SOURCED_FIELDS = [
  'wmkf_googlescholarid', 'wmkf_googlescholarurl',
  'wmkf_hindex', 'wmkf_i10index', 'wmkf_totalcitations',
  'wmkf_orcid', 'wmkf_orcidurl',
];

/** True when this status permits persisting identity-bearing fields. */
function mayPersistIdentity(status) {
  return status === 'confirmed' || status === 'probable';
}

module.exports = {
  RESOLVER_VERSION,
  CONFIDENCE_BAND,
  RESOLVER_SOURCED_FIELDS,
  evidenceFromEnrichment,
  resolveIdentity,
  mayPersistIdentity,
};
