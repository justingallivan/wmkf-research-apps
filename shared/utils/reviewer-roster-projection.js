/**
 * Shared reviewer roster candidate projection.
 *
 * Owns the bounded render/persistence DTO consumed by Workbench Find and the
 * server roster writers. Keep output keys, order, and field semantics stable:
 * stored candidate JSON is reloaded into the same client projection.
 */

import { mayPersistIdentity } from '../../lib/services/reviewer-identity-resolver';
import { buildReviewerProvenance, sanitizeInstitutionCOIDetails } from '../../lib/utils/reviewer-provenance';
import { ContactParser } from '../../lib/utils/contact-parser';
import { reviewerCandidateKey } from '../../lib/utils/reviewer-candidate-key';
import { pruneApplicantKnownReviewer } from '../../lib/utils/applicant-known-reviewer';
import { INSTITUTION_STAGE2_PRESENTATION_VERSION } from './institution-stage2-presentation';

// Increment when applicant-recommended enrichment semantics change in a way
// that requires existing roster JSON to be recomputed. Unversioned legacy rows
// deliberately miss the cache once and are stamped by the enrichment service.
// v4 (S400): verdict copy overhaul — version-3 rows carry the pre-fix vague
// "contradict the listed institution" reasoning (or a stale mismatch flag the
// success path now reconciles) and must re-enrich rather than replay it.
export const APPLICANT_ENRICHMENT_CACHE_VERSION = 4;

function pruneInstitutionPresentation(value) {
  if (!value || value.version !== INSTITUTION_STAGE2_PRESENTATION_VERSION) return null;
  const bounded = (text, max = 500) => (
    typeof text === 'string' ? text.trim().slice(0, max) || null : null
  );
  const allowedKinds = new Set([
    'compatible',
    'additional',
    'current_conflict',
    'historical',
    'provider_failure',
    'unresolved',
  ]);
  const allowedTones = new Set(['neutral', 'warning']);
  const allowedRemedies = new Set([
    'confirm_identity',
    'correct_current_institution',
    'record_joint_appointment',
    'not_a_fit',
    'retry_enrichment',
    'add_authoritative_evidence',
    'operator_review',
  ]);
  return {
    version: INSTITUTION_STAGE2_PRESENTATION_VERSION,
    visible: value.visible === true,
    kind: allowedKinds.has(value.kind) ? value.kind : 'unresolved',
    tone: allowedTones.has(value.tone) ? value.tone : 'neutral',
    heading: bounded(value.heading, 120),
    detail: bounded(value.detail),
    relationship: bounded(value.relationship, 40) || 'unresolved',
    evidenceContext: bounded(value.evidenceContext, 80) || 'unresolved',
    evidenceInstitution: bounded(value.evidenceInstitution, 180),
    recordedInstitution: bounded(value.recordedInstitution, 180),
    remedies: [...new Set((Array.isArray(value.remedies) ? value.remedies : [])
      .filter((remedy) => allowedRemedies.has(remedy)))],
    legacyHold: value.legacyHold === true,
  };
}

/**
 * Slice 5: compact, bounded `contactLeads` for durable roster storage. Keeps only
 * the fields the card renders (ContactLeads); drops `warnings` (re-derived in the
 * UI) and `evidence` (unused in display today), and caps count + string lengths so
 * a roster row stays small and never carries raw provider payloads (spec §7).
 * `persistable:false` is re-asserted so a roster round-trip can never flip it.
 */
export const MAX_ROSTER_CONTACT_LEADS = 8;
export const MAX_ROSTER_IDENTITY_ANCHORS = 20;
export const MAX_ROSTER_AFFILIATION_ASSERTIONS = 24;
export function pruneContactLeads(leads) {
  if (!Array.isArray(leads)) return [];
  return leads
    .slice(0, MAX_ROSTER_CONTACT_LEADS)
    .map((l) => ({
      type: l && l.type ? String(l.type) : null,
      value: l && typeof l.value === 'string' ? l.value.slice(0, 320) : null,
      sourceUrl: l && typeof l.sourceUrl === 'string' ? l.sourceUrl.slice(0, 500) : null,
      source: l && l.source ? String(l.source) : null,
      confidence: l && l.confidence ? String(l.confidence) : null,
      rejectedReason: l && l.rejectedReason ? String(l.rejectedReason) : null,
      persistable: false,
    }))
    .filter((l) => l.value);
}

