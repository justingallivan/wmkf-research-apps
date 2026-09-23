/** @jest-environment node */
import { sweepMaterialsReminders } from '../../lib/services/site-visit-materials/reminder-sweep';
import { prepareMaterialsReminderEmail } from '../../lib/services/site-visit-materials/collection-service';
import { SITE_VISIT_MATERIALS_CHECKLIST } from '../../shared/config/siteVisitMaterials';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';

const R1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const PC = 'bbbbbbbb-0000-4000-8000-000000000002';
const NOW = new Date('2026-10-06T15:00:00Z');
const REQUEST = { akoya_requestid: R1, akoya_requestnum: '1003222', akoya_title: 'Neural dust', _akoya_applicantid_value_formatted: 'Caltech' };

function row(overrides = {}) {
  return {
    id: 'c1', request_id: R1, status: 'open', due_at: '2026-10-05T19:00:00Z', closes_at: '2026-10-14T19:00:00Z',
    checklist: SITE_VISIT_MATERIALS_CHECKLIST.map((item) => ({ ...item, waived: false })),
    contacts: { pi: { role: 'pi', name: 'Pat', email: 'pi@example.edu' } }, invited_at: '2026-09-20T00:00:00Z',
    reminder_count: 0, created_by: PC, token_ciphertext: 'sealed', ...overrides,
  };
}
const PDF = { wmkf_requestdocumentid: 'd1', _wmkf_request_value: R1, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, wmkf_sharepointitemid: 'i', wmkf_filename: '1003222 Site Visit Presentation.pdf', modifiedon: '2026-10-01T00:00:00Z' };

function deps(overrides = {}) {
  return {
    schemaReady: () => true,
    listDue: jest.fn(async () => [row()]),
    claim: jest.fn(async (id) => row({ id, reminder_count: 1, last_reminder_at: NOW })),
    attachEmailId: jest.fn(async () => row()),
    getRequest: jest.fn(async () => REQUEST),
    findDocumentsByRequest: jest.fn(async () => ({ records: [PDF] })),
    findActiveSiteVisit: jest.fn(async () => ({ scheduledstart: '2026-10-07T16:00:00Z', wmkf_ianatimezone: 'America/Los_Angeles' })),
    getSender: jest.fn(async () => ({ email: 'pc@wmkeck.org', systemUserId: PC })),
    canReadLink: jest.fn(() => true),
    prepareReminder: jest.fn(async () => ({ subject: 'Configured reminder', bodyText: 'Configured body', url: 'https://apps.test/materials' })),
    sendReminder: jest.fn(async () => 'email-1'),
    now: () => NOW,
    ...overrides,
  };
}

test('claims before sending, names only the missing items, sends from the creating PC, and attaches the email id', async () => {
  const d = deps();
  const result = await sweepMaterialsReminders({}, d);
  expect(d.listDue).toHaveBeenCalledWith(NOW);
  expect(d.claim).toHaveBeenCalledWith('c1', NOW);
  expect(d.prepareReminder.mock.invocationCallOrder[0]).toBeLessThan(d.claim.mock.invocationCallOrder[0]);
  expect(d.claim.mock.invocationCallOrder[0]).toBeLessThan(d.sendReminder.mock.invocationCallOrder[0]);
  expect(d.findActiveSiteVisit.mock.invocationCallOrder[0]).toBeLessThan(d.claim.mock.invocationCallOrder[0]);
  const prep = d.prepareReminder.mock.calls[0][0];
  expect(prep.missing.map((item) => item.key)).toEqual(['presentation_source', 'participant_bios']);
  expect(prep).toMatchObject({ actorId: PC, request: REQUEST });
  const args = d.sendReminder.mock.calls[0][0];
  expect(args).toMatchObject({ fromEmail: 'pc@wmkeck.org', actorId: PC, sequence: 1, prepared: { subject: 'Configured reminder', bodyText: 'Configured body' } });
  expect(args.row.reminder_count).toBe(1);
  expect(d.attachEmailId).toHaveBeenCalledWith('c1', 'email-1');
  expect(result).toMatchObject({ scanned: 1, eligible: 1, sent: 1, sendFailed: 0, receiptFailed: 0, claimLost: 0, errors: [] });
});

