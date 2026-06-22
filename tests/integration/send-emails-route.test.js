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
    session: { user: { azureEmail: 'staff@wmkeck.org', dynamicsSystemuserId: 'u-1' } },
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
const updateRecord = jest.fn(async () => {});
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    createAndSendEmail: (...a) => createAndSendEmail(...a),
    getRecord: (...a) => getRecord(...a),
    updateRecord: (...a) => updateRecord(...a),
  },
}));

const findById = jest.fn(async (id) => SUGGESTIONS[id] ?? null);
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
}));
const mockFindOrCreateByEmail = jest.fn(async () => ({ id: 'c-1', created: false }));
const mockSetContactLink = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/contact', () => ({ findOrCreateByEmail: (...a) => mockFindOrCreateByEmail(...a) }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({ setContactLink: (...a) => mockSetContactLink(...a) }));
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

// send-emails GUID-validates each draft.suggestionId before it becomes a
// findById record-id selector (S259 trust-boundary hardening), so suggestionId
// fixtures must be GUID-shaped or the route 400s before the lane logic runs.
// pr-1 / req-1 are server-derived (off the fetched suggestion), not client-supplied,
// so they need no GUID shape. These four cover the single-row + batch cases.
const SUG_1 = '11111111-1111-4111-8111-111111111111';
const SUG_HELD = 'a1111111-1111-4111-8111-111111111111';
const SUG_FRESH = 'b2222222-2222-4222-8222-222222222222';
const SUG_MISSING = 'c3333333-3333-4333-8333-333333333333';

// Mutable fixtures (reset per test). SUGGESTIONS is a map so batch tests can return
// different rows / a missing row per suggestionId.
let SUGGESTIONS;
let PERSON;
let REQUEST;
let CYCLE_CODE;     // meetingDateToCycleCode() → this
let CYCLE_CONFIG;   // findByShortCode() → this (cycle materials live here)
let ORIGINAL_REVIEWER_EMAIL_DELIVERY_MODE;
let ORIGINAL_VERCEL_ENV;

function baseSuggestion(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG_1,
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
  ORIGINAL_REVIEWER_EMAIL_DELIVERY_MODE = process.env.REVIEWER_EMAIL_DELIVERY_MODE;
  ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;
  handler = (await import('../../pages/api/review-manager/send-emails')).default;
});
beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks does NOT drain a queued mockImplementationOnce — reset + reinstate
  // the default so the degrade test's one-shot throw can't leak to a later test.
  buildReviewHoldIcs.mockReset();
  buildReviewHoldIcs.mockImplementation(() => ICS);
  SUGGESTIONS = { [SUG_1]: baseSuggestion() };
  PERSON = basePerson();
  REQUEST = { akoya_requestid: 'req-1', akoya_requestnum: 'REQ-001', wmkf_meetingdate: '2026-07-01' };
  CYCLE_CODE = null;       // default: no cycle / no materials
  CYCLE_CONFIG = null;
  if (ORIGINAL_REVIEWER_EMAIL_DELIVERY_MODE === undefined) delete process.env.REVIEWER_EMAIL_DELIVERY_MODE;
  else process.env.REVIEWER_EMAIL_DELIVERY_MODE = ORIGINAL_REVIEWER_EMAIL_DELIVERY_MODE;
  if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
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
const htmlBodySent = () => createAndSendEmail.mock.calls[0][0].body;

async function run(body) {
  const req = createMockReq({ method: 'POST', query: {}, body });
  const res = createMockRes();
  await handler(req, res);
  return res;
}
const draft = (id = SUG_1) => ({ suggestionId: id, subject: 'S', body: 'B' });

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
    // Phase 3: first contact also clears the respond-by reminder marker (new offer window).
    expect(lc).toEqual({ invited: true, emailSentAt: expect.any(String), respondReminderSentAt: null });
    expect(lc).not.toHaveProperty('reviewStatus');
    expect(lc).not.toHaveProperty('responseType');
  });

  test('a thrown .ics build degrades — email still sends, recipient in sent[], attachments []', async () => {
    buildReviewHoldIcs.mockImplementationOnce(() => { throw new Error('boom'); });
    const res = await run({ drafts: [draft()], templateType: 'hold' });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(attachmentsSent()).toEqual([]); // degraded: no .ics, no materials
    const r = resultOf(res);
    expect(r.sent.map((s) => s.suggestionId)).toEqual([SUG_1]);
    expect(r.failed).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.stats).toMatchObject({ sent: 1, failed: 0, skipped: 0, total: 1 });
  });

  test('hold to an ALREADY-INVITED row is skipped already_invited (no send)', async () => {
    SUGGESTIONS = { [SUG_1]: baseSuggestion({ wmkf_invited: true }) };
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
    const res = await run({ drafts: [draft()], templateType: 'hold', confirmedLowConfidenceIds: [SUG_1] });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(resultOf(res).stats.sent).toBe(1);
  });
});

