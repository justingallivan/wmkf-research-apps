/**
 * @jest-environment node
 *
 * Reviewer Lifecycle Stage 6D — correction round (coordinator directive,
 * 2026-09-06): the projection-divergence tests in draft-fingerprint.test.js
 * called the pure builder twice with literal objects; no service ran, so a
 * real regression in which projection of the row send-emails-service.js
 * actually reads would not fail any test (every mock in the OTHER test files
 * returns the same fixed object regardless of the `select` string it is
 * called with).
 *
 * This file drives the REAL renderEmails and sendEmails together against
 * adapter mocks that HONOR `select` — they project a full fixture row down
 * to exactly the fields named in the `select` string a caller passed (plus
 * that field's `_formatted` annotation, which travels with the base lookup
 * field on a real Dataverse read). Fixtures use NON-default values (a
 * nonempty abstract, a distinct organization name, a real PI, one co-PI) so
 * a dropped field is observable in the fingerprint.
 *
 * Case A: both routes' real (current) select strings request every
 * fingerprinted field → render's fingerprint matches send's recompute → sent.
 * Case B: the SAME already-rendered draft (same fingerprint) is sent again,
 * but this run's request read is overridden to drop `wmkf_abstract` from the
 * projected row regardless of the select string passed — simulating a
 * regressed/narrowed select without touching production code — and the send
 * must refuse the draft as draft_stale, with no dispatch and no write.
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
const buildSendTimeExternalUrlPlaceholder = jest.fn(() => (
  'https://reviews.example.org/external/review/send_time_token.pending_authority.not_live'
));
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: (...a) => mintAndStore(...a),
  buildSendTimeExternalUrlPlaceholder: (...a) => buildSendTimeExternalUrlPlaceholder(...a),
  SEND_TIME_TOKEN_PLACEHOLDER_JWT: 'send_time_token.pending_authority.not_live',
}));
const findById = jest.fn(async () => SUGGESTION);
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
  REVIEW_STATUS_MAP: { accepted: 100000000, materials_sent: 100000001, under_review: 100000002 },
}));
const getSystemUserById = jest.fn(async () => ({
  systemuserid: 'pd-1', fullname: 'PD', internalemailaddress: 'pd@wmkeck.org', isdisabled: false,
}));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({
  getByIdWithSelect: (...a) => getSystemUserById(...a),
}));
const updateRequestById = jest.fn(async () => {});
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(async () => ({ found: false, value: null })),
}));
jest.mock('../../lib/services/reviewer-campaign-timeline', () => ({
  getReviewerCampaignTimeline: jest.fn(async () => ({ timeline: { desiredCount: null } })),
}));
jest.mock('../../lib/services/grant-cycles-dataverse', () => ({ findByShortCode: jest.fn(async () => null) }));
jest.mock('../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn(), isAllowedUrl: jest.fn(() => false) }));
jest.mock('../../lib/utils/uploaded-blob', () => ({ readUploadedBlobBuffer: jest.fn(async () => Buffer.from('PDF')) }));
jest.mock('../../lib/utils/cycle-material-ref', () => ({
  isPrivateCycleMaterialPathname: (p) => typeof p === 'string' && p.startsWith('cycle-materials/'),
}));
jest.mock('../../lib/utils/cycle-code', () => ({ meetingDateToCycleCode: jest.fn(() => null) }));
// Same co-PI list and honorarium amount both sides — this file's divergence
// is specifically about the REQUEST projection, not these two inputs.
jest.mock('../../lib/services/proposal-participants', () => ({
  fetchCoPIs: jest.fn(async () => ['Dr. Alex Co']),
}));
jest.mock('../../lib/services/honorarium-config', () => ({
  getHonorariumAmount: jest.fn(async () => 500),
}));

// ---- select-honoring adapter mocks -----------------------------------------
// Project a full fixture row down to exactly the fields named in `select`
// (comma-separated), PLUS each selected lookup field's `_formatted`
// annotation (a real Dataverse read returns the annotation alongside the
// base field automatically; it is not itself a $select token).
function project(fullRow, select) {
  if (!select) return { ...fullRow };
  const wanted = new Set(String(select).split(',').map((s) => s.trim()));
  const out = {};
  for (const key of Object.keys(fullRow)) {
    const base = key.endsWith('_formatted') ? key.slice(0, -'_formatted'.length) : key;
    if (wanted.has(base)) out[key] = fullRow[key];
  }
  return out;
}

const getPersonById = jest.fn(async (id, { select } = {}) => project(PERSON_FULL, select));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...a) => getPersonById(...a),
}));

const getRequestById = jest.fn(async (id, { select } = {}) => project(REQUEST_FULL, select));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
  updateById: (...a) => updateRequestById(...a),
}));

const { renderEmails } = require('../../lib/services/review-manager/render-emails-service');
const { sendEmails } = require('../../lib/services/review-manager/send-emails-service');

const SUG = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

const SUGGESTION = {
  wmkf_appreviewersuggestionid: SUG,
  _wmkf_potentialreviewer_value: 'person-1',
  _wmkf_request_value: REQUEST_ID,
  wmkf_accepted: true,
  wmkf_invited: false,
  wmkf_reviewstatus: null,
  wmkf_reviewduedateoverride: null,
  wmkf_honorariumoptout: false,
  _etag: 'W/"1"',
};

// Non-default values throughout: a nonempty abstract, a distinct
// organization name, a real PI — so a dropped field is observable.
const PERSON_FULL = {
  wmkf_potentialreviewersid: 'person-1',
  wmkf_name: 'Dr. Jane Roe',
  wmkf_emailaddress: 'jane@uni.edu',
  wmkf_emailsource: 'orcid',
  wmkf_identitystatus: 'confirmed',
  wmkf_primaryaffiliation: 'Institute of Reviewing',
  wmkf_organizationname: 'Institute of Reviewing (Org)',
};
const REQUEST_FULL = {
  akoya_requestid: REQUEST_ID,
  akoya_requestnum: 'R-2001',
  akoya_title: 'A Nontrivial Study of Something',
  wmkf_abstract: 'This is a nontrivial abstract with real, non-empty content.',
  wmkf_organizationname: 'Acme Research University',
  _akoya_applicantid_value: 'applicant-1',
  _akoya_applicantid_value_formatted: 'Acme Research University (Applicant)',
  _wmkf_projectleader_value: 'pi-1',
  _wmkf_projectleader_value_formatted: 'Dr. Sam Principal',
  wmkf_meetingdate: null,
  wmkf_reviewduedate: '2099-01-01',
  wmkf_respondoffsetdays: null,
  wmkf_desiredcount: null,
  _wmkf_programdirector_value: 'pd-1',
};

const TEMPLATE = { subject: 'Review Materials', body: 'Hello, please review {{proposalTitle}}.' };

async function send(drafts, templateType = 'materials') {
  const emitted = [];
  await sendEmails(
    { requestBody: { drafts, templateType }, fromEmail: 'staff@wmkeck.org', actingUserSystemId: 'u-1' },
    (e) => emitted.push(e),
  );
  return emitted.find((e) => e.event === 'result')?.data;
}

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockImplementation(async () => SUGGESTION);
  getPersonById.mockImplementation(async (id, { select } = {}) => project(PERSON_FULL, select));
  getRequestById.mockImplementation(async (id, { select } = {}) => project(REQUEST_FULL, select));
  mintAndStore.mockResolvedValue({ jwt: 'aaa.bbb.ccc' });
});

test('Case A: both routes’ real selects request every fingerprinted field — render’s fingerprint matches send’s recompute — sent', async () => {
  const { drafts } = await renderEmails({
    suggestionIds: [SUG],
    template: TEMPLATE,
    settings: {},
    templateType: 'materials',
    actingUserSystemId: 'u-1',
  });
  expect(drafts).toHaveLength(1);
  expect(drafts[0].draftFingerprint).toMatch(/^[0-9a-f]{64}$/);
  // The rendered body carries the real (non-default) proposal title.
  expect(drafts[0].body).toContain('A Nontrivial Study of Something');

  const draft = {
    suggestionId: SUG,
    subject: drafts[0].subject,
    body: drafts[0].body,
    externalLinkExpected: drafts[0].externalLinkExpected,
    draftFingerprint: drafts[0].draftFingerprint,
  };

  const result = await send([draft]);
  expect(result.skipped).toEqual([]);
  expect(result.sent).toHaveLength(1);
  expect(createAndSendEmail).toHaveBeenCalledTimes(1);
});

test('Case B: a request read whose select omits wmkf_abstract (simulated, production untouched) refuses the SAME draft as draft_stale, with no dispatch or write', async () => {
  const { drafts } = await renderEmails({
    suggestionIds: [SUG],
    template: TEMPLATE,
    settings: {},
    templateType: 'materials',
    actingUserSystemId: 'u-1',
  });
  const draft = {
    suggestionId: SUG,
    subject: drafts[0].subject,
    body: drafts[0].body,
    externalLinkExpected: drafts[0].externalLinkExpected,
    draftFingerprint: drafts[0].draftFingerprint,
  };

  // Simulate a regressed/narrowed select on THIS send's request read only —
  // production's real select string is untouched; this proves the harness
  // (and the fingerprint check it exercises) would catch exactly this class
  // of defect regardless of whether today's literal select happens to be wide.
  getRequestById.mockImplementationOnce(async (id, { select } = {}) => {
    const projected = project(REQUEST_FULL, select);
    delete projected.wmkf_abstract;
    return projected;
  });

  const result = await send([draft]);
  expect(result.skipped).toEqual([
    expect.objectContaining({ suggestionId: SUG, reason: 'draft_stale' }),
  ]);
  expect(createAndSendEmail).not.toHaveBeenCalled();
  expect(updateLifecycle).not.toHaveBeenCalled();
  expect(mintAndStore).not.toHaveBeenCalled();
});
