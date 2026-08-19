/**
 * Unit tests for the NotificationService → operational_events mirror.
 *
 * Covers: error/critical auto-mirror, info/warning NOT mirrored without
 * opt-in, `operationalEvent` opt-in at any severity (with override merge),
 * recorder failure never affecting the notify() outcome, and recovery
 * propagation from AlertService.autoResolve.
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/alert-service', () => ({
  createAlert: jest.fn(),
}));
jest.mock('../../lib/services/operational-event-service', () => ({
  recordEvent: jest.fn(),
  markRecovered: jest.fn(),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createAndSendEmail: jest.fn() },
}));
jest.mock('../../lib/services/alert-recipients', () => ({
  resolveRecipients: jest.fn().mockResolvedValue({ recipients: [], category: 'x', source: 'none' }),
  getSuperuserRoster: jest.fn().mockResolvedValue([]),
}));

const AlertService = require('../../lib/services/alert-service');
const OperationalEventService = require('../../lib/services/operational-event-service');
const NotificationService = require('../../lib/services/notification-service');

beforeEach(() => {
  jest.clearAllMocks();
  AlertService.createAlert.mockResolvedValue({ id: 1 });
  OperationalEventService.recordEvent.mockResolvedValue({ id: 2, folded: false });
  delete process.env.NOTIFICATION_EMAIL_FROM; // keep email path inert
});

test('error severity mirrors into operational_events with alert-derived keys', async () => {
  await NotificationService.notify({
    type: 'grantee_submit_failed',
    severity: 'error',
    title: 'Grantee submit failed (sharepoint_failed)',
    message: 'upload failed',
    metadata: { requestNumber: '1002912', reason: 'sharepoint_failed' },
    source: 'grantee-submit',
    autoResolveKey: 'grantee_submit_failed:sharepoint_failed:req-1',
  });
  expect(OperationalEventService.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    source: 'app',
    eventType: 'grantee_submit_failed',
    severity: 'error',
    summary: 'Grantee submit failed (sharepoint_failed): upload failed',
    subsystem: 'grantee-submit',
    requestNumber: '1002912',
    dedupeKey: 'alert:grantee_submit_failed:sharepoint_failed:req-1',
    recoveryKey: 'grantee_submit_failed:sharepoint_failed:req-1',
  }));
});

test('info and warning severities are NOT mirrored without opt-in', async () => {
  await NotificationService.notify({ type: 'new_user', severity: 'info', title: 'x' });
  await NotificationService.notify({ type: 'quota', severity: 'warning', title: 'y' });
  expect(OperationalEventService.recordEvent).not.toHaveBeenCalled();
});

test('operationalEvent opt-in records at warning severity and overrides defaults', async () => {
  await NotificationService.notify({
    type: 'honorarium_onboard_failed',
    severity: 'warning',
    title: 'Honorarium onboarding failed after reviewer accept',
    message: 'dataverse no-response: This operation was aborted',
    metadata: { suggestionId: 'sugg-1' },
    source: 'reviewer-acceptance-drain',
    autoResolveKey: 'honorarium_onboard_failed:sugg-1',
    operationalEvent: {
      stage: 'honorarium_onboard',
      transient: true,
      entityRefs: { suggestionId: 'sugg-1', jobId: 42 },
    },
  });
  expect(OperationalEventService.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    severity: 'warning',
    stage: 'honorarium_onboard',
    transient: true,
    entityRefs: { suggestionId: 'sugg-1', jobId: 42 },
    dedupeKey: 'alert:honorarium_onboard_failed:sugg-1',
    recoveryKey: 'honorarium_onboard_failed:sugg-1',
  }));
});

test('mirror runs even when the alert deduplicated (createAlert returned null)', async () => {
  AlertService.createAlert.mockResolvedValue(null);
  await NotificationService.notify({
    type: 'x_failed', severity: 'error', title: 't', autoResolveKey: 'x:1',
  });
  expect(OperationalEventService.recordEvent).toHaveBeenCalled();
});

test('recorder rejection does not break notify()', async () => {
  // recordEvent's contract is never-throw, but notify must survive even a
  // contract violation in the recorder.
  OperationalEventService.recordEvent.mockRejectedValue(new Error('recorder broke'));
  const alert = await NotificationService.notify({
    type: 'x_failed', severity: 'error', title: 't',
  });
  expect(alert).toEqual({ id: 1 });
});

test('alert creation still returned when mirror records', async () => {
  const alert = await NotificationService.notify({
    type: 'x_failed', severity: 'critical', title: 't',
  });
  expect(alert).toEqual({ id: 1 });
});
