/**
 * Shared provenance DTO helpers for Reviewer Finder candidates.
 *
 * The DTO's axis is candidate groundedness/origin, not whether Claude touched a
 * row during analysis or reasoning. Legacy source fields stay populated during
 * migration, but new logic should read `candidate.provenance`.
 */

const PROVENANCE_KINDS = Object.freeze({
  CITED_REFERENCE: 'cited_reference',
  PROPOSAL_NAMED: 'proposal_named',
  APPLICANT_SUGGESTED: 'applicant_suggested',
  // A contacted reviewer suggested this person (S249 referral capture). A strong human
  // signal — treated like PROPOSAL_NAMED: grounded-ranking bonus + selectable-with-verify.
  REFERRED: 'referred',
  LITERATURE_RETRIEVED: 'literature_retrieved',
  GROUNDED_SEED: 'grounded_seed',
  BARRED_PARAMETRIC: 'barred_parametric',
});

const SEED_ROLES = Object.freeze({
  CITED_AUTHOR: 'cited_author',
  PEER_OR_COMPETITOR: 'peer_or_competitor',
  COLLABORATOR: 'collaborator',
  APPLICANT_SUGGESTED: 'applicant_suggested',
  REFERRED_BY: 'referred_by',
  QUERY_SEED: 'query_seed',
});

const VALID_KINDS = new Set(Object.values(PROVENANCE_KINDS));
const VALID_SEED_ROLES = new Set(Object.values(SEED_ROLES));
const SCHOLARLY_SOURCES = ['pubmed', 'openalex', 'orcid', 'arxiv', 'ads', 'biorxiv', 'chemrxiv'];
const VALID_SOURCES = new Set([...SCHOLARLY_SOURCES, 'proposal_text', 'applicant_form', 'reference_list']);
const GROUNDED_RANKING_BONUS_KINDS = new Set([
  PROVENANCE_KINDS.CITED_REFERENCE,
  PROVENANCE_KINDS.PROPOSAL_NAMED,
  PROVENANCE_KINDS.REFERRED, // S249: a referral from a contacted reviewer is a strong signal
]);

function normalizeSource(source) {
  const value = String(source || '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'pubmed_verified' || value === 'pubmed_discovery') return 'pubmed';
  if (value === 'arxiv_discovery') return 'arxiv';
  if (value === 'biorxiv_discovery') return 'biorxiv';
  if (value === 'chemrxiv_discovery') return 'chemrxiv';
  if (value === 'applicant' || value === 'applicant_recommended') return 'applicant_form';
  if (value === 'proposal' || value === 'proposal_named') return 'proposal_text';
  if (value === 'reference' || value === 'reference_list') return 'reference_list';
  return VALID_SOURCES.has(value) ? value : null;
}

function unique(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));
}

function publicationWorkIds(candidate) {
  const pubs = Array.isArray(candidate?.publications) ? candidate.publications : [];
  return unique(pubs.flatMap((p) => {
    if (!p || typeof p !== 'object') return [];
    return [
      p.doi ? `doi:${p.doi}` : null,
      p.pmid ? `pmid:${p.pmid}` : null,
      p.arxivId ? `arxiv:${p.arxivId}` : null,
      p.adsId ? `ads:${p.adsId}` : null,
      p.openAlexId ? `openalex:${p.openAlexId}` : null,
    ];
  }));
}

function normalizeProvenance(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const kind = VALID_KINDS.has(raw.kind) ? raw.kind : PROVENANCE_KINDS.LITERATURE_RETRIEVED;
  const sources = unique((Array.isArray(raw.sources) ? raw.sources : []).map(normalizeSource));
  const seedRole = VALID_SEED_ROLES.has(raw.seedRole) ? raw.seedRole : SEED_ROLES.QUERY_SEED;
  const groundingWorkIds = unique(raw.groundingWorkIds || []);
  const provenance = { kind, sources, seedRole, groundingWorkIds };
  // Who referred this candidate (S249) — passthrough string, only meaningful for the
  // REFERRED kind. The durable home of the referrer is the match-reason text; this
  // structured field drives the card label. Added ONLY when present, so non-referred
  // provenance objects keep their existing shape.
  const referredBy = typeof raw.referredBy === 'string' && raw.referredBy.trim()
    ? raw.referredBy.trim().slice(0, 180)
    : null;
  if (referredBy) provenance.referredBy = referredBy;
  return provenance;
}

function inferSources(candidate, explicitSources) {
  const values = [
    ...(Array.isArray(explicitSources) ? explicitSources : []),
    ...(Array.isArray(candidate?.sources) ? candidate.sources : []),
    candidate?.verificationSource,
    candidate?.source,
  ];
  return unique(values.map(normalizeSource));
}