export function pruneEmailEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  const publications = Array.isArray(evidence.publications)
    ? evidence.publications.slice(0, 5).map((publication) => ({
        pmid: publication?.pmid ? String(publication.pmid).slice(0, 32) : null,
        pmcid: publication?.pmcid ? String(publication.pmcid).slice(0, 32) : null,
        doi: publication?.doi ? String(publication.doi).slice(0, 160) : null,
        title: publication?.title ? String(publication.title).slice(0, 500) : null,
        year: Number.isFinite(publication?.year) ? publication.year : null,
        url: publication?.url ? String(publication.url).slice(0, 500) : null,
        providers: Array.isArray(publication?.providers)
          ? publication.providers.slice(0, 3).map(String)
          : [],
      }))
    : [];
  const alternatives = Array.isArray(evidence.alternatives)
    ? evidence.alternatives
        .slice(0, 8)
        .map((alternative) => ({
          email: alternative?.email ? String(alternative.email).slice(0, 320) : null,
          matchClass: alternative?.matchClass ? String(alternative.matchClass).slice(0, 80) : null,
        }))
        .filter((alternative) => alternative.email)
    : [];
  return {
    sourceKind: evidence.sourceKind ? String(evidence.sourceKind).slice(0, 80) : null,
    sourceUrl: evidence.sourceUrl ? String(evidence.sourceUrl).slice(0, 500) : null,
    action: evidence.action ? String(evidence.action).slice(0, 40) : null,
    ownership: evidence.ownership ? String(evidence.ownership).slice(0, 80) : null,
    ownershipProof: evidence.ownershipProof ? String(evidence.ownershipProof).slice(0, 100) : null,
    matchClass: evidence.matchClass ? String(evidence.matchClass).slice(0, 80) : null,
    alternatives,
    affiliationMatched: evidence.affiliationMatched === true,
    publicationCount: Number.isFinite(evidence.publicationCount) ? evidence.publicationCount : publications.length,
    providers: Array.isArray(evidence.providers) ? evidence.providers.slice(0, 3).map(String) : [],
    publications,
    deliverabilityChecked: evidence.deliverabilityChecked === true,
  };
}

export function pruneIdentityDecision(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null;
  return {
    status: identity.status || null,
    confidenceBand: identity.confidenceBand || null,
    resolverVersion: identity.resolverVersion || null,
    resolvedAt: identity.resolvedAt || null,
    evidenceSummary: identity.evidenceSummary || null,
    anchors: Array.isArray(identity.anchors)
      ? identity.anchors.slice(0, MAX_ROSTER_IDENTITY_ANCHORS).map((anchor) => ({
          type: anchor?.type || null,
          canonicalKey: anchor?.canonicalKey || null,
          sourceUrl: anchor?.sourceUrl || null,
          verifier: anchor?.verifier || null,
        }))
      : null,
  };
}

export function pruneIndependentIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null;
  return {
    version: boundedText(identity.version, 80),
    result: boundedText(identity.result, 40),
    reason: boundedText(identity.reason, 160),
    excludesAffiliation: identity.excludesAffiliation === true,
    method: boundedText(identity.method, 80),
    resolverVersion: boundedText(identity.resolverVersion, 100),
    requestBinding: boundedText(identity.requestBinding, 160),
    candidateKey: boundedText(identity.candidateKey, 200),
    identityInputDigest: boundedText(identity.identityInputDigest, 128),
    evidenceDigest: boundedText(identity.evidenceDigest, 128),
    evaluatedAt: boundedText(identity.evaluatedAt, 80),
    providerObservedAt: boundedText(identity.providerObservedAt, 80),
    expiresAt: boundedText(identity.expiresAt, 80),
    providerState: boundedText(identity.providerState, 40),
  };
}

