/**
 * @jest-environment node
 *
 * Delegation-pin test for lib/services/review-manager/send-emails-service.js
 * (Reviewer Lifecycle Stage 3F).
 *
 * Mocks the EXTRACTED module (`reviewer-engagement/record-invitation`)
 * wholesale and drives the legacy caller (`sendEmails`) to pin: an
 * invitation send with `markAsSent` (the default) calls
 * `recordDeliveredInvitation` exactly once, immediately after the send,
 * with `{ suggestionId, actingUserSystemId }`, and reports
 * `inviteRecorded: true` on success; a rejection reports
 * `inviteRecorded: false` and the batch still completes (result/complete);
 * a non-invitation templateType, or `markAsSent: false`, never calls it.
 * This must go red if `sendEmails` reimplements the inline invitation stamp
 * while keeping the import.
 */

const createAndSendEmail = jest.fn(async () => ({ emailId: 'email-1' }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createAndSendEmail: (...a) => createAndSendEmail(...a) },
}));
const verifySuggestionToken = jest.fn(async () => ({
  ok: true,
  payload: { suggestionId: SUG_OK, requestId: REQUEST_ID },
}));
jest.mock('../../lib/external/verify-suggestion-token', () => ({
  verifySuggestionToken: (...a) => verifySuggestionToken(...a),
}));
const mintAndStore = jest.fn(async () => ({ jwt: 'aaa.bbb.ccc' }));
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: (...a) => mintAndStore(...a),
  SEND_TIME_TOKEN_PLACEHOLDER_JWT: 'send_time_token.pending_authority.not_live',
}));