function buildReviewerProvenance(candidate, origin = {}) {
  if (candidate?.provenance && !origin.force) {
    // Carry a top-level referredBy onto a provenance object that predates it (a row
    // persisted before this field, or rebuilt with referredBy alongside provenance).
    const base = candidate.provenance;
    if (!base.referredBy && candidate.referredBy) {
      return normalizeProvenance({ ...base, referredBy: candidate.referredBy });
    }
    return normalizeProvenance(base);
  }

  const role = origin.seedRole || candidate?.seedRole;
  const explicitKind = origin.kind || candidate?.provenanceKind;
  const sources = inferSources(candidate, origin.sources);
  let kind = explicitKind;
  let seedRole = role;

  if (!kind && (candidate?.isApplicantRecommended || candidate?.applicantRecommended)) {
    kind = PROVENANCE_KINDS.APPLICANT_SUGGESTED;
    seedRole = SEED_ROLES.APPLICANT_SUGGESTED;
    sources.push('applicant_form');
  }

  if (!kind && candidate?.source === 'proposal_named') {
    kind = PROVENANCE_KINDS.PROPOSAL_NAMED;
    seedRole = seedRole || SEED_ROLES.PEER_OR_COMPETITOR;
    sources.push('proposal_text');
  }

  // S249 referral capture: a contacted reviewer suggested this person. Inferred from a
  // `referredBy` string or an explicit `referred` source — checked on BOTH the singular
  // `source` and the plural `sources` (a my-candidates reload rebuilds the row with
  // `sources: ['staff_manual', 'referred']`).
  if (!kind && (candidate?.referredBy || candidate?.source === 'referred'
    || (Array.isArray(candidate?.sources) && candidate.sources.includes('referred')))) {
    kind = PROVENANCE_KINDS.REFERRED;
    seedRole = seedRole || SEED_ROLES.REFERRED_BY;
  }
  if (kind === PROVENANCE_KINDS.REFERRED) {
    seedRole = seedRole === SEED_ROLES.QUERY_SEED || !seedRole ? SEED_ROLES.REFERRED_BY : seedRole;
  }

  if (!kind && candidate?.source === 'cited_reference') {
    kind = PROVENANCE_KINDS.CITED_REFERENCE;
    seedRole = seedRole || SEED_ROLES.CITED_AUTHOR;
    sources.push('reference_list');
  }

  if (!kind) {
    // Current Track A starts with model-suggested names, but a PubMed hit grounds
    // the candidate against literature. If no real source is present, mark the
    // parametric seed as barred rather than inferring provenance from the legacy
    // Claude flag.
    kind = sources.length > 0
      ? PROVENANCE_KINDS.LITERATURE_RETRIEVED
      : PROVENANCE_KINDS.BARRED_PARAMETRIC;
  }

  return normalizeProvenance({
    kind,
    sources,
    seedRole: seedRole || SEED_ROLES.QUERY_SEED,
    groundingWorkIds: origin.groundingWorkIds || candidate?.groundingWorkIds || publicationWorkIds(candidate),
    referredBy: origin.referredBy || candidate?.referredBy || candidate?.provenance?.referredBy || null,
  });
}

function legacySourcesForCandidate(candidate, provenance) {
  const existing = Array.isArray(candidate?.sources) ? candidate.sources : [];
  return unique([
    ...existing,
    ...provenance.sources,
    candidate?.verificationSource,
    normalizeSource(candidate?.source),
  ]);
}

function withReviewerProvenance(candidate, origin = {}) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  const provenance = buildReviewerProvenance(candidate, origin);
  return {
    ...candidate,
    provenance,
    sources: legacySourcesForCandidate(candidate, provenance),
    isClaudeSuggestion: !!candidate.isClaudeSuggestion,
  };
}

function provenanceKindOf(candidate) {
  return buildReviewerProvenance(candidate).kind;
}

function saveSourceListForCandidate(candidate) {
  const provenance = buildReviewerProvenance(candidate);
  const scholarly = SCHOLARLY_SOURCES.filter((source) => provenance.sources.includes(source));
  const fallback = scholarly.length === 0
    ? inferSources(candidate).filter((source) => SCHOLARLY_SOURCES.includes(source))
    : [];
  return unique([...scholarly, ...fallback, provenance.kind]);
}

function hasGroundedProvenanceRankingBonus(candidate) {
  const provenance = buildReviewerProvenance(candidate);
  return GROUNDED_RANKING_BONUS_KINDS.has(provenance.kind);
}