describe('send-emails — reviewer portal HTML links', () => {
  test('external reviewer URLs render as a button with a fallback link', async () => {
    await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'S',
        body: 'Please use your secure personal link:\nhttps://reviews.wmkeck.org/external/review/token.value\n\nThank you',
      }],
      templateType: 'invitation',
    });

    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(htmlBodySent()).toContain('Start Review');
    expect(htmlBodySent()).toContain('This secure link is unique to you');
    expect(htmlBodySent()).toContain('https://reviews.wmkeck.org/external/review/token.value');
    expect(htmlBodySent()).toContain('<table role="presentation"');
    expect(htmlBodySent()).toContain('<td align="center" valign="middle"');
    expect(htmlBodySent()).toContain('line-height:20px');
    expect(htmlBodySent()).toContain('text-align:center');
    expect(htmlBodySent()).not.toContain('<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;"><br>');
  });

  test('excess blank lines before the reviewer portal call-to-action are collapsed', async () => {
    await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'S',
        body: [
          '--',
          'Justin Gallivan',
          'Senior Program Director',
          'W.M. Keck Foundation',
          'Los Angeles',
          '',
          '',
          '',
          'Please use your secure personal link to accept or decline this invitation:',
          'https://reviews.wmkeck.org/external/review/token.value',
        ].join('\n'),
      }],
      templateType: 'invitation',
    });

    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(htmlBodySent()).toContain('Los Angeles<br><br>Please use your secure personal link');
    expect(htmlBodySent()).not.toContain('Los Angeles<br><br><br>Please use your secure personal link');
  });

  test('ordinary URLs still render as plain links', async () => {
    await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'S',
        body: 'Read more: https://example.org/info',
      }],
      templateType: 'invitation',
    });

    expect(htmlBodySent()).toContain('<a href="https://example.org/info">https://example.org/info</a>');
    expect(htmlBodySent()).not.toContain('Start Review');
  });
});

describe('send-emails — capture delivery mode', () => {
  test('capture mode returns the rendered email artifact without calling Dynamics send', async () => {
    process.env.REVIEWER_EMAIL_DELIVERY_MODE = 'capture';
    delete process.env.VERCEL_ENV;
    PERSON = basePerson({ _wmkf_contact_value: null });

    const res = await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'Invitation',
        body: 'Please use your secure personal link:\nhttps://reviews.wmkeck.org/external/review/token.value',
      }],
      templateType: 'invitation',
    });

    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(mockFindOrCreateByEmail).not.toHaveBeenCalled();
    expect(mockSetContactLink).not.toHaveBeenCalled();
    expect(updateLifecycle).toHaveBeenCalledWith(
      SUG_1,
      { invited: true, emailSentAt: expect.any(String), respondReminderSentAt: null },
      { actingUserSystemId: 'u-1' },
    );

    const r = resultOf(res);
    expect(r.stats.sent).toBe(1);
    expect(r.sent[0]).toMatchObject({
      suggestionId: SUG_1,
      deliveryMode: 'capture',
      emailId: `captured-${SUG_1}`,
      contactPromoted: 'skipped_capture',
      orcidBackprop: 'skipped_capture',
    });
    expect(r.sent[0].capturedEmail).toMatchObject({
      subject: 'Invitation',
      from: 'staff@wmkeck.org',
      to: 'rev@example.org',
      htmlBody: expect.stringContaining('Start Review'),
    });
    expect(r.sent[0].capturedEmail.htmlBody).toContain('https://reviews.wmkeck.org/external/review/token.value');
  });

  test('capture mode is refused in Vercel production before send or lifecycle writes', async () => {
    process.env.REVIEWER_EMAIL_DELIVERY_MODE = 'capture';
    process.env.VERCEL_ENV = 'production';

    const res = await run({ drafts: [draft()], templateType: 'invitation' });

    expect(events(res).some((e) => e.event === 'error' && /not allowed in Vercel production/.test(e.data.message))).toBe(true);
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
  });
});

describe('send-emails — materials strip gate (recipientMayReceiveAttachments, end-to-end)', () => {
  beforeEach(() => { CYCLE_CODE = 'CYC'; CYCLE_CONFIG = MATERIALS_CYCLE; });

  test('materials send to an ACCEPTED reviewer carries the proposal material', async () => {
    SUGGESTIONS = { [SUG_1]: baseSuggestion({ wmkf_accepted: true }) };
    await run({ drafts: [draft()], templateType: 'materials' });
    expect(filenamesSent()).toContain('proposal.pdf');
  });

  test('materials send to a NON-accepted reviewer is SKIPPED not_accepted (Release accepted-only gate, §3.A)', async () => {
    // Reviewer-engagement Phase 2: the materials EMAIL itself is now refused for a
    // non-accepted reviewer (not merely stripped of attachments) — so they can never
    // receive materials nor get upgraded to the long-lived materials token.
    SUGGESTIONS = { [SUG_1]: baseSuggestion({ wmkf_accepted: false }) };
    const res = await run({ drafts: [draft()], templateType: 'materials' });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(resultOf(res).skipped[0].reason).toBe('not_accepted');
  });
});

