/**
 * @jest-environment node
 *
 * Unit tests for lib/services/review-manager/send-emails-service.js
 * (Route→Service Consolidation Plan, stage 2b — the logic-level layer that
 * could not exist while the logic lived in the route).
 *
 * The service is exercised directly through its (args, onEvent) contract:
 * event order incl. a mixed batch (sent + failed + skipped arrays),
 * fail-closed templateType (one error event, RESOLVES, no result/complete),
 * lifecycle-after-send ordering + failure-skips-lifecycle, and the shared
 * cycle-config projection shape.
 */

const createAndSendEmail = jest.fn(async () => ({ emailId: 'email-1' }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createAndSendEmail: (...a) => createAndSendEmail(...a) },
}));

const findById = jest.fn(async (id) => SUGGESTIONS[id] ?? null);
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
  REVIEW_STATUS_MAP: { accepted: 100000000, materials_sent: 100000001, under_review: 100000002 },
}));
const getPersonById = jest.fn(async (id) => PERSONS[id] ?? null);
const mockSetContactLink = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...a) => getPersonById(...a),
  setContactLink: (...a) => mockSetContactLink(...a),
}));
const mockFindOrCreateByEmail = jest.fn(async () => ({ id: 'c-1', created: false }));
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  findOrCreateByEmail: (...a) => mockFindOrCreateByEmail(...a),
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
const mockBackPropReviewerOrcidToContact = jest.fn(async () => ({ action: 'noop' }));
jest.mock('../../lib/services/backprop-reviewer-orcid', () => ({
  backPropReviewerOrcidToContact: (...a) => mockBackPropReviewerOrcidToContact(...a),
}));
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(async () => ({ found: false, value: null })),
}));
const findByShortCode = jest.fn(async () => CYCLE);
jest.mock('../../lib/services/grant-cycles-dataverse', () => ({
  findByShortCode: (...a) => findByShortCode(...a),
}));
jest.mock('../../lib/utils/cycle-code', () => ({ meetingDateToCycleCode: jest.fn(() => CYCLE_CODE) }));
jest.mock('../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn(), isAllowedUrl: jest.fn(() => false) }));
jest.mock('../../lib/utils/uploaded-blob', () => ({ readUploadedBlobBuffer: jest.fn(async () => Buffer.from('PDF')) }));
jest.mock('../../lib/utils/cycle-material-ref', () => ({
  isPrivateCycleMaterialPathname: (p) => typeof p === 'string' && p.startsWith('cycle-materials/'),
}));

const { sendEmails } = require('../../lib/services/review-manager/send-emails-service');
const { loadCycleConfigs } = require('../../lib/services/review-manager/cycle-config-loader');

const SUG_OK = '11111111-1111-4111-8111-111111111111';
const SUG_NO_EMAIL = '22222222-2222-4222-8222-222222222222';
const SUG_MISSING = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';

let SUGGESTIONS;
let PERSONS;
let REQUEST;
let CYCLE_CODE;
let CYCLE;

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
  CYCLE_CODE = null;
  CYCLE = null;
  delete process.env.REVIEWER_EMAIL_DELIVERY_MODE;
});

async function run(requestBody) {
  const emitted = [];
  await sendEmails(
    { requestBody, fromEmail: 'staff@wmkeck.org', actingUserSystemId: 'u-1' },
    (e) => emitted.push(e),
  );
  return emitted;
}
const names = (emitted) => emitted.map((e) => e.event);
const resultOf = (emitted) => emitted.find((e) => e.event === 'result')?.data;
// Body carries a secure-review link by default so invitation-templateType
// drafts clear the body-integrity gate (missing_secure_link / unresolved_placeholder)
// and exercise the real send path — tests of the gate itself override body.
const draft = (id) => ({
  suggestionId: id,
  subject: 'S',
  body: 'B\nhttps://reviews.example.org/external/review/tok-1',
});