test('nothing missing, no sender mailbox, and a lost claim each skip without sending', async () => {
  const complete = deps({ findDocumentsByRequest: async () => ({ records: [PDF, { ...PDF, wmkf_requestdocumentid: 'd2', wmkf_filename: '1003222 Site Visit Presentation.pptx' }, { ...PDF, wmkf_requestdocumentid: 'd3', wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS, wmkf_filename: '1003222 Site Visit Participant Bios.pdf' }] }) });
  expect(await sweepMaterialsReminders({}, complete)).toMatchObject({ skippedNothingMissing: 1, sent: 0 });
  expect(complete.claim).not.toHaveBeenCalled();

  const noSender = deps({ getSender: async () => null });
  expect(await sweepMaterialsReminders({}, noSender)).toMatchObject({ skippedNoSender: 1, sent: 0, errors: [{ id: 'c1', error: 'collection creator has no mailbox' }] });
  expect(noSender.claim).not.toHaveBeenCalled();

  const noRecipient = deps({ listDue: async () => [row({ contacts: { pi: { role: 'pi', name: 'Pat', email: null } } })] });
  expect(await sweepMaterialsReminders({}, noRecipient)).toMatchObject({ skippedNoRecipient: 1, sent: 0 });
  expect(noRecipient.claim).not.toHaveBeenCalled();

  const unreadable = deps({ canReadLink: () => false });
  expect(await sweepMaterialsReminders({}, unreadable)).toMatchObject({ skippedLinkUnreadable: 1, sent: 0 });
  expect(unreadable.claim).not.toHaveBeenCalled();

  const lost = deps({ claim: async () => null });
  expect(await sweepMaterialsReminders({}, lost)).toMatchObject({ eligible: 1, claimLost: 1, sent: 0 });
  expect(lost.sendReminder).not.toHaveBeenCalled();
});

test('dryRun reports eligibility and never claims or sends; readiness off skips everything; maxBatch bounds the scan', async () => {
  const d = deps();
  expect(await sweepMaterialsReminders({ dryRun: true }, d)).toMatchObject({ dryRun: true, eligibilityIsProvisional: true, eligible: 1, sent: 0 });
  expect(d.claim).not.toHaveBeenCalled();
  expect(d.sendReminder).not.toHaveBeenCalled();
  expect(d.prepareReminder).not.toHaveBeenCalled();
  const off = deps({ schemaReady: () => false });
  expect(await sweepMaterialsReminders({}, off)).toMatchObject({ skipped: 'schema_not_ready', scanned: 0 });
  expect(off.listDue).not.toHaveBeenCalled();
  const many = deps({ listDue: async () => [row({ id: 'c1' }), row({ id: 'c2' }), row({ id: 'c3' })] });
  expect(await sweepMaterialsReminders({ maxBatch: 2 }, many)).toMatchObject({ scanned: 2, sent: 2 });
});

test('two eligible rows share one settings read per sweep before either claim', async () => {
  const readEmailDefaults = jest.fn(async (keys) => ({ ok: true, values: Object.fromEntries(keys.map((key) => [key,
    key.endsWith('.subject') ? 'Reminder {{proposalTitle}}' : 'Missing: {{missingItems}}',
  ])) }));
  const d = deps({
    listDue: async () => [row({ id: 'c1' }), row({ id: 'c2' })],
    readEmailDefaults,
    prepareReminder: jest.fn((args, readDefaults) => prepareMaterialsReminderEmail(args, {
      unseal: () => 'jwt',
      buildContributorUrl: () => 'https://apps.test/materials/jwt',
      readEmailDefaults: readDefaults,
    })),
  });
  const result = await sweepMaterialsReminders({}, d);
  expect(result).toMatchObject({ eligible: 2, sent: 2, eligibilityIsProvisional: false });
  expect(readEmailDefaults).toHaveBeenCalledTimes(1);
  expect(readEmailDefaults.mock.invocationCallOrder[0]).toBeLessThan(d.claim.mock.invocationCallOrder[0]);
  expect(d.claim).toHaveBeenCalledTimes(2);
});

test('blank required default leaves the automatic reminder unclaimed and unsent', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const readEmailDefaults = jest.fn(async () => ({ ok: false, values: {}, failures: [{ key: 'email.site_visit_materials_reminder.body', reason: 'blank' }] }));
  const d = deps({
    listDue: async () => [row({ id: 'c1' }), row({ id: 'c2' })],
    readEmailDefaults,
    prepareReminder: jest.fn((args, readDefaults) => prepareMaterialsReminderEmail(args, {
      unseal: () => 'jwt',
      buildContributorUrl: () => 'https://apps.test/materials/jwt',
      readEmailDefaults: readDefaults,
    })),
  });
  const result = await sweepMaterialsReminders({}, d);
  expect(result).toMatchObject({ scanned: 2, eligible: 0, sent: 0, sendFailed: 0, errors: [
    { id: 'c1', error: 'Required email defaults are unavailable. Ask an admin to check Email defaults.' },
    { id: 'c2', error: 'Required email defaults are unavailable. Ask an admin to check Email defaults.' },
  ] });
  expect(readEmailDefaults).toHaveBeenCalledWith(
    ['email.site_visit_materials_reminder.subject', 'email.site_visit_materials_reminder.body'],
    { source: 'site-visit-materials:reminder' },
  );
  expect(readEmailDefaults).toHaveBeenCalledTimes(1);
  expect(d.claim).not.toHaveBeenCalled();
  expect(d.sendReminder).not.toHaveBeenCalled();
  expect(d.attachEmailId).not.toHaveBeenCalled();
  log.mockRestore();
});

