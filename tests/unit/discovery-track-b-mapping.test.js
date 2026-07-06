/**
 * Characterization tests for DiscoveryService.mapTrackBIdentityResult — the resolver-result →
 * candidate mapper used by resolveTrackBIdentities. Written before Stage 4 of the DiscoveryService
 * decomposition (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md) to pin current behavior before the
 * code moves to lib/services/discovery/track-b-identity.js.
 */

const { DiscoveryService } = require('../../lib/services/discovery-service');
const { normalizeOrcid } = require('../../lib/services/reviewer-work-author-resolver');
const { PROVENANCE_KINDS } = require('../../lib/utils/reviewer-provenance');

describe('DiscoveryService.mapTrackBIdentityResult', () => {
  it('maps a confirmed resolution to a trusted, verified candidate', () => {
    const out = DiscoveryService.mapTrackBIdentityResult(
      { name: 'Jane Doe', source: 'pubmed' },
      { resolverStatus: 'confirmed', orcid: '0000-0002-1825-0097', institution: 'Uni Z', openAlexAuthorId: 'A1', sources: { openalex: 'ok', orcid: 'ok' } },
    );
    expect(out).toMatchObject({
      verified: true,
      verificationStatus: DiscoveryService.VERIFICATION_STATUSES.VERIFIED,
      identityStatus: 'confirmed',
      verificationSource: 'openalex',
      verificationConfidence: 0.95,
      needsIdentification: false,
      affiliation: 'Uni Z',
      openAlexAuthorId: 'A1',
      orcid: normalizeOrcid('0000-0002-1825-0097'),
    });
    expect(out.provenance).toMatchObject({ kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED });
    expect(out.provenance.sources).toEqual(expect.arrayContaining(['openalex', 'orcid']));
  });

  it('maps an unresolved resolution to an untrusted, needs-identification candidate', () => {
    const out = DiscoveryService.mapTrackBIdentityResult({ name: 'Jane Doe', source: 'pubmed' }, {});
    expect(out).toMatchObject({
      verified: false,
      verificationStatus: DiscoveryService.VERIFICATION_STATUSES.UNRESOLVED,
      identityStatus: DiscoveryService.VERIFICATION_STATUSES.UNRESOLVED,
      verificationSource: null,
      needsIdentification: true,
      verificationReason: 'Literature author identity unresolved',
    });
  });

  it('maps a probable resolution with 0.75 confidence', () => {
    const out = DiscoveryService.mapTrackBIdentityResult(
      { name: 'Jane Doe' },
      { resolverStatus: 'probable', openAlexAuthorId: 'A2', sources: { openalex: 'ok' } },
    );
    expect(out).toMatchObject({
      verified: true,
      verificationStatus: DiscoveryService.VERIFICATION_STATUSES.PROBABLE,
      identityStatus: 'probable',
      verificationConfidence: 0.75,
    });
  });
});
