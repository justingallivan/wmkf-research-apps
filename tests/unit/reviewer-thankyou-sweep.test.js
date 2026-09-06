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
  claimThankYou: (id, sentAtIso, opts) => updateRecord('wmkf_appreviewersuggestions', id, { wmkf_thankyousentat: sentAtIso }, opts),
}));

const { sweepReviewThankYous } = require('../../lib/services/reviewer-thankyou-sweep');

const SUG = '11111111-1111-4111-8111-111111111111';
const REQ = 'req-1';
const PD = 'pd-1';
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

  test('send fails after a successful claim → at-most-once (sendFailed, marker NOT rolled back, no retry)', async () => {
    queryAllRecords.mockResolvedValue({ records: [candidate()] });
    installReads();
    createAndSendEmail.mockRejectedValueOnce(new Error('SMTP down'));
    const r = await sweepReviewThankYous();
    expect(updateRecord).toHaveBeenCalledTimes(1); // claim landed, never rolled back
    expect(r.sendFailed).toBe(1);
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

  test('maxBatch bounds CLAIMS even when sends fail (no mass suppression)', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => candidate({ wmkf_appreviewersuggestionid: `id-${i}`, _etag: `W/"${i}"` }));
    queryAllRecords.mockResolvedValue({ records: rows });
    installReads();
    fetchAnswersBySuggestion.mockResolvedValue({});
    createAndSendEmail.mockRejectedValue(new Error('SMTP down'));
    const r = await sweepReviewThankYous({ maxBatch: 2 });
    expect(updateRecord).toHaveBeenCalledTimes(2);
    expect(r.sendFailed).toBe(2);
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
