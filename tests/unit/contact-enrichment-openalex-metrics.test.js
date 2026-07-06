/**
 * Characterization suite for the openalex-metrics cluster of ContactEnrichmentService
 * (Stage 4 of docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * `_attachOpenAlexMetrics` is already heavily exercised transitively via
 * enrichCandidate/_finalize by contact-enrichment-scholar-metrics.test.js (with
 * OpenAlexService mocked); this suite adds DIRECT pins for the pure DTO builder
 * and the no-identity-anchor early-skip branch, so the Stage-4 move to
 * lib/services/contact-enrichment/openalex-metrics.js is a verified behavior-freeze.
 */

const { ContactEnrichmentService: S } = require('../../lib/services/contact-enrichment-service');

describe('ContactEnrichmentService openalex-metrics cluster (characterization)', () => {
  describe('_buildOpenAlexAuthorDto', () => {
    it('composes the evidence DTO from author fields + identity spread', () => {
      const author = {
        openAlexId: 'A123', displayName: 'Jane Q', lastKnownInstitution: 'MIT',
        lastKnownInstitutionRor: 'ror-1', hIndex: 12, i10Index: 9, citedByCount: 340,
      };
      expect(S._buildOpenAlexAuthorDto(author, { acceptPath: 'orcid', orcid: '0000-0002-1825-0097', claimedOrcid: '0000-0002-1825-0097' }))
        .toEqual({
          openAlexId: 'A123', displayName: 'Jane Q', lastKnownInstitution: 'MIT', ror: 'ror-1',
          acceptPath: 'orcid', orcid: '0000-0002-1825-0097', claimedOrcid: '0000-0002-1825-0097',
          hIndex: 12, i10Index: 9, citedByCount: 340,
        });
    });
    it('ror falls back to null when no lastKnownInstitutionRor', () => {
      expect(S._buildOpenAlexAuthorDto({ openAlexId: 'A1' }, { acceptPath: 'spine', identityStatus: 'confirmed' }).ror).toBeNull();
    });
  });

  describe('_attachOpenAlexMetrics — no identity anchor (early skip)', () => {
    it('skips with scholarPersistAllowed=false + identity_anchor_required when no orcid and no carried author id/status', async () => {
      const result = { contactEnrichment: { tierResults: {} } };
      await S._attachOpenAlexMetrics({ name: 'No Anchor' }, result, {});
      expect(result.contactEnrichment.scholarPersistAllowed).toBe(false);
      expect(result.contactEnrichment.tierResults.openalex_author).toEqual({ skipped: 'identity_anchor_required' });
    });
    // The resolved-anchor paths (ORCID richest-author, carried spine id, identity-gate
    // failure, metrics attach, institution-domain sourcing) are exercised end-to-end with
    // OpenAlexService mocked by contact-enrichment-scholar-metrics.test.js — mutation-proven
    // to catch a regression in this method (see the Stage-4 commit body).
  });
});
