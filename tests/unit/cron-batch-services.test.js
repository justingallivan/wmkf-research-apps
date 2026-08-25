/**
 * Unit tests for the Stage 5 cron batch services
 * (lib/services/cron/{generate-grantee-titles,grantee-deliverable-reminders}-service.js).
 *
 * The cron route suites drive these services end-to-end through the
 * byte-untouched verifyCronSecret shells; this suite pins the service-level
 * contracts directly — the 503 explicit bodies, the write-when-empty title
 * idempotency, and the reminders claim-before-send double-send guard.
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/grantee-title-service', () => ({
  generateGranteeTitle: jest.fn(async () => ({ editedTitle: 'To do science' })),
}));
jest.mock('../../shared/config/granteeResearchPrograms', () => ({
  GRANTEE_RESEARCH_PROGRAM_IDS: ['prog-a'],
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  queryAllRequests: jest.fn(),
  getById: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/grantee-deliverable', () => ({
  queryAllDeliverables: jest.fn(),
  update: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  getByIdWithSelect: jest.fn(async (id) => ({ contactid: id, fullname: `Person ${id}`, emailaddress1: `${id}@x.edu` })),
}));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({
  getByIdWithSelect: jest.fn(async (id) => ({ systemuserid: id, fullname: `PD ${id}`, internalemailaddress: `${id}@wmkeck.org`, isdisabled: false })),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createAndSendEmail: jest.fn(async () => ({ emailId: 'e1' })) },
}));
jest.mock('../../lib/services/email-defaults', () => ({
  readRequiredEmailDefaults: jest.fn(async () => ({
    ok: true,
    values: {
      'email.grantee_reminder.subject': 'Subject',
      'email.grantee_reminder.body': 'Dear [Name] — [title] by [date]. [Program Director signature]',
    },
  })),
}));
jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: jest.fn(async () => ({ signature: 'PD Sig' })),
}));
jest.mock('../../lib/external/grantee-token-lifecycle', () => ({
  mintForRequest: jest.fn(async () => ({ url: 'https://x/grantee/t' })),
}));
jest.mock('../../lib/external/grantee-invite-email', () => ({
  buildGranteeReminderDraftBodyText: jest.fn(() => 'draft'),
  renderGranteeReminderHtml: jest.fn(() => '<p>html</p>'),
}));
jest.mock('../../lib/services/email-automation-preferences', () => ({
  getEmailAutomationPreferenceForSystemUser: jest.fn(async () => null),
}));
jest.mock('../../lib/services/scheduled-email-store', () => ({
  createOrGetScheduledEmail: jest.fn(),
  listScheduledEmailsNeedingNotification: jest.fn(async () => []),
  listDueScheduledEmails: jest.fn(async () => []),
  listUnfinalizedScheduledEmails: jest.fn(async () => []),
}));
jest.mock('../../lib/services/scheduled-email-service', () => ({
  scheduledSendAtForInvitation: jest.fn((value) => new Date(new Date(value).getTime() + 12 * 86400000)),
  notifyScheduledEmailReview: jest.fn(),
  deliverScheduledEmail: jest.fn(),
  finalizeScheduledEmail: jest.fn(),
}));

import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import * as granteeDeliverableAdapter from '../../lib/dataverse/adapters/grantee-deliverable';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { readRequiredEmailDefaults } from '../../lib/services/email-defaults';
import { runGranteeTitleGeneration } from '../../lib/services/cron/generate-grantee-titles-service';
import { runGranteeDeliverableReminders } from '../../lib/services/cron/grantee-deliverable-reminders-service';

const titleRow = (n) => ({ akoya_requestid: `id-${n}`, akoya_requestnum: `100${n}`, akoya_title: `T${n}`, wmkf_abstract: 'x'.repeat(120) });
const deliv = (n) => ({ wmkf_granteedeliverableid: `d${n}`, _wmkf_request_value: `r${n}`, wmkf_inviteddate: '2026-06-01T00:00:00Z', _etag: `W/"${n}"` });

beforeEach(() => {
  jest.clearAllMocks();
  grantRequestAdapter.getById.mockImplementation(async (id, opts) => {
    if (opts?.select === 'wmkf_wmkfprojectdescription') return { wmkf_wmkfprojectdescription: null, _etag: 'e1' };
    return { akoya_requestid: id, akoya_requestnum: '1001', akoya_title: 'Award', _wmkf_projectleader_value: 'pi1', _akoya_primarycontactid_value: 'li1', _wmkf_programdirector_value: 'pd1' };
  });
  grantRequestAdapter.updateById.mockResolvedValue({});
  granteeDeliverableAdapter.update.mockResolvedValue({});
});

describe('runGranteeTitleGeneration', () => {
  const args = { cycleCode: 'J26', cycleFilter: 'wmkf_meetingdate ge 2026-06-01 and wmkf_meetingdate lt 2026-07-01' };

  it('503 ServiceHttpError with { error, cycleCode } body on a query failure', async () => {
    grantRequestAdapter.queryAllRequests.mockRejectedValue(new Error('down'));
    await expect(runGranteeTitleGeneration(args)).rejects.toMatchObject({
      httpStatus: 503, body: { error: 'Awardee query failed.', cycleCode: 'J26' },
    });
  });

  it('write-when-empty idempotency: re-filled field skips, empty field writes with fresh If-Match', async () => {
    grantRequestAdapter.queryAllRequests.mockResolvedValue({ records: [titleRow(1), titleRow(2)], totalCount: 2 });
    grantRequestAdapter.getById
      .mockResolvedValueOnce({ wmkf_wmkfprojectdescription: 'staff curated', _etag: 'e' })
      .mockResolvedValueOnce({ wmkf_wmkfprojectdescription: null, _etag: 'e2' });
    const summary = await runGranteeTitleGeneration(args);
    expect(summary).toMatchObject({ generated: 1, skippedConcurrent: 1, failed: 0 });
    expect(grantRequestAdapter.updateById).toHaveBeenCalledTimes(1);
    expect(grantRequestAdapter.updateById).toHaveBeenCalledWith(
      expect.any(String), { wmkf_wmkfprojectdescription: 'To do science' }, { ifMatch: 'e2' });
  });

  it('per-row failure is fail-soft and lands in failures[] with the requestNum', async () => {
    grantRequestAdapter.queryAllRequests.mockResolvedValue({ records: [{ ...titleRow(1), wmkf_abstract: 'x' }, titleRow(2)], totalCount: 2 });
    const summary = await runGranteeTitleGeneration(args);
    expect(summary).toMatchObject({ skippedNoSource: 1, generated: 1 });
    expect(summary.failures).toEqual([{ requestNum: '1001', reason: 'missing/short title or abstract' }]);
  });
});

describe('runGranteeDeliverableReminders', () => {
  it('503 ServiceHttpError with the explicit body on a query failure', async () => {
    granteeDeliverableAdapter.queryAllDeliverables.mockRejectedValue(new Error('down'));
    await expect(runGranteeDeliverableReminders()).rejects.toMatchObject({
      httpStatus: 503, body: { error: 'Deliverable query failed.' },
    });
  });

  it('claim-before-send idempotency: the status flip (If-Match) precedes the email; finalize stamps remindeddate', async () => {
    granteeDeliverableAdapter.queryAllDeliverables.mockResolvedValue({ records: [deliv(1)], totalCount: 1 });
    const summary = await runGranteeDeliverableReminders();
    expect(summary.reminded).toBe(1);
    expect(granteeDeliverableAdapter.update.mock.invocationCallOrder[0])
      .toBeLessThan(DynamicsService.createAndSendEmail.mock.invocationCallOrder[0]);
    expect(granteeDeliverableAdapter.update).toHaveBeenNthCalledWith(1,
      'd1', expect.any(Object), { ifMatch: 'W/"1"' });
    expect(granteeDeliverableAdapter.update).toHaveBeenNthCalledWith(2,
      'd1', expect.objectContaining({ wmkf_remindeddate: expect.any(String) }));
  });

  it('a failed claim (412 race) never sends the email', async () => {
    granteeDeliverableAdapter.queryAllDeliverables.mockResolvedValue({ records: [deliv(1)], totalCount: 1 });
    granteeDeliverableAdapter.update.mockRejectedValueOnce(Object.assign(new Error('precondition'), { status: 412 }));
    const summary = await runGranteeDeliverableReminders();
    expect(summary.claimFailed).toBe(1);
    expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
  });

  it('misconfigured email defaults skip new source rows before any legacy claim', async () => {
    readRequiredEmailDefaults.mockResolvedValueOnce({
      ok: false,
      failures: [{ key: 'email.grantee_reminder.subject', reason: 'blank' }],
    });
    granteeDeliverableAdapter.queryAllDeliverables.mockResolvedValue({ records: [deliv(1)], totalCount: 1 });
    const summary = await runGranteeDeliverableReminders();
    expect(summary.skippedMisconfigured).toBe(1);
    expect(granteeDeliverableAdapter.update).not.toHaveBeenCalled();
  });
});
