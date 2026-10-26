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
import { buildReviewDueIcs } from '../../lib/external/calendar-invite.js';
import { ownReviewerAcceptanceTemplate } from '../../lib/services/reviewer-acceptance-personalization';
import { sendAcceptanceConfirmationEmail, prepareAcceptanceConfirmationEmail, sendPreparedAcceptanceConfirmationEmail, renderAcceptanceConfirmationEmail } from '../../lib/services/reviewer-acceptance-email.js';

jest.mock('../../lib/services/reviewer-acceptance-personalization', () => ({ ownReviewerAcceptanceTemplate: jest.fn() }));
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
  ownReviewerAcceptanceTemplate.mockReset().mockResolvedValue({ status: 'absent', template: null });
  readRequiredEmailDefaults.mockReset().mockResolvedValue(defaultsOk());
  resolveSignatureForRequest.mockReset().mockResolvedValue({ signature: 'Program Director' });
  buildReviewDueIcs.mockReset().mockReturnValue(null);
  process.env.NOTIFICATION_EMAIL_FROM = 'fallback@wmkeck.org';
});

afterAll(() => {
  process.env.NOTIFICATION_EMAIL_FROM = OLD_ENV;
});

describe('sendAcceptanceConfirmationEmail — golden path', () => {
  test('PD found + enabled → sends from the PD sender', async () => {
    const getRecord = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      systemuserid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      internalemailaddress: 'pd@example.org',
      isdisabled: false,
    });
    const send = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue(undefined);

    const request = {
      akoya_requestid: 'req-1',
      akoya_title: 'Test Proposal',
      wmkf_reviewduedate: '2026-08-01',
      _wmkf_programdirector_value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    const reviewer = { wmkf_name: 'Jane Reviewer', wmkf_emailaddress: 'jane@reviewer.org' };

    const out = await sendAcceptanceConfirmationEmail({ suggestion: {}, request, reviewer });

    expect(out).toEqual({ sent: true });
    expect(getRecord).toHaveBeenCalledWith('systemusers', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      select: 'systemuserid,fullname,internalemailaddress,isdisabled',
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'pd@example.org',
      to: 'jane@reviewer.org',
      regardingId: 'req-1',
      regardingType: 'akoya_request',
      actingUserSystemId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      noFallback: true,
    }));
  });

  test('includes the secure withdrawal path and PD contact in the rendered email', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      systemuserid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      fullname: 'Jane Director',
      internalemailaddress: 'pd@example.org',
      isdisabled: false,
    });
    const send = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue(undefined);

    await sendAcceptanceConfirmationEmail({
      suggestion: { wmkf_revieweremail: 'reviewer@example.org' },
      request: {
        akoya_requestid: 'req-withdraw',
        akoya_title: 'Test Proposal',
        _wmkf_programdirector_value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      reviewer: { wmkf_name: 'Jane Reviewer' },
      withdrawUrl: 'https://reviews.wmkeck.org/external/review/token?action=decline',
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining(
        'https://reviews.wmkeck.org/external/review/token?action=decline',
      ),
    }));
  });

  test('reviewer-confirmed engagement email wins over the older person-record email', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(null);
    const send = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue(undefined);

    await sendAcceptanceConfirmationEmail({
      suggestion: { wmkf_revieweremail: 'confirmed@current.edu' },
      request: { akoya_requestid: 'req-1b' },
      reviewer: {
        wmkf_name: 'Jane Reviewer',
        wmkf_emailaddress: 'stale@former.edu',
      },
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'confirmed@current.edu',
    }));
  });

  test('suggestion due-date override wins in both the email body and calendar invite', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(null);
    const send = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue(undefined);
    buildReviewDueIcs.mockReturnValue(Buffer.from('calendar'));

    await sendAcceptanceConfirmationEmail({
      suggestion: {
        wmkf_appreviewersuggestionid: 'sug-override',
        wmkf_reviewduedateoverride: '2026-08-05',
      },
      request: {
        akoya_requestid: 'req-override',
        akoya_title: 'Override Proposal',
        wmkf_reviewduedate: '2026-08-01',
      },
      reviewer: { wmkf_name: 'Jane Reviewer', wmkf_emailaddress: 'jane@reviewer.org' },
    });

    expect(buildReviewDueIcs).toHaveBeenCalledWith(expect.objectContaining({
      reviewDueDate: '2026-08-05',
    }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('August 5, 2026'),
    }));
  });
});

