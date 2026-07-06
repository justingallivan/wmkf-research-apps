/**
 * DiscoveryService Track-B identity cluster — Stage 4 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * The minimum-publication partition (surface, never drop — S238), the OpenAlex/ORCID identity
 * resolution of literature-retrieved (Track-B) candidates, the resolver-result → candidate mapper,
 * and the shared-ORCID merge that upgrades a needs-review Track-A row when a resolved Track-B
 * author matches it. Extracted VERBATIM from discovery-service.js as a behavior-freeze — internal
 * `this.X` self-calls became direct function calls; constants from ./constants (MIN_PUBLICATIONS is
 * passed IN by the facade wrapper so a runtime override still applies — plan constraint C1); the
 * resolver + provenance utilities from the shared libs. The facade delegates each method here.
 *
 * Depends on ./constants, ../reviewer-work-author-resolver, ../../utils/reviewer-provenance.
 * Characterization net: tests/unit/discovery-track-b-identity.test.js.
 */

const { VERIFICATION_STATUSES } = require('./constants');
const { ReviewerWorkAuthorResolver, normalizeOrcid } = require('../reviewer-work-author-resolver');
const { PROVENANCE_KINDS, SEED_ROLES, withReviewerProvenance } = require('../../utils/reviewer-provenance');

/**
 * Partition candidates by the minimum-publication bar. Under-bar candidates are NOT dropped
 * (S238) — they are tagged and returned separately so the caller keeps qualified candidates'
 * priority for the bounded identity budget while still surfacing the low-count ones.
 * `minPublications` is supplied by the facade (DiscoveryService.MIN_PUBLICATIONS) so a runtime
 * override applies (C1).
 */
function partitionByPublicationBar(candidates = [], minPublications) {
  const qualified = [];
  const lowPublication = [];
  for (const c of candidates) {
    const found = c.publications?.length || 0;
    if (found >= minPublications) {
      qualified.push(c);
    } else {
      lowPublication.push({ ...c, lowPublicationCount: true, lowPublicationCountFound: found });
    }
  }
  return { qualified, lowPublication };
}

async function resolveTrackBIdentities(candidates = [], { signal, onProgress = () => {} } = {}) {
  const resolved = [];
  for (let i = 0; i < candidates.length; i += 1) {
    if (signal?.aborted) throw signal.reason || new Error('reviewer_time_budget_exceeded');
    const candidate = candidates[i];
    onProgress({
      stage: 'discovery',
      track: 'B',
      status: 'identity_resolving',
      message: `Resolving literature author identity ${i + 1}/${candidates.length}: ${candidate.name}`,
    });
    const result = await ReviewerWorkAuthorResolver.resolveCandidate(candidate, { signal });
    resolved.push(mapTrackBIdentityResult(candidate, result));
  }
  return resolved;
}

function mapTrackBIdentityResult(candidate = {}, resolverResult = {}) {
  const sourceNames = new Set([
    ...(Array.isArray(candidate.sources) ? candidate.sources : []),
    ...(resolverResult.sources?.openalex === 'ok' ? ['openalex'] : []),
    ...(resolverResult.sources?.orcid === 'ok' || resolverResult.orcid ? ['orcid'] : []),
  ].filter(Boolean));
  const status = resolverResult.resolverStatus || resolverResult.status || VERIFICATION_STATUSES.UNRESOLVED;
  const trusted = status === 'confirmed' || status === 'probable';
  const verificationStatus = status === 'confirmed'
    ? VERIFICATION_STATUSES.VERIFIED
    : status === 'probable'
      ? VERIFICATION_STATUSES.PROBABLE
      : VERIFICATION_STATUSES.UNRESOLVED;
  const resolvedOrcid = normalizeOrcid(resolverResult.orcid);
  const candidateOrcid = normalizeOrcid(candidate.orcid || candidate.orcidId);
  const verificationReason = resolverResult.reason || 'Literature author identity unresolved';

  return withReviewerProvenance({
    ...candidate,
    verified: trusted,
    verificationStatus,
    identityStatus: trusted ? status : VERIFICATION_STATUSES.UNRESOLVED,
    verificationSource: trusted ? 'openalex' : null,
    verificationConfidence: status === 'confirmed' ? 0.95 : (status === 'probable' ? 0.75 : null),
    verificationReason,
    reason: trusted ? candidate.reason : verificationReason,
    needsIdentification: !trusted,
    openAlexAuthorId: resolverResult.openAlexAuthorId || candidate.openAlexAuthorId || null,
    openAlexWorkId: resolverResult.work?.openAlexId || candidate.openAlexWorkId || null,
    orcid: resolvedOrcid || candidateOrcid,
    orcidId: resolvedOrcid || candidateOrcid,
    orcidUrl: resolvedOrcid ? `https://orcid.org/${resolvedOrcid}` : candidate.orcidUrl,
    affiliation: resolverResult.institution || candidate.affiliation,
    topics: resolverResult.topics || candidate.topics || [],
    identityEvidence: resolverResult.identity || null,
    identityAnchors: resolverResult.anchors || [],
    identityNote: resolverResult.identityNote || null,
    source: candidate.source,
  }, {
    kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED,
    sources: Array.from(sourceNames),
    seedRole: SEED_ROLES.QUERY_SEED,
    force: true,
  });
}

function mergeTrackBWithNeedsReviewBySharedOrcid(unverified = [], discovered = []) {
  const remainingDiscovered = [];
  const unverifiedOut = unverified.map((candidate) => ({ ...candidate }));
  let mergedCount = 0;

  for (const candidate of discovered) {
    const candidateOrcid = normalizeOrcid(candidate.orcid || candidate.orcidId);
    const workResolved = !!candidate.openAlexAuthorId
      && (candidate.identityStatus === 'confirmed' || candidate.identityStatus === 'probable');
    const matchIndex = candidateOrcid
      ? unverifiedOut.findIndex((trackA) => {
          const trackAOrcid = normalizeOrcid(trackA.orcid || trackA.orcidId);
          return workResolved && trackAOrcid && trackAOrcid === candidateOrcid;
        })
      : -1;

    if (matchIndex === -1) {
      remainingDiscovered.push(candidate);
      continue;
    }

    unverifiedOut[matchIndex] = withReviewerProvenance({
      ...unverifiedOut[matchIndex],
      ...candidate,
      name: unverifiedOut[matchIndex].name || candidate.name,
      source: unverifiedOut[matchIndex].source,
      isClaudeSuggestion: true,
    }, {
      kind: unverifiedOut[matchIndex].provenance?.kind || unverifiedOut[matchIndex].provenanceKind || PROVENANCE_KINDS.BARRED_PARAMETRIC,
      sources: [
        ...(unverifiedOut[matchIndex].sources || []),
        ...(candidate.sources || []),
      ],
      seedRole: unverifiedOut[matchIndex].provenance?.seedRole || SEED_ROLES.PEER_OR_COMPETITOR,
      force: true,
    });
    mergedCount += 1;
  }

  return { unverified: unverifiedOut, discovered: remainingDiscovered, mergedCount };
}

module.exports = {
  partitionByPublicationBar,
  resolveTrackBIdentities,
  mapTrackBIdentityResult,
  mergeTrackBWithNeedsReviewBySharedOrcid,
};
