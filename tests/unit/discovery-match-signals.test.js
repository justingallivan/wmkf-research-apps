/**
 * Characterization tests for the DiscoveryService match-signals cluster
 * (filterByExpertiseRelevance, calculateExpertiseMatch, checkInstitutionMismatch,
 * checkExpertiseMismatch).
 *
 * Written before Stage 3 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md) to pin current behavior before the code moves to
 * lib/services/discovery/match-signals.js. Values are the actual pre-extraction outputs.
 */

const { DiscoveryService } = require('../../lib/services/discovery-service');

describe('DiscoveryService.filterByExpertiseRelevance', () => {
  const arts = [{ title: 'Marine ecology study' }, { title: 'Quantum physics' }];
  it('returns all articles when no expertise areas', () => {
    expect(DiscoveryService.filterByExpertiseRelevance(arts, [])).toBe(arts);
  });
  it('keeps only articles matching an expertise keyword (len > 3)', () => {
    expect(DiscoveryService.filterByExpertiseRelevance(arts, ['marine ecology'])).toEqual([
      { title: 'Marine ecology study' },
    ]);
  });
  it('returns all when the areas produce only short (<=3 char) keywords', () => {
    expect(DiscoveryService.filterByExpertiseRelevance(arts, ['a b'])).toBe(arts);
  });
});

describe('DiscoveryService.calculateExpertiseMatch', () => {
  it('benefit-of-the-doubt 0.5 with no expertise areas', () => {
    expect(DiscoveryService.calculateExpertiseMatch([{ title: 'x' }], [])).toBe(0.5);
  });
  it('0 with no articles', () => {
    expect(DiscoveryService.calculateExpertiseMatch([], ['viral'])).toBe(0);
  });
  it('partial confidence for a partial keyword hit across articles', () => {
    expect(DiscoveryService.calculateExpertiseMatch(
      [{ title: 'viral study' }, { title: 'quantum optics' }], ['viral'],
    )).toBe(0.53);
  });
});

describe('DiscoveryService.checkInstitutionMismatch', () => {
  it('false when either input is missing', () => {
    expect(DiscoveryService.checkInstitutionMismatch('', 'X')).toBe(false);
    expect(DiscoveryService.checkInstitutionMismatch('X', '')).toBe(false);
  });
  it('false when the suggested institution is contained in the affiliation', () => {
    expect(DiscoveryService.checkInstitutionMismatch('Dept of Biology, University of Michigan', 'University of Michigan')).toBe(false);
  });
  it('false when both map to the same alias group', () => {
    expect(DiscoveryService.checkInstitutionMismatch('Massachusetts Institute of Technology', 'MIT')).toBe(false);
  });
  it('does not collapse Janelia Research Campus into HHMI', () => {
    expect(DiscoveryService.checkInstitutionMismatch(
      'Janelia Research Campus',
      'Howard Hughes Medical Institute',
    )).toBe(true);
  });
  it('true for two clearly different institutions with no shared significant word', () => {
    expect(DiscoveryService.checkInstitutionMismatch('Stanford', 'Harvard')).toBe(true);
  });
  it('lenient: shared "university" token counts as a match (no mismatch)', () => {
    expect(DiscoveryService.checkInstitutionMismatch('Stanford University', 'Harvard University')).toBe(false);
  });
});

describe('DiscoveryService.checkExpertiseMismatch', () => {
  it('no claimed expertise → no mismatch', () => {
    expect(DiscoveryService.checkExpertiseMismatch([{ title: 'x' }], [])).toEqual({
      hasMismatch: false, claimedTerms: [], matchedTerms: [],
    });
  });
  it('claimed expertise but no publications → mismatch', () => {
    expect(DiscoveryService.checkExpertiseMismatch([], ['CRISPR'])).toEqual({
      hasMismatch: true, claimedTerms: ['CRISPR'], matchedTerms: [],
    });
  });
  it('specific terms found in publications → no mismatch', () => {
    expect(DiscoveryService.checkExpertiseMismatch(
      [{ title: 'CRISPR gene editing in bacteria' }], ['CRISPR editing'],
    )).toEqual({
      hasMismatch: false,
      claimedTerms: ['crispr', 'editing', 'crispr editing'],
      matchedTerms: ['crispr', 'editing'],
    });
  });
  it('only generic single-word terms → cannot check, no mismatch', () => {
    expect(DiscoveryService.checkExpertiseMismatch([{ title: 'x' }], ['biology'])).toEqual({
      hasMismatch: false, claimedTerms: [], matchedTerms: [],
    });
  });
});
