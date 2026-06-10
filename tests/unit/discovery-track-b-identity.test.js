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

  test('partitionByPublicationBar surfaces under-bar candidates as a tagged warning, never drops them', () => {
    const filtered = [
      { name: 'Qualified A', publications: [{}, {}, {}] },        // 3 → qualified
      { name: 'Qualified B', publications: [{}, {}, {}, {}] },    // 4 → qualified
      { name: 'Thin C', publications: [{}, {}] },                 // 2 → low-pub
      { name: 'Thin D', publications: [] },                       // 0 → low-pub
      { name: 'Thin E' },                                         // missing → low-pub
    ];

    const { qualified, lowPublication } = DiscoveryService.partitionByPublicationBar(filtered);

    // No candidate is dropped — every input is accounted for in one of the two buckets.
    expect(qualified.length + lowPublication.length).toBe(filtered.length);
    expect(qualified.map((c) => c.name)).toEqual(['Qualified A', 'Qualified B']);

    // Under-bar candidates are surfaced (not filtered) and carry the warning flag + count.
    expect(lowPublication.map((c) => c.name)).toEqual(['Thin C', 'Thin D', 'Thin E']);
    expect(lowPublication.every((c) => c.lowPublicationCount === true)).toBe(true);
    expect(lowPublication.map((c) => c.lowPublicationCountFound)).toEqual([2, 0, 0]);

    // Qualified candidates are untouched (no warning flag).
    expect(qualified.every((c) => c.lowPublicationCount === undefined)).toBe(true);
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
