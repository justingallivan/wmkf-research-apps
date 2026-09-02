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
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: jest.fn(async () => ({})),
}));
const { authorizeReviewerRequestMutation } = require('../../lib/services/reviewer-request-authorization');
const { ServiceHttpError } = require('../../lib/services/service-http-error');

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
  REVIEW_STATUS_MAP: { accepted: 100000000, materials_sent: 100000001, under_review: 100000002 },
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
// Stage-aware single-button labels for post-invitation templates. Invitations use
// fixed paired response labels regardless of a legacy stored invitation setting.
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
// S404 Plan v4 send-time token authority gate. This route-integration file
// exercises many pre-existing send-path contracts unrelated to the gate, so
// rather than hand-crafting a real JWT per test, the mock decodes the
// suggestionId/requestId straight out of the fake token text (see `TOKEN_FOR`
// below) — every existing draft already embeds its own real suggestionId and
// this file's REQUEST is always `req-1`, so the gate passes generically
// without per-test wiring. Tests of the gate's OWN failure modes (a separate
// describe block below) override this per-call.
const verifySuggestionToken = jest.fn(async (jwt) => {
  const [suggestionId, requestId] = String(jwt).split('.');
  return { ok: true, payload: { suggestionId, requestId } };
});
jest.mock('../../lib/external/verify-suggestion-token', () => ({
  verifySuggestionToken: (...a) => verifySuggestionToken(...a),
}));
const mintAndStore = jest.fn(async () => ({ jwt: 'token.value.sig' }));
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: (...a) => mintAndStore(...a),
  SEND_TIME_TOKEN_PLACEHOLDER_JWT: 'send_time_token.pending_authority.not_live',
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
let ORIGINAL_NEXTAUTH_SECRET;

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
    _etag: 'W/"1"',
    ...over,
  };
}
function basePerson(over = {}) {
  return {
    wmkf_potentialreviewersid: 'pr-1',
    wmkf_name: 'Dr. Reviewer',
    wmkf_emailaddress: 'rev@example.org',
    _wmkf_contact_value: 'c-1', // existing durable link; invitation send never promotes
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
  ORIGINAL_NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
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
    systemuserid: 'pd-1',
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
  process.env.NEXTAUTH_SECRET = 'send-emails-route-test-signing-secret';
  mintAndStore.mockResolvedValue({ jwt: 'token.value.sig' });
});
afterAll(() => {
  if (ORIGINAL_NEXTAUTH_SECRET === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = ORIGINAL_NEXTAUTH_SECRET;
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

test('preauthorizes the complete draft batch and rejects before opening the send stream', async () => {
  authorizeReviewerRequestMutation.mockRejectedValueOnce(new ServiceHttpError('foreign', { httpStatus: 403 }));
  const res = await run({ drafts: [draft(SUG_1)], templateType: 'materials' });
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
    profileId: undefined,
    callerSystemId: 'u-1',
    suggestionIds: [SUG_1],
  });
  expect(res.status).toHaveBeenCalledWith(403);
  expect(createAndSendEmail).not.toHaveBeenCalled();
  expect(res.write).not.toHaveBeenCalled();
});
// Fake three-segment token whose first two segments the mocked
// verifySuggestionToken above decodes back into suggestionId/requestId — real
// JWT structure/signing is irrelevant here since verification is mocked.
const TOKEN_FOR = (id, requestId = 'req-1') => `${id}.${requestId}.sig`;
// Body carries a secure-review link by default so invitation-templateType
// drafts clear the body-integrity gate (missing_secure_link / unresolved_placeholder)
// and exercise the real send path — tests of the gate itself override body.
// externalLinkExpected:true matches the render-emails-service stamp for a
// template that referenced {{externalLink}}.
const draft = (id = SUG_1) => ({
  suggestionId: id,
  subject: 'S',
  body: `B\nhttps://reviews.example.org/external/review/${TOKEN_FOR(id)}`,
  externalLinkExpected: true,
});

describe('send-emails — reviewer portal HTML links', () => {
  test('refuses to send when the outgoing subject/body contains the internal request number', async () => {
    const res = await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'Review request REQ-001',
        body: `Please review this proposal. https://reviews.example.org/external/review/${TOKEN_FOR(SUG_1)}`,
        externalLinkExpected: true,
      }],
      templateType: 'invitation',
    });

    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(resultOf(res).sent).toHaveLength(0);
    expect(resultOf(res).failed).toHaveLength(1);
    expect(events(res).find((e) => e.event === 'email_failed')?.data.error)
      .toBe('Email subject/body contains the internal request number.');
  });

  test('invitation secure URL renders one paired action set with a generic fallback link', async () => {
    verifySuggestionToken.mockResolvedValueOnce({ ok: true, payload: { suggestionId: SUG_1, requestId: 'req-1' } });
    await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'S',
        body: 'Please use your secure personal link:\nhttps://reviews.wmkeck.org/external/review/token.value.sig\n\nThank you',
        externalLinkExpected: true,
      }],
      templateType: 'invitation',
    });

    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect((htmlBodySent().match(/Yes, I Can Review/g) || [])).toHaveLength(1);
    expect((htmlBodySent().match(/No, Not This Time/g) || [])).toHaveLength(1);
    expect(htmlBodySent()).toContain('https://reviews.wmkeck.org/external/review/token.value.sig?action=accept');
    expect(htmlBodySent()).toContain('https://reviews.wmkeck.org/external/review/token.value.sig?action=decline');
    expect(htmlBodySent()).not.toContain('Start Review');
    expect(htmlBodySent()).toContain(
      'This secure link is unique to you and was sent by W. M. Keck Foundation Program Director Dr. Program Director'
    );
    expect(htmlBodySent()).toContain('mailto:pd@wmkeck.org');
    expect(htmlBodySent()).toContain('https://reviews.wmkeck.org/external/review/token.value.sig');
    expect(htmlBodySent()).toContain('<table role="presentation"');
    expect(htmlBodySent()).toContain('<td width="48%" align="center" valign="middle"');
    expect(htmlBodySent()).toContain('line-height:20px');
    expect(htmlBodySent()).toContain('text-align:center');
    expect(htmlBodySent()).not.toContain('<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;"><br>');
  });

  test('excess blank lines before the reviewer portal call-to-action are collapsed', async () => {
    verifySuggestionToken.mockResolvedValueOnce({ ok: true, payload: { suggestionId: SUG_1, requestId: 'req-1' } });
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
          'https://reviews.wmkeck.org/external/review/token.value.sig',
        ].join('\n'),
        externalLinkExpected: true,
      }],
      templateType: 'invitation',
    });

    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(htmlBodySent()).toContain('Los Angeles</p><p');
    expect(htmlBodySent()).toContain('Please use your secure personal link to accept or decline this invitation:');
    expect(htmlBodySent()).not.toContain('<br><br><br>');
  });

  test('ordinary URLs still render as plain links', async () => {
    // TOKEN_FOR(SUG_1) already decodes correctly through the default mock —
    // no per-call override needed here.
    await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'S',
        body: `Read more: https://example.org/info\nSecure link: https://reviews.example.org/external/review/${TOKEN_FOR(SUG_1)}`,
        externalLinkExpected: true,
      }],
      templateType: 'invitation',
    });

    expect(htmlBodySent()).toContain('<a href="https://example.org/info">https://example.org/info</a>');
    expect(htmlBodySent()).not.toContain('Start Review');
  });

  test('a thank-you body cannot carry or rotate an external-review URL', async () => {
    const res = await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'Thank you',
        body: 'Thanks! Your secure link if needed:\nhttps://reviews.wmkeck.org/external/review/token.value.sig',
        externalLinkExpected: true,
      }],
      templateType: 'thankyou',
    });

    expect(verifySuggestionToken).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(resultOf(res).failed[0]).toMatchObject({
      suggestionId: SUG_1,
      code: 'external_link_forbidden',
    });
  });

  test('materials body renders before the portal action and ends with the security fallback', async () => {
    SUGGESTIONS = { [SUG_1]: baseSuggestion({ wmkf_accepted: true }) };
    verifySuggestionToken.mockResolvedValueOnce({ ok: true, payload: { suggestionId: SUG_1, requestId: 'req-1' } });
    await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'Review Materials',
        body: [
          'Dear Dr. Reviewer,',
          '',
          'Thank you for agreeing to review the proposal.',
          '',
          'Please use your secure reviewer link:',
          'https://reviews.wmkeck.org/external/review/token.value.sig',
          '',
          'This link is unique to you.',
          '',
          'Sincerely,',
          '',
          'Justin Gallivan',
          'Senior Program Director',
          'W.M. Keck Foundation',
          'Los Angeles',
        ].join('\n'),
        externalLinkExpected: true,
      }],
      templateType: 'materials',
    });

    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(htmlBodySent()).toContain(
      '<p style="margin:0 0 16px 0;">Dear Dr. Reviewer,</p>'
    );
    expect(htmlBodySent()).toContain(
      '<p style="margin:0 0 16px 0;">Please use your secure reviewer link:</p>'
    );
    expect(htmlBodySent()).toContain(
      '<p style="margin:0 0 16px 0;">This link is unique to you.</p>'
    );
    expect(htmlBodySent()).toContain(
      '<p style="margin:0 0 16px 0;">Justin Gallivan<br>Senior Program Director<br>W.M. Keck Foundation<br>Los Angeles</p>'
    );
    const html = htmlBodySent();
    expect(html.indexOf('Justin Gallivan<br>Senior Program Director'))
      .toBeLessThan(html.indexOf('<table role="presentation"'));
    expect(html.indexOf('<table role="presentation"'))
      .toBeLessThan(html.indexOf('For your security, please do not forward this link.'));
    expect(html.indexOf('For your security, please do not forward this link.'))
      .toBeLessThan(html.indexOf('If the button does not work'));
    expect(html).not.toContain('This secure link is unique to you and was sent by');
    expect(html).not.toContain('mailto:pd@wmkeck.org');
    expect(html.endsWith('</a></p>')).toBe(true);
  });
});

