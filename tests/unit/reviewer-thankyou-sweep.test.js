/**
 * Reviewer thank-you sweep — eligibility, fire-once claim-before-send,
 * at-most-once on send failure, and retryable pre-claim attachment generation.
 *
 * @jest-environment node
 */

const queryAllRecords = jest.fn();
const getRecord = jest.fn();
const updateRecord = jest.fn();
const createAndSendEmail = jest.fn();
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryAllRecords: (...a) => queryAllRecords(...a),
    getRecord: (...a) => getRecord(...a),
    updateRecord: (...a) => updateRecord(...a),
    createAndSendEmail: (...a) => createAndSendEmail(...a),
  },
}));
const ownReviewerThankYouTemplate = jest.fn();
jest.mock('../../lib/services/reviewer-thankyou-personalization', () => ({ ownReviewerThankYouTemplate: (...args) => ownReviewerThankYouTemplate(...args) }));
const readRequiredEmailDefaults = jest.fn();
jest.mock('../../lib/services/email-defaults', () => ({
  readRequiredEmailDefaults: (...a) => readRequiredEmailDefaults(...a),
}));
jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: jest.fn(async () => ({ signature: 'Dr. PD\nW. M. Keck Foundation' })),
}));
const fetchAnswersBySuggestion = jest.fn();
jest.mock('../../lib/services/review-answers', () => ({
  fetchAnswersBySuggestion: (...a) => fetchAnswersBySuggestion(...a),
}));
const preflightReviewDocxTemplates = jest.fn();
const renderIndividualReviewDocx = jest.fn();
jest.mock('../../lib/services/review-documents/docx-renderer', () => ({
  preflightReviewDocxTemplates: (...a) => preflightReviewDocxTemplates(...a),
  renderIndividualReviewDocx: (...a) => renderIndividualReviewDocx(...a),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  notExcludedFilter: () => 'wmkf_applicantdisposition ne 100000001',
  // queryAllSuggestions/patchReviewReceipt are thin DynamicsService
  // passthroughs (data-access-layer conversion, Stages 3-6) — forward
  // through the ALSO-mocked dynamics-service module so the existing
  // queryAllRecords/updateRecord assertions below still see these calls.
  queryAllSuggestions: (options) => queryAllRecords('wmkf_appreviewersuggestions', options),
  patchReviewReceipt: (id, payload, opts) => updateRecord('wmkf_appreviewersuggestions', id, payload, opts),
  // Stage 5A: sendOneThankYou now claims via claimThankYou instead of the
  // generic passthrough. Same forwarding pattern as patchReviewReceipt above
  // so the existing updateRecord assertions keep observing the claim write.
  // Wrapped in its own jest.fn() (wiring pin) so a regression that routes
  // the claim back through patchReviewReceipt is directly observable here.
  claimThankYou: jest.fn((id, sentAtIso, opts) => updateRecord('wmkf_appreviewersuggestions', id, { wmkf_thankyousentat: sentAtIso }, opts)),
}));

// Stage 1c: the per-run test-state lookup is replaced so each test chooses a
// request's state; the lookup itself is covered in test-request-state.test.js.
const mockRequestTestState = jest.fn(async () => ({ kind: 'ordinary', reason: 'test' }));
jest.mock('../../lib/services/test-requests/request-test-state', () => ({
  ...jest.requireActual('../../lib/services/test-requests/request-test-state'),
  createRequestTestStateLookup: () => (requestId) => mockRequestTestState(requestId),
}));

const { sweepReviewThankYous, prepareReviewerThankYou } = require('../../lib/services/reviewer-thankyou-sweep');
const { claimThankYou } = require('../../lib/dataverse/adapters/reviewer-suggestion');

const SUG = '11111111-1111-4111-8111-111111111111';
const REQ = 'req-1';
const PD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PERSON = 'person-1';
const SUBJECT_KEY = 'email.reviewer_thankyou.subject';
const BODY_KEY = 'email.reviewer_thankyou.body';
const SUBJECT = 'Thank You for Your Review — {{proposalTitle}}';
const BODY = '{{greeting}},\n\nThank you for completing your review of “{{proposalTitle}}”.\n\nWith gratitude,\n\n{{signature}}';

