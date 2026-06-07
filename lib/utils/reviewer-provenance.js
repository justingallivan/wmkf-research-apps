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
  LITERATURE_RETRIEVED: 'literature_retrieved',
  GROUNDED_SEED: 'grounded_seed',
  BARRED_PARAMETRIC: 'barred_parametric',
});

const SEED_ROLES = Object.freeze({
  CITED_AUTHOR: 'cited_author',
  PEER_OR_COMPETITOR: 'peer_or_competitor',
  COLLABORATOR: 'collaborator',
  APPLICANT_SUGGESTED: 'applicant_suggested',
  QUERY_SEED: 'query_seed',
});

const VALID_KINDS = new Set(Object.values(PROVENANCE_KINDS));
const VALID_SEED_ROLES = new Set(Object.values(SEED_ROLES));
const SCHOLARLY_SOURCES = ['pubmed', 'openalex', 'orcid', 'arxiv', 'ads', 'biorxiv', 'chemrxiv'];
const VALID_SOURCES = new Set([...SCHOLARLY_SOURCES, 'proposal_text', 'applicant_form', 'reference_list']);
const GROUNDED_RANKING_BONUS_KINDS = new Set([
  PROVENANCE_KINDS.CITED_REFERENCE,
  PROVENANCE_KINDS.PROPOSAL_NAMED,
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
  return { kind, sources, seedRole, groundingWorkIds };
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
    return normalizeProvenance(candidate.provenance);
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

function provenanceGroupOf(candidate) {
  const provenance = buildReviewerProvenance(candidate);
  if (candidate?.needsIdentification || candidate?.identityStatus === 'unresolved' || candidate?.verificationStatus === 'unresolved') {
    return 'needs_identity_review';
  }
  if ([PROVENANCE_KINDS.CITED_REFERENCE, PROVENANCE_KINDS.PROPOSAL_NAMED].includes(provenance.kind)) {
    return 'cited_or_proposal_named';
  }
  if (provenance.kind === PROVENANCE_KINDS.APPLICANT_SUGGESTED) return 'applicant_suggested';
  if (provenance.kind === PROVENANCE_KINDS.LITERATURE_RETRIEVED || provenance.kind === PROVENANCE_KINDS.GROUNDED_SEED) {
    return 'literature_retrieved';
  }
  return 'needs_identity_review';
}

function provenanceLabelForCandidate(candidate) {
  const provenance = buildReviewerProvenance(candidate);
  const sources = provenance.sources.length > 0 ? provenance.sources.join(', ') : 'unconfirmed';
  if (provenance.kind === PROVENANCE_KINDS.CITED_REFERENCE) return `Cited reference (${sources})`;
  if (provenance.kind === PROVENANCE_KINDS.PROPOSAL_NAMED) return `Proposal-named (${sources})`;
  if (provenance.kind === PROVENANCE_KINDS.APPLICANT_SUGGESTED) return 'Applicant-suggested';
  if (provenance.kind === PROVENANCE_KINDS.LITERATURE_RETRIEVED) return `Literature-retrieved (${sources})`;
  if (provenance.kind === PROVENANCE_KINDS.GROUNDED_SEED) return `Grounded seed (${sources})`;
  return 'Needs identity review';
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
  provenanceLabelForCandidate,
};
