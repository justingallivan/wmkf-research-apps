/**
 * @jest-environment node
 *
 * /api/reviewer-finder/discover — proposal-author filtering must cover the
 * unverified rescue list, not only verified/ranked candidates.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 5 })),
  getUserRole: jest.fn(async () => 'read_only'),
}));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: jest.fn(() => jest.fn(async () => true)),
}));
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(async () => {}),
}));
jest.mock('../../lib/services/reviewer-time-budget', () => ({
  getReviewerTimeBudgetSeconds: jest.fn(async () => 120),
}));
jest.mock('../../lib/services/claude-reviewer-service', () => ({
  ClaudeReviewerService: { generateDiscoveredReasoning: jest.fn() },
}));
jest.mock('../../lib/services/proposal-pi-identity', () => ({
  resolveProposalPI: jest.fn(async () => ({
    resolved: true,
    canonicalName: 'Patricia Investigator',
    contactName: 'Patricia Investigator',
  })),
  excludePiIdentity: jest.fn((candidates) => ({ kept: candidates, removed: [] })),
  appendPiName: jest.fn((authors, pi) => pi?.canonicalName ? [...authors, pi.canonicalName] : authors),
  piInstitutions: jest.fn(() => []),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  recordCoiDropped: jest.fn(async () => 0),
}));
jest.mock('../../lib/services/institution-identity-resolver', () => ({
  createInstitutionIdentityResolver: jest.fn(() => ({})),
}));
jest.mock('../../lib/services/reviewer-identity-lookup', () => ({
  lookupReviewerIdentity: jest.fn(),
}));

const mockDiscover = jest.fn(async () => ({
  verified: [],
  unverified: [
    { name: 'P. Investigator', identityStatus: 'unresolved' },
    { name: 'Casey M Lee', identityStatus: 'unresolved' },
    { name: 'Morgan Reviewer', identityStatus: 'unresolved' },
  ],
  discovered: [],
  coiDropped: [],
  stats: {},
}));
jest.mock('../../lib/services/discovery-service', () => ({
  DiscoveryService: {
    discover: (...args) => mockDiscover(...args),
    pubMedVerificationContract: jest.fn(() => ({ enabled: false })),
    rankAllCandidates: jest.fn(({ verified, discovered }) => [...verified, ...discovered]),
    summarizeCoauthorChecks: jest.fn(),
  },
}));

import handler from '../../pages/api/reviewer-finder/discover';
import { getUserRole } from '../../lib/utils/auth';

function response() {
  const chunks = [];
  return {
    chunks,
    setHeader: jest.fn(),
    write: jest.fn((chunk) => chunks.push(chunk)),
    end: jest.fn(),
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function resultEvent(res) {
  const stream = res.chunks.join('');
  const match = stream.match(/event: result\ndata: ([^\n]+)\n\n/);
  return match ? JSON.parse(match[1]) : null;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CLAUDE_API_KEY = 'test-key';
});

afterAll(() => {
  delete process.env.CLAUDE_API_KEY;
});

test('filters PI and co-investigator name variants before emitting unverified suggestions', async () => {
  const res = response();
  await handler({
    method: 'POST',
    body: {
      requestId: '11111111-1111-1111-1111-111111111111',
      analysisResult: {
        proposalInfo: {
          proposalAuthors: 'Patricia Investigator',
          coInvestigators: 'Casey Lee',
          keywords: '',
        },
        reviewerSuggestions: [],
      },
      options: {
        searchPubmed: false,
        searchArxiv: false,
        searchBiorxiv: false,
        searchChemrxiv: false,
        generateReasoning: false,
      },
    },
  }, res);

  const result = resultEvent(res);
  expect(result).not.toBeNull();
  expect(result.unverified.map((candidate) => candidate.name)).toEqual(['Morgan Reviewer']);
});

test('returns named resolver comparisons only to a freshly verified superuser', async () => {
  getUserRole.mockResolvedValueOnce('superuser');
  mockDiscover.mockImplementationOnce(async (_analysisResult, options) => {
    await options.onIdentityComparison({
      runId: '11111111-1111-4111-8111-111111111111',
      resolverMode: 'shadow',
      candidateKey: 'abcd1234abcd1234',
      reviewerName: 'Named Admin Diagnostic',
      claimedInstitution: 'Example University',
      legacyDecision: 'abstain',
      worksDecision: 'bind',
      combinedDecision: 'bind',
      combinedReason: 'works_rescue',
      anchorsAgree: false,
      providerPayload: { shouldNeverReachResponse: true },
    });
    return { verified: [], unverified: [], discovered: [], coiDropped: [], stats: {} };
  });

  const res = response();
  await handler({
    method: 'POST',
    body: {
      analysisResult: { proposalInfo: { keywords: '' }, reviewerSuggestions: [] },
      options: { generateReasoning: false },
    },
  }, res);

  expect(resultEvent(res).identityComparison).toEqual({
    runId: '11111111-1111-4111-8111-111111111111',
    resolverMode: 'shadow',
    candidates: [expect.objectContaining({
      reviewerName: 'Named Admin Diagnostic',
      legacyDecision: 'abstain',
      combinedDecision: 'bind',
    })],
  });
  expect(resultEvent(res).identityComparison.candidates[0]).not.toHaveProperty('providerPayload');
});

test('ordinary app users receive no named comparison field and no observer', async () => {
  let receivedObserver = 'not-called';
  mockDiscover.mockImplementationOnce(async (_analysisResult, options) => {
    receivedObserver = options.onIdentityComparison;
    return { verified: [], unverified: [], discovered: [], coiDropped: [], stats: {} };
  });

  const res = response();
  await handler({
    method: 'POST',
    body: {
      analysisResult: { proposalInfo: { keywords: '' }, reviewerSuggestions: [] },
      options: { generateReasoning: false },
    },
  }, res);

  expect(receivedObserver).toBeNull();
  expect(resultEvent(res)).not.toHaveProperty('identityComparison');
});
