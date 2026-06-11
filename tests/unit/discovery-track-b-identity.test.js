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

  test('gradeCoauthorCOI tiers on the strongest single-author tie, not the total (S238)', () => {
    // No shared papers → no COI grade.
    expect(DiscoveryService.gradeCoauthorCOI({ hasCoauthorship: false, maxSharedWithOneAuthor: 0 })).toBeNull();
    // A single shared paper (likely a hub artifact) → 'possible', not a hard COI.
    expect(DiscoveryService.gradeCoauthorCOI({ hasCoauthorship: true, maxSharedWithOneAuthor: 1 })).toBe('possible');
    expect(DiscoveryService.gradeCoauthorCOI({ hasCoauthorship: true, maxSharedWithOneAuthor: 2 })).toBe('possible');
    // A sustained tie (>= threshold) with one author → 'likely' (real conflict).
    expect(DiscoveryService.gradeCoauthorCOI({ hasCoauthorship: true, maxSharedWithOneAuthor: 3 })).toBe('likely');
    expect(DiscoveryService.gradeCoauthorCOI({ hasCoauthorship: true, maxSharedWithOneAuthor: 8 })).toBe('likely');
  });

  test('rankAllCandidates surfaces AI-flagged-off-topic candidates but sorts them last (S238)', () => {
    const ranked = DiscoveryService.rankAllCandidates({
      verified: [],
      discovered: [
        { name: 'OffTopic High', publications: [], aiFlaggedNotRelevant: true },
        { name: 'OnTopic A', publications: [] },
        { name: 'OnTopic B', publications: [] },
      ],
    }, []);

    // Nothing is dropped — all three survive.
    expect(ranked).toHaveLength(3);
    // The flagged candidate is surfaced but ranked last, regardless of its score.
    expect(ranked[ranked.length - 1].name).toBe('OffTopic High');
    expect(ranked.filter((c) => c.aiFlaggedNotRelevant)).toHaveLength(1);
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