const findById = jest.fn(async (id) => SUGGESTIONS[id] ?? null);
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
  REVIEW_STATUS_MAP: { accepted: 100000000, materials_sent: 100000001, under_review: 100000002 },
}));
const getPersonById = jest.fn(async (id) => PERSONS[id] ?? null);
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...a) => getPersonById(...a),
  setContactLink: jest.fn(async () => {}),
}));
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  findOrCreateByEmail: jest.fn(async () => ({ id: 'c-1', created: false })),
}));
const getSystemUserById = jest.fn(async () => ({
  systemuserid: 'pd-1',
  fullname: 'PD',
  internalemailaddress: 'pd@wmkeck.org',
  isdisabled: false,
}));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({
  getByIdWithSelect: (...a) => getSystemUserById(...a),
}));
const updateRequestById = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: jest.fn(async () => REQUEST),
  updateById: (...a) => updateRequestById(...a),
}));
jest.mock('../../lib/services/backprop-reviewer-orcid', () => ({
  backPropReviewerOrcidToContact: jest.fn(async () => ({ action: 'noop' })),
}));
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(async () => ({ found: false, value: null })),
}));
jest.mock('../../lib/services/grant-cycles-dataverse', () => ({
  findByShortCode: jest.fn(async () => null),
}));
jest.mock('../../lib/utils/cycle-code', () => ({ meetingDateToCycleCode: jest.fn(() => null) }));
jest.mock('../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn(), isAllowedUrl: jest.fn(() => false) }));
jest.mock('../../lib/utils/uploaded-blob', () => ({ readUploadedBlobBuffer: jest.fn(async () => Buffer.from('PDF')) }));
jest.mock('../../lib/utils/cycle-material-ref', () => ({
  isPrivateCycleMaterialPathname: (p) => typeof p === 'string' && p.startsWith('cycle-materials/'),
}));
jest.mock('../../lib/services/proposal-participants', () => ({
  fetchCoPIs: jest.fn(async () => []),
}));
// record-email-outcome is unrelated to the invitation stamp under test here
// (it handles materials/followup/thankyou post-send bookkeeping); mock it
// wholesale so it never runs real logic against these mocked adapters.
jest.mock('../../lib/services/reviewer-engagement/record-email-outcome', () => ({
  recordDeliveredEmail: jest.fn(async () => {}),
}));

// The module under delegation test: mocked wholesale so this suite pins
// only the CALL SHAPE and ORDERING, never the real bookkeeping logic (that
// is covered directly by tests/unit/record-invitation.test.js).
const recordDeliveredInvitation = jest.fn(async () => {});
jest.mock('../../lib/services/reviewer-engagement/record-invitation', () => ({
  recordDeliveredInvitation: (...a) => recordDeliveredInvitation(...a),
}));

const { sendEmails } = require('../../lib/services/review-manager/send-emails-service');
const { stampFingerprint } = require('../helpers/draft-fingerprint');

const SUG_OK = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';

let SUGGESTIONS;
let PERSONS;
let REQUEST;

function suggestion(id, over = {}) {
  return {
    wmkf_appreviewersuggestionid: id,
    _wmkf_potentialreviewer_value: `person-${id}`,
    _wmkf_request_value: REQUEST_ID,
    wmkf_accepted: false,
    wmkf_invited: false,
    wmkf_reviewstatus: null,
    _etag: 'W/"1"',
    ...over,
  };
}
function person(id, over = {}) {
  return {
    wmkf_potentialreviewersid: id,
    wmkf_name: 'Dr. Reviewer',
    wmkf_emailaddress: 'rev@example.org',
    _wmkf_contact_value: 'c-1',
    wmkf_emailsource: 'orcid',
    wmkf_identitystatus: 'confirmed',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getSystemUserById.mockResolvedValue({
    systemuserid: 'pd-1',
    fullname: 'PD',
    internalemailaddress: 'pd@wmkeck.org',
    isdisabled: false,
  });
  SUGGESTIONS = { [SUG_OK]: suggestion(SUG_OK) };
  PERSONS = { [`person-${SUG_OK}`]: person(`person-${SUG_OK}`) };
  REQUEST = {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: 'REQ-001',
    wmkf_meetingdate: null,
    _wmkf_programdirector_value: 'pd-1',
  };
  mintAndStore.mockResolvedValue({ jwt: 'aaa.bbb.ccc' });
  recordDeliveredInvitation.mockResolvedValue(undefined);
});

function autoStampDraft(d, templateType) {
  if (!d || typeof d !== 'object' || Object.prototype.hasOwnProperty.call(d, 'draftFingerprint')) return d;
  const sug = SUGGESTIONS[d.suggestionId];
  const per = (sug && PERSONS[sug._wmkf_potentialreviewer_value]) || PERSONS[`person-${d.suggestionId}`];
  return stampFingerprint(d, {
    templateType,
    suggestionId: d.suggestionId,
    suggestion: sug,
    person: per,
    request: REQUEST,
    coPINames: [],
    cycle: {},
    honorariumAmount: 250,
  });
}

async function run(requestBody) {
  const emitted = [];
  const onEvent = jest.fn((e) => emitted.push(e));
  const stampedBody = {
    ...requestBody,
    drafts: requestBody.drafts.map((d) => autoStampDraft(d, requestBody.templateType)),
  };
  await sendEmails(
    { requestBody: stampedBody, fromEmail: 'staff@wmkeck.org', actingUserSystemId: 'u-1' },
    onEvent,
  );
  return { emitted, onEvent };
}

const draft = (id) => ({
  suggestionId: id,
  subject: 'Review Materials',
  body: 'Dear Reviewer,\n\nPlease review: https://reviews.example.org/external/review/aaa.bbb.ccc\n\nThank you.',
  externalLinkExpected: true,
});

describe('send-emails-service delegates the post-send invitation stamp to recordDeliveredInvitation', () => {
  test('an invitation send with markAsSent calls recordDeliveredInvitation once with { suggestionId, actingUserSystemId }, after the send, and reports inviteRecorded: true', async () => {
    const { emitted } = await run({ drafts: [draft(SUG_OK)], templateType: 'invitation' });

    expect(emitted.some((e) => e.event === 'error')).toBe(false);
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(recordDeliveredInvitation).toHaveBeenCalledTimes(1);
    expect(recordDeliveredInvitation).toHaveBeenCalledWith({
      suggestionId: SUG_OK,
      actingUserSystemId: 'u-1',
    });

    const sendOrder = createAndSendEmail.mock.invocationCallOrder[0];
    const recordOrder = recordDeliveredInvitation.mock.invocationCallOrder[0];
    expect(sendOrder).toBeLessThan(recordOrder);

    const r = emitted.find((e) => e.event === 'result').data;
    expect(r.sent[0]).toMatchObject({ suggestionId: SUG_OK, inviteRecorded: true });
  });

  test('a recordDeliveredInvitation rejection reports inviteRecorded: false and the batch still completes', async () => {
    recordDeliveredInvitation.mockRejectedValueOnce(new Error('stamp failed'));

    const { emitted } = await run({ drafts: [draft(SUG_OK)], templateType: 'invitation' });

    expect(emitted.some((e) => e.event === 'error')).toBe(false);
    const r = emitted.find((e) => e.event === 'result').data;
    expect(r.sent[0]).toMatchObject({ suggestionId: SUG_OK, inviteRecorded: false });
    expect(emitted.slice(-2).map((e) => e.event)).toEqual(['result', 'complete']);
  });

  test('a non-invitation templateType never calls recordDeliveredInvitation', async () => {
    SUGGESTIONS[SUG_OK] = suggestion(SUG_OK, { wmkf_accepted: true });
    await run({ drafts: [draft(SUG_OK)], templateType: 'materials' });
    expect(recordDeliveredInvitation).not.toHaveBeenCalled();
  });

  test('markAsSent: false never calls recordDeliveredInvitation for an invitation send', async () => {
    const emitted2 = [];
    const onEvent = jest.fn((e) => emitted2.push(e));
    const stampedBody = {
      drafts: [draft(SUG_OK)].map((d) => autoStampDraft(d, 'invitation')),
      templateType: 'invitation',
      markAsSent: false,
    };
    await sendEmails(
      { requestBody: stampedBody, fromEmail: 'staff@wmkeck.org', actingUserSystemId: 'u-1' },
      onEvent,
    );
    expect(recordDeliveredInvitation).not.toHaveBeenCalled();
  });
});