export function pruneAffiliationAssertions(assertions) {
  if (!Array.isArray(assertions)) return [];
  return assertions.slice(0, MAX_ROSTER_AFFILIATION_ASSERTIONS).flatMap((assertion) => {
    const rawText = boundedText(assertion?.rawText, 1000);
    if (!rawText) return [];
    return [{
      rawText,
      sourceType: boundedText(assertion.sourceType, 80),
      sourceReference: boundedText(assertion.sourceReference, 500),
      observedAt: boundedText(assertion.observedAt, 80),
      currentness: boundedText(assertion.currentness, 40),
      authorSpecific: [true, false, 'unknown'].includes(assertion.authorSpecific)
        ? assertion.authorSpecific
        : 'unknown',
      publicationYear: assertion.publicationYear != null && Number.isSafeInteger(Number(assertion.publicationYear))
        ? Number(assertion.publicationYear)
        : null,
      startYear: assertion.startYear != null && Number.isSafeInteger(Number(assertion.startYear))
        ? Number(assertion.startYear)
        : null,
      endYear: assertion.endYear != null && Number.isSafeInteger(Number(assertion.endYear))
        ? Number(assertion.endYear)
        : null,
      ror: boundedText(assertion.ror, 200),
      openAlexId: boundedText(assertion.openAlexId, 200),
    }];
  });
}

export function pruneEligibilityEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  return {
    status: evidence.status === 'deceased' || evidence.status === 'emeritus'
      ? evidence.status
      : null,
    url: typeof evidence.url === 'string' ? evidence.url.slice(0, 500) : null,
    title: typeof evidence.title === 'string' ? evidence.title.slice(0, 500) : null,
    snippet: typeof evidence.snippet === 'string' ? evidence.snippet.slice(0, 800) : null,
    sourceDomain: typeof evidence.sourceDomain === 'string' ? evidence.sourceDomain.slice(0, 255) : null,
    checkedAt: typeof evidence.checkedAt === 'string' ? evidence.checkedAt.slice(0, 80) : null,
  };
}

export function pruneDataverseContactEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const statuses = new Set(['known', 'review_required', 'none', 'unavailable']);
  const reasons = new Set([
    'provisional_orcid_match',
    'ambiguous_or_name_mismatch',
    'orcid_email_split',
    'contact_linked_elsewhere',
    'email_mismatch',
    'identity_conflict',
    'lookup_unavailable',
    'partial_enrichment',
    'deadline_exceeded',
  ]);
  const institutionSources = new Set(['staff_confirmed', 'primary_affiliation', 'organization']);
  const recordKinds = Array.isArray(evidence.recordKinds)
    ? Array.from(new Set(evidence.recordKinds.filter((kind) => kind === 'contact' || kind === 'potential_reviewer'))).slice(0, 2)
    : [];
  const institutions = Array.isArray(evidence.institutions)
    ? evidence.institutions.slice(0, 8).flatMap((entry) => {
        const value = boundedText(entry?.value, 500);
        const source = institutionSources.has(entry?.source) ? entry.source : null;
        return value && source ? [{ value, source }] : [];
      })
    : [];
  const priorRequests = Array.isArray(evidence.priorRequestContext?.requests)
    ? evidence.priorRequestContext.requests.slice(0, 3).flatMap((request) => {
        const requestId = boundedText(request?.requestId, 80);
        if (!requestId) return [];
        return [{
          requestId,
          requestNumber: boundedText(request?.requestNumber, 80),
          title: boundedText(request?.title, 500),
          fiscalYear: boundedText(request?.fiscalYear, 120),
          meetingDate: boundedText(request?.meetingDate, 40),
        }];
      })
    : [];
  const priorRequestComplete = evidence.priorRequestContext?.complete === true;
  const priorRequestTotal = Number.isInteger(evidence.priorRequestContext?.totalCount)
    && evidence.priorRequestContext.totalCount >= priorRequests.length
    ? evidence.priorRequestContext.totalCount
    : null;
  const priorRequestContext = priorRequests.length > 0
    ? {
        complete: priorRequestComplete,
        ...(priorRequestComplete && priorRequestTotal !== null ? { totalCount: priorRequestTotal } : {}),
        requests: priorRequests,
      }
    : null;
  return {
    status: statuses.has(evidence.status) ? evidence.status : 'unavailable',
    matchKey: evidence.matchKey === 'email' || evidence.matchKey === 'orcid' ? evidence.matchKey : null,
    recordKinds,
    nameConsistent: evidence.nameConsistent === true ? true : evidence.nameConsistent === false ? false : null,
    institutions,
    reason: reasons.has(evidence.reason) ? evidence.reason : null,
    checkedAt: boundedText(evidence.checkedAt, 80),
    ...(priorRequestContext ? { priorRequestContext } : {}),
  };
}