function requestConfig(over = {}) {
  return {
    akoya_requestid: REQ, akoya_requestnum: 'R-1', akoya_title: 'A Proposal',
    _wmkf_programdirector_value: PD,
    ...over,
  };
}

function installReads({ request = requestConfig(), pdDisabled = false, reviewerEmail = 'rev@example.org' } = {}) {
  getRecord.mockImplementation(async (set) => {
    if (set === 'akoya_requests') return request;
    if (set === 'systemusers') return { systemuserid: PD, internalemailaddress: 'pd@keck.org', isdisabled: pdDisabled };
    if (set === 'wmkf_potentialreviewerses') return { wmkf_potentialreviewersid: PERSON, wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: reviewerEmail };
    return null;
  });
}

function candidate(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_potentialreviewer_value: PERSON,
    _wmkf_request_value: REQ,
    wmkf_reviewreceivedat: '2026-08-20T12:00:00.000Z',
    _etag: 'W/"100"',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  updateRecord.mockReset(); renderIndividualReviewDocx.mockReset(); ownReviewerThankYouTemplate.mockReset();
  ownReviewerThankYouTemplate.mockReset().mockResolvedValue({ status: 'absent', template: null });
  mockRequestTestState.mockImplementation(async () => ({ kind: 'ordinary', reason: 'test' }));
  readRequiredEmailDefaults.mockResolvedValue({
    ok: true,
    values: { [SUBJECT_KEY]: SUBJECT, [BODY_KEY]: BODY },
    failures: [],
  });
  fetchAnswersBySuggestion.mockResolvedValue({
    [SUG]: [
      { questionKey: 'q1', questionOrder: 1, questionText: 'Overall', questionType: 'picklist', answerHtml: '', answerText: 'Excellent', answerValue: 5 },
      { questionKey: 'q2', questionOrder: 2, questionText: 'Comments', questionType: 'richtext', answerHtml: '<p>Strong work</p>', answerText: '', answerValue: null },
    ],
  });
  preflightReviewDocxTemplates.mockResolvedValue(undefined);
  renderIndividualReviewDocx.mockResolvedValue(Buffer.from('docx-bytes'));
  createAndSendEmail.mockResolvedValue({ emailId: 'e-1' });
  updateRecord.mockResolvedValue(undefined);
});