describe('send-emails-service — fail-closed templateType', () => {
  test('unknown templateType: ONE error event, resolves, no result/complete, no adapter work', async () => {
    const emitted = await run({ drafts: [draft(SUG_OK)], templateType: 'bogus' });
    expect(names(emitted)).toEqual(['error']);
    expect(emitted[0].data.message).toBe('Unknown templateType: bogus');
    expect(findById).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
  });

  test('input-guard errors also resolve with a single error event (empty drafts, bad GUID)', async () => {
    expect(names(await run({ drafts: [], templateType: 'invitation' }))).toEqual(['error']);
    expect(names(await run({ drafts: [{ suggestionId: 'nope', subject: 'S', body: 'B' }], templateType: 'invitation' }))).toEqual(['error']);
    expect(findById).not.toHaveBeenCalled();
  });

  test('a flattened materials draft is refused before any recipient lookup or send', async () => {
    const emitted = await run({
      drafts: [{
        suggestionId: SUG_OK,
        subject: 'Review Materials',
        body: 'Dear Reviewer, Please review: https://reviews.example.org/external/review/tok-1 Thank you.',
      }],
      templateType: 'materials',
    });

    expect(names(emitted)).toEqual(['error']);
    expect(emitted[0].data.message)
      .toBe('Materials email body lost its line breaks. Regenerate the preview before sending.');
    expect(findById).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });
});

describe('send-emails-service — event order, mixed batch', () => {
  test('sent + skipped + failed arrays populate; terminal sequence is result -> complete, never error', async () => {
    SUGGESTIONS = {
      [SUG_OK]: suggestion(SUG_OK),
      [SUG_NO_EMAIL]: suggestion(SUG_NO_EMAIL),
      // SUG_MISSING absent → failed
    };
    PERSONS = {
      [`person-${SUG_OK}`]: person(`person-${SUG_OK}`),
      [`person-${SUG_NO_EMAIL}`]: person(`person-${SUG_NO_EMAIL}`, { wmkf_emailaddress: null }),
    };
    const emitted = await run({
      drafts: [draft(SUG_OK), draft(SUG_NO_EMAIL), draft(SUG_MISSING)],
      templateType: 'invitation',
    });

    const seq = names(emitted);
    expect(seq).not.toContain('error');
    expect(seq.slice(-2)).toEqual(['result', 'complete']);
    const stages = emitted.filter((e) => e.event === 'progress').map((e) => e.data.stage);
    expect(stages.slice(0, 4)).toEqual(['starting', 'resolving_recipients', 'fetching_attachments', 'sending']);
    // Pure-invitation batch: the invitation lifecycle stamp now runs INLINE in the
    // send loop, so the post-loop 'updating_lifecycle' pass never fires.
    expect(stages).not.toContain('updating_lifecycle');
    expect(seq.indexOf('email_sent')).toBeLessThan(seq.indexOf('result'));
    expect(seq.indexOf('email_failed')).toBeLessThan(seq.indexOf('result'));

    const r = resultOf(emitted);
    expect(r.stats).toMatchObject({ sent: 1, failed: 1, skipped: 1, unconfirmed: 0, total: 3 });
    expect(r.unconfirmed).toEqual([]);
    expect(r.sent.map((s) => s.suggestionId)).toEqual([SUG_OK]);
    expect(r.skipped.map((s) => ({ id: s.suggestionId, reason: s.reason }))).toEqual([{ id: SUG_NO_EMAIL, reason: 'no_email' }]);
    expect(r.failed.map((f) => f.suggestionId)).toEqual([SUG_MISSING]);
  });
});

describe('send-emails-service — duplicate suggestionId dedup', () => {
  test('a repeated suggestionId in one batch sends ONCE (no double-invite to a real reviewer)', async () => {
    const emitted = await run({ drafts: [draft(SUG_OK), draft(SUG_OK)], templateType: 'invitation' });
    expect(names(emitted)).not.toContain('error');
    // The duplicate is dropped before hydration and the send loop.
    expect(findById).toHaveBeenCalledTimes(1);
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    // total (starting progress) and the result reflect the deduped batch.
    const startTotal = emitted.find((e) => e.event === 'progress' && e.data.stage === 'starting')?.data.total;
    expect(startTotal).toBe(1);
    const r = resultOf(emitted);
    expect(r.sent.map((s) => s.suggestionId)).toEqual([SUG_OK]);
    expect(r.stats).toMatchObject({ sent: 1, total: 1 });
  });
});

