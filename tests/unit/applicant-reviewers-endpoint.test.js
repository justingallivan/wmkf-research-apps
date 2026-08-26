/**
 * @jest-environment node
 */
/**
 * /api/workbench/applicant-reviewers — materializes applicant-recommended slots
 * and parses the free-text excluded-reviewers list (a hardened Claude call).
 *
 * Regression focus: the excluded-reviewer extraction resolves its model via the
 * synchronous getModelForApp('reviewer-finder'), which only returns a real model
 * id once loadModelOverrides() has warmed the cache. If the handler skips that
 * call, Anthropic 404s on the raw tier key ("sonnet") and a trivially-parseable
 * name (e.g. "Mya Breitbart") falls through to excludedParseFailed=true. This
 * test pins the warm-before-extract ordering. (Sibling bug fixed S229 in
 * web-suggestions; same class of defect.)
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 7, session: { user: {} } })),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

const getRecord = jest.fn(async () => ({
  akoya_requestid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  akoya_requestnum: '1002788',
  akoya_title: 'Engineered gene circuits',
  wmkf_meetingdate: null,
  wmkf_excludedreviewers: 'Mya Breitbart',
  // No populated reviewer slots — keeps the test focused on the excluded path.
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: (...a) => getRecord(...a) },
}));

// No slots populated, so ensureApplicantRecommended is never invoked by default; mock the
// module anyway so its dataverse-adapter transitive deps don't load.
const ensureApplicantRecommended = jest.fn(async () => ({ id: 'sug-1', created: true, skippedExcluded: false }));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  ensureApplicantRecommended: (...a) => ensureApplicantRecommended(...a),
}));

jest.mock('../../lib/utils/cycle-code', () => ({ meetingDateToCycleCode: () => null }));

const extractExcludedReviewers = jest.fn(async () => ({
  names: [{ name: 'Mya Breitbart', affiliation: null }],
  substantive: true,
  parseFailed: false,
}));
jest.mock('../../lib/services/reviewer-exclusion-parser', () => ({
  extractExcludedReviewers: (...a) => extractExcludedReviewers(...a),
}));

const loadModelOverrides = jest.fn(async () => {});
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: (...a) => loadModelOverrides(...a),
}));

import handler from '../../pages/api/workbench/applicant-reviewers';
import { requireAppAccess } from '../../lib/utils/auth';

function res() {
  return { statusCode: 200, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const VALID_GUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function get(requestId = VALID_GUID) {
  return { method: 'GET', query: { requestId } };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: {} } });
  getRecord.mockResolvedValue({
    akoya_requestid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    akoya_requestnum: '1002788',
    akoya_title: 'Engineered gene circuits',
    wmkf_meetingdate: null,
    wmkf_excludedreviewers: 'Mya Breitbart',
  });
  ensureApplicantRecommended.mockResolvedValue({ id: 'sug-1', created: true, skippedExcluded: false });
  extractExcludedReviewers.mockResolvedValue({
    names: [{ name: 'Mya Breitbart', affiliation: null }],
    substantive: true,
    parseFailed: false,
  });
});

describe('handler gates', () => {
  it('rejects non-GET (405)', async () => {
    const r = res();
    await handler({ method: 'POST' }, r);
    expect(r.statusCode).toBe(405);
    expect(loadModelOverrides).not.toHaveBeenCalled();
  });

  it('unauthenticated caller: 401 short-circuit, no work performed', async () => {
    requireAppAccess.mockImplementation(async (_req, resArg) => {
      resArg.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const r = res();
    await handler(get(), r);
    expect(r.statusCode).toBe(401);
    expect(loadModelOverrides).not.toHaveBeenCalled();
    expect(extractExcludedReviewers).not.toHaveBeenCalled();
    expect(getRecord).not.toHaveBeenCalled();
  });

  it('400s on a non-GUID requestId', async () => {
    const r = res();
    await handler(get('not-a-guid'), r);
    expect(r.statusCode).toBe(400);
    expect(loadModelOverrides).not.toHaveBeenCalled();
  });

  it('404s when the request GUID does not resolve', async () => {
    getRecord.mockRejectedValueOnce(new Error('not found'));
    const r = res();
    await handler(get(), r);
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: `No request found for ${VALID_GUID}` });
    expect(extractExcludedReviewers).not.toHaveBeenCalled();
  });
});

describe('excluded-reviewer extraction', () => {
  it('parses a clean single name without tripping excludedParseFailed', async () => {
    const r = res();
    await handler(get(), r);
    expect(r.statusCode).toBe(200);
    expect(r.body.excludedParseFailed).toBe(false);
    expect(r.body.excludedNames).toEqual(['Mya Breitbart']);
  });

  it('warms model overrides BEFORE the extraction (regression: prod 404 on tier key "sonnet")', async () => {
    const r = res();
    await handler(get(), r);
    expect(loadModelOverrides).toHaveBeenCalledTimes(1);
    expect(extractExcludedReviewers).toHaveBeenCalledTimes(1);
    expect(loadModelOverrides.mock.invocationCallOrder[0])
      .toBeLessThan(extractExcludedReviewers.mock.invocationCallOrder[0]);
  });
});

describe('happy-path envelope (full pin)', () => {
  it('pins the exact 200 response shape for a populated-slot request', async () => {
    getRecord.mockResolvedValue({
      akoya_requestid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      akoya_requestnum: '1002788',
      akoya_title: 'Engineered gene circuits',
      wmkf_meetingdate: null,
      wmkf_excludedreviewers: 'Mya Breitbart',
      _wmkf_potentialreviewer1_value: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      _wmkf_potentialreviewer1_value_formatted: 'Dr. Slot One',
    });
    ensureApplicantRecommended.mockResolvedValue({ id: 'sugg-slot1', created: true, skippedExcluded: false });
    const r = res();
    await handler(get(), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({
      success: true,
      requestId: VALID_GUID,
      requestNumber: '1002788',
      cycleCode: null,
      recommended: [{
        slot: 1,
        potentialReviewerId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        name: 'Dr. Slot One',
        suggestionId: 'sugg-slot1',
        created: true,
        skippedExcluded: false,
        applicantKnownReviewer: {
          status: 'known',
          code: null,
          addressTrustVerified: false,
          addressConflictPending: false,
          addressChoice: null,
          potentialReviewerId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          name: null,
          affiliation: null,
          email: null,
          emailSource: null,
          emailReadiness: {
            level: 'low',
            action: 'missing',
            reason: 'No email address found',
          },
          orcid: null,
          contactLinked: false,
        },
      }],
      recommendedCount: 1,
      recommendedCreated: 1,
      slotsPopulated: 1,
      recommendedFailed: undefined,
      recommendedComplete: true,
      knownLookupComplete: true,
      knownLookupFailed: undefined,
      excluded: [{ name: 'Mya Breitbart', affiliation: null }],
      excludedNames: ['Mya Breitbart'],
      excludedRaw: 'Mya Breitbart',
      excludedSubstantive: true,
      excludedParseFailed: false,
      errors: undefined,
    });
  });
});