describe('sweepReviewThankYous', () => {
  test('eligibility filter: received-not-thanked, keyed on wmkf_reviewreceivedat (not status)', async () => {
    queryAllRecords.mockResolvedValue({ records: [] });
    await sweepReviewThankYous();
    const [, opts] = queryAllRecords.mock.calls[0];
    expect(opts.filter).toContain('wmkf_reviewreceivedat ne null');
    expect(opts.filter).toContain('wmkf_thankyousentat eq null');
    expect(opts.filter).not.toContain('wmkf_reviewstatus');
  });

  test('eligible: builds DOCX, claims wmkf_thankyousentat (If-Match), THEN sends with the attachment', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] });
    installReads();
    const r = await sweepReviewThankYous();
    expect(r.sent).toBe(1);
    expect(r.attachmentFailed).toBe(0);
    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions', SUG,
      expect.objectContaining({ wmkf_thankyousentat: expect.any(String) }),
      expect.objectContaining({ ifMatch: 'W/"100"' }),
    );
    // Stage 5A wiring pin: the claim goes through the named op, not the
    // generic passthrough.
    expect(claimThankYou).toHaveBeenCalled();
    // Claim-before-send ordering.
    expect(updateRecord.mock.invocationCallOrder[0]).toBeLessThan(createAndSendEmail.mock.invocationCallOrder[0]);
    expect(renderIndividualReviewDocx.mock.invocationCallOrder[0]).toBeLessThan(updateRecord.mock.invocationCallOrder[0]);
    expect(renderIndividualReviewDocx.mock.calls[0][0].header.generatedAtIso)
      .toBe(updateRecord.mock.calls[0][2].wmkf_thankyousentat);
    const email = createAndSendEmail.mock.calls[0][0];
    expect(email.from).toBe('pd@keck.org');
    expect(email.to).toBe('rev@example.org');
    expect(email.subject).toBe('Thank You for Your Review — A Proposal');
    expect(email.body).toContain('Dear Dr. Reviewer,');
    expect(email.body).toContain('A Proposal');
    expect(email.body).toContain('Dr. PD');
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0]).toMatchObject({
      filename: 'Review-R-1.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(Buffer.isBuffer(email.attachments[0].content)).toBe(true);
  });

  test('missing _etag → fail closed (claimFailed, no claim write, no send)', async () => {
    const { _etag, ...noEtag } = candidate();
    queryAllRecords.mockResolvedValue({ records: [noEtag] });
    installReads();
    const r = await sweepReviewThankYous();
    expect(r.claimFailed).toBe(1);
    expect(r.sent).toBe(0);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('claim loses the If-Match race (412) → claimFailed, no send', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] });
    installReads();
    updateRecord.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
    const r = await sweepReviewThankYous();
    expect(r.claimFailed).toBe(1);
    expect(r.sent).toBe(0);
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('an ambiguous send error after a successful claim is unconfirmed and not retried', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] });
    installReads();
    createAndSendEmail.mockRejectedValueOnce(new Error('SMTP down'));
    const r = await sweepReviewThankYous();
    expect(updateRecord).toHaveBeenCalledTimes(1); // claim landed, never rolled back
    expect(r.sendUnconfirmed).toBe(1);
    expect(r.sent).toBe(0);
    expect(createAndSendEmail).toHaveBeenCalledTimes(1); // no retry
  });

  test('attachment compose failure → leaves row unclaimed and unsent for retry', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] });
    installReads();
    renderIndividualReviewDocx.mockRejectedValueOnce(new Error('docx boom'));
    const r = await sweepReviewThankYous();
    expect(r.sent).toBe(0);
    expect(r.attachmentFailed).toBe(1);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('template preflight failure skips every row before any claim', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] });
    installReads();
    preflightReviewDocxTemplates.mockRejectedValueOnce(new Error('marker missing'));
    const r = await sweepReviewThankYous();
    expect(r.skippedMisconfigured).toBe(1);
    expect(r.errors[0].message).toMatch(/template misconfigured/);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('email defaults misconfigured → skip all before claim, no send', async () => {
    readRequiredEmailDefaults.mockResolvedValue({
      ok: false,
      values: {},
      failures: [{ key: SUBJECT_KEY, reason: 'blank' }],
    });
    queryAllRecords.mockResolvedValue({ records: [candidate()] });
    installReads();
    const r = await sweepReviewThankYous();
    expect(r.skippedMisconfigured).toBe(1);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('missing reviewer email → skipped, no claim or send', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] });
    installReads({ reviewerEmail: null });
    const r = await sweepReviewThankYous();
    expect(r.sent).toBe(0);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('disabled PD (no sender) → skipped', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] });
    installReads({ pdDisabled: true });
    const r = await sweepReviewThankYous();
    expect(r.sent).toBe(0);
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('dryRun: counts eligible but never claims or sends', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] });
    installReads();
    const r = await sweepReviewThankYous({ dryRun: true });
    expect(r.eligible).toBe(1);
    expect(r.sent).toBe(0);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('maxBatch bounds CLAIMS even when sends are unconfirmed (no mass suppression)', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => candidate({ wmkf_appreviewersuggestionid: `id-${i}`, _etag: `W/"${i}"` }));
    queryAllRecords.mockResolvedValue({ records: rows });
    installReads();
    fetchAnswersBySuggestion.mockResolvedValue({});
    createAndSendEmail.mockRejectedValue(new Error('SMTP down'));
    const r = await sweepReviewThankYous({ maxBatch: 2 });
    expect(updateRecord).toHaveBeenCalledTimes(2);
    expect(r.sendUnconfirmed).toBe(2);
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(3);
  });

  describe('retired honorarium token cannot imply a closeout decision', () => {
    const HONORARIUM_LINE = 'We will be in touch regarding the processing of your honorarium.';
    const BODY_WITH_NOTE = '{{greeting}},\n\nThank you for completing your review of “{{proposalTitle}}”.\n\n{{honorariumNote}}\n\nWith gratitude,\n\n{{signature}}';

    beforeEach(() => {
      readRequiredEmailDefaults.mockResolvedValue({
        ok: true,
        values: { [SUBJECT_KEY]: SUBJECT, [BODY_KEY]: BODY_WITH_NOTE },
        failures: [],
      });
    });

    test('projects wmkf_honorariumoptout in the eligibility select', async () => {
      queryAllRecords.mockResolvedValue({ records: [] });
      await sweepReviewThankYous();
      const [, opts] = queryAllRecords.mock.calls[0];
      expect(opts.select.split(',')).toContain('wmkf_honorariumoptout');
    });

    test('opt-out true → honorarium line omitted, no literal token, no blank paragraph; claim/attachment/send unchanged', async () => {
      queryAllRecords.mockResolvedValue({ records: [candidate({ wmkf_honorariumoptout: true })] });
      installReads();
      const r = await sweepReviewThankYous();
      expect(r.sent).toBe(1);
      const email = createAndSendEmail.mock.calls[0][0];
      expect(email.body).not.toContain(HONORARIUM_LINE);
      expect(email.body).not.toContain('honorarium');
      expect(email.body).not.toContain('{{honorariumNote}}');
      expect(email.body).not.toMatch(/<p[^>]*><\/p>/);
      expect(email.body).toContain('Dear Dr. Reviewer,');
      expect(email.body).toContain('With gratitude,');
      // Existing contract untouched: recipients, subject, attachment, claim-before-send.
      expect(email.to).toBe('rev@example.org');
      expect(email.subject).toBe('Thank You for Your Review — A Proposal');
      expect(email.attachments).toHaveLength(1);
      expect(updateRecord).toHaveBeenCalledWith(
        'wmkf_appreviewersuggestions', SUG,
        expect.objectContaining({ wmkf_thankyousentat: expect.any(String) }),
        expect.objectContaining({ ifMatch: 'W/"100"' }),
      );
      expect(updateRecord.mock.invocationCallOrder[0]).toBeLessThan(createAndSendEmail.mock.invocationCallOrder[0]);
    });

    test('opt-out false still omits payment language', async () => {
      queryAllRecords.mockResolvedValue({ records: [candidate({ wmkf_honorariumoptout: false })] });
      installReads();
      await sweepReviewThankYous();
      const email = createAndSendEmail.mock.calls[0][0];
      expect(email.body).not.toContain(HONORARIUM_LINE);
      expect(email.body).not.toContain('{{honorariumNote}}');
    });

    test.each([
      ['null (row predates the Stage 2a column)', null],
      ['undefined (field absent from the row)', undefined],
    ])('uncaptured choice — %s → payment language remains omitted', async (_label, value) => {
      const row = candidate();
      if (value === undefined) delete row.wmkf_honorariumoptout; else row.wmkf_honorariumoptout = value;
      queryAllRecords.mockResolvedValue({ records: [row] });
      installReads();
      await sweepReviewThankYous();
      const email = createAndSendEmail.mock.calls[0][0];
      expect(email.body).not.toContain(HONORARIUM_LINE);
    });

    test('opt-out true + attachment failure → still unclaimed and unsent for retry', async () => {
      queryAllRecords.mockResolvedValue({ records: [candidate({ wmkf_honorariumoptout: true })] });
      installReads();
      renderIndividualReviewDocx.mockRejectedValueOnce(new Error('docx boom'));
      const r = await sweepReviewThankYous();
      expect(r.attachmentFailed).toBe(1);
      expect(r.sent).toBe(0);
      expect(updateRecord).not.toHaveBeenCalled();
      expect(createAndSendEmail).not.toHaveBeenCalled();
    });
  });
});

