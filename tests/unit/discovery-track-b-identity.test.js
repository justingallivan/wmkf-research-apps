/**
 * @jest-environment node
 */

const { DiscoveryService } = require('../../lib/services/discovery-service');

describe('DiscoveryService Track B identity merge gates', () => {
  test('shared ORCID merges a discovered candidate into a needs-review Track A twin', () => {
    const out = DiscoveryService.mergeTrackBWithNeedsReviewBySharedOrcid(
      [{ name: 'Jane Roe', verificationStatus: 'unresolved', orcid: '0000-0002-1825-0097', sources: ['proposal_text'] }],
      [{ name: 'J. Roe', verificationStatus: 'probable', identityStatus: 'probable', openAlexAuthorId: 'https://openalex.org/A1', orcid: '0000-0002-1825-0097', sources: ['arxiv', 'openalex', 'orcid'] }],
    );

    expect(out.mergedCount).toBe(1);
    expect(out.discovered).toHaveLength(0);
    expect(out.unverified[0].identityStatus).toBe('probable');
    expect(out.unverified[0].sources).toEqual(expect.arrayContaining(['proposal_text', 'arxiv', 'openalex', 'orcid']));
  });

  test('honorific-robust name-only match does not merge or upgrade', () => {
    const out = DiscoveryService.mergeTrackBWithNeedsReviewBySharedOrcid(
      [{ name: 'Dr. Jane Roe', verificationStatus: 'unresolved', sources: ['proposal_text'] }],
      [{ name: 'Jane Roe', verificationStatus: 'probable', identityStatus: 'probable', sources: ['arxiv', 'openalex'] }],
    );

    expect(out.mergedCount).toBe(0);
    expect(out.unverified[0].verificationStatus).toBe('unresolved');
    expect(out.discovered).toHaveLength(1);
  });

  test('bioRxiv-only contamination check reads post-dedup sources and keeps cross-source candidates', () => {
    expect(DiscoveryService.isCrossFieldDiscoveredContamination(
      { primaryResearchArea: 'quantum materials engineering' },
      { name: 'Bio Only', sources: ['biorxiv'] },
    )).toBe(true);

    expect(DiscoveryService.isCrossFieldDiscoveredContamination(
      { primaryResearchArea: 'quantum materials engineering' },
      { name: 'Cross Source', sources: ['biorxiv', 'arxiv'] },
    )).toBe(false);
  });
});