describe('send-emails — capture delivery mode', () => {
  test('capture mode returns the rendered email artifact without calling Dynamics send', async () => {
    process.env.REVIEWER_EMAIL_DELIVERY_MODE = 'capture';
    delete process.env.VERCEL_ENV;
    PERSON = basePerson({ _wmkf_contact_value: null });
    verifySuggestionToken.mockResolvedValueOnce({ ok: true, payload: { suggestionId: SUG_1, requestId: 'req-1' } });

    const res = await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'Invitation',
        body: 'Please use your secure personal link:\nhttps://reviews.wmkeck.org/external/review/token.value.sig',
        externalLinkExpected: true,
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
      contactPromoted: false,
      orcidBackprop: null,
    });
    expect(r.sent[0].capturedEmail).toMatchObject({
      subject: 'Invitation',
      from: 'pd@wmkeck.org',
      to: 'rev@example.org',
      htmlBody: expect.stringContaining('Yes, I Can Review'),
    });
    expect(r.sent[0].capturedEmail.htmlBody).toContain('https://reviews.wmkeck.org/external/review/token.value.sig');
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

// S4 (Plan v4, S404): the route integration pin for the send-time token
// authority gate's SSE wire shape and result -> complete terminal order. The
// gate's decision-table branches themselves are pinned in
// send-emails-service.test.js; this file confirms the same failure surfaces
// correctly through the real SSE shell (pages/api/review-manager/send-emails.js).
describe('send-emails — send-time token authority gate SSE wire shape (S404 Plan v4)', () => {
  test('a stale/superseded reviewer link fails only that recipient via email_failed{code}, dispatches no email for it, and the batch still ends result -> complete', async () => {
    const freshId = 'e7777777-7777-4777-8777-777777777777';
    SUGGESTIONS = {
      [SUG_1]: baseSuggestion({ wmkf_appreviewersuggestionid: SUG_1 }),
      [freshId]: baseSuggestion({ wmkf_appreviewersuggestionid: freshId }),
    };
    // SUG_1's token verifies as superseded (hash_mismatch); freshId's is untouched
    // and uses the default decode-based mock (which matches genuinely).
    verifySuggestionToken.mockImplementationOnce(async () => ({ ok: false, reason: 'hash_mismatch' }));

    const res = await run({ drafts: [draft(SUG_1), draft(freshId)], templateType: 'invitation' });
    const seq = events(res).map((e) => e.event);

    expect(seq).not.toContain('error');
    expect(seq.slice(-2)).toEqual(['result', 'complete']);
    expect(seq).toContain('email_failed');
    expect(seq.indexOf('email_failed')).toBeLessThan(seq.indexOf('result'));

    const r = resultOf(res);
    expect(r.stats).toMatchObject({ sent: 1, failed: 1, unconfirmed: 0, total: 2 });
    expect(r.sent.map((s) => s.suggestionId)).toEqual([freshId]);
    expect(r.failed).toEqual([{
      suggestionId: SUG_1,
      candidateName: 'Dr. Reviewer',
      candidateEmail: 'rev@example.org',
      code: 'external_link_superseded',
      error: 'This email’s secure reviewer link was replaced by a newer preview. Regenerate the preview and send this recipient again.',
    }]);
    // Only one recipient's draft ever reached Dynamics.
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
  });

  test('a draft missing the externalLinkExpected marker (pre-S404 render) fails external_link_expectation_missing before dispatch', async () => {
    SUGGESTIONS = { [SUG_1]: baseSuggestion({ wmkf_appreviewersuggestionid: SUG_1, wmkf_accepted: true }) };
    const res = await run({
      drafts: [{
        suggestionId: SUG_1,
        subject: 'S',
        body: `Body:\nhttps://reviews.example.org/external/review/${TOKEN_FOR(SUG_1)}`,
        // no externalLinkExpected field — simulates a draft rendered before S404 shipped
      }],
      templateType: 'materials',
    });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(verifySuggestionToken).not.toHaveBeenCalled();
    const seq = events(res).map((e) => e.event);
    expect(seq.slice(-2)).toEqual(['result', 'complete']);
    expect(resultOf(res).failed[0]).toMatchObject({
      suggestionId: SUG_1,
      code: 'external_link_expectation_missing',
    });
  });
});
