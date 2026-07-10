/**
 * @jest-environment node
 *
 * Route-level tests for /api/review-manager/send-emails send-path gates.
 *
 * Uses the REAL reviewer-invite gates (sendAllowsAttachments allowlist,
 * isKnownTemplateType, recipientMayReceiveAttachments,
 * shouldSkipDuplicateInvitation, emailConfidence) — those are the contract under test.
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
  if (entity === 'systemusers') return SYSTEMUSER;
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
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => {
  // getByIdWithSelect is a thin DynamicsService passthrough (data-access-layer
  // conversion, Stages 3-6) — forward through the ALSO-mocked getRecord above
  // so the existing suite (which stubs getRecord by entity set) keeps working.
  const { DynamicsService } = jest.requireMock('../../lib/services/dynamics-service');
  return {
    setContactLink: (...a) => mockSetContactLink(...a),
    getByIdWithSelect: (id, { select } = {}) =>
      DynamicsService.getRecord('wmkf_potentialreviewerses', id, { select }),
  };
});
jest.mock('../../lib/services/backprop-reviewer-orcid', () => ({ backPropReviewerOrcidToContact: jest.fn(async () => ({ action: 'noop' })) }));
// Reviewer quota (wmkf_desiredcount) seed: server-side admin default, read via this
// service. Default resolves { desiredCount: null } (no seed) unless a test overrides it.
const getReviewerCampaignTimeline = jest.fn(async () => ({ timeline: { desiredCount: null } }));
jest.mock('../../lib/services/reviewer-campaign-timeline', () => ({
  getReviewerCampaignTimeline: (...a) => getReviewerCampaignTimeline(...a),
}));
// Stage-aware secure-link button label: send-emails reads email.reviewer_<type>.button_label.
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(async (key) => {
    const labels = {
      'email.reviewer_invitation.button_label': 'Respond to Invitation',
      'email.reviewer_materials.button_label': 'Start Review',
      'email.reviewer_followup.button_label': 'Go to Review',
    };
    return key in labels ? { found: true, value: labels[key] } : { found: false, value: null };
  }),
}));
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

const { createMockReq, createMockRes } = require('../helpers/auth-mock');

// send-emails GUID-validates each draft.suggestionId before it becomes a
// findById record-id selector (S259 trust-boundary hardening), so suggestionId
// fixtures must be GUID-shaped or the route 400s before the lane logic runs.
// pr-1 / req-1 are server-derived (off the fetched suggestion), not client-supplied,
// so they need no GUID shape. These four cover the single-row + batch cases.
const SUG_1 = '11111111-1111-4111-8111-111111111111';
const SUG_MISSING = 'c3333333-3333-4333-8333-333333333333';

// Mutable fixtures (reset per test). SUGGESTIONS is a map so batch tests can return
// different rows / a missing row per suggestionId.
let SUGGESTIONS;
let PERSON;
let REQUEST;
let SYSTEMUSER;
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
  SUGGESTIONS = { [SUG_1]: baseSuggestion() };
  PERSON = basePerson();
  REQUEST = {
    akoya_requestid: 'req-1',
    akoya_requestnum: 'REQ-001',
    wmkf_meetingdate: '2026-07-01',
    _wmkf_programdirector_value: 'pd-1',
  };
  SYSTEMUSER = {
    fullname: 'Dr. Program Director',
    internalemailaddress: 'pd@wmkeck.org',
    isdisabled: false,
  };
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
// Body carries a secure-review link by default so invitation-templateType
// drafts clear the body-integrity gate (missing_secure_link / unresolved_placeholder)
// and exercise the real send path — tests of the gate itself override body.
const draft = (id = SUG_1) => ({ suggestionId: id, subject: 'S', body: 'B https://reviews.example.org/external/review/tok-1' });

describe('send-emails — reviewer portal HTML links', () => {
  test('refuses to send when the outgoing subject/body contains the internal request number', async () => {
    const res = await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'Review request REQ-001',
        body: 'Please review this proposal. https://reviews.example.org/external/review/tok-1',
      }],
      templateType: 'invitation',
    });

    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(resultOf(res).sent).toHaveLength(0);
    expect(resultOf(res).failed).toHaveLength(1);
    expect(events(res).find((e) => e.event === 'email_failed')?.data.error)
      .toBe('Email subject/body contains the internal request number.');
  });

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
    // Invitation stage → commit-appropriate label, not "Start Review".
    expect(htmlBodySent()).toContain('Respond to Invitation');
    expect(htmlBodySent()).not.toContain('Start Review');
    expect(htmlBodySent()).toContain(
      'This secure link is unique to you and was sent by W.M. Keck Foundation Program Director Dr. Program Director pd@wmkeck.org. Please contact them with any questions.'
    );
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
        body: 'Read more: https://example.org/info\nSecure link: https://reviews.example.org/external/review/tok-1',
      }],
      templateType: 'invitation',
    });

    expect(htmlBodySent()).toContain('<a href="https://example.org/info">https://example.org/info</a>');
    expect(htmlBodySent()).not.toContain('Start Review');
  });

  test('a thankyou body with an external-review URL renders a plain link, not a button', async () => {
    // thankyou has no configured label → resolver returns '' → button suppressed.
    // The URL must still render (as a plain link), never be dropped or shown as a CTA.
    await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'Thank you',
        body: 'Thanks! Your secure link if needed:\nhttps://reviews.wmkeck.org/external/review/token.value',
      }],
      templateType: 'thankyou',
    });

    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(htmlBodySent()).toContain('<a href="https://reviews.wmkeck.org/external/review/token.value">https://reviews.wmkeck.org/external/review/token.value</a>');
    expect(htmlBodySent()).not.toContain('<table role="presentation"');
    expect(htmlBodySent()).not.toContain('Start Review');
    expect(htmlBodySent()).not.toContain('Respond to Invitation');
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
      htmlBody: expect.stringContaining('Respond to Invitation'),
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

describe('send-emails — partial-success batch', () => {
  test('mixed batch: accepted materials sends, non-accepted skips, missing row fails', async () => {
    SUGGESTIONS = {
      [SUG_1]: baseSuggestion({ wmkf_appreviewersuggestionid: SUG_1, wmkf_accepted: true }),
      [SUG_MISSING]: undefined,
      // SUG_MISSING intentionally absent → findById returns null → failed
    };
    const freshId = 'b2222222-2222-4222-8222-222222222222';
    SUGGESTIONS[freshId] = baseSuggestion({ wmkf_appreviewersuggestionid: freshId, wmkf_accepted: false });
    const res = await run({
      drafts: [draft(SUG_1), draft(freshId), draft(SUG_MISSING)],
      templateType: 'materials',
    });
    const r = resultOf(res);
    expect(r.sent.map((s) => s.suggestionId)).toEqual([SUG_1]);
    expect(r.skipped.map((s) => ({ id: s.suggestionId, reason: s.reason }))).toEqual([{ id: freshId, reason: 'not_accepted' }]);
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

describe('send-emails — reviewer quota (wmkf_desiredcount) seed on first invite', () => {
  const CONFIG = { respondOffsetDays: 7, reviewDueDate: '2026-08-01' };
  const invite = (over = {}) => ({ drafts: [draft()], templateType: 'invitation', campaignConfig: CONFIG, ...over });

  test('unset wmkf_desiredcount + admin default 4 → writes wmkf_desiredcount 4 alongside the timing columns', async () => {
    getReviewerCampaignTimeline.mockResolvedValueOnce({ timeline: { desiredCount: 4 } });
    await run(invite());
    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(updateRecord).toHaveBeenCalledWith('akoya_requests', 'req-1',
      { wmkf_respondoffsetdays: 7, wmkf_reviewduedate: '2026-08-01', wmkf_desiredcount: 4 }, expect.any(Object));
  });

  test('already-set wmkf_desiredcount is never overwritten (sibling timing columns still seed)', async () => {
    getReviewerCampaignTimeline.mockResolvedValueOnce({ timeline: { desiredCount: 4 } });
    REQUEST = { ...REQUEST, wmkf_desiredcount: 2 };
    await run(invite());
    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(updateRecord).toHaveBeenCalledWith('akoya_requests', 'req-1',
      { wmkf_respondoffsetdays: 7, wmkf_reviewduedate: '2026-08-01' }, expect.any(Object));
  });

  test('request fetch $selects wmkf_desiredcount — the never-overwrite guard is blind without it', async () => {
    // Guards the select at send-emails-service.js ~L213: if the column is dropped from
    // the projection, reqRec.wmkf_desiredcount is undefined and the seed would clobber
    // a quota the PD already set via the campaign settings modal.
    getReviewerCampaignTimeline.mockResolvedValueOnce({ timeline: { desiredCount: 4 } });
    await run(invite());
    const reqFetch = getRecord.mock.calls.find(([entity, , opts]) => entity === 'akoya_requests' && opts?.select);
    expect(reqFetch?.[2]?.select).toContain('wmkf_desiredcount');
  });

  test('admin default null → no wmkf_desiredcount write (timing columns still seed)', async () => {
    getReviewerCampaignTimeline.mockResolvedValueOnce({ timeline: { desiredCount: null } });
    await run(invite());
    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(updateRecord).toHaveBeenCalledWith('akoya_requests', 'req-1',
      { wmkf_respondoffsetdays: 7, wmkf_reviewduedate: '2026-08-01' }, expect.any(Object));
  });

  test('timeline read throws → send still succeeds; quota seed is skipped, not the whole batch', async () => {
    getReviewerCampaignTimeline.mockRejectedValueOnce(new Error('settings read failed'));
    const res = await run(invite());
    expect(resultOf(res).stats).toMatchObject({ sent: 1 });
    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(updateRecord).toHaveBeenCalledWith('akoya_requests', 'req-1',
      { wmkf_respondoffsetdays: 7, wmkf_reviewduedate: '2026-08-01' }, expect.any(Object));
  });
});

describe('send-emails — fail-closed on unknown templateType', () => {
  for (const templateType of ['bogus', 'hold', 'finalize']) {
    test(`${templateType} errors before ANY work (no findById/getRecord/send/lifecycle)`, async () => {
      const res = await run({ drafts: [draft()], templateType });
      expect(events(res).some((e) => e.event === 'error' && /Unknown templateType/.test(e.data.message))).toBe(true);
      expect(findById).toHaveBeenCalledTimes(0);
      expect(getRecord).toHaveBeenCalledTimes(0);
      expect(createAndSendEmail).toHaveBeenCalledTimes(0);
      expect(updateLifecycle).toHaveBeenCalledTimes(0);
    });

    // Terminal-sequence pin (Stage 2b pre-extraction contract): every pre-loop
    // fail-closed guard (templateType here; drafts-shape/GUID guards below) emits
    // exactly ONE event and ends the stream WITHOUT ever reaching 'result' or
    // 'complete' — the SSE contract's error path is `error` -> stream end, full stop,
    // never `error` -> `complete` and never a second event.
    test(`${templateType} emits ONLY the error event — no result/complete, stream ends`, async () => {
      const res = await run({ drafts: [draft()], templateType });
      const seq = events(res).map((e) => e.event);
      expect(seq).toEqual(['error']);
      expect(res.end).toHaveBeenCalledTimes(1);
    });
  }
});

describe('send-emails — pre-loop fail-closed guards (SSE error terminal sequence)', () => {
  test('empty drafts array: single error event, no result/complete', async () => {
    const res = await run({ drafts: [], templateType: 'invitation' });
    const seq = events(res).map((e) => e.event);
    expect(seq).toEqual(['error']);
    expect(events(res)[0].data.message).toBe('drafts array is required');
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  test('missing required draft field: single error event, no result/complete', async () => {
    const res = await run({ drafts: [{ suggestionId: SUG_1, subject: 'S' }], templateType: 'invitation' });
    const seq = events(res).map((e) => e.event);
    expect(seq).toEqual(['error']);
    expect(events(res)[0].data.message).toMatch(/each draft must have suggestionId, subject, body/);
  });

  test('non-GUID suggestionId: single error event, findById never called', async () => {
    const res = await run({
      drafts: [{ suggestionId: 'not-a-guid', subject: 'S', body: 'B' }],
      templateType: 'invitation',
    });
    const seq = events(res).map((e) => e.event);
    expect(seq).toEqual(['error']);
    expect(events(res)[0].data.message).toMatch(/valid GUID/);
    expect(findById).toHaveBeenCalledTimes(0);
  });
});

describe('send-emails — invitation body-integrity gate (missing_secure_link / unresolved_placeholder)', () => {
  test('an invitation with no secure link is skipped missing_secure_link and never sent', async () => {
    const res = await run({
      drafts: [{ suggestionId: SUG_1, subject: 'S', body: 'No link here.' }],
      templateType: 'invitation',
    });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(resultOf(res).skipped[0]).toMatchObject({ suggestionId: SUG_1, reason: 'missing_secure_link' });
  });

  test('an invitation with an unresolved {{token}} is skipped unresolved_placeholder and never sent', async () => {
    const res = await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'S',
        body: 'Link: https://reviews.example.org/external/review/tok-1 Hi {{firstName}}',
      }],
      templateType: 'invitation',
    });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(resultOf(res).skipped[0]).toMatchObject({ suggestionId: SUG_1, reason: 'unresolved_placeholder' });
  });
});

describe('send-emails — pre-stream 4xx (before SSE headers are ever written)', () => {
  test('wrong method (GET) returns a plain 405 with Allow-less JSON body, never SSE', async () => {
    const req = createMockReq({ method: 'GET', query: {}, body: {} });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
    expect(res.write).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalledWith('Content-Type', 'text/event-stream');
  });
});

describe('send-emails — full SSE event vocabulary and ordering (Stage 2b pre-extraction contract)', () => {
  // Three-recipient batch exercising all three per-recipient terminal branches in
  // one run — success (email_sent), skip (no email → skipped, no email_failed/
  // email_sent), and a REAL send-time failure (email_failed via the try/catch
  // around createAndSendEmail, distinct from the missing-suggestion `failed` path
  // already pinned by the "partial-success batch" describe above).
  const SUG_SKIP = 'a4444444-4444-4444-8444-444444444444';
  const SUG_SENDFAIL = 'd5555555-5555-4555-8555-555555555555';

  test('event name sequence is exactly: progress(starting) -> progress(resolving_recipients) -> progress(fetching_attachments) -> progress(sending) -> per-recipient interleaved progress/email_sent/email_unconfirmed -> result -> complete', async () => {
    SUGGESTIONS = {
      [SUG_1]: baseSuggestion({ wmkf_appreviewersuggestionid: SUG_1 }),
      [SUG_SKIP]: baseSuggestion({ wmkf_appreviewersuggestionid: SUG_SKIP, _wmkf_potentialreviewer_value: 'pr-skip' }),
      [SUG_SENDFAIL]: baseSuggestion({ wmkf_appreviewersuggestionid: SUG_SENDFAIL, _wmkf_potentialreviewer_value: 'pr-fail' }),
    };
    // Per-suggestion person lookup: PERSON is a single fixture object keyed by the
    // shared getRecord mock (see top-of-file getRecord), which does not vary by id —
    // so drive the skip/fail branches through getRecord's entity dispatch instead by
    // overriding it for this test only.
    getRecord.mockImplementation(async (entity, id) => {
      if (entity === 'wmkf_potentialreviewerses') {
        if (id === 'pr-skip') return { wmkf_potentialreviewersid: 'pr-skip', wmkf_name: 'No Email', wmkf_emailaddress: null, wmkf_emailsource: 'orcid', wmkf_identitystatus: 'confirmed' };
        if (id === 'pr-fail') return { wmkf_potentialreviewersid: 'pr-fail', wmkf_name: 'Send Fails', wmkf_emailaddress: 'fail@example.org', wmkf_emailsource: 'orcid', wmkf_identitystatus: 'confirmed' };
        return PERSON;
      }
      if (entity === 'akoya_requests') return REQUEST;
      if (entity === 'systemusers') return SYSTEMUSER;
      return null;
    });
    createAndSendEmail.mockImplementation(async (payload) => {
      if (payload.to === 'fail@example.org') throw new Error('Dynamics transport error');
      return { emailId: 'email-1' };
    });

    const res = await run({
      drafts: [draft(SUG_1), draft(SUG_SKIP), draft(SUG_SENDFAIL)],
      templateType: 'invitation',
    });

    const seq = events(res).map((e) => e.event);

    // Fixed prefix.
    expect(seq.slice(0, 4)).toEqual(['progress', 'progress', 'progress', 'progress']);
    // Terminal suffix: result then complete, always in that order and always last.
    expect(seq.slice(-2)).toEqual(['result', 'complete']);
    // Per-recipient events present exactly once each, in emission order. A send-time
    // throw on an INVITATION lands in unconfirmed[] via email_unconfirmed, not failed[]
    // via email_failed — a blind retry could double-email a real external reviewer.
    expect(seq).toContain('email_sent');
    expect(seq).not.toContain('email_failed');
    expect(seq).toContain('email_unconfirmed');
    expect(seq.indexOf('email_sent')).toBeLessThan(seq.indexOf('result'));
    expect(seq.indexOf('email_unconfirmed')).toBeLessThan(seq.indexOf('result'));
    // Pure-invitation batch: the invitation lifecycle stamp runs INLINE in the send
    // loop, so the post-loop 'updating_lifecycle' pass never fires.
    const progressStages = events(res).filter((e) => e.event === 'progress').map((e) => e.data.stage);
    expect(progressStages.slice(0, 4)).toEqual(['starting', 'resolving_recipients', 'fetching_attachments', 'sending']);
    expect(progressStages).not.toContain('updating_lifecycle');

    const r = resultOf(res);
    expect(r.stats).toMatchObject({ sent: 1, failed: 0, unconfirmed: 1, skipped: 1, total: 3 });
    expect(r.sent.map((s) => s.suggestionId)).toEqual([SUG_1]);
    expect(r.failed).toEqual([]);
    expect(r.unconfirmed.map((f) => f.suggestionId)).toEqual([SUG_SENDFAIL]);
    expect(r.skipped.map((s) => s.suggestionId)).toEqual([SUG_SKIP]);
  });
});

describe('send-emails — lifecycle-after-send ordering (Stage 2b pre-extraction contract)', () => {
  test('the Dynamics send call happens BEFORE the lifecycle write for the same recipient', async () => {
    await run({ drafts: [draft()], templateType: 'invitation' });

    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(updateLifecycle).toHaveBeenCalledTimes(1);
    const sendOrder = createAndSendEmail.mock.invocationCallOrder[0];
    const lifecycleOrder = updateLifecycle.mock.invocationCallOrder[0];
    expect(sendOrder).toBeLessThan(lifecycleOrder);
  });

  test('a send-time failure never reaches the lifecycle write for that recipient (invitation → unconfirmed, not failed)', async () => {
    createAndSendEmail.mockImplementationOnce(async () => { throw new Error('boom'); });
    const res = await run({ drafts: [draft()], templateType: 'invitation' });

    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(resultOf(res).failed).toHaveLength(0);
    expect(resultOf(res).unconfirmed).toHaveLength(1);
    expect(resultOf(res).sent).toHaveLength(0);
  });

  test('a lifecycle-stamp failure after a successful invitation send: sent[] carries inviteRecorded: false, batch still completes', async () => {
    updateLifecycle.mockImplementationOnce(async () => { throw new Error('patch failed'); });
    const res = await run({ drafts: [draft()], templateType: 'invitation' });

    const seq = events(res).map((e) => e.event);
    expect(seq).not.toContain('error');
    expect(seq.slice(-2)).toEqual(['result', 'complete']);
    const r = resultOf(res);
    expect(r.stats.sent).toBe(1);
    expect(r.sent[0]).toMatchObject({ suggestionId: SUG_1, inviteRecorded: false });
  });
});

describe('send-emails — mid-stream failure sequence (real send-time exception, not a missing-row/skip failure)', () => {
  test('a send-time exception for one invitation recipient in a multi-recipient batch: email_unconfirmed fires (not email_failed), batch continues, terminal sequence is still result -> complete (never error)', async () => {
    const freshId = 'e6666666-6666-4666-8666-666666666666';
    SUGGESTIONS = {
      [SUG_1]: baseSuggestion({ wmkf_appreviewersuggestionid: SUG_1 }),
      [freshId]: baseSuggestion({ wmkf_appreviewersuggestionid: freshId }),
    };
    let call = 0;
    createAndSendEmail.mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error('transient Dynamics failure');
      return { emailId: 'email-2' };
    });

    const res = await run({ drafts: [draft(SUG_1), draft(freshId)], templateType: 'invitation' });
    const seq = events(res).map((e) => e.event);

    expect(seq).not.toContain('error');
    expect(seq).not.toContain('email_failed');
    expect(seq.slice(-2)).toEqual(['result', 'complete']);
    const r = resultOf(res);
    expect(r.stats).toMatchObject({ sent: 1, failed: 0, unconfirmed: 1, total: 2 });
    expect(events(res).find((e) => e.event === 'email_unconfirmed').data.error).toBe('transient Dynamics failure');
  });

  test('a send-time exception for a non-invitation recipient still fires email_failed (unchanged)', async () => {
    CYCLE_CODE = null;
    CYCLE_CONFIG = null;
    SUGGESTIONS = { [SUG_1]: baseSuggestion({ wmkf_appreviewersuggestionid: SUG_1, wmkf_accepted: true }) };
    createAndSendEmail.mockImplementationOnce(async () => { throw new Error('transient Dynamics failure'); });

    const res = await run({ drafts: [draft(SUG_1)], templateType: 'materials' });
    const seq = events(res).map((e) => e.event);

    expect(seq).not.toContain('email_unconfirmed');
    expect(seq).toContain('email_failed');
    const r = resultOf(res);
    expect(r.stats).toMatchObject({ sent: 0, failed: 1, unconfirmed: 0 });
  });
});
