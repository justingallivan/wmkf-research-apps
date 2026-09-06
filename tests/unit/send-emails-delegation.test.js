/**
 * @jest-environment node
 *
 * Delegation-pin test for lib/services/review-manager/send-emails-service.js
 * (Reviewer Lifecycle Stage 3E correction round, Codex round 1 medium).
 *
 * Mocks the EXTRACTED module (`reviewer-engagement/record-email-outcome`)
 * wholesale and drives the legacy caller (`sendEmails`) to pin: the call
 * happens with the existing five arguments, AFTER the send and BEFORE the
 * campaign-config block (materials never reaches that block at all — this
 * also confirms `updateRequestById` is not invoked), and a rejection
 * produces the existing `stage: 'updating_lifecycle'` warning event rather
 * than failing the batch. This must go red if `sendEmails` reimplements the
 * bookkeeping inline while keeping the import.
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

// The module under delegation test: mocked wholesale so this suite pins
// only the CALL SHAPE and ORDERING, never the real bookkeeping logic
// (that is covered directly by tests/unit/record-email-outcome.test.js).
const recordDeliveredEmail = jest.fn(async () => {});
jest.mock('../../lib/services/reviewer-engagement/record-email-outcome', () => ({
  recordDeliveredEmail: (...a) => recordDeliveredEmail(...a),
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
    wmkf_accepted: true,
    wmkf_invited: true,
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
  recordDeliveredEmail.mockResolvedValue(undefined);
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

describe('send-emails-service delegates post-send bookkeeping (materials) to recordDeliveredEmail', () => {
  test('calls recordDeliveredEmail with the existing five arguments, after the send and before the campaign-config block', async () => {
    const { emitted, onEvent } = await run({ drafts: [draft(SUG_OK)], templateType: 'materials' });

    expect(emitted.some((e) => e.event === 'error')).toBe(false);
    expect(emitted.slice(-2).map((e) => e.event)).toEqual(['result', 'complete']);

    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(recordDeliveredEmail).toHaveBeenCalledTimes(1);
    expect(recordDeliveredEmail).toHaveBeenCalledWith({
      suggestionId: SUG_OK,
      originalSuggestion: expect.objectContaining({ wmkf_appreviewersuggestionid: SUG_OK }),
      templateType: 'materials',
      sentAt: expect.any(String),
      actingUserSystemId: 'u-1',
    });

    // Ordering: the send happens strictly before the bookkeeping call, which
    // in turn happens strictly before the terminal result/complete events —
    // recovered from the shared jest invocation-order counter across two
    // independent mocks (sendEmails' own onEvent callback and
    // recordDeliveredEmail), since both are jest.fn()s.
    const sendOrder = createAndSendEmail.mock.invocationCallOrder[0];
    const recordOrder = recordDeliveredEmail.mock.invocationCallOrder[0];
    expect(sendOrder).toBeLessThan(recordOrder);

    const resultCallIndex = emitted.findIndex((e) => e.event === 'result');
    const resultOrder = onEvent.mock.invocationCallOrder[resultCallIndex];
    expect(recordOrder).toBeLessThan(resultOrder);

    // The campaign-config block is gated on templateType === 'invitation' and
    // never runs for a materials send — pinning that it did not run also
    // pins that recordDeliveredEmail's call is not somehow ordered after it.
    expect(updateRequestById).not.toHaveBeenCalled();

    const updatingLifecycleIndex = emitted.findIndex(
      (e) => e.event === 'progress' && e.data.stage === 'updating_lifecycle',
    );
    expect(updatingLifecycleIndex).toBeGreaterThanOrEqual(0);
    const updatingLifecycleOrder = onEvent.mock.invocationCallOrder[updatingLifecycleIndex];
    expect(updatingLifecycleOrder).toBeLessThan(recordOrder);
  });

  test('a recordDeliveredEmail rejection produces the existing updating_lifecycle warning event rather than failing the batch', async () => {
    recordDeliveredEmail.mockRejectedValueOnce(new Error('lifecycle boom'));

    const { emitted } = await run({ drafts: [draft(SUG_OK)], templateType: 'materials' });

    expect(emitted.some((e) => e.event === 'error')).toBe(false);
    const warning = emitted.find(
      (e) => e.event === 'progress' && e.data.stage === 'updating_lifecycle'
        && typeof e.data.message === 'string' && e.data.message.startsWith('Warning:'),
    );
    expect(warning).toBeDefined();
    expect(warning.data.message).toContain('lifecycle boom');
    expect(emitted.slice(-2).map((e) => e.event)).toEqual(['result', 'complete']);
    const r = emitted.find((e) => e.event === 'result').data;
    expect(r.stats).toMatchObject({ sent: 1, failed: 0 });
  });
});
