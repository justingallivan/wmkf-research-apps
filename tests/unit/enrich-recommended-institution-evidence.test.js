/**
 * @jest-environment node
 *
 * institutionEvidenceConnectsIdentity — characterization against the five
 * REAL production operand pairs captured on request 1002903 (S400
 * [verdict-trace] capture, 2026-08-04; outputs/s400-verdict-trace-capture).
 *
 * Deliberately uses the REAL DeduplicationService, REAL consistency checker,
 * and REAL byline-core extractor: the pre-existing service suite mocks
 * institutionDirectMatch with lenient substring logic, which is exactly why
 * the byline false-mismatch class was never caught there. Only the OpenAlex
 * resolver is stubbed (returns null = abstain), mirroring the captured
 * production behavior where every decorated byline resolution abstained.
 *
 * Current pinned behavior: ALL byline-vs-clean pairs compare CONTRADICTED —
 * including the four same-institution pairs (the known false-mismatch class).
 * A core-extraction fallback that flipped those four was REVERTED after the
 * S400 Codex review: the borrowed aggregation-key extractor collapsed
 * comma-qualified sibling institutions into false CONSISTENTs, a write-gate
 * hazard. ACCEPTANCE SPEC for the future conservative extractor: the four
 * same-institution pairs flip to true; the Northwestern-vs-Texas-A&M pair and
 * every sibling attack below stay false.
 */

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findApplicantRecommendedByRequest: jest.fn(),
  setMatchReason: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getById: jest.fn(), findByEmailCandidates: jest.fn(), update: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  upsertByPotentialReviewer: jest.fn(), writeIdentityDecision: jest.fn(), clearIdentityFields: jest.fn(),
}));
jest.mock('../../lib/services/discovery-service', () => ({
  DiscoveryService: { YEARS_LOOKBACK: 5 },
}));
jest.mock('../../lib/services/contact-enrichment-service', () => ({
  ContactEnrichmentService: { enrichCandidates: jest.fn() },
}));
jest.mock('../../lib/services/openalex-service', () => ({
  OpenAlexService: { searchInstitutions: jest.fn(), getInstitution: jest.fn(), getWorksByAuthor: jest.fn() },
}));
jest.mock('../../lib/services/claude-reviewer-service', () => ({
  ClaudeReviewerService: { analyzeProposal: jest.fn() },
}));
jest.mock('../../lib/services/proposal-pi-identity', () => ({
  resolveProposalPI: jest.fn(), appendPiName: jest.fn(), piInstitutions: jest.fn(),
}));
jest.mock('../../lib/utils/proposal-authors', () => ({ deriveProposalAuthorNames: jest.fn() }));
jest.mock('../../lib/services/reviewer-identity-resolver', () => ({
  mayPersistIdentity: jest.fn(), RESOLVER_SOURCED_FIELDS: [],
}));
jest.mock('../../lib/services/backprop-reviewer-orcid', () => ({
  backPropReviewerOrcidToContact: jest.fn(),
}));
jest.mock('../../lib/services/reviewer-time-budget', () => ({
  getReviewerTimeBudgetSeconds: jest.fn(),
}));
jest.mock('../../lib/services/reviewer-request-context', () => ({
  loadReviewerRequestContext: jest.fn(),
}));
jest.mock('../../shared/components/reviewers/reviewer-search-logic', () => ({
  APPLICANT_ENRICHMENT_CACHE_VERSION: 4, pruneCandidateForRoster: jest.fn(),
}));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  recordSurfaced: jest.fn(), findCandidateBySuggestion: jest.fn(),
}));
jest.mock('../../lib/services/workbench/applicant-known-reviewer-service', () => ({
  loadApplicantKnownReviewerContext: jest.fn(),
}));
jest.mock('../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn() }));

import {
  institutionEvidenceConnectsIdentity,
  institutionVerdictReason,
} from '../../lib/services/workbench/enrich-recommended-service';
const { createInstitutionConsistencyChecker } = require('../../lib/services/institution-affiliation-consistency');

// Abstaining resolver: mirrors captured production behavior for decorated
// bylines (OpenAlex returns zero results → resolve() null). Consistency must
// therefore come from the direct matcher over extracted cores.
const abstainResolver = { resolve: jest.fn(async () => null) };
const checker = () => createInstitutionConsistencyChecker({ resolver: abstainResolver });

const compare = (evidenceInstitution, finalAffiliation, resolvedInstitutions = [finalAffiliation]) =>
  institutionEvidenceConnectsIdentity({
    evidenceInstitution,
    resolvedInstitutions,
    finalAffiliation,
    checker: checker(),
  });

// Verbatim operands from the S400 production capture (request 1002903).
const CAPTURED = {
  ucsd: {
    evidence: 'Department of Bioengineering, University of California San Diego, La Jolla, California 92093, United States.',
    listed: 'University of California San Diego',
  },
  columbia: {
    evidence: 'Dept. of Biomedical Engineering, Columbia University, New York, NY, USA; Dept. of Radiology, Columbia University, New York, NY, USA.',
    listed: 'Columbia University',
  },
  ncstate: {
    evidence: 'Department of Mechanical and Aerospace Engineering, North Carolina State University, Raleigh, NC, 27695, USA.',
    listed: 'North Carolina State University',
  },
  vumc: {
    evidence: 'Department of Radiology, Vanderbilt University Institute of Imaging Science, Vanderbilt University Medical Center, Nashville, USA.',
    listed: 'Vanderbilt University Medical Center',
  },
  zhou: {
    evidence: 'Division of Nephrology and Hypertension, Northwestern University Feinberg School of Medicine and the Feinberg Cardiovascular and Renal Research Institute, Chicago, IL, United States.',
    listed: 'Center for Translational Cancer Research, Institute of Biosciences and Technology, Texas A&M University, Houston, TX 77030, USA; Department of Medical Physiology, College of Medicine, Texas A&M University, Bryan, TX 77807, USA; Department of Translational Medical Sciences, College of Medicine, Texas A&M University, Houston, TX 77030, USA. Electronic address: yubinzhou@tamu.edu.',
  },
};

describe('institutionEvidenceConnectsIdentity — S400 captured operands', () => {
  // CURRENT behavior: these four same-institution pairs compare false (the
  // S400-attributed false-mismatch class). When the conservative segment-whole
  // extractor lands, flip these expectations to true — that flip IS the
  // acceptance test for the fix.
  test.each([
    ['UCSD', CAPTURED.ucsd],
    ['Columbia', CAPTURED.columbia],
    ['NC State', CAPTURED.ncstate],
    ['VUMC', CAPTURED.vumc],
  ])('%s byline vs its listed institution currently compares CONTRADICTED (known false-mismatch class)', async (_label, pair) => {
    await expect(compare(pair.evidence, pair.listed)).resolves.toBe(false);
  });

  test('Northwestern byline vs listed Texas A&M stays CONTRADICTED', async () => {
    await expect(compare(CAPTURED.zhou.evidence, CAPTURED.zhou.listed)).resolves.toBe(false);
  });

  test('distinct clean institutions stay contradicted (fallback does not fire on unchanged cores)', async () => {
    await expect(compare('Stanford University', 'Columbia University', ['Columbia University'])).resolves.toBe(false);
  });

  test('byline evidence vs a DIFFERENT university core stays contradicted', async () => {
    await expect(compare(CAPTURED.ucsd.evidence, 'Columbia University', ['Columbia University'])).resolves.toBe(false);
  });

  test('missing operands still abstain (null), preserving the fail-closed fallback upstream', async () => {
    await expect(compare(null, 'Columbia University')).resolves.toBe(null);
    await expect(compare(CAPTURED.columbia.evidence, null)).resolves.toBe(null);
  });

  // Sibling-institution attacks (S400 author pass + Codex review): any future
  // same-institution widening at this seam must keep ALL of these false. The
  // Codex-review set puts comma-delimited campus qualifiers on BOTH sides —
  // the shape that collapsed the reverted aggregation-key extractor. (Note:
  // the >0.9 string-similarity fallback lives in legacy institutionsMatch,
  // NOT in institutionDirectMatch, which has no similarity calculation.)
  test.each([
    ['UCSD byline vs listed UCSF', CAPTURED.ucsd.evidence, 'University of California, San Francisco'],
    ['UCSF byline vs listed UCSD', 'Department of Medicine, University of California San Francisco, San Francisco, CA, USA.', 'University of California San Diego'],
    ['NC State byline vs NC Central', 'Department of Chemistry, North Carolina State University, Raleigh, NC, USA.', 'North Carolina Central University'],
    ['West Texas A&M byline vs Texas A&M', 'Department of X, West Texas A&M University, Canyon, TX, USA.', 'Texas A&M University'],
    ['UC San Diego vs UC San Francisco (both comma-qualified)', 'University of California, San Diego', 'University of California, San Francisco'],
    ['UT Austin vs UT Dallas (both comma-qualified)', 'University of Texas, Austin', 'University of Texas, Dallas'],
    ['UW Madison vs UW Milwaukee (both comma-qualified)', 'University of Wisconsin, Madison', 'University of Wisconsin, Milwaukee'],
    ['MGH campuses sharing a >50-char decorated prefix', 'Massachusetts General Hospital Department of Extended Translational Research Programs, Main Campus', 'Massachusetts General Hospital Department of Extended Translational Research Programs, West Campus'],
  ])('sibling institutions stay contradicted: %s', async (_label, evidence, listed) => {
    await expect(compare(evidence, listed, [listed])).resolves.toBe(false);
  });

  test('verdict reason: a decided contradiction names BOTH compared institutions', () => {
    const reason = institutionVerdictReason({
      contradictionSource: 'compared',
      contradictedEvidence: CAPTURED.zhou.evidence,
      finalAffiliation: 'Texas A&M University',
    });
    expect(reason).toContain('Northwestern University');
    expect(reason).toContain('Texas A&M University');
    expect(reason).not.toMatch(/contradict the listed institution$/);
  });

  test('verdict reason: a comparison error reads as unverified, never as affirmative contradiction', () => {
    const reason = institutionVerdictReason({ contradictionSource: 'comparison_error' });
    expect(reason).toContain('could not be completed');
    expect(reason).toContain('unverified');
    expect(reason).not.toContain('contradict');
  });

  test('verdict reason: a carried prior flag says the comparison did not happen this run, not that a mismatch was confirmed', () => {
    const reason = institutionVerdictReason({ contradictionSource: 'prior_flag' });
    expect(reason).toContain('earlier verification pass');
    expect(reason).toContain('could not be compared');
    expect(reason).not.toMatch(/flagged an institution mismatch/);
  });

  test('verdict reason: long bylines are clipped for copy, not dumped verbatim', () => {
    const reason = institutionVerdictReason({
      contradictionSource: 'compared',
      contradictedEvidence: CAPTURED.zhou.listed, // 300+ chars
      finalAffiliation: 'Texas A&M University',
    });
    expect(reason).toContain('…');
    expect(reason.length).toBeLessThan(400);
  });

  test('resolved-institution direct match still short-circuits before any checker call', async () => {
    const spy = { areConsistent: jest.fn() };
    await expect(institutionEvidenceConnectsIdentity({
      evidenceInstitution: 'Columbia University',
      resolvedInstitutions: ['Columbia University'],
      finalAffiliation: 'Columbia University',
      checker: spy,
    })).resolves.toBe(true);
    expect(spy.areConsistent).not.toHaveBeenCalled();
  });
});