test('the default sender lookup refuses a disabled or mailbox-less creator', async () => {
  jest.resetModules();
  jest.doMock('../../lib/dataverse/adapters/system-user.js', () => ({ getById: jest.fn(async (id) => (id === 'disabled' ? { systemuserid: id, internalemailaddress: 'X@wmkeck.org', isdisabled: true } : id === 'nomail' ? { systemuserid: id } : { systemuserid: id, internalemailaddress: ' PC@wmkeck.org ' })) }));
  const { DEFAULT_DEPENDENCIES } = require('../../lib/services/site-visit-materials/reminder-sweep');
  expect(await DEFAULT_DEPENDENCIES.getSender('disabled')).toBeNull();
  expect(await DEFAULT_DEPENDENCIES.getSender('nomail')).toBeNull();
  expect(await DEFAULT_DEPENDENCIES.getSender('ok')).toEqual({ email: 'pc@wmkeck.org', systemUserId: 'ok' });
  expect(DEFAULT_DEPENDENCIES.canReadLink({ token_ciphertext: 'not-sealed' })).toBe(false);
  jest.dontMock('../../lib/dataverse/adapters/system-user.js');
});

test('a failed site-visit read does not consume the claim: the reminder still sends, without a visit (Codex adversarial finding)', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const d = deps({ findActiveSiteVisit: jest.fn(async () => { throw new Error('dataverse 503'); }) });
  const result = await sweepMaterialsReminders({}, d);
  expect(result).toMatchObject({ eligible: 1, sent: 1, sendFailed: 0, errors: [] });
  expect(d.claim).toHaveBeenCalledTimes(1);
  expect(d.prepareReminder.mock.calls[0][0].visit).toBeNull();
  log.mockRestore();
});

test('a receipt-attach failure after a delivered email counts as sent + receiptFailed with the email id in the error, never as a transport failure (Codex adversarial finding)', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const d = deps({ attachEmailId: jest.fn(async () => { throw new Error('pg down'); }) });
  const result = await sweepMaterialsReminders({}, d);
  expect(result).toMatchObject({ sent: 1, sendFailed: 0, receiptFailed: 1, errors: [{ id: 'c1', error: 'sent as email-1; receipt not attached: pg down' }] });
  expect(d.sendReminder).toHaveBeenCalledTimes(1);
  log.mockRestore();
});

test('a send failure after the claim is counted and logged, not retried, and other rows still run', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const d = deps({
    listDue: async () => [row({ id: 'c1' }), row({ id: 'c2' })],
    sendReminder: jest.fn(async ({ row: claimed }) => { if (claimed.id === 'c1') throw new Error('smtp down'); return 'email-2'; }),
  });
  const result = await sweepMaterialsReminders({}, d);
  expect(result).toMatchObject({ scanned: 2, eligible: 2, sent: 1, sendFailed: 0, sendUnconfirmed: 1, errors: [{ id: 'c1', outcome: 'uncertain', error: 'smtp down' }] });
  expect(d.claim).toHaveBeenCalledTimes(2);
  expect(d.attachEmailId).toHaveBeenCalledTimes(1);
  expect(d.attachEmailId).toHaveBeenCalledWith('c2', 'email-2');
  log.mockRestore();
});

describe('Test Request isolation (Stage 1b)', () => {
  test('skips a test request row before any read, preparation, claim or send', async () => {
    const d = { ...deps(), isolationEnabled: () => true,
      resolveTestState: jest.fn(async () => ({ kind: 'synthetic', reason: 'marker_and_run_valid' })) };
    const result = await sweepMaterialsReminders({}, d);
    expect(result.skippedTestRequest).toBeGreaterThan(0);
    expect(d.getRequest).not.toHaveBeenCalled();
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.sendReminder).not.toHaveBeenCalled();
  });

  test('an unreadable marker skips the row for this run and reports it', async () => {
    const d = { ...deps(), isolationEnabled: () => true,
      resolveTestState: jest.fn(async () => ({ kind: 'unknown', reason: 'read_failed' })) };
    const result = await sweepMaterialsReminders({}, d);
    expect(d.claim).not.toHaveBeenCalled();
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ error: 'request could not be confirmed as ordinary' }),
    ]));
  });

  test('skipped test collections never take up the batch (Stage 1c): the ordinary row behind them is sent', async () => {
    const TEST_REQUEST = 'cccccccc-0000-4000-8000-000000000003';
    const testRows = Array.from({ length: 3 }, (_, i) => row({ id: `t${i}`, request_id: TEST_REQUEST }));
    const d = { ...deps(), isolationEnabled: () => true,
      listDue: jest.fn(async () => [...testRows, row()]),
      resolveTestState: jest.fn(async (id) => (id === TEST_REQUEST
        ? { kind: 'synthetic', reason: 'x' } : { kind: 'ordinary', reason: 'x' })) };
    const result = await sweepMaterialsReminders({ maxBatch: 1 }, d);
    expect(result).toMatchObject({ skippedTestRequest: 3, scanned: 1, sent: 1 });
    expect(d.claim).toHaveBeenCalledTimes(1);
  });
});
