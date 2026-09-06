/**
 * @jest-environment node
 *
 * Delegation pin (Stage 3 build plan, mandatory from 3E on): mocks the
 * extracted `reviewer-engagement/change-review-deadline` command and drives
 * `saveReviewerDueDateExtension` through its eligible path, so a faithful
 * inline reimplementation of the write in `reviewer-due-extension.js` (that
 * keeps the import for the census) still goes red.
 */

jest.mock('../../lib/services/reviewer-engagement/change-review-deadline', () => ({
  changeReviewDeadline: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion.js', () => ({
  getByIdWithSelect: jest.fn(),
  isExcluded: jest.fn(() => false),
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer.js', () => ({
  getById: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/system-user.js', () => ({
  getById: jest.fn(),
}));
jest.mock('../../lib/services/email-defaults.js', () => ({
  readRequiredEmailDefaults: jest.fn(),
}));
jest.mock('../../lib/services/email-signature.js', () => ({
  resolveSignatureForRequest: jest.fn(),
}));
jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: { createAndSendEmail: jest.fn() },
}));

import { saveReviewerDueDateExtension } from '../../lib/services/reviewer-due-extension';
import { changeReviewDeadline } from '../../lib/services/reviewer-engagement/change-review-deadline';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion';
import { getById as getRequestById } from '../../lib/dataverse/adapters/grant-request';
import { getById as getPotentialReviewerById } from '../../lib/dataverse/adapters/potential-reviewer';
import { getById as getSystemUserById } from '../../lib/dataverse/adapters/system-user';
import { readRequiredEmailDefaults } from '../../lib/services/email-defaults';
import { resolveSignatureForRequest } from '../../lib/services/email-signature';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { REVIEWER_EXTENSION_SEED_BODY } from '../../lib/seed/email-defaults/reviewer-actions';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const PD_ID = '44444444-4444-4444-8444-444444444444';
const BODY = REVIEWER_EXTENSION_SEED_BODY;
const ORIGINAL_IMPERSONATION_SETTING = process.env.DYNAMICS_IMPERSONATION_ENABLED;

function suggestion(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_accepted: true,
    wmkf_declined: false,
    wmkf_reviewstatus: 100000001,
    wmkf_reviewreceivedat: null,
    wmkf_completedat: null,
    wmkf_reviewduedateoverride: null,
    wmkf_externaltokenhash: 'active-token-hash',
    wmkf_externaltokenexpires: '2099-12-01T23:59:59Z',
    wmkf_externaltokenrevoked: false,
    wmkf_reviewerfirstname: 'Ada',
    wmkf_reviewerlastname: 'Lovelace',
    wmkf_reviewernickname: 'Ada',
    wmkf_revieweremail: 'confirmed@example.org',
    _etag: 'W/"7"',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
  suggestionAdapter.getByIdWithSelect.mockResolvedValue(suggestion());
  changeReviewDeadline.mockResolvedValue({});
  getRequestById.mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_title: 'A Better Telescope',
    wmkf_reviewduedate: '2099-09-01',
    _wmkf_programdirector_value: PD_ID,
  });
  getPotentialReviewerById.mockResolvedValue(null);
  getSystemUserById.mockResolvedValue({
    systemuserid: PD_ID,
    fullname: 'Pat Director',
    internalemailaddress: 'pd@wmkeck.org',
    isdisabled: false,
  });
  readRequiredEmailDefaults.mockResolvedValue({
    ok: true,
    values: { 'email.reviewer_extension.body': BODY },
    failures: [],
  });
  resolveSignatureForRequest.mockResolvedValue({
    signature: 'Pat Director\nW. M. Keck Foundation',
    name: 'Pat Director',
    customClosing: false,
  });
  DynamicsService.createAndSendEmail.mockResolvedValue({ emailId: 'email-1' });
});

afterAll(() => {
  if (ORIGINAL_IMPERSONATION_SETTING === undefined) {
    delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
  } else {
    process.env.DYNAMICS_IMPERSONATION_ENABLED = ORIGINAL_IMPERSONATION_SETTING;
  }
});

test('delegates the deadline write to changeReviewDeadline with the suggestion _etag, after prepareNotification and before the send', async () => {
  const result = await saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
    actingUserSystemId: PD_ID,
  });

  expect(result).toEqual({
    ok: true,
    saved: true,
    notified: true,
    effectiveReviewDeadline: '2099-09-15',
  });

  expect(changeReviewDeadline).toHaveBeenCalledTimes(1);
  expect(changeReviewDeadline).toHaveBeenCalledWith({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
    ifMatch: 'W/"7"',
    actingUserSystemId: PD_ID,
  });

  // prepareNotification resolves before the write: resolveSignatureForRequest
  // (a prepareNotification prerequisite) is called before changeReviewDeadline.
  expect(resolveSignatureForRequest.mock.invocationCallOrder[0])
    .toBeLessThan(changeReviewDeadline.mock.invocationCallOrder[0]);

  // the write commits before the notification is dispatched.
  expect(changeReviewDeadline.mock.invocationCallOrder[0])
    .toBeLessThan(DynamicsService.createAndSendEmail.mock.invocationCallOrder[0]);
});

test('a thrown 412 from the command yields the existing classifySaveError conflict reason and no send', async () => {
  changeReviewDeadline.mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 412 }));

  const result = await saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
    actingUserSystemId: PD_ID,
  });

  expect(result).toEqual({ ok: false, reason: 'conflict' });
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});