describe('Test Request isolation (Stage 1c)', () => {
  test.each([
    ['a test request', 'synthetic', 'skippedTestRequest'],
    ['an unreadable marker', 'unknown', 'testStateUnknown'],
  ])('skips %s before any request read, claim or send', async (_label, kind, counter) => {
    mockRequestTestState.mockImplementation(async () => ({ kind, reason: 'x' }));
    queryAllRecords.mockResolvedValue({ records: [candidate()] });
    installReads();
    const r = await sweepReviewThankYous();
    expect(mockRequestTestState).toHaveBeenCalledWith(REQ);
    expect(r[counter]).toBe(1);
    expect(getRecord).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });
});

describe('automatic personal defaults and pre-claim safety', () => {
  const own = (subject, body) => ({ status: 'configured', template: { subject, body } });
  const safe = { subject: 'Personal {{proposalTitle}}', body: '{{greeting}} thank you for {{proposalTitle}}. {{signature}}' };
  test('personal raw pair is rendered before DOCX/claim and sends exact server sender, attachment and signature', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] }); installReads(); ownReviewerThankYouTemplate.mockResolvedValue(own(safe.subject, safe.body));
    const result = await sweepReviewThankYous(); expect(result.sent).toBe(1); expect(ownReviewerThankYouTemplate).toHaveBeenCalledWith(PD);
    const email = createAndSendEmail.mock.calls[0][0]; expect(email.subject).toBe('Personal A Proposal'); expect(email.body).toContain('thank you for A Proposal'); expect(email.body).toContain('Dr. PD');
    expect(email).toMatchObject({ from: 'pd@keck.org', to: 'rev@example.org', actingUserSystemId: PD, noFallback: true });
    expect(email.attachments[0].content).toEqual(Buffer.from('docx-bytes'));
  });
  test.each(['invalid', 'duplicates', 'encrypted', 'unavailable', 'identity_unavailable'])('%s own defaults pause before attachment/claim without fallback', async status => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] }); installReads(); ownReviewerThankYouTemplate.mockResolvedValue({ status, template: null });
    const result = await sweepReviewThankYous(); expect(result).toMatchObject({ eligible: 1, skipped: 1, skippedMisconfigured: 1, sent: 0 });
    expect(result.errors[0].reason).toBe(`preference_${status}`); expect(renderIndividualReviewDocx).not.toHaveBeenCalled(); expect(updateRecord).not.toHaveBeenCalled(); expect(createAndSendEmail).not.toHaveBeenCalled();
  });
  test.each([false, true])('shared empty rendered business copy is refused before claim, then recovers in a fresh run (dry=%s)', async dryRun => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] }); installReads();
    readRequiredEmailDefaults.mockResolvedValueOnce({ ok: true, values: { [SUBJECT_KEY]: SUBJECT, [BODY_KEY]: '{{honorariumNote}}' } });
    const failed = await sweepReviewThankYous({ dryRun }); expect(failed).toMatchObject({ eligible: 1, skipped: 1, skippedMisconfigured: 1, claimFailed: 0, sent: 0 });
    expect(failed.errors[0].reason).toBe('rendered_copy_invalid'); expect(updateRecord).not.toHaveBeenCalled(); expect(renderIndividualReviewDocx).not.toHaveBeenCalled();
    const recovered = await sweepReviewThankYous(); expect(recovered.sent).toBe(1); expect(updateRecord).toHaveBeenCalledTimes(1); expect(ownReviewerThankYouTemplate).toHaveBeenCalledTimes(2);
  });
  test.each([['newline', 'A\nProposal', SUBJECT, BODY], ['long subject', 'x'.repeat(2001), '{{proposalTitle}}', BODY], ['long body', 'x'.repeat(60000), 'Thanks', '{{proposalTitle}}{{proposalTitle}}']])('expanded context %s refuses before DOCX/claim', async (_kind, title, subject, body) => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] }); installReads({ request: requestConfig({ akoya_title: title }) });
    readRequiredEmailDefaults.mockResolvedValue({ ok: true, values: { [SUBJECT_KEY]: subject, [BODY_KEY]: body } });
    const result = await sweepReviewThankYous(); expect(result.skippedMisconfigured).toBe(1); expect(result.errors[0].reason).toBe('rendered_context_invalid'); expect(updateRecord).not.toHaveBeenCalled(); expect(renderIndividualReviewDocx).not.toHaveBeenCalled();
  });
  test.each([false, true])('invalid concrete ETag and bad copy count claimFailed first in both modes (dry=%s)', async dryRun => {
    queryAllRecords.mockResolvedValue({ records: [candidate({ _etag: '*' })] }); installReads();
    readRequiredEmailDefaults.mockResolvedValue({ ok: true, values: { [SUBJECT_KEY]: 'x\ny', [BODY_KEY]: '{{honorariumNote}}' } });
    expect(await sweepReviewThankYous({ dryRun })).toMatchObject({ claimFailed: 1, skipped: 0, skippedMisconfigured: 0 });
    expect(updateRecord).not.toHaveBeenCalled(); expect(renderIndividualReviewDocx).not.toHaveBeenCalled();
  });
  test('shared unknown/legacy token grammar stays compatible, but personal unknown tokens do not', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] }); installReads();
    readRequiredEmailDefaults.mockResolvedValue({ ok: true, values: { [SUBJECT_KEY]: 'Shared {{future}} [proposal title]', [BODY_KEY]: '[greeting] {{future}} [Program Director signature]' } });
    expect((await sweepReviewThankYous()).sent).toBe(1); expect(createAndSendEmail.mock.calls[0][0]).toMatchObject({ subject: 'Shared {{future}} A Proposal' });
    expect(createAndSendEmail.mock.calls[0][0].body).toContain('{{future}}');
    updateRecord.mockClear(); createAndSendEmail.mockClear(); ownReviewerThankYouTemplate.mockResolvedValue(own('{{future}}', '{{greeting}} Thanks'));
    expect((await sweepReviewThankYous()).skippedMisconfigured).toBe(1); expect(updateRecord).not.toHaveBeenCalled(); expect(createAndSendEmail).not.toHaveBeenCalled();
  });
  test('same-PD failures share one snapshot/group while other PDs proceed; next run reads fresh', async () => {
    const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    queryAllRecords.mockResolvedValue({ records: [candidate(), candidate({ wmkf_appreviewersuggestionid: 'row2', _wmkf_request_value: 'req-2' }), candidate({ wmkf_appreviewersuggestionid: 'row3', _wmkf_request_value: 'req-3' })] });
    getRecord.mockImplementation(async (set, id) => set === 'akoya_requests' ? requestConfig({ akoya_requestid: id, _wmkf_programdirector_value: id === 'req-3' ? OTHER : PD.toUpperCase() }) : set === 'systemusers' ? { systemuserid: id, internalemailaddress: 'pd@keck.org', isdisabled: false } : { wmkf_name: 'Reviewer', wmkf_emailaddress: 'rev@example.org' });
    ownReviewerThankYouTemplate.mockImplementation(async id => id === PD ? { status: 'unavailable' } : { status: 'absent' });
    const first = await sweepReviewThankYous(); expect(first).toMatchObject({ eligible: 3, skippedMisconfigured: 2, sent: 1 }); expect(ownReviewerThankYouTemplate).toHaveBeenCalledTimes(2); expect(first.errors[0]).toMatchObject({ affectedCount: 2, sampleIds: [SUG, 'row2'] });
    queryAllRecords.mockResolvedValue({ records: [candidate()] }); installReads(); ownReviewerThankYouTemplate.mockResolvedValue({ status: 'absent' });
    expect((await sweepReviewThankYous()).sent).toBe(1); expect(ownReviewerThankYouTemplate).toHaveBeenCalledTimes(3);
  });
  test('same-PD successful snapshot remains complete when saved default changes between rows', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate(), candidate({ wmkf_appreviewersuggestionid: 'row2' })] }); installReads();
    ownReviewerThankYouTemplate.mockResolvedValueOnce(own('First subject', 'First body')).mockResolvedValue(own('Later subject', 'Later body'));
    expect((await sweepReviewThankYous()).sent).toBe(2); expect(ownReviewerThankYouTemplate).toHaveBeenCalledTimes(1);
    expect(createAndSendEmail.mock.calls.every(([email]) => email.subject === 'First subject' && email.body.includes('First body'))).toBe(true);
  });
  test('overlapping sweeps with different default snapshots have one ETag winner and one unmixed pair', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] }); installReads();
    ownReviewerThankYouTemplate.mockResolvedValueOnce(own('Subject A', 'Body A')).mockResolvedValueOnce(own('Subject B', 'Body B'));
    let release; const prepared = new Promise(r => { release = r; }); let arrivals = 0;
    renderIndividualReviewDocx.mockImplementation(async () => { if (++arrivals === 2) release(); await prepared; return Buffer.from('docx-bytes'); });
    let claimed = false; updateRecord.mockImplementation(async () => { if (claimed) throw Object.assign(new Error('etag mismatch'), { status: 412 }); claimed = true; });
    const results = await Promise.all([sweepReviewThankYous(), sweepReviewThankYous()]);
    expect(results.reduce((sum, x) => sum + x.sent, 0)).toBe(1); expect(results.reduce((sum, x) => sum + x.claimFailed, 0)).toBe(1); expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    const email = createAndSendEmail.mock.calls[0][0]; expect(email.body).toContain(email.subject === 'Subject A' ? 'Body A' : 'Body B'); expect(ownReviewerThankYouTemplate).toHaveBeenCalledTimes(2);
  });
  test('diagnostic caps do not hide refusal counts; maxBatch stops lookup on rows after an attempt', async () => {
    const records = Array.from({ length: 120 }, (_, i) => candidate({ wmkf_appreviewersuggestionid: `row${i}` })); queryAllRecords.mockResolvedValue({ records }); installReads(); ownReviewerThankYouTemplate.mockResolvedValue({ status: 'unavailable' });
    const failed = await sweepReviewThankYous({ maxBatch: 1 }); expect(failed.skippedMisconfigured).toBe(120); expect(failed.errors).toHaveLength(1); expect(failed.errors[0]).toMatchObject({ affectedCount: 120 }); expect(failed.errors[0].sampleIds).toHaveLength(10);
    ownReviewerThankYouTemplate.mockClear().mockResolvedValue({ status: 'absent' });
    expect(await sweepReviewThankYous({ maxBatch: 1 })).toMatchObject({ sent: 1, eligible: 1, skipped: 119 }); expect(ownReviewerThankYouTemplate).toHaveBeenCalledTimes(1);
  });
});