describe('send-emails — finalize held-eligibility gate', () => {
  test('finalize to a NON-held row is skipped not_held (no send, no lifecycle write)', async () => {
    SUGGESTIONS = { [SUG_1]: baseSuggestion({ wmkf_responsetype: null }) };
    const res = await run({ drafts: [draft()], templateType: 'finalize' });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(resultOf(res).skipped[0].reason).toBe('not_held');
  });

  test('finalize to a HELD row sends, carries no .ics/materials, stamps emailSentAt only', async () => {
    SUGGESTIONS = { [SUG_1]: baseSuggestion({ wmkf_responsetype: 100000004 }) };
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
      [SUG_HELD]: baseSuggestion({ wmkf_appreviewersuggestionid: SUG_HELD, wmkf_responsetype: 100000004 }),
      [SUG_FRESH]: baseSuggestion({ wmkf_appreviewersuggestionid: SUG_FRESH, wmkf_responsetype: null }),
      // SUG_MISSING intentionally absent → findById returns null → failed
    };
    const res = await run({
      drafts: [draft(SUG_HELD), draft(SUG_FRESH), draft(SUG_MISSING)],
      templateType: 'finalize',
    });
    const r = resultOf(res);
    expect(r.sent.map((s) => s.suggestionId)).toEqual([SUG_HELD]);
    expect(r.skipped.map((s) => ({ id: s.suggestionId, reason: s.reason }))).toEqual([{ id: SUG_FRESH, reason: 'not_held' }]);
    expect(r.failed.map((f) => f.suggestionId)).toEqual([SUG_MISSING]);
    expect(r.stats).toMatchObject({ sent: 1, skipped: 1, failed: 1, total: 3 });
  });
});

describe('send-emails — Phase 1 campaign-config persistence (first invite)', () => {
  const CONFIG = { respondOffsetDays: 7, reviewDueDate: '2026-08-01' };
  const invite = (over = {}) => ({ drafts: [draft()], templateType: 'invitation', campaignConfig: CONFIG, ...over });

  test('first invite with no existing config writes BOTH columns once', async () => {
    const res = await run(invite());
    expect(resultOf(res).stats).toMatchObject({ sent: 1 });
    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(updateRecord).toHaveBeenCalledWith('akoya_requests', 'req-1',
      { wmkf_respondoffsetdays: 7, wmkf_reviewduedate: '2026-08-01' }, expect.any(Object));
  });

  test('pre-set offset is NOT clobbered; only the unset due date is written', async () => {
    REQUEST = { ...REQUEST, wmkf_respondoffsetdays: 5 }; // due date still unset
    await run(invite());
    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(updateRecord).toHaveBeenCalledWith('akoya_requests', 'req-1',
      { wmkf_reviewduedate: '2026-08-01' }, expect.any(Object));
  });

  test('pre-set due date is NOT clobbered; only the unset offset is written (Codex finding #1a)', async () => {
    REQUEST = { ...REQUEST, wmkf_reviewduedate: '2026-09-09' };
    await run(invite());
    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(updateRecord).toHaveBeenCalledWith('akoya_requests', 'req-1',
      { wmkf_respondoffsetdays: 7 }, expect.any(Object));
  });

  test('fully configured request → no write at all', async () => {
    REQUEST = { ...REQUEST, wmkf_respondoffsetdays: 5, wmkf_reviewduedate: '2026-09-09' };
    await run(invite());
    expect(updateRecord).not.toHaveBeenCalled();
  });

  test('Re-invite (allowResend) sends but never writes request config (Codex finding #2)', async () => {
    SUGGESTIONS = { [SUG_1]: baseSuggestion({ wmkf_invited: true }) };
    const res = await run(invite({ allowResend: true }));
    expect(resultOf(res).stats).toMatchObject({ sent: 1 });
    expect(updateRecord).not.toHaveBeenCalled();
  });

  test('no campaignConfig → no write (backwards-compatible)', async () => {
    await run({ drafts: [draft()], templateType: 'invitation' });
    expect(updateRecord).not.toHaveBeenCalled();
  });

  test('non-invitation templateType never writes config', async () => {
    await run({ drafts: [draft()], templateType: 'followup', campaignConfig: CONFIG });
    expect(updateRecord).not.toHaveBeenCalled();
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
