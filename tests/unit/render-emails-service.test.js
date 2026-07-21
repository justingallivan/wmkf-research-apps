/**
 * Logic-level unit tests for lib/services/review-manager/render-emails-service.js
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Adapters + helpers mocked; covers the per-recipient skip semantics inside
 * one result ({ drafts[], stats } with skipped:'no_email' + emailConfidence
 * on every row), BEST-EFFORT per-recipient token minting (mint only when the
 * template references {{externalLink}}; a mint failure yields an empty link,
 * never a throw), and the 404 no-reviewers domain error.
 */

const findById = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
}));
const getReviewerByIdWithSelect = jest.fn();
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...a) => getReviewerByIdWithSelect(...a),
}));
const getRequestById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
}));
jest.mock('../../lib/services/grant-cycles-dataverse', () => ({
  findByShortCode: jest.fn(async () => null),
}));
jest.mock('../../lib/services/proposal-participants', () => ({
  fetchCoPIs: jest.fn(async () => []),
}));
jest.mock('../../lib/services/honorarium-config', () => ({
  getHonorariumAmount: jest.fn(async () => 500),
}));
const mintAndStore = jest.fn();
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: (...a) => mintAndStore(...a),
}));

const SUG1 = '22222222-2222-4222-8222-222222222222';
const SUG2 = '33333333-3333-4333-8333-333333333333';
const REQ = '11111111-1111-4111-8111-111111111111';

let renderEmails;
let RenderEmailsError;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/render-emails-service');
  renderEmails = mod.renderEmails;
  RenderEmailsError = mod.RenderEmailsError;
});

function suggestion(over = {}) {
  return { _wmkf_potentialreviewer_value: 'person-1', _wmkf_request_value: REQ, wmkf_accepted: true, ...over };
}

function person(over = {}) {
  return {
    wmkf_name: 'Dr. Jane Roe',
    wmkf_emailaddress: 'jane@uni.edu',
    wmkf_emailsource: 'orcid',
    wmkf_identitystatus: null,
    ...over,
  };
}

const request = {
  akoya_requestid: REQ,
  akoya_requestnum: 'R-1001',
  akoya_title: 'Proposal T',
  wmkf_reviewduedate: null,
  wmkf_meetingdate: null,
};

const TEMPLATE = { subject: 'Review request', body: 'Hello reviewer' };

beforeEach(() => {
  jest.clearAllMocks();
  getRequestById.mockResolvedValue(request);
  mintAndStore.mockResolvedValue({ url: 'https://x/review?token=abc' });
});

test('per-recipient skip: no-email recipient yields skipped:"no_email" row inside one result; stats split', async () => {
  findById.mockResolvedValueOnce(suggestion()).mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect
    .mockResolvedValueOnce(person())
    .mockResolvedValueOnce(person({ wmkf_emailaddress: null }));
  const out = await renderEmails({ suggestionIds: [SUG1, SUG2], template: TEMPLATE, settings: {}, actingUserSystemId: null });
  expect(out.stats).toEqual({ total: 2, ready: 1, skipped: 1 });
  const ready = out.drafts.find((d) => !d.skipped);
  const skipped = out.drafts.find((d) => d.skipped);
  expect(ready.candidateEmail).toBe('jane@uni.edu');
  expect(ready.subject).toBe('Review request');
  expect(ready.body).toBe('Hello reviewer');
  expect(skipped).toMatchObject({ skipped: 'no_email', candidateEmail: null, subject: '', body: '' });
  // Every row carries emailConfidence (Slice G server-side stamp).
  for (const d of out.drafts) expect(d.emailConfidence).toBeDefined();
});

test('invitation render refuses a research-only search address', async () => {
  findById.mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect.mockResolvedValueOnce(person({ wmkf_emailsource: 'serp_search' }));
  const out = await renderEmails({
    suggestionIds: [SUG1],
    template: { subject: 'Review request', body: 'Respond: {{externalLink}}' },
    settings: {},
    templateType: 'invitation',
    actingUserSystemId: null,
  });
  expect(out.stats).toEqual({ total: 1, ready: 0, skipped: 1 });
  expect(out.drafts[0]).toMatchObject({
    skipped: 'email_research_only',
    emailConfidence: { action: 'research_only' },
    manualLink: 'https://x/review?token=abc',
  });
  expect(mintAndStore).toHaveBeenCalledTimes(1);
});

test('post-engagement render does not re-gate a research-only source', async () => {
  findById.mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect.mockResolvedValueOnce(person({ wmkf_emailsource: 'serp_search' }));
  const out = await renderEmails({
    suggestionIds: [SUG1],
    template: TEMPLATE,
    settings: {},
    templateType: 'materials',
    actingUserSystemId: null,
  });
  expect(out.stats.ready).toBe(1);
  expect(out.drafts[0].skipped).toBeUndefined();
});

test('mint only when the template references {{externalLink}}; failure is BEST-EFFORT per recipient (empty link, no throw)', async () => {
  // No placeholder → no mint at all.
  findById.mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect.mockResolvedValueOnce(person());
  await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null });
  expect(mintAndStore).not.toHaveBeenCalled();

  // Placeholder present → mint per recipient; one failure leaves that link "".
  findById.mockResolvedValueOnce(suggestion()).mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect.mockResolvedValueOnce(person()).mockResolvedValueOnce(person({ wmkf_name: 'Dr. Bob' }));
  mintAndStore
    .mockResolvedValueOnce({ url: 'https://x/review?token=ok' })
    .mockRejectedValueOnce(new Error('hash write failed'));
  const out = await renderEmails({
    suggestionIds: [SUG1, SUG2],
    template: { subject: 'Invite', body: 'Link: {{externalLink}}' },
    settings: {},
    actingUserSystemId: 'su-1',
  });
  expect(mintAndStore).toHaveBeenCalledTimes(2);
  expect(out.drafts[0].body).toContain('https://x/review?token=ok');
  expect(out.drafts[1].body).not.toContain('undefined');
  expect(out.stats.ready).toBe(2); // mint failure never skips or fails the render
});

test('no suggestion rows resolve → RenderEmailsError 404 with the pinned message', async () => {
  findById.mockResolvedValue(null);
  const err = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null })
    .catch((e) => e);
  expect(err).toBeInstanceOf(RenderEmailsError);
  expect(err.httpStatus).toBe(404);
  expect(err.message).toBe('No reviewers found for the provided IDs');
  expect(err.body).toBeUndefined(); // {error} route — shell default envelope
});

test('hydration failures are per-recipient best-effort (person lookup failure → skip row, render continues)', async () => {
  findById.mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect.mockRejectedValueOnce(new Error('person 404'));
  const out = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null });
  expect(out.drafts[0].skipped).toBe('no_email'); // null person → no email → skip
});