describe('send-emails-service — lifecycle-after-send ordering', () => {
  test('createAndSendEmail is invoked BEFORE updateLifecycle for the same recipient', async () => {
    await run({ drafts: [draft(SUG_OK)], templateType: 'invitation' });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(updateLifecycle).toHaveBeenCalledTimes(1);
    expect(createAndSendEmail.mock.invocationCallOrder[0])
      .toBeLessThan(updateLifecycle.mock.invocationCallOrder[0]);
    expect(updateLifecycle).toHaveBeenCalledWith(
      SUG_OK,
      { invited: true, emailSentAt: expect.any(String), respondReminderSentAt: null },
      { actingUserSystemId: 'u-1' },
    );
  });

  test('a successful send never creates, links, or mutates a CRM contact', async () => {
    PERSONS[`person-${SUG_OK}`] = person(`person-${SUG_OK}`, {
      _wmkf_contact_value: null,
      wmkf_orcid: '0000-0002-1825-0097',
    });

    const emitted = await run({
      drafts: [draft(SUG_OK)],
      templateType: 'invitation',
    });

    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(mockFindOrCreateByEmail).not.toHaveBeenCalled();
    expect(mockSetContactLink).not.toHaveBeenCalled();
    expect(mockBackPropReviewerOrcidToContact).not.toHaveBeenCalled();
    expect(resultOf(emitted).sent[0]).toMatchObject({
      contactPromoted: false,
      orcidBackprop: null,
    });
  });

  test('an invitation send-time failure lands in unconfirmed[] (not failed[]) via email_unconfirmed; batch ends result -> complete', async () => {
    // A throw from createAndSendEmail may have dispatched before failing, so an
    // invitation is recorded as "possibly sent" rather than plain failed — a blind
    // retry would risk double-emailing a real external reviewer.
    createAndSendEmail.mockImplementationOnce(async () => { throw new Error('boom'); });
    const emitted = await run({ drafts: [draft(SUG_OK)], templateType: 'invitation' });
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(names(emitted)).not.toContain('error');
    expect(names(emitted)).not.toContain('email_failed');
    expect(names(emitted)).toContain('email_unconfirmed');
    expect(names(emitted).slice(-2)).toEqual(['result', 'complete']);
    const r = resultOf(emitted);
    expect(r.failed).toEqual([]);
    expect(r.unconfirmed).toHaveLength(1);
    expect(r.unconfirmed[0]).toMatchObject({ suggestionId: SUG_OK, error: 'boom' });
    expect(r.stats).toMatchObject({ sent: 0, failed: 0, unconfirmed: 1 });
  });

  test('a non-invitation send-time failure still lands in failed[] via email_failed (unchanged)', async () => {
    SUGGESTIONS[SUG_OK] = suggestion(SUG_OK, { wmkf_accepted: true });
    createAndSendEmail.mockImplementationOnce(async () => { throw new Error('boom'); });
    const emitted = await run({ drafts: [draft(SUG_OK)], templateType: 'materials' });
    expect(names(emitted)).not.toContain('email_unconfirmed');
    expect(names(emitted)).toContain('email_failed');
    const r = resultOf(emitted);
    expect(r.unconfirmed).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatchObject({ suggestionId: SUG_OK, error: 'boom' });
  });

  test('an invitation lifecycle-stamp failure after a successful send is non-terminal: sent[] carries inviteRecorded: false, no post-loop lifecycle pass', async () => {
    updateLifecycle.mockImplementationOnce(async () => { throw new Error('patch failed'); });
    const emitted = await run({ drafts: [draft(SUG_OK)], templateType: 'invitation' });
    expect(names(emitted)).not.toContain('error');
    // Inline stamp failure is logged (console.error), not a progress warning, and
    // the pure-invitation batch never reaches the post-loop 'updating_lifecycle' pass.
    expect(emitted.some((e) => e.event === 'progress' && e.data.stage === 'updating_lifecycle')).toBe(false);
    const r = resultOf(emitted);
    expect(r.stats.sent).toBe(1);
    expect(r.sent[0]).toMatchObject({ suggestionId: SUG_OK, inviteRecorded: false });
    expect(names(emitted).slice(-2)).toEqual(['result', 'complete']);
  });

  test('non-invitation sent records do not carry an inviteRecorded key', async () => {
    SUGGESTIONS[SUG_OK] = suggestion(SUG_OK, { wmkf_accepted: true });
    const emitted = await run({ drafts: [draft(SUG_OK)], templateType: 'materials' });
    const r = resultOf(emitted);
    expect(r.sent[0]).not.toHaveProperty('inviteRecorded');
  });
});

describe('send-emails-service — terminal thank-you guard', () => {
  test.each([100000005, 100000006])('thank-you does not resurrect terminal status %s', async (terminalValue) => {
    SUGGESTIONS[SUG_OK] = suggestion(SUG_OK, { wmkf_accepted: true, wmkf_reviewstatus: terminalValue });
    await run({ drafts: [draft(SUG_OK)], templateType: 'thankyou' });
    expect(updateLifecycle).toHaveBeenCalledWith(
      SUG_OK,
      { thankYouSentAt: expect.any(String) },
      { actingUserSystemId: 'u-1' },
    );
  });
});

