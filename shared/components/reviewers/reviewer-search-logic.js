/**
 * Pure helpers for the in-panel reviewer search (Workbench Find).
 * Kept separate from the React component so they can be unit-tested.
 */

// Name normalization + exact-exclusion live in the CJS util so the server
// (/discover dedup, reviewer-roster-store) and this client module share ONE
// implementation. Re-exported below so existing client imports keep working.
import { normalizeReviewerName as _normalizeReviewerName, partitionByExcluded } from '../../../lib/utils/reviewer-name-match';
import { mayPersistIdentity } from '../../../lib/services/reviewer-identity-resolver';
import { buildReviewerProvenance, PROVENANCE_KINDS, provenanceGroupOf, provenanceKindOf, sanitizeInstitutionCOIDetails as _sanitizeInstitutionCOIDetails } from '../../../lib/utils/reviewer-provenance';
import { ContactParser } from '../../../lib/utils/contact-parser';
import { parseReferredSeeds as _parseReferredSeeds } from '../../../lib/utils/reviewer-referral-seeds';
import { reviewerSaveKey } from '../../../lib/utils/reviewer-save-key';

/**
 * Merge contact-enrichment results (from /enrich-contacts) back onto the chosen
 * candidates by name, mirroring the standalone Reviewer Finder's save mapping.
 * The enrichment's contact + bibliometric fields take precedence and are also
 * promoted to the candidate top-level, because save-candidates.js reads them off
 * `candidate.*` (email/website/orcid/website/hIndex/i10Index/totalCitations/…),
 * NOT off `candidate.contactEnrichment.*`. The full contactEnrichment object is
 * also attached so the card can render source/year detail.
 *
 * Institution COI is also re-promoted here: enrich-contacts re-evaluates it on the
 * post-enrichment affiliation and flags `contactEnrichment.coiRecomputed`, so the
 * badge matches the affiliation the card actually shows (Codex P2#1).
 *
 * @param {object[]} candidates
 * @param {Array<{name: string, contactEnrichment: object}>|null|undefined} enrichmentResults
 * @returns {object[]}
 */
// Re-export the canonical sanitizer (lib/utils/reviewer-provenance) so existing
// client imports keep working while server (roster-store) + client share ONE impl.
export const sanitizeInstitutionCOIDetails = _sanitizeInstitutionCOIDetails;

export function isCandidateSelectable(c) {
  return (provenanceGroupOf(c) !== 'needs_identity_review' || c?.pdIdentityConfirmed === true) && !c?.hasInstitutionCOI;
}

export function candidateWasSaved(candidate, savedKeys = [], savedNames = []) {
  const stableKeys = new Set(Array.isArray(savedKeys) ? savedKeys : []);
  if (stableKeys.size > 0) return stableKeys.has(reviewerSaveKey(candidate));
  const legacyNames = new Set((Array.isArray(savedNames) ? savedNames : []).map(_normalizeReviewerName));
  return legacyNames.has(_normalizeReviewerName(candidate?.name));
}

export function mergeEnrichment(candidates, enrichmentResults) {
  if (!Array.isArray(candidates)) return [];
  if (!Array.isArray(enrichmentResults) || enrichmentResults.length === 0) return candidates;
  const byName = new Map();
  for (const r of enrichmentResults) {
    if (r && r.name && r.contactEnrichment) byName.set(r.name, r);
  }
  return candidates.map((c) => {
    const enriched = byName.get(c.name);
    if (!enriched) return c;
    const e = enriched.contactEnrichment;
    const contactEnrichment = {
      ...e,
      website: ContactParser.sanitizeWebsiteForCandidate(e.website, c.name) || null,
    };
    return {
      ...c,
      automatedIdentityAttestation: enriched.automatedIdentityAttestation || null,
      contactEnrichment,
      // Institution COI re-evaluated server-side against the post-enrichment
      // affiliation (enrich-contacts). `coiRecomputed` distinguishes "ran and
      // found none" (override the discover value) from "didn't run" (keep it).
      // (Codex P2#1.)
      hasInstitutionCOI: e.coiRecomputed ? !!e.hasInstitutionCOI : c.hasInstitutionCOI,
      institutionCOIDetails: sanitizeInstitutionCOIDetails(e.coiRecomputed ? e.institutionCOIDetails : c.institutionCOIDetails),
      email: e.email || c.email,
      // Defensive: a document-file URL (e.g. a paper PDF) must never ride through
      // the merge as a website. Sanitized at ingestion already; re-guarded here.
      website: ContactParser.sanitizeWebsiteForCandidate(e.website || c.website, c.name),
      facultyPageUrl: e.facultyPageUrl || c.facultyPageUrl,
      department: e.department || c.department,
      orcid: e.orcid || e.orcidId || c.orcid,
      orcidUrl: e.orcidUrl || c.orcidUrl,
      googleScholarId: e.googleScholarId || c.googleScholarId,
      googleScholarUrl: e.googleScholarUrl || c.googleScholarUrl,
      // Bibliometrics: prefer enrichment, but `?? c` so a real 0 isn't dropped.
      hIndex: e.hIndex ?? c.hIndex,
      i10Index: e.i10Index ?? c.i10Index,
      totalCitations: e.totalCitations ?? c.totalCitations,
      // Current-affiliation pin (S224 #16): enrichment may have replaced the
      // discovery affiliation with an identity-trusted ORCID/Scholar current
      // one. Promote it + its provenance so the card shows "per ORCID" and the
      // client re-rank scores the same affiliation the server persisted.
      affiliation: e.affiliation || c.affiliation,
      affiliationSource: e.affiliationSource || c.affiliationSource,
      // Recency rank input: enrichment carries the discovery value through so the
      // client re-rank matches the server (`?? c` so a real 0 isn't dropped).
      publicationCount5yr: e.publicationCount5yr ?? c.publicationCount5yr,
    };
  });
}

