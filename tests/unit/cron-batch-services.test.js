/**
 * Unit tests for the Stage 5 cron batch services
 * (lib/services/cron/{generate-grantee-titles,grantee-deliverable-reminders}-service.js).
 *
 * The cron route suites drive these services end-to-end through the
 * byte-untouched verifyCronSecret shells; this suite pins the service-level
 * contracts directly — the 503 explicit bodies, the write-when-empty title
 * idempotency, and the reminders ledger-creation / VIP-approval /
 * fail-closed-posture contracts (no direct cron send path exists).
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
  reassignScheduledEmail: jest.fn(),
  filterVipFlaggedContacts: jest.fn(async () => new Set()),
  listScheduledEmailDigestRows: jest.fn(async () => []),
  listDueScheduledEmails: jest.fn(async () => []),
  listUnfinalizedScheduledEmails: jest.fn(async () => []),
}));
jest.mock('../../lib/services/scheduled-email-service', () => ({
  scheduledSendAtForInvitation: jest.fn((value) => new Date(new Date(value).getTime() + 12 * 86400000)),
  groupDigestRowsByPd: jest.fn(() => []),
  sendScheduledEmailDigest: jest.fn(),
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

  it('every Invited row becomes a ledger entry on first sight; the cron never sends directly', async () => {
    const scheduledEmailStore = require('../../lib/services/scheduled-email-store');
    granteeDeliverableAdapter.queryAllDeliverables.mockResolvedValue({ records: [deliv(1)], totalCount: 1 });
    const summary = await runGranteeDeliverableReminders();
    expect(summary.scheduled).toBe(1);
    expect(scheduledEmailStore.createOrGetScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({
      workflowType: 'grantee_abstract_reminder',
      sourceRecordId: 'd1',
      approvalRequired: false,
      recipientContactIds: ['pi1', 'li1'],
    }));
    // The legacy direct claim-before-send path is deleted.
    expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
    expect(granteeDeliverableAdapter.update).not.toHaveBeenCalled();
  });

  it('a VIP flag on ANY recipient contact (liaison included) requires approval', async () => {
    const scheduledEmailStore = require('../../lib/services/scheduled-email-store');
    scheduledEmailStore.filterVipFlaggedContacts.mockResolvedValue(new Set(['li1']));
    granteeDeliverableAdapter.queryAllDeliverables.mockResolvedValue({ records: [deliv(1)], totalCount: 1 });
    const summary = await runGranteeDeliverableReminders();
    expect(summary.scheduled).toBe(1);
    expect(scheduledEmailStore.createOrGetScheduledEmail).toHaveBeenCalledWith(
      expect.objectContaining({ approvalRequired: true }),
    );
  });

  it('PD handoff rebuilds an unsent row under the current PD with the CURRENT PD\'s posture', async () => {
    const scheduledEmailStore = require('../../lib/services/scheduled-email-store');
    // Ledger row still owned by the FORMER PD; the request now points at pd1.
    scheduledEmailStore.createOrGetScheduledEmail.mockResolvedValue({
      pd_systemuser_id: 'old-pd', status: 'scheduled',
    });
    // pd1 (the current PD) has VIP-flagged the liaison — the rebuilt row must
    // carry pd1's posture, not the former PD's.
    scheduledEmailStore.filterVipFlaggedContacts.mockResolvedValue(new Set(['li1']));
    scheduledEmailStore.reassignScheduledEmail.mockResolvedValue({ pd_systemuser_id: 'pd1' });
    granteeDeliverableAdapter.queryAllDeliverables.mockResolvedValue({ records: [deliv(1)], totalCount: 1 });
    const summary = await runGranteeDeliverableReminders();
    expect(summary.reassigned).toBe(1);
    expect(scheduledEmailStore.reassignScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({
      workflowType: 'grantee_abstract_reminder',
      sourceRecordId: 'd1',
      pdSystemUserId: 'pd1',
      pdEmail: 'pd1@wmkeck.org',
      approvalRequired: true,
    }));
    expect(scheduledEmailStore.filterVipFlaggedContacts).toHaveBeenCalledWith('pd1', ['pi1', 'li1']);
  });

  it('no PD drift means no rebuild call at all', async () => {
    const scheduledEmailStore = require('../../lib/services/scheduled-email-store');
    scheduledEmailStore.createOrGetScheduledEmail.mockResolvedValue({
      pd_systemuser_id: 'pd1', status: 'scheduled',
    });
    granteeDeliverableAdapter.queryAllDeliverables.mockResolvedValue({ records: [deliv(1)], totalCount: 1 });
    const summary = await runGranteeDeliverableReminders();
    expect(summary.reassigned).toBe(0);
    expect(scheduledEmailStore.reassignScheduledEmail).not.toHaveBeenCalled();
  });

  it('reports a deferred PD handoff when the atomic transport or lease guard refuses the rebuild', async () => {
    const scheduledEmailStore = require('../../lib/services/scheduled-email-store');
    scheduledEmailStore.createOrGetScheduledEmail.mockResolvedValue({
      id: 'message-1', pd_systemuser_id: 'old-pd', status: 'failed',
    });
    scheduledEmailStore.reassignScheduledEmail.mockResolvedValue(null);
    granteeDeliverableAdapter.queryAllDeliverables.mockResolvedValue({ records: [deliv(1)], totalCount: 1 });
    const summary = await runGranteeDeliverableReminders();
    expect(summary.reassigned).toBe(0);
    expect(summary.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: expect.stringMatching(/handoff deferred/) }),
    ]));
    expect(scheduledEmailStore.reassignScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({
      workflowType: 'grantee_abstract_reminder',
      sourceRecordId: 'd1',
      pdSystemUserId: 'pd1',
    }));
  });

  it('a review posture read failure fails closed: no ledger row, no send', async () => {
    const scheduledEmailStore = require('../../lib/services/scheduled-email-store');
    const prefs = require('../../lib/services/email-automation-preferences');
    prefs.getEmailAutomationPreferenceForSystemUser.mockRejectedValueOnce(new Error('dataverse down'));
    granteeDeliverableAdapter.queryAllDeliverables.mockResolvedValue({ records: [deliv(1)], totalCount: 1 });
    const summary = await runGranteeDeliverableReminders();
    expect(summary.preferenceFailed).toBe(1);
    expect(scheduledEmailStore.createOrGetScheduledEmail).not.toHaveBeenCalled();
  });

  it('misconfigured email defaults skip row creation entirely', async () => {
    const scheduledEmailStore = require('../../lib/services/scheduled-email-store');
    readRequiredEmailDefaults.mockResolvedValueOnce({
      ok: false,
      failures: [{ key: 'email.grantee_reminder.subject', reason: 'blank' }],
    });
    granteeDeliverableAdapter.queryAllDeliverables.mockResolvedValue({ records: [deliv(1)], totalCount: 1 });
    const summary = await runGranteeDeliverableReminders();
    expect(summary.skippedMisconfigured).toBe(1);
    expect(scheduledEmailStore.createOrGetScheduledEmail).not.toHaveBeenCalled();
  });
});