describe('send-emails-service — invitation body-integrity gate', () => {
  test('invitation renders one paired accept/decline CTA and sends from the assigned Program Director', async () => {
    const emitted = await run({
      drafts: [{
        suggestionId: SUG_OK,
        subject: 'Invitation',
        body: 'Please respond:\nhttps://reviews.example.org/external/review/tok-1',
      }],
      templateType: 'invitation',
    });

    expect(resultOf(emitted).sent).toHaveLength(1);
    expect(createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'pd@wmkeck.org',
      actingUserSystemId: 'pd-1',
      body: expect.stringContaining('?action=accept'),
    }));
    const html = createAndSendEmail.mock.calls[0][0].body;
    expect((html.match(/Yes, I Can Review/g) || [])).toHaveLength(1);
    expect((html.match(/No, Not This Time/g) || [])).toHaveLength(1);
    expect(html).toContain('?action=decline');
    expect(html).toContain('PD');
    expect(html).toContain('mailto:pd@wmkeck.org');
  });

  test.each([
    ['missing assignment', { request: { _wmkf_programdirector_value: null }, pd: null }],
    ['disabled Program Director', { request: {}, pd: { systemuserid: 'pd-1', internalemailaddress: 'pd@wmkeck.org', isdisabled: true } }],
    ['Program Director without email', { request: {}, pd: { systemuserid: 'pd-1', internalemailaddress: '', isdisabled: false } }],
  ])('%s fails closed before invitation transport', async (_label, setup) => {
    REQUEST = { ...REQUEST, ...setup.request };
    if (setup.pd) getSystemUserById.mockResolvedValue(setup.pd);

    const emitted = await run({ drafts: [draft(SUG_OK)], templateType: 'invitation' });

    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(resultOf(emitted).skipped[0]).toMatchObject({
      suggestionId: SUG_OK,
      reason: 'program_director_sender_unavailable',
    });
  });

  test('non-invitation email preserves the authenticated staff sender', async () => {
    SUGGESTIONS[SUG_OK] = suggestion(SUG_OK, { wmkf_accepted: true });
    await run({ drafts: [draft(SUG_OK)], templateType: 'materials' });
    expect(createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'staff@wmkeck.org',
      actingUserSystemId: 'u-1',
    }));
  });

  test('an invitation with no secure link is skipped missing_secure_link and never sent', async () => {
    const emitted = await run({
      drafts: [{ suggestionId: SUG_OK, subject: 'S', body: 'No link here.' }],
      templateType: 'invitation',
    });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
    const r = resultOf(emitted);
    expect(r.skipped).toEqual([
      { suggestionId: SUG_OK, candidateName: 'Dr. Reviewer', candidateEmail: 'rev@example.org', reason: 'missing_secure_link' },
    ]);
  });

  test('an invitation with an unresolved {{token}} is skipped unresolved_placeholder and never sent', async () => {
    const emitted = await run({
      drafts: [{
        suggestionId: SUG_OK,
        subject: 'S',
        body: 'Link: https://reviews.example.org/external/review/tok-1 Hi {{firstName}}',
      }],
      templateType: 'invitation',
    });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    const r = resultOf(emitted);
    expect(r.skipped[0]).toMatchObject({ suggestionId: SUG_OK, reason: 'unresolved_placeholder' });
  });

  test('the body-integrity gate does not apply to non-invitation templateTypes', async () => {
    SUGGESTIONS[SUG_OK] = suggestion(SUG_OK, { wmkf_accepted: true });
    const emitted = await run({
      drafts: [{
        suggestionId: SUG_OK,
        subject: 'S',
        body: 'No link here.',
      }],
      templateType: 'materials',
    });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(resultOf(emitted).sent).toHaveLength(1);
  });
});

