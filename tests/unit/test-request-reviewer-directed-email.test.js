import { assertReviewerDirectedEmailBound } from '../../lib/services/test-requests/reviewer-directed-email.js';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const SUGGESTION = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';

function fixture() {
  return {
    requestId: REQUEST, suggestionId: SUGGESTION, recipients: ['cast@wmkeck.org'],
    env: { TEST_REQUEST_ISOLATION: 'on', SYNTHETIC_REVIEWER_ISOLATION: 'on' },
    resolveState: jest.fn(async () => ({ kind: 'synthetic', runId: RUN })),
    getSuggestion: jest.fn(async () => ({
      wmkf_appreviewersuggestionid: SUGGESTION,
      _wmkf_request_value: REQUEST,
      _wmkf_potentialreviewer_value: PERSON,
    })),
    getPerson: jest.fn(async () => ({
      wmkf_potentialreviewersid: PERSON,
      wmkf_emailaddress: 'Cast@WMKECK.ORG ',
      wmkf_issyntheticreviewer: true,
      statecode: 0,
    })),
    assertAllowlisted: jest.fn(async () => {}),
  };
}

test('a bound cast reviewer with the stored allowlisted address passes', async () => {
  const args = fixture();
  await expect(assertReviewerDirectedEmailBound(args)).resolves.toMatchObject({ kind: 'synthetic' });
  expect(args.assertAllowlisted).toHaveBeenCalledWith(REQUEST, expect.objectContaining({ recipients: ['cast@wmkeck.org'] }));
});

test('an allowlisted address belonging to someone other than the bound cast reviewer refuses', async () => {
  const args = fixture();
  args.recipients = ['other@wmkeck.org'];
  await expect(assertReviewerDirectedEmailBound(args)).rejects.toMatchObject({ code: 'test_request_reviewer_email_unbound' });
  expect(args.assertAllowlisted).not.toHaveBeenCalled();
});

test('a matching address with a suggestion bound to another Request refuses', async () => {
  const args = fixture();
  args.getSuggestion.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUGGESTION,
    _wmkf_request_value: PERSON,
    _wmkf_potentialreviewer_value: PERSON,
  });
  await expect(assertReviewerDirectedEmailBound(args)).rejects.toMatchObject({ code: 'test_request_reviewer_email_unbound' });
});

test('an ordinary Request keeps its existing reviewer email path', async () => {
  const args = fixture();
  args.resolveState.mockResolvedValue({ kind: 'ordinary' });
  await expect(assertReviewerDirectedEmailBound(args)).resolves.toMatchObject({ kind: 'ordinary' });
  expect(args.getPerson).not.toHaveBeenCalled();
  expect(args.assertAllowlisted).toHaveBeenCalled();
});

test('a bound cast address still requires the allowlist', async () => {
  const args = fixture();
  args.assertAllowlisted.mockRejectedValue(Object.assign(new Error('denied'), { code: 'test_request_email_denied' }));
  await expect(assertReviewerDirectedEmailBound(args)).rejects.toMatchObject({ code: 'test_request_email_denied' });
});

test('a Request changing classification during the allowlist read is refused', async () => {
  const args = fixture();
  args.resolveState.mockResolvedValueOnce({ kind: 'ordinary' }).mockResolvedValueOnce({ kind: 'synthetic', runId: RUN });
  await expect(assertReviewerDirectedEmailBound(args)).rejects.toMatchObject({ code: 'test_request_reviewer_email_unbound' });
});
