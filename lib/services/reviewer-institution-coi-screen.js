/**
 * Shared save-boundary institution COI recomputation.
 *
 * The ordinary and applicant promotion paths must apply the same direct-match
 * and exemption semantics. Additional typed assertions are opt-in so the
 * Phase 2 flag-off path preserves the incumbent signal set exactly.
 */

import { DeduplicationService } from './deduplication-service';

export async function recomputeReviewerInstitutionCOI({
  candidate,
  institutionEntries,
  serverAffiliations = [],
  institutionIdentityResolver,
  includeAdditionalAffiliations = false,
} = {}) {
  const decisions = [];
  const options = {
    resolver: institutionIdentityResolver,
    includeAdditionalAffiliations,
  };
  const payloadResolution = await DeduplicationService.institutionCOIResolution(
    candidate,
    institutionEntries,
    options,
  );
  const payloadDecision = payloadResolution.decision;
  const payloadRefuted = payloadResolution.status === 'refuted_by_existing_ids'
    || payloadResolution.status === 'refuted_by_resolved_ids';
  if (payloadDecision) decisions.push({ ...payloadDecision, decisionSource: 'candidate_payload' });

  for (const serverAffiliation of serverAffiliations) {
    if (!serverAffiliation) continue;
    const serverAffiliationDecision = await DeduplicationService.institutionCOIDecisionResolved(
      {
        ...candidate,
        affiliation: serverAffiliation,
        affiliationSource: 'staff_manual',
        primaryAffiliation: serverAffiliation,
        primaryAffiliationSource: 'staff_manual',
        contactEnrichment: {
          ...(candidate?.contactEnrichment || {}),
          affiliation: serverAffiliation,
          affiliationSource: 'staff_manual',
        },
      },
      institutionEntries,
      options,
    );
    if (serverAffiliationDecision) {
      decisions.push({
        ...serverAffiliationDecision,
        decisionSource: 'server_reviewer_identity_affiliation',
      });
    }
  }

  const decision = decisions.find((item) => item.dropDecision !== 'exempt')
    || decisions.find((item) => item.dropDecision === 'exempt')
    || null;
  const matchedSource = decision?.candidate?.institutionCOIDetails?.matchedAffiliationSource || null;
  const assertions = Array.isArray(candidate?.affiliationAssertions)
    ? candidate.affiliationAssertions.filter((assertion) => assertion?.authorSpecific === true)
    : [];
  const hasUnknownCurrentness = assertions.some((assertion) => assertion?.currentness === 'unknown');
  const hasIncompleteProjection = candidate?.affiliationAssertionsComplete === false;
  const additionalCoi = !includeAdditionalAffiliations
    ? 'not_screened'
    : (decision && ['pubmed_additional', 'orcid_additional'].includes(matchedSource)
      && decision.dropDecision !== 'exempt'
      ? 'conflict'
      : ((hasUnknownCurrentness || hasIncompleteProjection) ? 'incomplete' : 'clear'));
  return { decision, payloadRefuted, additionalCoi };
}
