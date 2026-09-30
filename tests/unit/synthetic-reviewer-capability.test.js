/** @jest-environment node */

import { resolveReviewerBindCapability } from '../../lib/services/test-requests/synthetic-reviewer-capability';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const on = { SYNTHETIC_REVIEWER_ISOLATION: 'on', TEST_REQUEST_ISOLATION: 'on' };

function fixture({ marked = true, requestState = 'synthetic', slot = PERSON, suggestion = null } = {}) {
  return {
    personId: PERSON,
    requestId: REQUEST,
    env: on,
    personAdapter: {
      getById: jest.fn(async () => ({
        wmkf_potentialreviewersid: PERSON,
        statecode: 0,
        wmkf_emailaddress: 'cast@example.org',
        wmkf_issyntheticreviewer: marked,
      })),
    },
    requestAdapter: {
      getById: jest.fn(async () => ({
        akoya_requestid: REQUEST,
        _wmkf_potentialreviewer1_value: slot,
      })),
    },
    suggestionAdapter: {
      findByPotentialReviewerAndRequest: jest.fn(async () => suggestion),
    },
    resolveTestState: jest.fn(async () => ({ kind: requestState, runId: RUN })),
  };
}

test('an exact slot authorizes a marked person only on a verified test Request', async () => {
  const args = fixture();
  await expect(resolveReviewerBindCapability(args)).resolves.toMatchObject({
    kind: 'synthetic', binding: 'slot',
  });
  expect(args.requestAdapter.getById).toHaveBeenCalledWith(REQUEST, {
    select: expect.stringContaining('_wmkf_potentialreviewer5_value'),
  });
});

test('an exact existing suggestion can prove the pair when no slot contains the person', async () => {
  const args = fixture({ slot: null, suggestion: {
    _wmkf_potentialreviewer_value: PERSON,
    _wmkf_request_value: REQUEST,
  } });
  await expect(resolveReviewerBindCapability(args)).resolves.toMatchObject({
    kind: 'synthetic', binding: 'suggestion',
  });
});

test.each(['ordinary', 'unknown', 'anomaly'])('a marked person refuses a %s Request', async (requestState) => {
  await expect(resolveReviewerBindCapability(fixture({ requestState })))
    .rejects.toMatchObject({ code: 'synthetic_reviewer_request_not_verified' });
});

test('a client person ID with no server-read binding is insufficient', async () => {
  await expect(resolveReviewerBindCapability(fixture({ slot: null })))
    .rejects.toMatchObject({ code: 'synthetic_reviewer_pair_unverified' });
});

test('manual add refuses a marked person even with an exact slot', async () => {
  await expect(resolveReviewerBindCapability({ ...fixture(), allowSynthetic: false }))
    .rejects.toMatchObject({ code: 'synthetic_reviewer_not_bindable' });
});

test('an ordinary person can bind while Request isolation is off after a marker read', async () => {
  const args = fixture({ marked: false });
  args.env = { SYNTHETIC_REVIEWER_ISOLATION: 'on', TEST_REQUEST_ISOLATION: 'off' };
  await expect(resolveReviewerBindCapability(args)).resolves.toMatchObject({ kind: 'ordinary' });
  expect(args.resolveTestState).not.toHaveBeenCalled();
});

test('a legacy null marker is an ordinary person, but an omitted marker is unknown', async () => {
  const legacy = fixture({ marked: null });
  await expect(resolveReviewerBindCapability(legacy)).resolves.toMatchObject({ kind: 'ordinary' });
  const omitted = fixture();
  omitted.personAdapter.getById.mockResolvedValue({ wmkf_potentialreviewersid: PERSON, statecode: 0 });
  await expect(resolveReviewerBindCapability(omitted))
    .rejects.toMatchObject({ code: 'reviewer_person_unavailable' });
});

test('an inactive person gets a distinct repair reason and cannot bind', async () => {
  const args = fixture({ marked: false });
  args.personAdapter.getById.mockResolvedValue({
    wmkf_potentialreviewersid: PERSON, statecode: 1, wmkf_issyntheticreviewer: false,
  });
  await expect(resolveReviewerBindCapability(args))
    .rejects.toMatchObject({ code: 'reviewer_person_inactive' });
  expect(args.requestAdapter.getById).not.toHaveBeenCalled();
});

test('a marked person refuses when Request isolation is off', async () => {
  const args = fixture();
  args.env = { SYNTHETIC_REVIEWER_ISOLATION: 'on', TEST_REQUEST_ISOLATION: 'off' };
  await expect(resolveReviewerBindCapability(args))
    .rejects.toMatchObject({ code: 'test_request_isolation_not_ready' });
  expect(args.requestAdapter.getById).not.toHaveBeenCalled();
});

test('a suggestion attached to another Request cannot prove a marked person', async () => {
  const args = fixture({ slot: null, suggestion: {
    _wmkf_potentialreviewer_value: PERSON, _wmkf_request_value: RUN,
  } });
  await expect(resolveReviewerBindCapability(args))
    .rejects.toMatchObject({ code: 'synthetic_reviewer_pair_unverified' });
});

test.each(['off', undefined, 'invalid'])('reviewer isolation %s blocks every bind before a person read', async (value) => {
  const args = fixture({ marked: false });
  args.env = { ...on, SYNTHETIC_REVIEWER_ISOLATION: value };
  await expect(resolveReviewerBindCapability(args))
    .rejects.toMatchObject({ code: 'reviewer_isolation_not_ready' });
  expect(args.personAdapter.getById).not.toHaveBeenCalled();
});