// Cited-in-proposal / PI-named candidates are human/document-grounded: the proposal author
// explicitly named (or cited) this SPECIFIC person. An UNRESOLVED automatic identity match
// ("couldn't auto-match the name", NOT "might be the wrong person") must not HARD-BLOCK them
// the way it does a system-discovered candidate. They stay in the selectable
// cited_or_proposal_named group with a "verify identity" affordance; the SAVE path force-nulls
// their contact/bibliometrics until identity is confirmed/probable (anchor-or-abstain still
// enforced — see save-candidates), so a selectable-but-unverified row can't carry a wrong email.
function isIdentityReviewExemptProvenance(kind) {
  return kind === PROVENANCE_KINDS.CITED_REFERENCE
    || kind === PROVENANCE_KINDS.PROPOSAL_NAMED
    // S249: a referral is a staff-asserted strong human signal (a contacted reviewer named
    // this person), not a system-discovered row — selectable-with-verify like proposal_named.
    // The save path still force-nulls contact/bibliometrics until identity is confirmed/probable.
    || kind === PROVENANCE_KINDS.REFERRED;
}

function provenanceGroupOf(candidate) {
  const provenance = buildReviewerProvenance(candidate);
  // Exempt kinds (cited/proposal-named) route to their selectable group EVEN WHEN unresolved —
  // checked before the unresolved gate. System-discovered rows fall through to the gate below.
  if (isIdentityReviewExemptProvenance(provenance.kind)) {
    return 'cited_or_proposal_named';
  }
  if (candidate?.needsIdentification || candidate?.identityStatus === 'unresolved' || candidate?.verificationStatus === 'unresolved') {
    return 'needs_identity_review';
  }
  if (provenance.kind === PROVENANCE_KINDS.APPLICANT_SUGGESTED) return 'applicant_suggested';
  if (provenance.kind === PROVENANCE_KINDS.LITERATURE_RETRIEVED || provenance.kind === PROVENANCE_KINDS.GROUNDED_SEED) {
    return 'literature_retrieved';
  }
  // Fallback for an odd/unknown provenance kind (e.g. BARRED_PARAMETRIC). A row whose
  // IDENTITY is positively resolved (confirmed/probable/verified) is a legitimate,
  // selectable reviewer even if its origin kind is barred/unknown — e.g. a BARRED
  // Track-A row upgraded by a shared-ORCID Track-B match (discovery-service's
  // mergeTrackBWithNeedsReviewBySharedOrcid keeps the Track-A kind but gains the
  // resolved identity). Only a row with NO positive identity routes to
  // needs_identity_review, so the client selectability gate and the save-candidates
  // server gate agree (resolved ⇒ savable, unresolved ⇒ gated).
  const positivelyResolved = candidate?.verified === true
    || candidate?.identityStatus === 'confirmed' || candidate?.identityStatus === 'probable'
    || candidate?.verificationStatus === 'verified' || candidate?.verificationStatus === 'probable';
  return positivelyResolved ? 'literature_retrieved' : 'needs_identity_review';
}

function provenanceLabelForCandidate(candidate) {
  const provenance = buildReviewerProvenance(candidate);
  const sources = provenance.sources.length > 0 ? provenance.sources.join(', ') : 'unconfirmed';
  if (provenance.kind === PROVENANCE_KINDS.REFERRED) {
    return provenance.referredBy ? `Externally-Referred · ${provenance.referredBy}` : 'Externally-Referred';
  }
  if (provenance.kind === PROVENANCE_KINDS.CITED_REFERENCE) return `Cited reference (${sources})`;
  if (provenance.kind === PROVENANCE_KINDS.PROPOSAL_NAMED) return `Proposal-named (${sources})`;
  if (provenance.kind === PROVENANCE_KINDS.APPLICANT_SUGGESTED) return 'Applicant-Referred';
  if (provenance.kind === PROVENANCE_KINDS.LITERATURE_RETRIEVED) return `Literature-retrieved (${sources})`;
  if (provenance.kind === PROVENANCE_KINDS.GROUNDED_SEED) return `Grounded seed (${sources})`;
  return 'Needs identity review';
}

// Institution-COI detail carries only { piInstitution, reviewerInstitution } (S240
// Chunk 2a). Strip any legacy `.historical` field so a roster row saved before the
// historical-COI retirement isn't reloaded/rendered as a current conflict. Canonical
// home (shared by the client merge/prune AND the server roster-store read path).
function sanitizeInstitutionCOIDetails(detail) {
  if (!detail || typeof detail !== 'object') return null;
  const piInstitution = detail.piInstitution || null;
  const reviewerInstitution = detail.reviewerInstitution || null;
  return (piInstitution || reviewerInstitution) ? { piInstitution, reviewerInstitution } : null;
}

module.exports = {
  PROVENANCE_KINDS,
  SEED_ROLES,
  buildReviewerProvenance,
  withReviewerProvenance,
  provenanceKindOf,
  saveSourceListForCandidate,
  hasGroundedProvenanceRankingBonus,
  provenanceGroupOf,
  isIdentityReviewExemptProvenance,
  provenanceLabelForCandidate,
  sanitizeInstitutionCOIDetails,
};
