/**
 * Coverage for NotificationService.sendAdminEmail's explicitRecipients branch.
 *
 * Added S190 as part of the virus-scan-detection alert wiring. The
 * branch lets callers route per-event (e.g. the program director on a
 * specific akoya_request) without configuring a category mapping in
 * `/admin → Alert Recipients`. When the list is empty/falsy, category
 * routing applies — the test below pins that fallback so a future
 * refactor can't silently swap "no recipients" for "skip the email."
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    createAndSendEmail: jest.fn(() => Promise.resolve({})),
  },
}));
jest.mock('../../lib/services/alert-recipients', () => ({
  __esModule: true,
  default: {
    resolveRecipients: jest.fn(),
    getSuperuserRoster: jest.fn(() => Promise.resolve([])),
  },
  resolveRecipients: jest.fn(),
  getSuperuserRoster: jest.fn(() => Promise.resolve([])),
}));

const NotificationService = require('../../lib/services/notification-service');
const { DynamicsService } = require('../../lib/services/dynamics-service');
const AlertRecipients = require('../../lib/services/alert-recipients');

const ORIGINAL_FROM = process.env.NOTIFICATION_EMAIL_FROM;

beforeEach(() => {
  process.env.NOTIFICATION_EMAIL_FROM = 'alerts@example.org';
  DynamicsService.createAndSendEmail.mockClear();
  // The module exports the class with these as static methods via `module.exports`.
  // Provide both module-default and named exports because lib code reads either.
  const resolve = AlertRecipients.resolveRecipients
    || AlertRecipients.default?.resolveRecipients;
  resolve.mockReset();
});

afterAll(() => {
  if (ORIGINAL_FROM === undefined) delete process.env.NOTIFICATION_EMAIL_FROM;
  else process.env.NOTIFICATION_EMAIL_FROM = ORIGINAL_FROM;
});

describe('sendAdminEmail — explicitRecipients branch', () => {
  test('non-empty explicitRecipients → sends to that list, never calls category resolver', async () => {
    await NotificationService.sendAdminEmail({
      subject: 'test',
      htmlBody: '<p>body</p>',
      category: 'virus-detection',
      explicitRecipients: ['pd@example.org'],
    });

    expect(DynamicsService.createAndSendEmail).toHaveBeenCalledTimes(1);
    const call = DynamicsService.createAndSendEmail.mock.calls[0][0];
    expect(call.to).toEqual(['pd@example.org']);
    expect(call.from).toBe('alerts@example.org');
    expect(call.subject).toBe('test');

    const resolve = AlertRecipients.resolveRecipients
      || AlertRecipients.default?.resolveRecipients;
    expect(resolve).not.toHaveBeenCalled();
  });

  test('falsy entries in explicitRecipients are filtered → falls through to category routing', async () => {
    const resolve = AlertRecipients.resolveRecipients
      || AlertRecipients.default?.resolveRecipients;
    resolve.mockResolvedValue({
      recipients: ['fallback@example.org'],
      source: 'config',
      category: 'virus-detection',
    });

    await NotificationService.sendAdminEmail({
      subject: 'test',
      htmlBody: '<p>body</p>',
      category: 'virus-detection',
      explicitRecipients: [null, '', '   '],
    });

    expect(resolve).toHaveBeenCalledWith('virus-detection');
    expect(DynamicsService.createAndSendEmail.mock.calls[0][0].to).toEqual([
      'fallback@example.org',
    ]);
  });

  test('empty explicitRecipients + empty category resolution → skipped (no email)', async () => {
    const resolve = AlertRecipients.resolveRecipients
      || AlertRecipients.default?.resolveRecipients;
    resolve.mockResolvedValue({ recipients: [], source: 'roster', category: 'default' });

    const sent = await NotificationService.sendAdminEmail({
      subject: 'test',
      htmlBody: '<p>body</p>',
      category: 'virus-detection',
      explicitRecipients: [],
    });

    expect(sent).toBe(false);
    expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
  });

  test('no NOTIFICATION_EMAIL_FROM → skipped even with explicit recipients', async () => {
    delete process.env.NOTIFICATION_EMAIL_FROM;
    const sent = await NotificationService.sendAdminEmail({
      subject: 'test',
      htmlBody: '<p>body</p>',
      explicitRecipients: ['pd@example.org'],
    });
    expect(sent).toBe(false);
    expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
  });
});