function pruneCoauthorCheckFailures(failures) {
  if (!Array.isArray(failures)) return [];
  return failures.slice(0, 12).map((failure) => ({
    proposalAuthor: typeof failure?.proposalAuthor === 'string'
      ? failure.proposalAuthor.slice(0, 200)
      : null,
    status: Number.isFinite(failure?.status) ? failure.status : null,
    reason: failure?.reason === 'rate_limited' ? 'rate_limited' : 'unavailable',
  }));
}

function pruneManualContactFields(fields) {
  const allowed = new Set(['email', 'website', 'affiliation', 'hIndex']);
  return Array.isArray(fields)
    ? Array.from(new Set(fields.filter((field) => allowed.has(field)))).slice(0, 4)
    : [];
}

function boundedText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : null;
}

function pruneStaffIdentityConfirmation(confirmation) {
  if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) return null;
  const confirmationId = boundedText(confirmation.confirmationId, 100);
  if (!confirmationId || confirmation.source !== 'staff_confirmed') return null;
  return {
    confirmationId,
    source: 'staff_confirmed',
    normalizedName: boundedText(confirmation.normalizedName, 300),
    email: boundedText(confirmation.email, 320),
    website: boundedText(confirmation.website, 500),
    affiliation: boundedText(confirmation.affiliation, 500),
    actorProfileId: typeof confirmation.actorProfileId === 'number'
      ? confirmation.actorProfileId
      : boundedText(confirmation.actorProfileId, 100),
    actorSystemUserId: boundedText(confirmation.actorSystemUserId, 100),
    confirmedAt: boundedText(confirmation.confirmedAt, 80),
  };
}

/**
 * Prune an enriched candidate down to the fields `CandidateCard` actually
 * renders, for durable storage in `reviewer_find_roster` (S224). Keeps the card
 * fully renderable after reload while dropping heavy raw enrichment internals.
 * The compact, server-attested identity decision is retained so W4.1 evidence
 * can reach the save boundary after a reload; raw tierResults remain excluded.
 * The SINGLE source for the roster DTO shape so the server store + client merge
 * agree.
 */
