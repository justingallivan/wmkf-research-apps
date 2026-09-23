/** @jest-environment node */
/**
 * Materials create/invite/remind each send email, so each must run the Test
 * Request early refusal before loading the request or touching the collection.
 * The post-claim send helper does no fallible read (it would consume the
 * at-most-once claim of an ordinary request).
 */

const refusal = Object.assign(new Error('Email is disabled for test requests.'), {
  httpStatus: 409,
  code: 'test_request_email_denied',
});
const assertRequestEmailAllowed = jest.fn(async () => { throw refusal; });
jest.mock('../../lib/services/test-requests/request-test-state.js', () => ({
  assertRequestEmailAllowed: (...args) => assertRequestEmailAllowed(...args),
}));

import {
  createMaterialsCollection,
  inviteMaterialsContributors,
  remindMaterialsContributors,
  sendReminderEmail,
} from '../../lib/services/site-visit-materials/collection-service.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

function dependencies() {
  return {
    schemaReady: () => true,
    getRequest: jest.fn(),
    getOpenCollection: jest.fn(),
    findActiveSiteVisit: jest.fn(),
  };
}

test.each([
  ['createMaterialsCollection', createMaterialsCollection],
  ['inviteMaterialsContributors', inviteMaterialsContributors],
  ['remindMaterialsContributors', remindMaterialsContributors],
])('%s refuses a test request before loading it or its collection', async (_name, fn) => {
  const deps = dependencies();
  await expect(fn({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps)).rejects.toBe(refusal);
  expect(assertRequestEmailAllowed).toHaveBeenCalledWith(REQUEST_ID);
  expect(deps.getRequest).not.toHaveBeenCalled();
  expect(deps.getOpenCollection).not.toHaveBeenCalled();
  expect(deps.findActiveSiteVisit).not.toHaveBeenCalled();
});

test('sendReminderEmail runs after the claim and does no test-request read of its own', async () => {
  assertRequestEmailAllowed.mockClear();
  const deps = { sendEmail: jest.fn(async () => 'email-1') };
  await expect(sendReminderEmail({
    row: { id: 7, request_id: REQUEST_ID, contacts: [] },
    prepared: { subject: 's', bodyText: 'b' },
    fromEmail: 'pd@example.org',
    actorId: ACTOR_ID,
    sequence: 1,
  }, deps)).resolves.toBe('email-1');
  expect(assertRequestEmailAllowed).not.toHaveBeenCalled();
});