test('final rendered bounds are inclusive, whitespace is checked but not rewritten, and unknown sources refuse', () => {
  const args = { row: candidate(), request: requestConfig(), pd: { fullname: 'PD', internalemailaddress: 'pd@keck.org' }, reviewer: { wmkf_name: 'Reviewer' }, signatureBlock: { signature: 'PD' }, subjectTemplate: 'x'.repeat(2000), bodyTemplate: 'x'.repeat(100000) };
  expect(prepareReviewerThankYou(args).ok).toBe(true);
  expect(prepareReviewerThankYou({ ...args, subjectTemplate: 'x'.repeat(2001) }).reason).toBe('rendered_context_invalid');
  expect(prepareReviewerThankYou({ ...args, bodyTemplate: 'x'.repeat(100001) }).reason).toBe('rendered_context_invalid');
  expect(prepareReviewerThankYou({ ...args, subjectTemplate: '  Padded  ', bodyTemplate: ' Body ' }).subject).toBe('  Padded  ');
  expect(prepareReviewerThankYou({ ...args, source: 'unknown' }).reason).toBe('preference_invalid');
});
test('new diagnostic groups cap at100 while every PD refusal is counted and no claim occurs', async () => {
  const ids = Array.from({ length: 105 }, (_, i) => `${String(i + 1).padStart(8, '0')}-1111-4111-8111-111111111111`);
  queryAllRecords.mockResolvedValue({ records: ids.map(id => candidate({ wmkf_appreviewersuggestionid: id, _wmkf_request_value: id })) });
  getRecord.mockImplementation(async (set, id) => set === 'akoya_requests' ? requestConfig({ akoya_requestid: id, _wmkf_programdirector_value: id }) : set === 'systemusers' ? { systemuserid: id, internalemailaddress: 'pd@keck.org', isdisabled: false } : { wmkf_name: 'Reviewer', wmkf_emailaddress: 'rev@example.org' });
  ownReviewerThankYouTemplate.mockResolvedValue({ status: 'duplicates' });
  const result = await sweepReviewThankYous(); expect(result.skippedMisconfigured).toBe(105); expect(result.errors).toHaveLength(100);
  expect(updateRecord).not.toHaveBeenCalled(); expect(createAndSendEmail).not.toHaveBeenCalled();
});
