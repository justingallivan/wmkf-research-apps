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
}));
const getPersonById = jest.fn(async (id) => PERSONS[id] ?? null);
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...a) => getPersonById(...a),
  setContactLink: jest.fn(async () => {}),
}));
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  findOrCreateByEmail: jest.fn(async () => ({ id: 'c-1', created: false })),
}));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({
  getByIdWithSelect: jest.fn(async () => ({ fullname: 'PD', internalemailaddress: 'pd@wmkeck.org', isdisabled: false })),
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

let SUGGESTIONS;
let PERSONS;
let REQUEST;
let CYCLE_CODE;
let CYCLE;

function suggestion(id, over = {}) {
  return {
    wmkf_appreviewersuggestionid: id,
    _wmkf_potentialreviewer_value: `person-${id}`,
    _wmkf_request_value: 'req-1',
    wmkf_accepted: false,
    wmkf_invited: false,
    wmkf_reviewstatus: null,
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
  SUGGESTIONS = { [SUG_OK]: suggestion(SUG_OK) };
  PERSONS = { [`person-${SUG_OK}`]: person(`person-${SUG_OK}`) };
  REQUEST = { akoya_requestid: 'req-1', akoya_requestnum: 'REQ-001', wmkf_meetingdate: null };
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
const draft = (id) => ({ suggestionId: id, subject: 'S', body: 'B' });

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
    expect(stages).toContain('updating_lifecycle');
    expect(seq.indexOf('email_sent')).toBeLessThan(seq.indexOf('result'));
    expect(seq.indexOf('email_failed')).toBeLessThan(seq.indexOf('result'));

    const r = resultOf(emitted);
    expect(r.stats).toMatchObject({ sent: 1, failed: 1, skipped: 1, total: 3 });
    expect(r.sent.map((s) => s.suggestionId)).toEqual([SUG_OK]);
    expect(r.skipped.map((s) => ({ id: s.suggestionId, reason: s.reason }))).toEqual([{ id: SUG_NO_EMAIL, reason: 'no_email' }]);
    expect(r.failed.map((f) => f.suggestionId)).toEqual([SUG_MISSING]);
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

  test('a send-time failure never reaches the lifecycle write; batch ends result -> complete', async () => {
    createAndSendEmail.mockImplementationOnce(async () => { throw new Error('boom'); });
    const emitted = await run({ drafts: [draft(SUG_OK)], templateType: 'invitation' });
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(names(emitted)).not.toContain('error');
    expect(names(emitted).slice(-2)).toEqual(['result', 'complete']);
    expect(resultOf(emitted).failed[0].error).toBe('boom');
  });

  test('a lifecycle-write failure after a successful send is a progress warning, never terminal', async () => {
    updateLifecycle.mockImplementationOnce(async () => { throw new Error('patch failed'); });
    const emitted = await run({ drafts: [draft(SUG_OK)], templateType: 'invitation' });
    expect(names(emitted)).not.toContain('error');
    expect(resultOf(emitted).stats.sent).toBe(1);
    expect(emitted.some((e) => e.event === 'progress'
      && e.data.stage === 'updating_lifecycle'
      && /lifecycle update failed/.test(e.data.message))).toBe(true);
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
