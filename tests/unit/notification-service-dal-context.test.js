/**
 * notification-service DAL-context contract.
 *
 * Originally an S333 bypass-strip characterization pinning the internal
 * withDalContext('notification-email') wrap. That wrap was REMOVED in the
 * S334 site-33 push-up (docs/NOTIFICATION_TRUST_MODEL_PLAN.md Stage 3) once
 * every entry point that can reach the email branch establishes its own
 * trusted context. This file now pins the NEW contract:
 *   - sendAdminEmail no longer self-establishes a context (called bare, the
 *     transport runs untrusted — and in production createAndSendEmail's
 *     assertTrustedDalContext would fail closed);
 *   - sendAdminEmail PROPAGATES an ambient caller-established context.
 * The real fail-closed throw (no context -> createAndSendEmail throws) is
 * exercised with a real DynamicsService in the negative control of
 * notification-trust-model-pushup.test.js.
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
const { hasTrustedDalContext, withDalContext } = require('../../lib/dataverse/core/context');

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

  test('sendAdminEmail no longer self-establishes context — called bare, createAndSendEmail runs untrusted (S334 push-up removed the internal wrap)', async () => {
    const seen = { inside: null };
    DynamicsService.createAndSendEmail.mockImplementation(async () => {
      seen.inside = hasTrustedDalContext();
    });

    const sent = await NotificationService.sendAdminEmail({
      subject: 'Test subject',
      htmlBody: '<p>body</p>',
      category: 'ops',
    });

    // Transport still runs (DynamicsService mocked here, so no fail-closed throw),
    // but with NO ambient context it runs untrusted: establishment is now the
    // caller/entry-point's responsibility, not sendAdminEmail's. If someone
    // re-adds an internal wrap, seen.inside flips to true and this fails.
    expect(sent).toBe(true);
    expect(seen.inside).toBe(false);
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('sendAdminEmail propagates an ambient caller-established trusted context to createAndSendEmail', async () => {
    const seen = { inside: null };
    DynamicsService.createAndSendEmail.mockImplementation(async () => {
      seen.inside = hasTrustedDalContext();
    });

    const sent = await withDalContext('caller-established-context', () =>
      NotificationService.sendAdminEmail({
        subject: 'Test subject',
        htmlBody: '<p>body</p>',
        category: 'ops',
      }),
    );

    expect(sent).toBe(true);
    expect(seen.inside).toBe(true);
    expect(hasTrustedDalContext()).toBe(false);
  });
});