describe('send-emails-service — address action gate', () => {
  test('quick-check address requires recipient-specific confirmation', async () => {
    PERSONS[`person-${SUG_OK}`] = person(`person-${SUG_OK}`, { wmkf_emailsource: 'scholarly_single' });
    const emitted = await run({ drafts: [draft(SUG_OK)], templateType: 'invitation' });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(resultOf(emitted).skipped[0]).toMatchObject({
      suggestionId: SUG_OK,
      reason: 'email_unconfirmed',
      emailConfidence: { action: 'quick_check' },
    });
  });

  test('confirmed quick-check address may be invited', async () => {
    PERSONS[`person-${SUG_OK}`] = person(`person-${SUG_OK}`, { wmkf_emailsource: 'scholarly_single' });
    const emitted = await run({
      drafts: [draft(SUG_OK)],
      templateType: 'invitation',
      confirmedLowConfidenceIds: [SUG_OK],
    });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(resultOf(emitted).sent).toHaveLength(1);
  });

  test('research-only address cannot be invited even when client claims confirmation', async () => {
    PERSONS[`person-${SUG_OK}`] = person(`person-${SUG_OK}`, { wmkf_emailsource: 'serp_search' });
    const emitted = await run({
      drafts: [draft(SUG_OK)],
      templateType: 'invitation',
      confirmedLowConfidenceIds: [SUG_OK],
    });
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(resultOf(emitted).skipped[0]).toMatchObject({
      suggestionId: SUG_OK,
      reason: 'email_research_only',
      emailConfidence: { action: 'research_only' },
    });
  });
});

describe('send-emails-service — complete event message wording', () => {
  test('unconfirmed count appends "; N possibly sent (verify before retry)"; skipped wording drops "(no email)"', async () => {
    SUGGESTIONS = {
      [SUG_OK]: suggestion(SUG_OK),
      [SUG_NO_EMAIL]: suggestion(SUG_NO_EMAIL),
    };
    PERSONS = {
      [`person-${SUG_OK}`]: person(`person-${SUG_OK}`),
      [`person-${SUG_NO_EMAIL}`]: person(`person-${SUG_NO_EMAIL}`, { wmkf_emailaddress: null }),
    };
    createAndSendEmail.mockImplementationOnce(async () => { throw new Error('boom'); });
    const emitted = await run({
      drafts: [draft(SUG_OK), draft(SUG_NO_EMAIL)],
      templateType: 'invitation',
    });
    const complete = emitted.find((e) => e.event === 'complete').data;
    expect(complete.unconfirmed).toBe(1);
    expect(complete.message).toContain('; 1 possibly sent (verify before retry)');
    expect(complete.message).toContain('; 1 skipped');
    expect(complete.message).not.toContain('skipped (no email)');
  });
});

describe('cycle-config-loader — per-caller projection shape', () => {
  test('send-emails projection: short_code + review_template_blob_url + additional_attachments only', async () => {
    findByShortCode.mockResolvedValueOnce({
      shortCode: 'CYC',
      reviewTemplateBlobUrl: 'https://blob/template.docx',
      additionalAttachments: [{ pathname: 'cycle-materials/p.pdf' }],
      name: 'Cycle Name',
      programName: 'SE',
    });
    const out = await loadCycleConfigs(['CYC'], {
      fields: {
        review_template_blob_url: 'reviewTemplateBlobUrl',
        additional_attachments: 'additionalAttachments',
      },
    });
    expect(out.CYC).toEqual({
      short_code: 'CYC',
      review_template_blob_url: 'https://blob/template.docx',
      additional_attachments: [{ pathname: 'cycle-materials/p.pdf' }],
      review_deadline: undefined,
    });
  });

  test('render-emails projection: short_code + name/program_name/review_deadline/custom_fields only', async () => {
    findByShortCode.mockResolvedValueOnce({
      shortCode: 'CYC',
      name: 'Cycle Name',
      programName: 'SE',
      reviewDeadline: '2026-08-01',
      customFields: { honorarium: '500' },
      reviewTemplateBlobUrl: 'https://blob/template.docx',
    });
    const out = await loadCycleConfigs(['CYC'], {
      fields: {
        name: 'name',
        program_name: 'programName',
        review_deadline: 'reviewDeadline',
        custom_fields: 'customFields',
      },
    });
    expect(out.CYC).toEqual({
      short_code: 'CYC',
      name: 'Cycle Name',
      program_name: 'SE',
      review_deadline: '2026-08-01',
      custom_fields: { honorarium: '500' },
    });
  });

  test('missing/null cycles are silent; empty input returns {}', async () => {
    expect(await loadCycleConfigs([], { fields: {} })).toEqual({});
    findByShortCode.mockResolvedValueOnce(null);
    expect(await loadCycleConfigs(['NOPE'], { fields: {} })).toEqual({});
  });
});