/**
 * Render a 0–1 or 0–100 score as an integer percentage, or null if absent.
 * Discovery returns relevanceScore as 0–100 and verificationConfidence as 0–1.
 */
export function asPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

/**
 * Normalize a reviewer name for exclusion / dedup matching. Re-exported from the
 * shared CJS util (`lib/utils/reviewer-name-match`) so the client, the
 * `/discover` server dedup, and the roster store all use ONE implementation.
 */
export const normalizeReviewerName = _normalizeReviewerName;

/** Parse a comma/newline-separated exclude textbox into a clean name list. */
export function parseExcludeList(text) {
  if (!text) return [];
  return String(text)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseReferredSeeds(text, referredBy = '') {
  return _parseReferredSeeds(text, referredBy);
}

/**
 * Referral-preserving collision merge (S320 pre-merge fix). When a seeded
 * externally-referred reviewer and a candidate discovery independently finds
 * normalize to the SAME name, `dedupeByName` keeps the first occurrence — which is
 * relevance-order, NOT provenance. Without this, if the discovery copy outranks the
 * seed the survivor loses its `referred` provenance (Externally-Referred badge +
 * `referredBy`). This grafts the referral labeling onto the kept survivor so the
 * badge/referrer survive regardless of ranking order.
 *
 * Deliberately conservative:
 * - Only fires when the DROPPED copy is `referred` and the kept one is a plain
 *   discovery/literature kind. It never touches `applicant_suggested` survivors
 *   (that lane has its own promote-by-suggestionId save path), and is a no-op when
 *   the survivor is already `referred`.
 * - Grafts ONLY provenance/label fields (`referred` source, `referredBy`, and the
 *   durable `Referred by …` match-reason prefix that `my-candidates` reload parses).
 *   It does NOT copy contact/identity/bibliometrics across copies, so the
 *   unresolved/name-only referred-seed contact-null safety is preserved — the
 *   survivor keeps its own resolution status.
 */
export function mergeReferredProvenance(keep, incoming) {
  if (!keep || !incoming) return keep;
  const keepKind = provenanceKindOf(keep);
  const incomingReferred = provenanceKindOf(incoming) === PROVENANCE_KINDS.REFERRED;
  const keepReferred = keepKind === PROVENANCE_KINDS.REFERRED;
  const keepApplicant = keepKind === PROVENANCE_KINDS.APPLICANT_SUGGESTED;
  if (!incomingReferred || keepReferred || keepApplicant) return keep;

  const referredBy = incoming.referredBy
    || incoming.provenance?.referredBy
    || keep.referredBy
    || null;
  const sources = Array.from(new Set([
    ...(Array.isArray(keep.sources) ? keep.sources : []),
    'referred',
  ]));
  let reasoning = keep.reasoning || keep.generatedReasoning || '';
  // Durable-string contract: my-candidates reload reconstructs `referredBy` from a
  // leading "Referred by {name}." in wmkf_matchreason. Prepend it (once) so a
  // grafted survivor round-trips the referrer, matching a native referred seed.
  if (referredBy && !/^Referred by /i.test(reasoning)) {
    reasoning = `Referred by ${referredBy}. ${reasoning}`.trim();
  }
  const upgraded = {
    ...keep,
    sources,
    reasoning,
    referredBy: referredBy || null,
    isReferredSeed: true,
  };
  // force past buildReviewerProvenance's pre-built-provenance short-circuit so the
  // kind is re-derived to `referred` (keep already carries a literature provenance).
  upgraded.provenance = buildReviewerProvenance(upgraded, {
    force: true,
    kind: PROVENANCE_KINDS.REFERRED,
    referredBy,
  });
  return upgraded;
}

/**
 * Dedupe candidates by a name key, first-occurrence wins, but on a collision graft
 * referral provenance onto the survivor via {@link mergeReferredProvenance}. Shared
 * by the panel's `dedupeByName` so the visible + savable list can never drop a
 * seeded referral's Externally-Referred badge when discovery also finds the person.
 */
export function dedupeByNamePreferReferred(list, keyFn) {
  const posByKey = new Map();
  const out = [];
  for (const c of (Array.isArray(list) ? list : [])) {
    const k = keyFn(c);
    if (!k) continue;
    if (posByKey.has(k)) {
      const pos = posByKey.get(k);
      out[pos] = mergeReferredProvenance(out[pos], c);
      continue;
    }
    posByKey.set(k, out.length);
    out.push(c);
  }
  return out;
}

/**
 * Drop any candidate whose name normalizes to an excluded name. Exact (not fuzzy)
 * normalized match so it never over-filters. This is what makes the panel's
 * "applicant-excluded names are blocked from the results" claim TRUE — /discover
 * searches databases independently of the Claude soft-block, so excluded people
 * must be filtered client-side too (Codex S210, Finding 3).
 *
 * @returns {{ kept: object[], removed: object[] }}
 */
export function filterExcluded(candidates, excludedNames) {
  return partitionByExcluded(candidates, excludedNames, (c) => c && c.name);
}

export function hasValidApplicantEnrichmentCache(rosterActive, proposalKey) {
  if (!proposalKey) return false;
  return (Array.isArray(rosterActive) ? rosterActive : []).some((c) => (
    c?.enrichedProposalKey === proposalKey
      && (c.isApplicantRecommended || provenanceKindOf(c) === PROVENANCE_KINDS.APPLICANT_SUGGESTED)
  ));
}

/**
 * Slice 5: compact, bounded `contactLeads` for durable roster storage. Keeps only
 * the fields the card renders (ContactLeads); drops `warnings` (re-derived in the
 * UI) and `evidence` (unused in display today), and caps count + string lengths so
 * a roster row stays small and never carries raw provider payloads (spec §7).
 * `persistable:false` is re-asserted so a roster round-trip can never flip it.
 */
export const MAX_ROSTER_CONTACT_LEADS = 8;
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

/**
 * Prune an enriched candidate down to the fields `CandidateCard` actually
 * renders, for durable storage in `reviewer_find_roster` (S224). Keeps the card
 * fully renderable after reload while dropping the heavy raw enrichment internals
 * (tierResults, identity-resolver anchors). The SINGLE source for the roster DTO
 * shape so the server store + client merge agree.
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
    // still work after reload. NEVER the raw internals (identity/tierResults).
    contactEnrichment: {
      email: e.email || null,
      emailSource: e.emailSource || null,
      emailYear: e.emailYear || null,
      contactStatus: e.contactStatus || null,
      contactStatusReason: e.contactStatusReason || null,
      verifiedInstitutionDomain: e.verifiedInstitutionDomain || null,
      anchoredInstitutionDomains: Array.isArray(e.anchoredInstitutionDomains) ? e.anchoredInstitutionDomains.slice(0, 8) : [],
      plausibleInstitutionDomains: Array.isArray(e.plausibleInstitutionDomains) ? e.plausibleInstitutionDomains.slice(0, 12) : [],
      website: ContactParser.sanitizeWebsiteForCandidate(e.website, c.name) || null,
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
    enrichedProposalKey: c.enrichedProposalKey || null,
    suggestionId: c.suggestionId || null,
    // COI + mismatch detail.
    hasInstitutionCOI: !!c.hasInstitutionCOI,
    institutionCOIDetails: sanitizeInstitutionCOIDetails(c.institutionCOIDetails),
    hasCoauthorCOI: !!c.hasCoauthorCOI,
    coauthorships: Array.isArray(c.coauthorships) ? c.coauthorships : [],
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
    emailSource: e.emailSource || null,
    emailYear: e.emailYear || null,
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
    // UI convenience only. Save-candidates derives authority by looking up the
    // opaque confirmation id in the request-scoped server roster.
    pdIdentityConfirmed: c.pdIdentityConfirmed === true,
    pdIdentityConfirmationId: typeof c.pdIdentityConfirmationId === 'string'
      ? c.pdIdentityConfirmationId
      : null,
  };
}