export function pruneCandidateForRoster(c) {
  if (!c || typeof c !== 'object') return c;
  const e = c.contactEnrichment || {};
  const provenance = buildReviewerProvenance(c);
  const persistFlag = (name) => {
    if (c[name] === false || e[name] === false) return false;
    if (c[name] === true || e[name] === true) return true;
    return undefined;
  };
  const currentOrcidAffiliation = Array.isArray(e.tierResults?.orcid?.affiliations)
    ? e.tierResults.orcid.affiliations.find((aff) => aff?.current === true)
    : null;
  const currentOrcidInstitutionRor = currentOrcidAffiliation
    && String(currentOrcidAffiliation.disambiguationSource || '').toUpperCase() === 'ROR'
    ? currentOrcidAffiliation.disambiguatedOrganizationId || null
    : null;
  // Capture the identity-resolver verdict NOW (before it's dropped) as safe
  // boolean persist-permission flags, so a candidate saved AFTER a roster reload
  // (when contactEnrichment.identity / tierResults are gone) still honors the
  // resolver gate (Codex post-impl HIGH). Mirror save-candidates' block logic:
  //   blockByIdentity = identity present AND verdict < probable
  //   blockScholar    = blockByIdentity OR the Scholar profile was name/inst-skipped
  const identity = e.identity || null;
  const scholarSkipped = !!e.tierResults?.openalex_author?.skipped;
  const identityPersistAllowed = !identity || mayPersistIdentity(identity.status);
  const scholarPersistAllowed = identityPersistAllowed && !scholarSkipped;
  return {
    // Render-safe persist flags consumed by save-candidates for roster-reloaded rows.
    identityPersistAllowed,
    scholarPersistAllowed,
    emailPersistAllowed: persistFlag('emailPersistAllowed'),
    websitePersistAllowed: persistFlag('websitePersistAllowed'),
    affiliationPersistAllowed: persistFlag('affiliationPersistAllowed'),
    // A render-safe contactEnrichment SUBSET so CandidateCard's `enr.*` reads
    // (emailSource/emailYear/priorAffiliation/affiliationSource/links/metrics)
    // still work after reload. NEVER raw tierResults; identity is reduced to
    // the exact fields covered by the server receipt and persistence writer.
    contactEnrichment: {
      identity: pruneIdentityDecision(identity),
      email: e.email || null,
      emailSource: e.emailSource || null,
      emailYear: e.emailYear || null,
      emailAction: e.emailAction || null,
      emailActionReason: e.emailActionReason || null,
      emailEvidence: pruneEmailEvidence(e.emailEvidence),
      contactStatus: e.contactStatus || null,
      contactStatusReason: e.contactStatusReason || null,
      verifiedInstitutionDomain: e.verifiedInstitutionDomain || null,
      anchoredInstitutionDomains: Array.isArray(e.anchoredInstitutionDomains) ? e.anchoredInstitutionDomains.slice(0, 8) : [],
      plausibleInstitutionDomains: Array.isArray(e.plausibleInstitutionDomains) ? e.plausibleInstitutionDomains.slice(0, 12) : [],
      website: ContactParser.sanitizeWebsiteForCandidate(e.website, c.name) || null,
      websiteSource: e.websiteSource === 'manual' ? 'manual' : (e.websiteSource || null),
      orcid: e.orcid || e.orcidId || null,
      orcidId: e.orcidId || null,
      orcidUrl: e.orcidUrl || null,
      googleScholarUrl: e.googleScholarUrl || null,
      googleScholarId: e.googleScholarId || null,
      affiliationSource: e.affiliationSource || null,
      openAlexInstitutionId: e.openAlexInstitutionId || null,
      openAlexInstitutionRor: e.openAlexInstitutionRor || null,
      orcidInstitutionRor: e.orcidInstitutionRor || currentOrcidInstitutionRor || null,
      priorAffiliation: e.priorAffiliation || null,
      hIndex: e.hIndex ?? null,
      totalCitations: e.totalCitations ?? null,
      emailPersistAllowed: persistFlag('emailPersistAllowed'),
      websitePersistAllowed: persistFlag('websitePersistAllowed'),
      affiliationPersistAllowed: persistFlag('affiliationPersistAllowed'),
      // Slice 5: compact quarantined leads so the ContactLeads section survives a
      // roster reload. Bounded + stripped of raw payloads; persistable stays false.
      contactLeads: pruneContactLeads(e.contactLeads),
      eligibilityStatus: e.eligibilityStatus || c.eligibilityStatus || 'unknown',
      eligibilityReason: e.eligibilityReason || c.eligibilityReason || null,
      eligibilityEvidence: pruneEligibilityEvidence(e.eligibilityEvidence || c.eligibilityEvidence),
      dataverseContactEvidence: pruneDataverseContactEvidence(e.dataverseContactEvidence),
    },
    name: c.name,
    affiliation: c.affiliation || null,
    affiliationSource: c.affiliationSource || e.affiliationSource || null,
    seniorityEstimate: c.seniorityEstimate || null,
    verificationConfidence: typeof c.verificationConfidence === 'number' ? c.verificationConfidence : null,
    // Identity-review markers (Slice E): provenanceGroupOf keys on these to route a
    // candidate to the non-selectable `needs_identity_review` group. They MUST survive
    // a roster reload — otherwise a deferred/unresolved candidate recorded as
    // surfaced-active loses its marker and becomes silently selectable again on reload
    // (the gate would only hold for the live run). Persist all three the group test reads.
    identityStatus: c.identityStatus || e.identity?.status || null,
    eligibilityStatus: c.eligibilityStatus || e.eligibilityStatus || 'unknown',
    eligibilityReason: c.eligibilityReason || e.eligibilityReason || null,
    eligibilityEvidence: pruneEligibilityEvidence(c.eligibilityEvidence || e.eligibilityEvidence),
    needsIdentification: !!c.needsIdentification,
    verificationStatus: c.verificationStatus || null,
    // Source / provenance flags the card branches on.
    isClaudeSuggestion: !!c.isClaudeSuggestion,
    source: c.source || null,
    sources: Array.isArray(c.sources) ? c.sources : [],
    provenance,
    isReferredSeed: !!c.isReferredSeed,
    referredBy: c.referredBy || c.provenance?.referredBy || null,
    seedResolvedPotentialReviewerId: c.seedResolvedPotentialReviewerId || null,
    seedResolvedContactId: c.seedResolvedContactId || null,
    seedIdentityMatchKey: c.seedIdentityMatchKey || null,
    seedIdentityNameConsistent: c.seedIdentityNameConsistent === false ? false : (c.seedIdentityNameConsistent === true ? true : null),
    isApplicantRecommended: !!c.isApplicantRecommended,
    applicantKnownReviewer: pruneApplicantKnownReviewer(c.applicantKnownReviewer),
    applicantContactMismatch: c.applicantContactMismatch === true,
    serverRepairReason: typeof c.serverRepairReason === 'string'
      ? c.serverRepairReason.slice(0, 100)
      : null,
    enrichedProposalKey: c.enrichedProposalKey || null,
    applicantEnrichmentCacheVersion: Number.isInteger(c.applicantEnrichmentCacheVersion)
      ? c.applicantEnrichmentCacheVersion
      : null,
    suggestionId: c.suggestionId || null,
    // COI + mismatch detail.
    hasInstitutionCOI: !!c.hasInstitutionCOI,
    institutionCOIDetails: sanitizeInstitutionCOIDetails(c.institutionCOIDetails),
    hasCoauthorCOI: !!c.hasCoauthorCOI,
    coauthorships: Array.isArray(c.coauthorships) ? c.coauthorships : [],
    coauthorCheckStatus: c.coauthorCheckStatus === 'complete' || c.coauthorCheckStatus === 'incomplete'
      ? c.coauthorCheckStatus
      : null,
    coauthorCheckFailures: pruneCoauthorCheckFailures(c.coauthorCheckFailures),
    // S238 graded coauthor COI + thin-evidence/off-topic warnings — persist so the
    // card's severity and warnings survive a roster reload (else a 'possible' overlap
    // regresses to red via the UI fallback, and the warnings vanish entirely).
    coauthorCOIStrength: c.coauthorCOIStrength || null,
    coauthorSharedPaperTotal: Number.isFinite(c.coauthorSharedPaperTotal) ? c.coauthorSharedPaperTotal : null,
    coauthorMaxWithOneAuthor: Number.isFinite(c.coauthorMaxWithOneAuthor) ? c.coauthorMaxWithOneAuthor : null,
    aiFlaggedNotRelevant: !!c.aiFlaggedNotRelevant,
    lowPublicationCount: !!c.lowPublicationCount,
    lowPublicationCountFound: Number.isFinite(c.lowPublicationCountFound) ? c.lowPublicationCountFound : null,
    institutionMismatch: !!c.institutionMismatch,
    institutionPresentation: pruneInstitutionPresentation(c.institutionPresentation),
    ...(c.independentIdentity
      ? { independentIdentity: pruneIndependentIdentity(c.independentIdentity) }
      : {}),
    ...(Array.isArray(c.affiliationAssertions)
      ? { affiliationAssertions: pruneAffiliationAssertions(c.affiliationAssertions) }
      : {}),
    ...(Array.isArray(c.affiliationAssertions)
      ? {
          affiliationAssertionsComplete: c.affiliationAssertionsComplete !== false
            && c.affiliationAssertions.length <= MAX_ROSTER_AFFILIATION_ASSERTIONS,
        }
      : {}),
    suggestedInstitution: c.suggestedInstitution || null,
    expertiseMismatch: !!c.expertiseMismatch,
    // Verification-incoherence flag (Fix 11) drives the relevance-score −15
    // down-weight; retain it (like institutionMismatch/expertiseMismatch above) so
    // the penalty survives a roster reload + the Workbench client re-rank. Fold the
    // redundant `incoherentVerification` alias into the canonical field here.
    verificationIncoherence: !!(c.verificationIncoherence || c.incoherentVerification),
    verificationIncoherenceReasons: Array.isArray(c.verificationIncoherenceReasons) ? c.verificationIncoherenceReasons : [],
    expertiseAreas: Array.isArray(c.expertiseAreas) ? c.expertiseAreas : null,
    keywords: Array.isArray(c.keywords) ? c.keywords : null,
    reasoning: c.reasoning || c.generatedReasoning || null,
    // Plain-language identity-spine note (confirmed/probable/needs-review + why);
    // persisted so it survives a roster reload like `reasoning`.
    identityNote: c.identityNote || null,
    // Contact + bibliometrics (prefer the merged top-level, fall back to enrichment).
    email: c.email || e.email || null,
    emailSource: c.isApplicantRecommended
      ? (c.emailSource || e.emailSource || null)
      : (e.emailSource || null),
    emailYear: e.emailYear || null,
    emailAction: e.emailAction || null,
    emailActionReason: e.emailActionReason || null,
    // Defensive: re-guard the persisted website so a document-file URL can't ride
    // through the prune (mirrors mergeEnrichment; sanitized at ingestion too).
    website: ContactParser.sanitizeWebsiteForCandidate(c.website || e.website, c.name) || null,
    orcid: c.orcid || e.orcid || e.orcidId || null,
    orcidUrl: c.orcidUrl || e.orcidUrl || null,
    googleScholarUrl: c.googleScholarUrl || e.googleScholarUrl || null,
    googleScholarId: c.googleScholarId || e.googleScholarId || null,
    priorAffiliation: e.priorAffiliation || null,
    hIndex: c.hIndex ?? e.hIndex ?? null,
    i10Index: c.i10Index ?? e.i10Index ?? null,
    totalCitations: c.totalCitations ?? e.totalCitations ?? null,
    publicationCount5yr: Number.isFinite(c.publicationCount5yr) ? c.publicationCount5yr : (e.publicationCount5yr ?? null),
    publications: Array.isArray(c.publications)
      ? c.publications.slice(0, 10).map((p) => ({ title: p && p.title, year: p && p.year, url: p && p.url }))
      : [],
    relevanceScore: typeof c.relevanceScore === 'number' ? c.relevanceScore : null,
    automatedIdentityAttestation: typeof c.automatedIdentityAttestation === 'string'
      && c.automatedIdentityAttestation.length <= 4096
      ? c.automatedIdentityAttestation
      : null,
    ...(typeof c.institutionEvidenceAttestation === 'string'
      && c.institutionEvidenceAttestation.length <= 4096
      ? { institutionEvidenceAttestation: c.institutionEvidenceAttestation }
      : {}),
    candidateKey: reviewerCandidateKey(c),
    manualContactFields: pruneManualContactFields(c.manualContactFields),
    // UI convenience only. Save-candidates derives authority by looking up the
    // opaque confirmation id in the request-scoped server roster.
    pdIdentityConfirmed: c.pdIdentityConfirmed === true,
    pdIdentityConfirmationId: typeof c.pdIdentityConfirmationId === 'string'
      ? c.pdIdentityConfirmationId
      : null,
    staffIdentityConfirmation: pruneStaffIdentityConfirmation(c.staffIdentityConfirmation),
    addressConflictPending: c.addressConflictPending === true || e.addressConflictPending === true,
    conflictRecordUnavailable: c.conflictRecordUnavailable === true || e.conflictRecordUnavailable === true,
    addressVerificationRequired: c.addressVerificationRequired === true || e.addressVerificationRequired === true,
    serverIdentityReviewReason: c.serverIdentityReviewReason || e.serverIdentityReviewReason || null,
  };
}
