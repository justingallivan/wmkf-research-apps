/**
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion.js', () => ({
  getByIdWithSelect: jest.fn(),
  isExcluded: jest.fn(() => false),
  updateLifecycle: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
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

import {
  retryReviewerDueDateNotification,
  saveReviewerDueDateExtension,
} from '../../lib/services/reviewer-due-extension';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion';
import { getById as getRequestById } from '../../lib/dataverse/adapters/grant-request';
import { getById as getSystemUserById } from '../../lib/dataverse/adapters/system-user';
import { readRequiredEmailDefaults } from '../../lib/services/email-defaults';
import { resolveSignatureForRequest } from '../../lib/services/email-signature';
import { DynamicsService } from '../../lib/services/dynamics-service';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const PD_ID = '44444444-4444-4444-8444-444444444444';
const BODY = 'Dear {{reviewerName}},\n\nWe are happy to receive your review of “{{proposalTitle}}” by {{reviewDueDate}}.\n\n{{signature}}';
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
  suggestionAdapter.updateLifecycle.mockResolvedValue({});
  getRequestById.mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_title: 'A Better Telescope',
    wmkf_reviewduedate: '2099-09-01',
    _wmkf_programdirector_value: PD_ID,
  });
  getSystemUserById.mockResolvedValue({
    systemuserid: PD_ID,
    fullname: 'Pat Director',
    internalemailaddress: 'pd@wmkf.org',
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

test('saves first, then automatically sends the confirmed reviewer a fixed-subject calendar update', async () => {
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
  expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION_ID,
    { reviewDueDateOverride: '2099-09-15' },
    { actingUserSystemId: PD_ID, ifMatch: 'W/"7"' },
  );
  expect(DynamicsService.createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({
    subject: 'Updated review deadline: A Better Telescope',
    from: 'pd@wmkf.org',
    to: 'confirmed@example.org',
    actingUserSystemId: PD_ID,
    noFallback: true,
  }));
  const email = DynamicsService.createAndSendEmail.mock.calls[0][0];
  expect(email.body).toContain('Ada Lovelace');
  expect(email.body).toContain('September 15, 2099');
  expect(email.body).toContain('Pat Director');
  expect(email.attachments).toHaveLength(1);
  expect(email.attachments[0].content.toString('utf8')).toContain('UID:wmkf-review-due-11111111-1111-4111-8111-111111111111@wmkf');
  expect(email.attachments[0].content.toString('utf8')).toContain('DTSTART;VALUE=DATE:20990915');
  expect(suggestionAdapter.updateLifecycle.mock.invocationCallOrder[0])
    .toBeLessThan(DynamicsService.createAndSendEmail.mock.invocationCallOrder[0]);
});

test('restoring clears the override and notifies with the original deadline', async () => {
  suggestionAdapter.getByIdWithSelect.mockResolvedValueOnce(suggestion({
    wmkf_reviewduedateoverride: '2099-09-15',
  }));

  const result = await saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: null,
  });

  expect(result.effectiveReviewDeadline).toBe('2099-09-01');
  expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION_ID,
    { reviewDueDateOverride: null },
    { actingUserSystemId: null, ifMatch: 'W/"7"' },
  );
  const email = DynamicsService.createAndSendEmail.mock.calls[0][0];
  expect(email.body).toContain('September 1, 2099');
  expect(email.attachments[0].content.toString('utf8')).toContain('DTSTART;VALUE=DATE:20990901');
});

test('rejects non-accepted rows and dates that are not after the original deadline before writing', async () => {
  suggestionAdapter.getByIdWithSelect.mockResolvedValueOnce(suggestion({ wmkf_accepted: false }));
  await expect(saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  })).resolves.toEqual({ ok: false, reason: 'ineligible' });

  suggestionAdapter.getByIdWithSelect.mockResolvedValueOnce(suggestion());
  await expect(saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-01',
  })).resolves.toEqual({ ok: false, reason: 'invalid_extension_date' });

  expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('rejects review-received status even when its receipt timestamp is anomalously absent', async () => {
  suggestionAdapter.getByIdWithSelect.mockResolvedValueOnce(suggestion({
    wmkf_reviewstatus: 100000003,
    wmkf_reviewreceivedat: null,
  }));

  await expect(saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  })).resolves.toEqual({ ok: false, reason: 'ineligible' });
  expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
});

test('rejects an unchanged extension so save cannot become an accidental resend', async () => {
  suggestionAdapter.getByIdWithSelect.mockResolvedValueOnce(suggestion({
    wmkf_reviewduedateoverride: '2099-09-15',
  }));

  await expect(saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  })).resolves.toEqual({ ok: false, reason: 'no_change' });
  expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('keeps the saved deadline and returns retryable partial success when sending fails', async () => {
  DynamicsService.createAndSendEmail.mockRejectedValueOnce(new Error('mail unavailable'));

  const result = await saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  });

  expect(result).toMatchObject({
    ok: false,
    saved: true,
    notified: false,
    retryable: true,
    reason: 'send_failed',
    effectiveReviewDeadline: '2099-09-15',
  });
  expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledTimes(1);
});

test('fails before writing when the fresh suggestion row lacks a concurrency token', async () => {
  suggestionAdapter.getByIdWithSelect.mockResolvedValueOnce(suggestion({ _etag: null }));

  const result = await saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  });

  expect(result).toMatchObject({ ok: false, reason: 'save_failed' });
  expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('retry re-reads and sends the currently stored effective deadline without another write', async () => {
  suggestionAdapter.getByIdWithSelect.mockResolvedValueOnce(suggestion({
    wmkf_reviewduedateoverride: '2099-09-20',
  }));

  const result = await retryReviewerDueDateNotification({ suggestionId: SUGGESTION_ID });

  expect(result).toMatchObject({ ok: true, saved: false, notified: true, effectiveReviewDeadline: '2099-09-20' });
  expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail.mock.calls[0][0].body).toContain('September 20, 2099');
});

test('retry send failure reports no date write and remains retryable', async () => {
  suggestionAdapter.getByIdWithSelect.mockResolvedValueOnce(suggestion({
    wmkf_reviewduedateoverride: '2099-09-20',
  }));
  DynamicsService.createAndSendEmail.mockRejectedValueOnce(new Error('mail unavailable'));

  const result = await retryReviewerDueDateNotification({ suggestionId: SUGGESTION_ID });

  expect(result).toMatchObject({
    ok: false,
    saved: false,
    notified: false,
    retryable: true,
    reason: 'send_failed',
    effectiveReviewDeadline: '2099-09-20',
  });
  expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
});

test('fails before writing when Dynamics impersonation is disabled', async () => {
  process.env.DYNAMICS_IMPERSONATION_ENABLED = 'false';

  const result = await saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  });

  expect(result).toMatchObject({ ok: false, reason: 'misconfigured' });
  expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('fails before writing when the admin body omits required recipient/date/signature placeholders', async () => {
  readRequiredEmailDefaults.mockResolvedValueOnce({
    ok: true,
    values: { 'email.reviewer_extension.body': 'Hello there' },
    failures: [],
  });

  const result = await saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  });

  expect(result).toMatchObject({ ok: false, reason: 'misconfigured' });
  expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('fails before writing when sender or confirmed recipient prerequisites are unavailable', async () => {
  getSystemUserById.mockResolvedValueOnce(null);
  const missingPd = await saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  });
  expect(missingPd).toMatchObject({ ok: false, reason: 'notification_unavailable' });

  getSystemUserById.mockResolvedValueOnce({
    systemuserid: PD_ID,
    internalemailaddress: 'pd@wmkf.org',
    isdisabled: false,
  });
  suggestionAdapter.getByIdWithSelect.mockResolvedValueOnce(suggestion({ wmkf_revieweremail: null }));
  const missingRecipient = await saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  });
  expect(missingRecipient).toMatchObject({ ok: false, reason: 'notification_unavailable' });

  expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('distinguishes structured missing rows, transient reads, and write conflicts', async () => {
  suggestionAdapter.getByIdWithSelect.mockRejectedValueOnce({
    serviceName: 'dataverse',
    status: 404,
    dataverseCode: '0x80040217',
  });
  await expect(saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  })).resolves.toEqual({ ok: false, reason: 'not_found' });

  suggestionAdapter.getByIdWithSelect.mockRejectedValueOnce(new Error('Dataverse unavailable'));
  await expect(saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  })).resolves.toEqual({ ok: false, reason: 'read_failed' });

  suggestionAdapter.updateLifecycle.mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 412 }));
  await expect(saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  })).resolves.toMatchObject({ ok: false, reason: 'conflict' });
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('classifies adapter race rejections without exposing internal error text', async () => {
  suggestionAdapter.updateLifecycle.mockRejectedValueOnce(
    new Error(`reviewer-suggestion.updateLifecycle: refusing to mutate an applicant-excluded suggestion (${SUGGESTION_ID})`),
  );
  const excluded = await saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  });
  expect(excluded).toEqual({ ok: false, reason: 'ineligible' });

  suggestionAdapter.updateLifecycle.mockRejectedValueOnce(
    new Error('reviewer-suggestion: reviewDueDateOverride must be today or later'),
  );
  const crossedMidnight = await saveReviewerDueDateExtension({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
  });
  expect(crossedMidnight).toEqual({ ok: false, reason: 'invalid_extension_date' });
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});
