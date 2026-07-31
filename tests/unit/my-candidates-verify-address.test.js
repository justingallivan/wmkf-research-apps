/** @jest-environment node */

const findById = jest.fn();
const updateById = jest.fn();

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  updateById: (...args) => updateById(...args),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({}));
jest.mock('../../lib/dataverse/adapters/account', () => ({}));
jest.mock('../../lib/services/program-director-resolver', () => ({}));
jest.mock('../../lib/external/token-lifecycle', () => ({}));
jest.mock('../../lib/services/external-token', () => ({}));

const { patchMyCandidates, MyCandidatesError } = require('../../lib/services/reviewer-finder/my-candidates-service');

test('legacy provenance-only address verification is retired with a working remedy', async () => {
  const error = await patchMyCandidates({
    body: {
      suggestionId: '22222222-2222-4222-8222-222222222222',
      requestId: '11111111-1111-4111-8111-111111111111',
      verifyEmailAddress: true,
      verifiedEmail: 'reviewer@example.edu',
    },
    actingUserSystemId: 'system-1',
  }).catch((caught) => caught);

  expect(error).toBeInstanceOf(MyCandidatesError);
  expect(error.httpStatus).toBe(409);
  expect(error.body).toMatchObject({
    code: 'address_verification_moved',
    remediation: [{ action: 'verify_person_and_address' }],
  });
  expect(findById).not.toHaveBeenCalled();
  expect(updateById).not.toHaveBeenCalled();
});
