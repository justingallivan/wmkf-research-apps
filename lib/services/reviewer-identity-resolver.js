/**
 * ReviewerIdentityResolver — Phase 2, PR1 (docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md).
 *
 * A deterministic, PURE post-enrichment CLASSIFIER. It does NOT fetch anything —
 * it consumes the ORCID/Scholar evidence ContactEnrichmentService.enrichCandidate
 * already gathered and decides an identity status. The status is the single gate
 * that decides whether identity-bearing fields (Scholar id/url, h-index/citations,
 * ORCID id/url) may be persisted or count toward ranking.
 *
 * PR1 rules (§3 of the design), extended in S215 (§3.1):
 *   - Most anchors are WEAK (public ORCID name-match, Scholar profile name-match).
 *   - ONE strong anchor exists now: an institution-corroborated public ORCID — the
 *     ORCID record's self-reported institution contains the reviewer's affiliation
 *     token, i.e. name-match AND institution-match (two independent signals). It is
 *     sufficient ALONE to reach `probable`. (Authenticated ORCID / faculty page /
 *     publication cluster remain later PRs, so `confirmed` is still NOT reachable.)
 *   - A lone WEAK anchor → `unresolved`. One STRONG anchor, or two corroborating
 *     weak anchors → `probable`.
 *   - ORCID multi-match (structured ambiguous) → `ambiguous`.
 *   - A name/institution-mismatched Scholar profile is a REJECTED ANCHOR (anchor-level),
 *     never identity rejection — it just fails to support the target.
 *   - `rejected` (identity-level) requires positively cross-identifying a different
 *     human with supporting evidence; PR1's weak-only evidence can't establish that,
 *     so PR1 does not emit `rejected` (kept for the later strong-anchor PR).
 *
 * Principle: unresolved is acceptable; wrong-and-confident is not.
 */

const RESOLVER_VERSION = '1.2.0-openalex-orcid-spine';

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
    // Institution-corroborated public ORCID (name-match AND institution-match) is a
    // STRONG anchor — sufficient alone for `probable`. A bare name-match is WEAK.
    const corroborated = !!o.institutionCorroborated;
    return {
      anchor: {
        type: corroborated ? 'orcid_public_institution_corroborated' : 'orcid_public',
        canonicalKey: `orcid:${o.orcidId}`,
        value: o.orcidId,
        weight: corroborated ? 'strong' : 'weak',
        sourceUrl: o.orcidUrl || null,
        parserOutput: { name: o.name || null, matchedInstitution: corroborated ? (o.matchedInstitution || null) : null },
        verifier: corroborated ? `orcidInstitutionCorroborated@${RESOLVER_VERSION}` : `orcidNameMatch@${RESOLVER_VERSION}`,
        verdict: 'pass',
      },
      ambiguous: false,
    };
  }
  return { anchor: null, ambiguous: false };
}

function normalizeExternalAnchor(raw = {}, now) {
  if (!raw || !raw.type) return null;
  return withStamp({
    type: raw.type,
    canonicalKey: raw.canonicalKey || (raw.value ? `${raw.type}:${raw.value}` : null),
    value: raw.value || null,
    weight: raw.weight === 'strong' ? 'strong' : 'weak',
    sourceUrl: raw.sourceUrl || null,
    parserOutput: raw.parserOutput || {},
    verifier: raw.verifier || `externalEvidence@${RESOLVER_VERSION}`,
    verdict: raw.verdict || 'pass',
    reason: raw.reason || null,
  }, now);
}

function hasAnchor(anchors, type, weight = null) {
  return anchors.some((anchor) => anchor.type === type && (!weight || anchor.weight === weight));
}