describe('sendAcceptanceConfirmationEmail — PD lookup fallback', () => {
  test('PD lookup failure refuses before transport under O2', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('dataverse down'));
    const send = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue(undefined);

    const request = { akoya_requestid: 'req-2', _wmkf_programdirector_value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const reviewer = { wmkf_emailaddress: 'jane@reviewer.org' };

    const out = await sendAcceptanceConfirmationEmail({ suggestion: {}, request, reviewer });
    expect(out).toEqual({ skipped: true, reason: 'sender_unavailable' });
    expect(send).not.toHaveBeenCalled();
  });

  test('disabled PD → falls back to NOTIFICATION_EMAIL_FROM', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      systemuserid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      internalemailaddress: 'pd@example.org',
      isdisabled: true,
    });
    const send = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue(undefined);

    const request = { akoya_requestid: 'req-3', _wmkf_programdirector_value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const reviewer = { wmkf_emailaddress: 'jane@reviewer.org' };

    await sendAcceptanceConfirmationEmail({ suggestion: {}, request, reviewer });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'fallback@wmkeck.org' }));
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

  test('with Test Request isolation on, a confirmation that cannot name its request is refused', async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    process.env.NOTIFICATION_EMAIL_FROM = 'noreply@example.org';
    const send = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue({ emailId: 'e' });
    try {
      await expect(sendAcceptanceConfirmationEmail({
        suggestion: {},
        request: null,
        reviewer: { wmkf_emailaddress: 'jane@reviewer.org' },
      })).rejects.toThrow('acceptance confirmation request missing');
      expect(send).not.toHaveBeenCalled();
    } finally {
      delete process.env.TEST_REQUEST_ISOLATION;
    }
  });
});

