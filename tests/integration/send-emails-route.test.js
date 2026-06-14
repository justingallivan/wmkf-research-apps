/**
 * @jest-environment node
 *
 * Route-level tests for /api/review-manager/send-emails — the reviewer "hold step"
 * calendar lane + send-path gates (chunks 5/6, carried from their Codex reviews).
 *
 * Uses the REAL reviewer-invite gates (sendAllowsAttachments allowlist,
 * templateCarriesCalendarInvite, mayReceiveFinalize, isKnownTemplateType,
 * recipientMayReceiveAttachments, confidence) — those are the contract under test.
 * calendar-invite is mocked so we can force the .ics throw (its CONTENT is unit-tested
 * in calendar-invite.test.js); here we test the lane WIRING + degrade.
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({
    session: { user: { azureEmail: 'staff@wmkf.org', dynamicsSystemuserId: 'u-1' } },
  })),
}));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => async () => true,
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

const createAndSendEmail = jest.fn(async () => ({ emailId: 'email-1' }));
const getRecord = jest.fn(async (entity) => {
  if (entity === 'wmkf_potentialreviewerses') return PERSON;
  if (entity === 'akoya_requests') return REQUEST;
  return null;
});
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    createAndSendEmail: (...a) => createAndSendEmail(...a),
    getRecord: (...a) => getRecord(...a),
  },
}));

const findById = jest.fn(async () => SUGGESTION);
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
}));
jest.mock('../../lib/dataverse/adapters/contact', () => ({ findOrCreateByEmail: jest.fn(async () => ({ id: 'c-1', created: false })) }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({ setContactLink: jest.fn(async () => {}) }));
jest.mock('../../lib/services/backprop-reviewer-orcid', () => ({ backPropReviewerOrcidToContact: jest.fn(async () => ({ action: 'noop' })) }));
jest.mock('../../lib/services/grant-cycles-dataverse', () => ({ findByShortCode: jest.fn(async () => null) }));
jest.mock('../../lib/utils/cycle-code', () => ({ meetingDateToCycleCode: jest.fn(() => null) }));
jest.mock('../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn(), isAllowedUrl: jest.fn(() => false) }));
jest.mock('../../lib/utils/uploaded-blob', () => ({ readUploadedBlobBuffer: jest.fn() }));
jest.mock('../../lib/utils/cycle-material-ref', () => ({ isPrivateCycleMaterialPathname: jest.fn(() => false) }));

const buildReviewHoldIcs = jest.fn(() => ({ filename: 'keck-review-hold.ics', contentType: 'text/calendar', content: Buffer.from('ICS') }));
jest.mock('../../lib/external/calendar-invite', () => ({ buildReviewHoldIcs: (...a) => buildReviewHoldIcs(...a) }));

const { createMockReq, createMockRes } = require('../helpers/auth-mock');

// Mutable fixtures (reassigned per test before invoking the handler).
let SUGGESTION;
let PERSON;
let REQUEST;

function baseSuggestion(over = {}) {
  return {
    wmkf_appreviewersuggestionid: 'sug-1',
    _wmkf_potentialreviewer_value: 'pr-1',
    _wmkf_request_value: 'req-1',
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_invited: false,
    wmkf_responsetype: null,
    wmkf_reviewstatus: null,
    wmkf_honorariumoptout: false,
    ...over,
  };
}
function basePerson(over = {}) {
  return {
    wmkf_potentialreviewersid: 'pr-1',
    wmkf_name: 'Dr. Reviewer',
    wmkf_emailaddress: 'rev@example.org',
    _wmkf_contact_value: 'c-1', // set → skip contact promotion
    wmkf_emailsource: 'orcid', // HIGH confidence (not first-contact-gated)
    wmkf_identitystatus: 'confirmed',
    ...over,
  };
}

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/send-emails')).default;
});
beforeEach(() => {
  jest.clearAllMocks();
  SUGGESTION = baseSuggestion();
  PERSON = basePerson();
  REQUEST = { akoya_requestid: 'req-1', akoya_requestnum: 'REQ-001', wmkf_meetingdate: '2026-07-01' };
});

// Parse the SSE writes into {event, data} pairs.
function events(res) {
  const raw = res.write.mock.calls.map((c) => c[0]).join('');
  const out = [];
  for (const block of raw.split('\n\n')) {
    const ev = block.match(/event: (.+)/);
    const dt = block.match(/data: (.+)/);
    if (ev && dt) out.push({ event: ev[1], data: JSON.parse(dt[1]) });
  }
  return out;
}
function resultOf(res) {
  return events(res).find((e) => e.event === 'result')?.data;
}
async function run(body) {
  const req = createMockReq({ method: 'POST', query: {}, body });
  const res = createMockRes();
  await handler(req, res);
  return res;
}

describe('send-emails — hold calendar lane', () => {
  test('hold send attaches the .ics and NO proposal materials', async () => {
    const res = await run({ drafts: [{ suggestionId: 'sug-1', subject: 'S', body: 'B' }], templateType: 'hold' });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    const att = createAndSendEmail.mock.calls[0][0].attachments;
    expect(att).toHaveLength(1);
    expect(att[0].filename).toBe('keck-review-hold.ics');
    expect(resultOf(res).stats.sent).toBe(1);
  });

  test('a thrown .ics build degrades — the email still sends and the recipient is counted sent', async () => {
    buildReviewHoldIcs.mockImplementationOnce(() => { throw new Error('boom'); });
    const res = await run({ drafts: [{ suggestionId: 'sug-1', subject: 'S', body: 'B' }], templateType: 'hold' });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(createAndSendEmail.mock.calls[0][0].attachments).toHaveLength(0); // degraded: no .ics
    const r = resultOf(res).stats;
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(0);
  });
});

describe('send-emails — finalize held-eligibility gate', () => {
  test('finalize to a NON-held row is skipped not_held (no send)', async () => {
    SUGGESTION = baseSuggestion({ wmkf_responsetype: null });
    const res = await run({ drafts: [{ suggestionId: 'sug-1', subject: 'S', body: 'B' }], templateType: 'finalize' });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    const r = resultOf(res).stats;
    expect(r.skipped).toBe(1);
    const skipReason = resultOf(res).skipped[0].reason;
    expect(skipReason).toBe('not_held');
  });

  test('finalize to a HELD row sends', async () => {
    SUGGESTION = baseSuggestion({ wmkf_responsetype: 100000004 }); // held
    const res = await run({ drafts: [{ suggestionId: 'sug-1', subject: 'S', body: 'B' }], templateType: 'finalize' });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    // finalize is post-engagement → carries no .ics and no materials.
    expect(createAndSendEmail.mock.calls[0][0].attachments).toHaveLength(0);
    expect(resultOf(res).stats.sent).toBe(1);
  });
});

describe('send-emails — fail-closed on unknown templateType', () => {
  test('unknown templateType errors before any send', async () => {
    const res = await run({ drafts: [{ suggestionId: 'sug-1', subject: 'S', body: 'B' }], templateType: 'bogus' });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(events(res).some((e) => e.event === 'error' && /Unknown templateType/.test(e.data.message))).toBe(true);
  });
});
