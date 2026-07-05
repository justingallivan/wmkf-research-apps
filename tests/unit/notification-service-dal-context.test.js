/**
 * S333 bypass-strip Stage 0 characterization (BYPASS_STRIP_PLAN.md site 33,
 * lib/services/notification-service.js). This is the ENTRY-seam called
 * fire-and-forget from the NextAuth sign-in callback (A4, no ambient
 * context). Drives the real dynamics-context machinery (no dynamics-context
 * mock) and asserts hasTrustedDalContext() === true inside
 * DynamicsService.createAndSendEmail (notification-email).
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/alert-recipients', () => ({
  resolveRecipients: jest.fn().mockResolvedValue({
    recipients: ['admin@example.com'],
    category: 'ops',
    source: 'config',
  }),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createAndSendEmail: jest.fn() },
}));

const NotificationService = require('../../lib/services/notification-service');
const { DynamicsService } = require('../../lib/services/dynamics-service');
const { hasTrustedDalContext } = require('../../lib/dataverse/core/context');

describe('notification-service DAL context (S333 characterization, site 33)', () => {
  beforeEach(() => {
    process.env.NOTIFICATION_EMAIL_FROM = 'sender@example.com';
    process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
    process.env.DYNAMICS_TENANT_ID = 't';
    process.env.DYNAMICS_CLIENT_ID = 'c';
    process.env.DYNAMICS_CLIENT_SECRET = 's';
  });
  afterEach(() => {
    delete process.env.NOTIFICATION_EMAIL_FROM;
    jest.clearAllMocks();
  });

  test('negative control: no trusted context exists before the call', () => {
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('sendAdminEmail establishes a trusted context for createAndSendEmail (fire-and-forget seam)', async () => {
    const seen = { inside: null };
    DynamicsService.createAndSendEmail.mockImplementation(async () => {
      seen.inside = hasTrustedDalContext();
    });

    const sent = await NotificationService.sendAdminEmail({
      subject: 'Test subject',
      htmlBody: '<p>body</p>',
      category: 'ops',
    });

    expect(sent).toBe(true);
    expect(seen.inside).toBe(true);
    expect(hasTrustedDalContext()).toBe(false);
  });
});
