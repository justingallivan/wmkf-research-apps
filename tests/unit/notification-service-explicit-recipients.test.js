/**
 * Coverage for NotificationService.sendAdminEmail's recipient resolution.
 *
 * Recipients are the UNION of:
 *   - category-routed recipients (resolved by AlertRecipients), and
 *   - explicit per-event recipients (e.g. the PD on a specific request).
 *
 * Both are optional. Either alone is sufficient. Both empty → skipped.
 *
 * Added S190 as part of the virus-scan-detection alert wiring. The union
 * semantics let detection alerts route a static foundation address via
 * the admin-dashboard category config AND a dynamic per-event PD email
 * resolved at call time.
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

function getResolveMock() {
  return AlertRecipients.resolveRecipients
    || AlertRecipients.default?.resolveRecipients;
}

beforeEach(() => {
  process.env.NOTIFICATION_EMAIL_FROM = 'alerts@example.org';
  DynamicsService.createAndSendEmail.mockClear();
  getResolveMock().mockReset();
});

afterAll(() => {
  if (ORIGINAL_FROM === undefined) delete process.env.NOTIFICATION_EMAIL_FROM;
  else process.env.NOTIFICATION_EMAIL_FROM = ORIGINAL_FROM;
});

describe('sendAdminEmail — category + explicit recipient union', () => {
  test('category recipients only → sends to those', async () => {
    getResolveMock().mockResolvedValue({
      recipients: ['ops@example.org'],
      source: 'config',
      category: 'ops',
    });

    await NotificationService.sendAdminEmail({
      subject: 'test',
      htmlBody: '<p>body</p>',
      category: 'ops',
    });

    expect(getResolveMock()).toHaveBeenCalledWith('ops');
    expect(DynamicsService.createAndSendEmail.mock.calls[0][0].to).toEqual([
      'ops@example.org',
    ]);
  });

  test('explicit recipients only (no category) → sends to those, never calls resolver', async () => {
    await NotificationService.sendAdminEmail({
      subject: 'test',
      htmlBody: '<p>body</p>',
      explicitRecipients: ['pd@example.org'],
    });

    expect(getResolveMock()).not.toHaveBeenCalled();
    expect(DynamicsService.createAndSendEmail.mock.calls[0][0].to).toEqual([
      'pd@example.org',
    ]);
  });

  test('category + explicit → unioned and deduped', async () => {
    getResolveMock().mockResolvedValue({
      recipients: ['alerts@example.org', 'shared@example.org'],
      source: 'config',
      category: 'virus-detection',
    });

    await NotificationService.sendAdminEmail({
      subject: 'test',
      htmlBody: '<p>body</p>',
      category: 'virus-detection',
      explicitRecipients: ['pd@example.org', 'shared@example.org'], // 'shared@' overlaps
    });

    const to = DynamicsService.createAndSendEmail.mock.calls[0][0].to;
    expect(to).toEqual(['alerts@example.org', 'shared@example.org', 'pd@example.org']);
    expect(to).toHaveLength(3); // shared@ deduped to one entry
  });

  test('falsy entries in explicitRecipients are filtered', async () => {
    getResolveMock().mockResolvedValue({
      recipients: ['alerts@example.org'],
      source: 'config',
      category: 'virus-detection',
    });

    await NotificationService.sendAdminEmail({
      subject: 'test',
      htmlBody: '<p>body</p>',
      category: 'virus-detection',
      explicitRecipients: [null, '', '   ', undefined],
    });

    expect(DynamicsService.createAndSendEmail.mock.calls[0][0].to).toEqual([
      'alerts@example.org',
    ]);
  });

  test('category resolution empty + no explicit → skipped, no email', async () => {
    getResolveMock().mockResolvedValue({
      recipients: [],
      source: 'roster',
      category: 'default',
    });

    const sent = await NotificationService.sendAdminEmail({
      subject: 'test',
      htmlBody: '<p>body</p>',
      category: 'virus-detection',
    });

    expect(sent).toBe(false);
    expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
  });

  test('no category and no explicit → skipped (resolver never called)', async () => {
    const sent = await NotificationService.sendAdminEmail({
      subject: 'test',
      htmlBody: '<p>body</p>',
    });

    expect(sent).toBe(false);
    expect(getResolveMock()).not.toHaveBeenCalled();
    expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
  });

  test('no NOTIFICATION_EMAIL_FROM → skipped even with recipients available', async () => {
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
