/**
 * Characterization tests for the DiscoveryService research-area cluster
 * (isClearlyBiomedicalResearchArea, isPhysicalOrEngineeringResearchArea,
 * isClearlyNonBiomedicalVerifierArea, articlesLookBiomedicalOrClinical,
 * evaluateCrossFieldNamesakeGuard, isCrossFieldDiscoveredContamination).
 *
 * Written before Stage 3 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md) to pin current behavior before the code moves to
 * lib/services/discovery/research-area.js. Values are the actual pre-extraction outputs.
 */

const { DiscoveryService } = require('../../lib/services/discovery-service');

describe('DiscoveryService.isClearlyBiomedicalResearchArea', () => {
  it('true for biomedical keywords, false otherwise', () => {
    expect(DiscoveryService.isClearlyBiomedicalResearchArea('Cancer Biology')).toBe(true);
    expect(DiscoveryService.isClearlyBiomedicalResearchArea('Neuroscience')).toBe(true);
    expect(DiscoveryService.isClearlyBiomedicalResearchArea('Attosecond Physics')).toBe(false);
    expect(DiscoveryService.isClearlyBiomedicalResearchArea('')).toBe(false);
    expect(DiscoveryService.isClearlyBiomedicalResearchArea(null)).toBe(false);
  });
});

describe('DiscoveryService.isPhysicalOrEngineeringResearchArea', () => {
  it('true for physical/engineering keywords, false otherwise', () => {
    expect(DiscoveryService.isPhysicalOrEngineeringResearchArea('Quantum Optics')).toBe(true);
    expect(DiscoveryService.isPhysicalOrEngineeringResearchArea('Materials Engineering')).toBe(true);
    expect(DiscoveryService.isPhysicalOrEngineeringResearchArea('Cancer Biology')).toBe(false);
    expect(DiscoveryService.isPhysicalOrEngineeringResearchArea('')).toBe(false);
  });
});

describe('DiscoveryService.isClearlyNonBiomedicalVerifierArea', () => {
  it('true only when physical AND not biomedical', () => {
    expect(DiscoveryService.isClearlyNonBiomedicalVerifierArea('Attosecond Physics')).toBe(true);
    // "Chemical Biology" hits both regexes → not clearly non-biomedical
    expect(DiscoveryService.isClearlyNonBiomedicalVerifierArea('Chemical Biology')).toBe(false);
    expect(DiscoveryService.isClearlyNonBiomedicalVerifierArea('Cancer Biology')).toBe(false);
  });
});

describe('DiscoveryService.articlesLookBiomedicalOrClinical', () => {
  it('true when any article text carries a biomedical/clinical marker', () => {
    expect(DiscoveryService.articlesLookBiomedicalOrClinical([{ title: 'A clinical trial in patients' }])).toBe(true);
    expect(DiscoveryService.articlesLookBiomedicalOrClinical([{ title: 'Quantum laser dynamics', abstract: 'photon optics' }])).toBe(false);
    expect(DiscoveryService.articlesLookBiomedicalOrClinical([])).toBe(false);
  });
});

describe('DiscoveryService.evaluateCrossFieldNamesakeGuard', () => {
  it('does not demote a biomedical proposal', () => {
    expect(DiscoveryService.evaluateCrossFieldNamesakeGuard({
      proposalInfo: { primaryResearchArea: 'Cancer Biology' }, articles: [], expertiseMatch: 0, expertiseMismatchResult: {},
    })).toEqual({ shouldDemote: false, reason: null });
  });
  it('does not demote when there is topical overlap', () => {
    expect(DiscoveryService.evaluateCrossFieldNamesakeGuard({
      proposalInfo: { primaryResearchArea: 'Attosecond Physics' },
      articles: [{ title: 'clinical patient disease' }],
      expertiseMatch: 0.5,
      expertiseMismatchResult: { hasMismatch: false, matchedTerms: ['laser'] },
    })).toEqual({ shouldDemote: false, reason: null });
  });
  it('demotes a non-biomedical proposal with a biomedical-only namesake match and no overlap', () => {
    expect(DiscoveryService.evaluateCrossFieldNamesakeGuard({
      proposalInfo: { primaryResearchArea: 'Attosecond Physics' },
      articles: [{ title: 'clinical patient disease therapy' }],
      expertiseMatch: 0,
      expertiseMismatchResult: {},
    })).toEqual({
      shouldDemote: true,
      reason: 'Non-biomedical proposal with biomedical-only PubMed namesake match and no topical overlap',
    });
  });
});

describe('DiscoveryService.isCrossFieldDiscoveredContamination', () => {
  it('true only for a bioRxiv-only candidate on a clearly non-biomedical proposal', () => {
    expect(DiscoveryService.isCrossFieldDiscoveredContamination(
      { primaryResearchArea: 'Attosecond Physics' }, { source: 'biorxiv' },
    )).toBe(true);
    expect(DiscoveryService.isCrossFieldDiscoveredContamination(
      { primaryResearchArea: 'Attosecond Physics' }, { sources: ['biorxiv', 'pubmed'] },
    )).toBe(false);
    expect(DiscoveryService.isCrossFieldDiscoveredContamination(
      { primaryResearchArea: 'Cancer Biology' }, { source: 'biorxiv' },
    )).toBe(false);
  });
});