const PD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = () => ({ suggestion: { wmkf_appreviewersuggestionid: 's', wmkf_revieweremail: 'confirmed@example.org' }, request: { akoya_requestid: 'r', akoya_title: 'Title', _wmkf_programdirector_value: PD }, reviewer: { wmkf_name: 'Dr. Jane Reviewer' } });
function pdLookup(extra = {}) { return jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ systemuserid: PD, isdisabled: false, internalemailaddress: 'pd@example.org', fullname: 'Director', ...extra }); }
test('personal pair is frozen; real prepared sender adapts Dynamics emailId receipt without reading again', async () => {
  pdLookup(); ownReviewerAcceptanceTemplate.mockResolvedValue({ status: 'configured', template: { subject: 'Own {{proposalTitle}}', body: 'Own body {{signature}}' } });
  const send = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue({ emailId: 'sent-1' });
  const prepared = await prepareAcceptanceConfirmationEmail(input()); expect(prepared.ok).toBe(true);
  expect(prepared.message).toMatchObject({ subject: 'Own Title', from: 'pd@example.org', to: 'confirmed@example.org', actingUserSystemId: PD, noFallback: true });
  ownReviewerAcceptanceTemplate.mockRejectedValue(new Error('changed')); readRequiredEmailDefaults.mockRejectedValue(new Error('changed'));
  expect(await sendPreparedAcceptanceConfirmationEmail(prepared)).toEqual({ sent: true, emailId: 'sent-1' });
  expect(send).toHaveBeenCalledWith(prepared.message); expect(ownReviewerAcceptanceTemplate).toHaveBeenCalledTimes(1);
});
test.each(['unavailable', 'duplicates', 'encrypted', 'invalid', 'identity_unavailable', 'new_status'])('own %s refuses before transport and never generic-falls-back', async status => {
  pdLookup(); ownReviewerAcceptanceTemplate.mockResolvedValue({ status, template: null }); const send = jest.spyOn(DynamicsService, 'createAndSendEmail');
  expect(await sendAcceptanceConfirmationEmail(input())).toEqual({ skipped: true, reason: `preference_${status}` }); expect(send).not.toHaveBeenCalled();
});
test.each([null, { systemuserid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }])('assigned PD missing/mismatching result %p refuses with no own read', async result => {
  pdLookup().mockResolvedValue(result); expect((await prepareAcceptanceConfirmationEmail(input())).ok).toBe(false); expect(ownReviewerAcceptanceTemplate).not.toHaveBeenCalled();
});
test.each([{ isdisabled: true }, { internalemailaddress: '' }])('confirmed unusable PD uses shared generic fallback without reading actual own default %p', async extra => {
  pdLookup(extra); ownReviewerAcceptanceTemplate.mockResolvedValue({ status: 'configured', template: { subject: 'Private', body: 'Private' } });
  expect((await prepareAcceptanceConfirmationEmail(input())).message).toMatchObject({ from: 'fallback@wmkeck.org', actingUserSystemId: undefined }); expect(ownReviewerAcceptanceTemplate).not.toHaveBeenCalled();
});
test('required shared outage cannot be masked by a configured personal pair', async () => {
  pdLookup(); readRequiredEmailDefaults.mockResolvedValue({ ok: false }); ownReviewerAcceptanceTemplate.mockResolvedValue({ status: 'configured', template: { subject: 'Own', body: 'Own' } });
  expect(await prepareAcceptanceConfirmationEmail(input())).toEqual({ ok: false, reason: 'defaults_unavailable' });
});
test.each(['personal', 'shared'])('subject substitutions normalize only values, preserving body text for %s copy', async source => {
  pdLookup(); const template = { subject: 'For {{proposalTitle}} {{reviewerName}}', body: '{{proposalTitle}}' };
  if (source === 'personal') ownReviewerAcceptanceTemplate.mockResolvedValue({ status: 'configured', template });
  else readRequiredEmailDefaults.mockResolvedValue({ ok: true, values: { 'email.reviewer_acceptance.subject': template.subject, 'email.reviewer_acceptance.body': template.body } });
  const args = input(); args.request.akoya_title = 'First\r\nSecond'; const prepared = await prepareAcceptanceConfirmationEmail(args);
  expect(prepared.message.subject).toContain('First Second'); expect(prepared.message.subject).not.toMatch(/[\r\n]/); expect(prepared.message.body).toContain('First\r<br>Second');
});
test('legacy shared subject aliases normalize values, authored CR/LF and empty stripped business copy refuse', async () => {
  pdLookup(); const args = input(); args.request.akoya_title = 'First\nSecond';
  readRequiredEmailDefaults.mockResolvedValue({ ok: true, values: { 'email.reviewer_acceptance.subject': '[title]', 'email.reviewer_acceptance.body': 'Body' } });
  expect((await prepareAcceptanceConfirmationEmail(args)).message.subject).toBe('First Second');
  readRequiredEmailDefaults.mockResolvedValue({ ok: true, values: { 'email.reviewer_acceptance.subject': 'Bad\nSubject', 'email.reviewer_acceptance.body': 'Body' } });
  expect((await prepareAcceptanceConfirmationEmail(args)).reason).toBe('rendered_copy_invalid');
  readRequiredEmailDefaults.mockResolvedValue({ ok: true, values: { 'email.reviewer_acceptance.subject': 'Subject', 'email.reviewer_acceptance.body': '{{requestNumber}}' } });
  expect((await prepareAcceptanceConfirmationEmail({ ...args, withdrawUrl: 'https://example.org/secure' })).reason).toBe('rendered_copy_invalid');
});
test.each(['personal', 'shared'])('final expanded subject/body caps refuse oversized %s copy before send', async source => {
  pdLookup(); const args = input(); args.request.akoya_title = 'x'.repeat(100001);
  const template = { subject: '{{proposalTitle}}', body: '{{proposalTitle}}' };
  if (source === 'personal') ownReviewerAcceptanceTemplate.mockResolvedValue({ status: 'configured', template });
  else readRequiredEmailDefaults.mockResolvedValue({ ok: true, values: { 'email.reviewer_acceptance.subject': template.subject, 'email.reviewer_acceptance.body': template.body } });
  expect((await prepareAcceptanceConfirmationEmail(args)).reason).toBe('rendered_copy_invalid');
});
test('plain renderer public shape and server withdrawal append remain compatible', () => {
  const out = renderAcceptanceConfirmationEmail({ ...input(), subjectTemplate: 'Hi', bodyTemplate: 'Body {{withdrawUrl}}', withdrawUrl: 'https://example.org/secure' });
  expect(Object.keys(out).sort()).toEqual(['body', 'subject']); expect(out.body.match(/https:\/\/example.org\/secure/g)).toHaveLength(1);
});
test.each(['personal', 'shared'])('expanded %s business body independently enforces inclusive final limits', async source => {
  pdLookup(); const args = input(), template = { subject: 'Subject', body: '{{proposalTitle}}' };
  if (source === 'personal') ownReviewerAcceptanceTemplate.mockResolvedValue({ status: 'configured', template });
  else readRequiredEmailDefaults.mockResolvedValue({ ok: true, values: { 'email.reviewer_acceptance.subject': template.subject, 'email.reviewer_acceptance.body': template.body } });
  args.request.akoya_title = 'x'.repeat(100000); expect((await prepareAcceptanceConfirmationEmail(args)).ok).toBe(true);
  args.request.akoya_title += 'x'; expect((await prepareAcceptanceConfirmationEmail(args)).reason).toBe('rendered_copy_invalid');
  args.request.akoya_title = 'x'.repeat(99999); expect((await prepareAcceptanceConfirmationEmail({ ...args, withdrawUrl: 'https://example.org/secure' })).reason).toBe('rendered_copy_invalid');
});
test('expanded subject limit is inclusive; personal token-only body without available value refuses', async () => {
  pdLookup(); ownReviewerAcceptanceTemplate.mockResolvedValue({ status: 'configured', template: { subject: '{{proposalTitle}}', body: 'Message' } });
  const args = input(); args.request.akoya_title = 'x'.repeat(2000); expect((await prepareAcceptanceConfirmationEmail(args)).ok).toBe(true); args.request.akoya_title += 'x'; expect((await prepareAcceptanceConfirmationEmail(args)).reason).toBe('rendered_copy_invalid');
  ownReviewerAcceptanceTemplate.mockResolvedValue({ status: 'configured', template: { subject: 'Subject', body: '{{withdrawUrl}}' } }); expect((await prepareAcceptanceConfirmationEmail(args)).reason).toBe('rendered_copy_invalid');
});