function classifySpineEvidence(hypothesis, evidence, anchors) {
  const spine = evidence.spine || {};
  if (spine.abstainReason) {
    return {
      status: 'unresolved',
      competitors: [],
    };
  }

  if (spine.crossSourceOrcidDisagreement) {
    return {
      status: 'ambiguous',
      competitors: [{
        name: hypothesis.name || null,
        primaryAnchor: { type: 'cross_source_orcid_agreement', canonicalKey: null },
        competingAffiliations: [],
        conflictingEvidence: ['OpenAlex inline ORCID disagreed with ORCID direct search'],
        whyUnresolved: 'Cross-source ORCID disagreement on selected record',
      }],
    };
  }

  const strongAffiliation = hasAnchor(anchors, 'affiliation_match', 'strong')
    || (hasAnchor(anchors, 'affiliation_match') && hasAnchor(anchors, 'orcid_employment_corroborated'));
  const anyAffiliation = hasAnchor(anchors, 'affiliation_match');
  const topic = hasAnchor(anchors, 'topic_match');
  const employment = hasAnchor(anchors, 'orcid_employment_corroborated');
  const authorshipGrounded = hasAnchor(anchors, 'authorship_grounded', 'strong');

  if (authorshipGrounded && (topic || employment)) {
    return { status: 'confirmed', competitors: [] };
  }
  if (authorshipGrounded) {
    return { status: 'probable', competitors: [] };
  }

  if (strongAffiliation && employment && topic) {
    return { status: 'confirmed', competitors: [] };
  }
  if ((anyAffiliation && topic) || strongAffiliation) {
    return { status: 'probable', competitors: [] };
  }

  // S235: a STRONG orcid_employment_corroborated anchor (the reviewer's OWN ORCID profile lists
  // the claimed institution) is a person-specific signal that disambiguates among namesakes
  // better than OpenAlex's `last_known_institution`, which drifts (a sabbatical / most-recent
  // paper). Promote to `probable` even without an OpenAlex `affiliation_match` — realizing this
  // file's documented intent that an institution-corroborated ORCID is sufficient alone for
  // probable. GATED on `spine.forenameAgrees` (the selected record's forename fully agrees with
  // the suggestion) so a wrong-forename namesake whose ORCID happens to corroborate cannot be
  // promoted (the fail-dangerous hazard). `probable` only — never `confirmed`.
  const employmentStrong = hasAnchor(anchors, 'orcid_employment_corroborated', 'strong');
  if (employmentStrong && topic && spine.forenameAgrees === true) {
    return { status: 'probable', competitors: [] };
  }

  return { status: 'unresolved', competitors: [] };
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

  const externalAnchors = Array.isArray(evidence.identityAnchors)
    ? evidence.identityAnchors.map((a) => normalizeExternalAnchor(a, now)).filter(Boolean)
    : [];
  for (const externalAnchor of externalAnchors) {
    (externalAnchor.verdict === 'pass' ? anchors : rejectedAnchors).push(externalAnchor);
  }

  // STATUS (PR1 rules — confirmed & rejected are not reachable with weak-only evidence).
  let status;
  let competitors = [];
  if (externalAnchors.length > 0 || evidence.spine) {
    const spineResult = classifySpineEvidence(hypothesis, evidence, anchors);
    status = spineResult.status;
    competitors = spineResult.competitors;
  } else if (oe.ambiguous) {
    status = 'ambiguous';
    competitors = [{
      name: hypothesis.name || null,
      primaryAnchor: { type: 'orcid_public', canonicalKey: null },
      competingAffiliations: [],
      conflictingEvidence: [`${oe.candidateCount || 'multiple'} plausible ORCID records for this name`],
      whyUnresolved: 'Multiple name-matching ORCID records could not be disambiguated',
    }];
  } else if (anchors.some((a) => a.weight === 'strong') || anchors.length >= 2) {
    status = 'probable';   // one STRONG anchor, or ≥2 corroborating weak anchors
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
  if (anchors.length) parts.push(`${anchors.length} anchor(s): ${anchors.map((a) => `${a.type}[${a.weight}]`).join(', ')}`);
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
