/**
 * @jest-environment node
 *
 * Contract tests for sendAcceptanceConfirmationEmail (lib/services/reviewer-acceptance-email.js)
 * written BEFORE Wave-4 conversion to the systemusers adapter. DynamicsService
 * is mocked at the transport boundary (jest.spyOn), so these stay valid whether
 * the PD-sender lookup goes through DynamicsService.getRecord directly or via
 * lib/dataverse/adapters/system-user.js — same select/id/entity shape.
 */

jest.mock('../../lib/services/email-defaults.js', () => ({
  readRequiredEmailDefaults: jest.fn(),
}));
jest.mock('../../lib/services/email-signature.js', () => ({
  resolveSignatureForRequest: jest.fn(),
}));
jest.mock('../../lib/external/calendar-invite.js', () => ({
  buildReviewDueIcs: jest.fn(() => null),
}));

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { readRequiredEmailDefaults } from '../../lib/services/email-defaults.js';
import { resolveSignatureForRequest } from '../../lib/services/email-signature.js';
import { sendAcceptanceConfirmationEmail } from '../../lib/services/reviewer-acceptance-email.js';

const OLD_ENV = process.env.NOTIFICATION_EMAIL_FROM;

function defaultsOk() {
  return {
    ok: true,
    values: {
      'email.reviewer_acceptance.subject': 'Thanks for accepting, {{reviewerName}}',
      'email.reviewer_acceptance.body': 'Body for {{proposalTitle}}. {{reviewDueDate}} {{signature}}',
    },
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  readRequiredEmailDefaults.mockReset().mockResolvedValue(defaultsOk());
  resolveSignatureForRequest.mockReset().mockResolvedValue({ signature: 'Program Director' });
  process.env.NOTIFICATION_EMAIL_FROM = 'fallback@wmkf.org';
});

afterAll(() => {
  process.env.NOTIFICATION_EMAIL_FROM = OLD_ENV;
});

describe('sendAcceptanceConfirmationEmail — golden path', () => {
  test('PD found + enabled → sends from the PD sender', async () => {
    const getRecord = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      systemuserid: 'su-1',
      internalemailaddress: 'pd@example.org',
      isdisabled: false,
    });
    const send = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue(undefined);

    const request = {
      akoya_requestid: 'req-1',
      akoya_title: 'Test Proposal',
      wmkf_reviewduedate: '2026-08-01',
      _wmkf_programdirector_value: 'pd-guid',
    };
    const reviewer = { wmkf_name: 'Jane Reviewer', wmkf_emailaddress: 'jane@reviewer.org' };

    const out = await sendAcceptanceConfirmationEmail({ suggestion: {}, request, reviewer });

    expect(out).toEqual({ sent: true });
    expect(getRecord).toHaveBeenCalledWith('systemusers', 'pd-guid', {
      select: 'systemuserid,internalemailaddress,isdisabled',
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'pd@example.org',
      to: 'jane@reviewer.org',
      regardingId: 'req-1',
      regardingType: 'akoya_request',
      actingUserSystemId: 'su-1',
    }));
  });
});

describe('sendAcceptanceConfirmationEmail — PD lookup fallback', () => {
  test('PD lookup failure falls back to NOTIFICATION_EMAIL_FROM', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('dataverse down'));
    const send = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue(undefined);

    const request = { akoya_requestid: 'req-2', _wmkf_programdirector_value: 'pd-guid' };
    const reviewer = { wmkf_emailaddress: 'jane@reviewer.org' };

    const out = await sendAcceptanceConfirmationEmail({ suggestion: {}, request, reviewer });
    expect(out).toEqual({ sent: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'fallback@wmkf.org' }));
  });

  test('disabled PD → falls back to NOTIFICATION_EMAIL_FROM', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      systemuserid: 'su-1',
      internalemailaddress: 'pd@example.org',
      isdisabled: true,
    });
    const send = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue(undefined);

    const request = { akoya_requestid: 'req-3', _wmkf_programdirector_value: 'pd-guid' };
    const reviewer = { wmkf_emailaddress: 'jane@reviewer.org' };

    await sendAcceptanceConfirmationEmail({ suggestion: {}, request, reviewer });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'fallback@wmkf.org' }));
  });
});

describe('sendAcceptanceConfirmationEmail — failure paths', () => {
  test('missing recipient email throws', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(null);
    const request = { akoya_requestid: 'req-4' };
    const reviewer = {};

    await expect(sendAcceptanceConfirmationEmail({ suggestion: {}, request, reviewer }))
      .rejects.toThrow('acceptance confirmation recipient email missing');
  });

  test('missing sender email (no PD, no env fallback) throws', async () => {
    delete process.env.NOTIFICATION_EMAIL_FROM;
    const request = { akoya_requestid: 'req-5' };
    const reviewer = { wmkf_emailaddress: 'jane@reviewer.org' };

    await expect(sendAcceptanceConfirmationEmail({ suggestion: {}, request, reviewer }))
      .rejects.toThrow('acceptance confirmation sender email missing');
  });
});
