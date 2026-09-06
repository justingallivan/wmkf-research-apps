/**
 * @jest-environment node
 *
 * Reviewer Lifecycle Stage 6D — correction round (coordinator directive,
 * 2026-09-06). The prior `projection-divergence` block in
 * draft-fingerprint.test.js called the pure builder twice with literal
 * objects; no service ran, so a real regression in send-emails-service.js's
 * recipient-hydration selects (or a dropped fetchCoPIs/getHonorariumAmount
 * call) would not have failed any test. Opus proved the gap by narrowing the
 * request `$select` at send-emails-service.js back to `akoya_title` only:
 * 449/449 tests stayed green because every existing mock returns the same
 * fixed object regardless of the `select` argument it was called with.
 *
 * This file asserts by INSPECTING THE MOCK CALL ARGUMENTS the send service
 * actually receives — not by re-deriving behavior from a fixture that
 * ignores `select` — so a narrowed select fails here directly, on the
 * select string itself.
 */

const createAndSendEmail = jest.fn(async () => ({ emailId: 'email-1' }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createAndSendEmail: (...a) => createAndSendEmail(...a) },
}));
const verifySuggestionToken = jest.fn(async () => ({ ok: true, payload: {} }));
jest.mock('../../lib/external/verify-suggestion-token', () => ({
  verifySuggestionToken: (...a) => verifySuggestionToken(...a),
}));
const mintAndStore = jest.fn(async () => ({ jwt: 'aaa.bbb.ccc' }));
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: (...a) => mintAndStore(...a),
  SEND_TIME_TOKEN_PLACEHOLDER_JWT: 'send_time_token.pending_authority.not_live',
}));
const findById = jest.fn(async () => SUGGESTION);
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
  REVIEW_STATUS_MAP: { accepted: 100000000, materials_sent: 100000001, under_review: 100000002 },
}));
const getPersonById = jest.fn(async () => PERSON);
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...a) => getPersonById(...a),
}));
const getSystemUserById = jest.fn(async () => ({
  systemuserid: 'pd-1', fullname: 'PD', internalemailaddress: 'pd@wmkeck.org', isdisabled: false,
}));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({
  getByIdWithSelect: (...a) => getSystemUserById(...a),
}));
const getRequestById = jest.fn(async () => REQUEST);
const updateRequestById = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
  updateById: (...a) => updateRequestById(...a),
}));
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(async () => ({ found: false, value: null })),
}));
jest.mock('../../lib/services/reviewer-campaign-timeline', () => ({
  getReviewerCampaignTimeline: jest.fn(async () => ({ timeline: { desiredCount: null } })),
}));
jest.mock('../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn(), isAllowedUrl: jest.fn(() => false) }));
jest.mock('../../lib/utils/uploaded-blob', () => ({ readUploadedBlobBuffer: jest.fn(async () => Buffer.from('PDF')) }));
jest.mock('../../lib/utils/cycle-material-ref', () => ({
  isPrivateCycleMaterialPathname: (p) => typeof p === 'string' && p.startsWith('cycle-materials/'),
}));
jest.mock('../../lib/utils/cycle-code', () => ({ meetingDateToCycleCode: jest.fn(() => null) }));
// Fingerprint-input dependencies added by Stage 6D — spied directly so we can
// assert they were actually invoked on the send path.
const fetchCoPIs = jest.fn(async () => []);
jest.mock('../../lib/services/proposal-participants', () => ({
  fetchCoPIs: (...a) => fetchCoPIs(...a),
}));
const getHonorariumAmount = jest.fn(async () => 250);
jest.mock('../../lib/services/honorarium-config', () => ({
  getHonorariumAmount: (...a) => getHonorariumAmount(...a),
}));
// Mocked here (isolated per-file module registry — does not affect the
// "cycle-config-loader — per-caller projection shape" tests in
// send-emails-service.test.js, which exercise the REAL loader) so we can
// inspect exactly what `fields` map send-emails-service.js passes.
const loadCycleConfigs = jest.fn(async () => ({}));
jest.mock('../../lib/services/review-manager/cycle-config-loader', () => ({
  loadCycleConfigs: (...a) => loadCycleConfigs(...a),
}));

const { sendEmails } = require('../../lib/services/review-manager/send-emails-service');
const { stampFingerprint } = require('../helpers/draft-fingerprint');

const SUG = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

let SUGGESTION;
let PERSON;
let REQUEST;

beforeEach(() => {
  jest.clearAllMocks();
  SUGGESTION = {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_potentialreviewer_value: 'person-1',
    _wmkf_request_value: REQUEST_ID,
    wmkf_accepted: true,
    wmkf_invited: false,
    wmkf_reviewstatus: null,
    wmkf_reviewduedateoverride: null,
    _etag: 'W/"1"',
  };
  PERSON = {
    wmkf_potentialreviewersid: 'person-1',
    wmkf_name: 'Dr. Reviewer',
    wmkf_emailaddress: 'rev@example.org',
    wmkf_emailsource: 'orcid',
    wmkf_identitystatus: 'confirmed',
    wmkf_primaryaffiliation: 'Uni A',
    wmkf_organizationname: 'Org A',
  };
  REQUEST = {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: 'R-1001',
    wmkf_meetingdate: null,
    _wmkf_programdirector_value: 'pd-1',
    akoya_title: 'Title',
    wmkf_abstract: 'Abstract',
  };
  findById.mockImplementation(async () => SUGGESTION);
  getPersonById.mockImplementation(async () => PERSON);
  getRequestById.mockImplementation(async () => REQUEST);
  mintAndStore.mockResolvedValue({ jwt: 'aaa.bbb.ccc' });
});

async function run(drafts, templateType = 'materials') {
  const emitted = [];
  await sendEmails(
    { requestBody: { drafts, templateType }, fromEmail: 'staff@wmkeck.org', actingUserSystemId: 'u-1' },
    (e) => emitted.push(e),
  );
  return emitted;
}

function matchingDraft() {
  return stampFingerprint(
    { suggestionId: SUG, subject: 'S', body: 'B', externalLinkExpected: false },
    {
      templateType: 'materials',
      suggestionId: SUG,
      suggestion: SUGGESTION,
      person: PERSON,
      request: REQUEST,
      coPINames: [],
      cycle: {},
      honorariumAmount: 250,
    },
  );
}

test('send-time request select includes every fingerprinted request field', async () => {
  await run([matchingDraft()]);

  expect(getRequestById).toHaveBeenCalledTimes(1);
  const [, options] = getRequestById.mock.calls[0];
  const selected = new Set(String(options.select).split(','));
  for (const field of [
    'akoya_title',
    'wmkf_abstract',
    '_wmkf_projectleader_value',
    'wmkf_organizationname',
    '_akoya_applicantid_value',
  ]) {
    expect(selected.has(field)).toBe(true);
  }
});

test('send-time person select includes the name and both affiliation fields', async () => {
  await run([matchingDraft()]);

  expect(getPersonById).toHaveBeenCalledTimes(1);
  const [, options] = getPersonById.mock.calls[0];
  const selected = new Set(String(options.select).split(','));
  expect(selected.has('wmkf_name')).toBe(true);
  expect(selected.has('wmkf_primaryaffiliation')).toBe(true);
  expect(selected.has('wmkf_organizationname')).toBe(true);
});

test('send-time cycle-config fields map includes program_name and custom_fields', async () => {
  await run([matchingDraft()]);

  expect(loadCycleConfigs).toHaveBeenCalledTimes(1);
  const [, options] = loadCycleConfigs.mock.calls[0];
  expect(Object.keys(options.fields)).toEqual(expect.arrayContaining(['program_name', 'custom_fields']));
});

test('send-time reads co-PIs (fetchCoPIs) and the honorarium amount (getHonorariumAmount) on every send', async () => {
  await run([matchingDraft()]);

  expect(fetchCoPIs).toHaveBeenCalledTimes(1);
  expect(fetchCoPIs).toHaveBeenCalledWith(REQUEST_ID);
  expect(getHonorariumAmount).toHaveBeenCalledTimes(1);
});
