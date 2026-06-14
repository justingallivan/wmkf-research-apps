/**
 * @jest-environment node
 *
 * Route-level tests for /api/review-manager/send-emails — the reviewer "hold step"
 * calendar lane + send-path gates (chunks 5/6, carried from their Codex reviews).
 *
 * Uses the REAL reviewer-invite gates (sendAllowsAttachments allowlist,
 * templateCarriesCalendarInvite, mayReceiveFinalize, isKnownTemplateType,
 * recipientMayReceiveAttachments, shouldSkipDuplicateInvitation, emailConfidence) —
 * those are the contract under test. calendar-invite is mocked so we can force the
 * .ics throw (its CONTENT is unit-tested in calendar-invite.test.js); here we test
 * the lane WIRING + the strip/skip/degrade gates end-to-end through the handler.
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

const findById = jest.fn(async (id) => SUGGESTIONS[id] ?? null);
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
}));
jest.mock('../../lib/dataverse/adapters/contact', () => ({ findOrCreateByEmail: jest.fn(async () => ({ id: 'c-1', created: false })) }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({ setContactLink: jest.fn(async () => {}) }));
jest.mock('../../lib/services/backprop-reviewer-orcid', () => ({ backPropReviewerOrcidToContact: jest.fn(async () => ({ action: 'noop' })) }));
jest.mock('../../lib/services/grant-cycles-dataverse', () => ({ findByShortCode: jest.fn(async () => CYCLE_CONFIG) }));
jest.mock('../../lib/utils/cycle-code', () => ({ meetingDateToCycleCode: jest.fn(() => CYCLE_CODE) }));
jest.mock('../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn(), isAllowedUrl: jest.fn(() => false) }));
// Private cycle-materials path: a 'cycle-materials/…' pathname is read from the blob
// store, producing a real material attachment — this is how the materials tests below
// populate sharedAttachments so the strip gate is actually exercised.
jest.mock('../../lib/utils/uploaded-blob', () => ({ readUploadedBlobBuffer: jest.fn(async () => Buffer.from('PDF-BYTES')) }));
jest.mock('../../lib/utils/cycle-material-ref', () => ({
  isPrivateCycleMaterialPathname: (p) => typeof p === 'string' && p.startsWith('cycle-materials/'),
}));

const ICS = { filename: 'keck-review-hold.ics', contentType: 'text/calendar', content: Buffer.from('ICS') };
const buildReviewHoldIcs = jest.fn(() => ICS);
jest.mock('../../lib/external/calendar-invite', () => ({ buildReviewHoldIcs: (...a) => buildReviewHoldIcs(...a) }));

const { createMockReq, createMockRes } = require('../helpers/auth-mock');

// Mutable fixtures (reset per test). SUGGESTIONS is a map so batch tests can return
// different rows / a missing row per suggestionId.
let SUGGESTIONS;
let PERSON;
let REQUEST;
let CYCLE_CODE;     // meetingDateToCycleCode() → this
let CYCLE_CONFIG;   // findByShortCode() → this (cycle materials live here)

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
    wmkf_emailsource: 'orcid',  // HIGH confidence (not first-contact-gated)
    wmkf_identitystatus: 'confirmed',
    ...over,
  };
}
// A cycle config carrying one private proposal-material attachment.
const MATERIALS_CYCLE = {
  shortCode: 'CYC',
  additionalAttachments: [{ pathname: 'cycle-materials/proposal.pdf', filename: 'proposal.pdf' }],
};

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/send-emails')).default;
});
beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks does NOT drain a queued mockImplementationOnce — reset + reinstate
  // the default so the degrade test's one-shot throw can't leak to a later test.
  buildReviewHoldIcs.mockReset();
  buildReviewHoldIcs.mockImplementation(() => ICS);
  SUGGESTIONS = { 'sug-1': baseSuggestion() };
  PERSON = basePerson();
  REQUEST = { akoya_requestid: 'req-1', akoya_requestnum: 'REQ-001', wmkf_meetingdate: '2026-07-01' };
  CYCLE_CODE = null;       // default: no cycle / no materials
  CYCLE_CONFIG = null;
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
const resultOf = (res) => events(res).find((e) => e.event === 'result')?.data;
const attachmentsSent = () => createAndSendEmail.mock.calls[0][0].attachments;
const filenamesSent = () => attachmentsSent().map((a) => a.filename);

async function run(body) {
  const req = createMockReq({ method: 'POST', query: {}, body });
  const res = createMockRes();
  await handler(req, res);
  return res;
}
const draft = (id = 'sug-1') => ({ suggestionId: id, subject: 'S', body: 'B' });

describe('send-emails — hold calendar lane', () => {
  test('hold attaches ONLY the .ics — proposal materials are excluded even when the cycle HAS them', async () => {
    // Materials-capable cycle + a non-accepted hold recipient: proves the hold path
    // excludes materials (allowAttachments('hold')=false), not just that none existed.
    CYCLE_CODE = 'CYC';
    CYCLE_CONFIG = MATERIALS_CYCLE;
    const res = await run({ drafts: [draft()], templateType: 'hold' });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(filenamesSent()).toEqual(['keck-review-hold.ics']); // .ics only, no proposal.pdf
    const r = resultOf(res);
    expect(r.stats.sent).toBe(1);
    // Lifecycle: first contact → invited + emailSentAt, and NOT reviewstatus/responsetype.
    expect(updateLifecycle).toHaveBeenCalledTimes(1);
    const lc = updateLifecycle.mock.calls[0][1];
    expect(lc).toEqual({ invited: true, emailSentAt: expect.any(String) });
    expect(lc).not.toHaveProperty('reviewStatus');
    expect(lc).not.toHaveProperty('responseType');
  });

  test('a thrown .ics build degrades — email still sends, recipient in sent[], attachments []', async () => {
    buildReviewHoldIcs.mockImplementationOnce(() => { throw new Error('boom'); });
    const res = await run({ drafts: [draft()], templateType: 'hold' });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(attachmentsSent()).toEqual([]); // degraded: no .ics, no materials
    const r = resultOf(res);
    expect(r.sent.map((s) => s.suggestionId)).toEqual(['sug-1']);
    expect(r.failed).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.stats).toMatchObject({ sent: 1, failed: 0, skipped: 0, total: 1 });
  });

  test('hold to an ALREADY-INVITED row is skipped already_invited (no send)', async () => {
    SUGGESTIONS = { 'sug-1': baseSuggestion({ wmkf_invited: true }) };
    const res = await run({ drafts: [draft()], templateType: 'hold' });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
    const r = resultOf(res);
    expect(r.skipped[0].reason).toBe('already_invited');
    expect(r.sent).toEqual([]);
  });

  test('hold to a LOW-confidence address is refused email_unconfirmed (first-contact gate covers hold)', async () => {
    PERSON = basePerson({ wmkf_emailsource: 'manual', wmkf_identitystatus: '' }); // LOW
    const res = await run({ drafts: [draft()], templateType: 'hold' });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(resultOf(res).skipped[0].reason).toBe('email_unconfirmed');
  });

  test('hold to a LOW-confidence address PROCEEDS when staff confirmed that recipient', async () => {
    PERSON = basePerson({ wmkf_emailsource: 'manual', wmkf_identitystatus: '' }); // LOW
    const res = await run({ drafts: [draft()], templateType: 'hold', confirmedLowConfidenceIds: ['sug-1'] });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(resultOf(res).stats.sent).toBe(1);
  });
});

describe('send-emails — materials strip gate (recipientMayReceiveAttachments, end-to-end)', () => {
  beforeEach(() => { CYCLE_CODE = 'CYC'; CYCLE_CONFIG = MATERIALS_CYCLE; });

  test('materials send to an ACCEPTED reviewer carries the proposal material', async () => {
    SUGGESTIONS = { 'sug-1': baseSuggestion({ wmkf_accepted: true }) };
    await run({ drafts: [draft()], templateType: 'materials' });
    expect(filenamesSent()).toContain('proposal.pdf');
  });

  test('materials send to a NON-accepted reviewer is STRIPPED (no materials leak)', async () => {
    SUGGESTIONS = { 'sug-1': baseSuggestion({ wmkf_accepted: false }) };
    await run({ drafts: [draft()], templateType: 'materials' });
    expect(attachmentsSent()).toEqual([]); // materials existed but were stripped
  });
});

describe('send-emails — finalize held-eligibility gate', () => {
  test('finalize to a NON-held row is skipped not_held (no send, no lifecycle write)', async () => {
    SUGGESTIONS = { 'sug-1': baseSuggestion({ wmkf_responsetype: null }) };
    const res = await run({ drafts: [draft()], templateType: 'finalize' });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(resultOf(res).skipped[0].reason).toBe('not_held');
  });

  test('finalize to a HELD row sends, carries no .ics/materials, stamps emailSentAt only', async () => {
    SUGGESTIONS = { 'sug-1': baseSuggestion({ wmkf_responsetype: 100000004 }) };
    const res = await run({ drafts: [draft()], templateType: 'finalize' });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(attachmentsSent()).toEqual([]);
    expect(resultOf(res).stats.sent).toBe(1);
    expect(updateLifecycle.mock.calls[0][1]).toEqual({ emailSentAt: expect.any(String) });
  });
});

describe('send-emails — partial-success batch', () => {
  test('mixed batch: held finalize sends, non-held skips not_held, missing row fails', async () => {
    SUGGESTIONS = {
      'sug-held': baseSuggestion({ wmkf_appreviewersuggestionid: 'sug-held', wmkf_responsetype: 100000004 }),
      'sug-fresh': baseSuggestion({ wmkf_appreviewersuggestionid: 'sug-fresh', wmkf_responsetype: null }),
      // 'sug-missing' intentionally absent → findById returns null → failed
    };
    const res = await run({
      drafts: [draft('sug-held'), draft('sug-fresh'), draft('sug-missing')],
      templateType: 'finalize',
    });
    const r = resultOf(res);
    expect(r.sent.map((s) => s.suggestionId)).toEqual(['sug-held']);
    expect(r.skipped.map((s) => ({ id: s.suggestionId, reason: s.reason }))).toEqual([{ id: 'sug-fresh', reason: 'not_held' }]);
    expect(r.failed.map((f) => f.suggestionId)).toEqual(['sug-missing']);
    expect(r.stats).toMatchObject({ sent: 1, skipped: 1, failed: 1, total: 3 });
  });
});

describe('send-emails — fail-closed on unknown templateType', () => {
  test('unknown templateType errors before ANY work (no findById/getRecord/send/lifecycle)', async () => {
    const res = await run({ drafts: [draft()], templateType: 'bogus' });
    expect(events(res).some((e) => e.event === 'error' && /Unknown templateType/.test(e.data.message))).toBe(true);
    expect(findById).toHaveBeenCalledTimes(0);
    expect(getRecord).toHaveBeenCalledTimes(0);
    expect(createAndSendEmail).toHaveBeenCalledTimes(0);
    expect(updateLifecycle).toHaveBeenCalledTimes(0);
  });
});
