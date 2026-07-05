/**
 * Regression test: intake routes + staff sign-in + drain recovery must wrap
 * their trusted Dynamics reads in bypassDynamicsRestrictions().
 *
 * After F-002 made DynamicsService.checkRestriction() fail closed when no
 * ALS context is set, the bridge/membership/identity-link/recovery paths
 * regressed silently (Codex 2026-05-26 review P1 + P2 + P2). This test
 * pins the fix: each affected route calls bypassDynamicsRestrictions
 * around the relevant call site.
 *
 * Strategy: spy on bypassDynamicsRestrictions and assert it is invoked
 * with a non-empty label during the trusted-read path.
 *
 * @jest-environment node
 */

const bypassSpy = jest.fn((labelOrFn, maybeFn) => {
  const fn = typeof labelOrFn === 'function' ? labelOrFn : maybeFn;
  return Promise.resolve().then(() => fn());
});

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: bypassSpy,
  withDynamicsContext: jest.fn(),
  getDynamicsContext: jest.fn(),
}));

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('../../lib/services/contact-bridge-service', () => ({
  resolveContactForSession: jest.fn(),
}));
jest.mock('../../lib/services/membership-service', () => ({
  hasLiveMembership: jest.fn(),
  hasSubmitterRole: jest.fn(),
}));
jest.mock('../../lib/services/intake-draft-service', () => ({
  __esModule: true,
  default: {
    getByKey: jest.fn(),
    upsertDraftJson: jest.fn(),
    getById: jest.fn(),
  },
}));
jest.mock('../../lib/services/intake-audit-service', () => ({
  __esModule: true,
  default: { log: jest.fn(() => Promise.resolve(null)) },
}));
jest.mock('../../lib/intake/rate-limit', () => ({
  checkIntakeRateLimit: jest.fn(() => Promise.resolve({ ok: true })),
}));

import { getServerSession } from 'next-auth/next';
import { resolveContactForSession } from '../../lib/services/contact-bridge-service';
import { hasLiveMembership, hasSubmitterRole } from '../../lib/services/membership-service';
import IntakeDraftService from '../../lib/services/intake-draft-service';

const CONTACT_OID = 'oid-1';
const CONTACT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeReqRes(body = {}, method = 'POST') {
  const req = { method, body, headers: {} };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
  };
  return { req, res };
}

function mockApplicantSession() {
  getServerSession.mockResolvedValue({
    user: {
      userType: 'applicant',
      contactOid: CONTACT_OID,
      contactEmail: 'a@b.org',
      contactName: 'A B',
    },
  });
}

beforeEach(() => {
  bypassSpy.mockClear();
  resolveContactForSession.mockReset();
  hasLiveMembership.mockReset();
  hasSubmitterRole.mockReset();
  IntakeDraftService.getByKey.mockReset();
  IntakeDraftService.upsertDraftJson.mockReset();
  IntakeDraftService.getById.mockReset();
  resolveContactForSession.mockResolvedValue({ ok: true, contactId: CONTACT_ID });
  hasLiveMembership.mockResolvedValue(true);
  hasSubmitterRole.mockResolvedValue(true);
});

describe('intake routes wrap trusted Dynamics reads in bypass context', () => {
  test('POST /api/intake/draft wraps bridge + membership', async () => {
    const handler = (await import('../../pages/api/intake/draft')).default;
    mockApplicantSession();
    IntakeDraftService.getByKey.mockResolvedValue(null);
    IntakeDraftService.upsertDraftJson.mockResolvedValue({ id: 1, updated_at: 't' });
    const { req, res } = makeReqRes({ accountId: ACCOUNT_ID, formKey: 'k', draftJson: {} });
    await handler(req, res);
    const labels = bypassSpy.mock.calls.map((c) => c[0]);
    expect(labels).toEqual(expect.arrayContaining([
      'intake-draft-bridge',
      'intake-draft-membership',
    ]));
  });

  test('POST /api/intake/submit wraps bridge + membership', async () => {
    // submit pulls a draft + pg; we only need the route to reach the
    // bridge/membership calls before any downstream failure.
    const handler = (await import('../../pages/api/intake/submit')).default;
    mockApplicantSession();
    // Make the route fail AFTER the bridge + membership reads have run.
    IntakeDraftService.getByKey.mockRejectedValue(new Error('stop here'));
    const { req, res } = makeReqRes({
      accountId: ACCOUNT_ID,
      formKey: 'k',
      idempotencyKey: 'idem-1',
    });
    await handler(req, res);
    const labels = bypassSpy.mock.calls.map((c) => c[0]);
    expect(labels).toEqual(expect.arrayContaining([
      'intake-submit-bridge',
      'intake-submit-membership',
    ]));
  });

  test('POST /api/intake/draft/upload-token wraps bridge + membership on non-owner path', async () => {
    const handler = (await import('../../pages/api/intake/draft/upload-token')).default;
    mockApplicantSession();
    // Different contact_oid so the non-owner branch runs.
    IntakeDraftService.getById.mockResolvedValue({
      id: 7,
      contact_oid: 'other-oid',
      account_id: ACCOUNT_ID,
      form_key: 'k',
      request_id: null,
    });
    const { req, res } = makeReqRes({
      draftId: 7,
      fieldKey: 'budget',
      filename: 'b.pdf',
      contentType: 'application/pdf',
    });
    await handler(req, res);
    const labels = bypassSpy.mock.calls.map((c) => c[0]);
    expect(labels).toEqual(expect.arrayContaining([
      'intake-upload-token-bridge',
      'intake-upload-token-membership',
    ]));
  });

  test('POST /api/intake/draft/attach wraps bridge + membership on non-owner path', async () => {
    const handler = (await import('../../pages/api/intake/draft/attach')).default;
    mockApplicantSession();
    IntakeDraftService.getById.mockResolvedValue({
      id: 9,
      contact_oid: 'other-oid',
      account_id: ACCOUNT_ID,
      form_key: 'k',
      request_id: null,
      attachments: [],
      pending_attachments: [],
    });
    const { req, res } = makeReqRes({
      draftId: 9,
      attachmentId: '11111111-1111-4111-8111-111111111111',
    });
    await handler(req, res);
    const labels = bypassSpy.mock.calls.map((c) => c[0]);
    expect(labels).toEqual(expect.arrayContaining([
      'intake-attach-bridge',
      'intake-attach-membership',
    ]));
  });
});

describe('staff sign-in reconcileProfile is wrapped', () => {
  // Direct module-shape assertion is the right scope: importing the full
  // NextAuth route handler pulls Postgres + the provider config. The fix
  // is structurally a single-line wrap; pin it by reading the source.
  //
  // S333 bypass-strip Stage 1: the wrapper is now the sanctioned
  // `withDalContext` (behavior-identical to the retired
  // `bypassDynamicsRestrictions`, same label); the shape assertion tracks
  // the rename.
  test('source contains withDalContext around reconcileProfile', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../pages/api/auth/[...nextauth].js'),
      'utf8'
    );
    // Both fire-and-forget reconcile call sites must be wrapped AND
    // reconcileProfile must appear lexically inside each wrapper — not
    // just somewhere else in the file.
    const wrappedShape = src.match(
      /withDalContext\(\s*['"]staff-signin-reconcile['"][^]*?reconcileProfile\s*\(/g
    );
    expect(wrappedShape?.length || 0).toBeGreaterThanOrEqual(2);
    // No bare reconcileProfile(...).catch — every call site must go
    // through the wrapper.
    expect(src).not.toMatch(/^\s*reconcileProfile\([^)]*\)\.catch/m);
    // No unwrapped legacy shape remains.
    expect(src).not.toMatch(/bypassDynamicsRestrictions/);
  });
});

describe('notification email transport is wrapped', () => {
  // Codex S191 found that NotificationService.sendAdminEmail →
  // DynamicsService.createAndSendEmail → resolveSystemUser →
  // queryRecords('systemusers') was unwrapped, breaking notifyNewUser
  // from the sign-in callback.
  //
  // S333 bypass-strip Stage 2: the wrapper is now the sanctioned
  // `withDalContext` (behavior-identical to the retired
  // `bypassDynamicsRestrictions`, same label); the shape assertion tracks
  // the rename.
  test('source wraps DynamicsService.createAndSendEmail in a trusted DAL context', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../lib/services/notification-service.js'),
      'utf8'
    );
    expect(src).toMatch(
      /withDalContext\(\s*['"]notification-email['"][^]*?DynamicsService\.createAndSendEmail\s*\(/
    );
    expect(src).not.toMatch(/bypassDynamicsRestrictions/);
  });
});

describe('test-email endpoint is wrapped', () => {
  // Route→Service Consolidation Stage 5: the route is now a thin shell that
  // establishes withDalContext around the service call (labels preserved via
  // branch dispatch); the Dynamics email calls live in
  // lib/services/admin/test-email-service.js and are additionally guarded
  // fail-closed by assertTrustedDalContext inside DynamicsService (S330).
  test('shell establishes the DAL context (historical labels kept) around the service call', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../pages/api/test-email.js'),
      'utf8'
    );
    // Both historical labels still selected at dispatch time…
    expect(src).toMatch(/['"]test-email-send['"]/);
    expect(src).toMatch(/['"]test-email-draft['"]/);
    // …and the context lexically encloses the one service call.
    expect(src).toMatch(/withDalContext\(\s*label[^]*?sendTestEmail\s*\(/);
    // No unwrapped legacy shape remains.
    expect(src).not.toMatch(/bypassDynamicsRestrictions/);
  });

  test('service performs the Dynamics email calls (context assumed, enforced by DynamicsService)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../lib/services/admin/test-email-service.js'),
      'utf8'
    );
    expect(src).toMatch(/DynamicsService\.createAndSendEmail\s*\(/);
    expect(src).toMatch(/DynamicsService\.createEmailActivity\s*\(/);
  });
});

describe('drain duplicate-PK recovery relies on the outer processJob context', () => {
  // S333 Stage 4a: the local `drain-recover-request-created` withDalContext
  // wrap was removed as nested-redundant — recoverRequestCreated is only ever
  // reached from within a state handler dispatched under processJob's own
  // withDalContext('drain-submissions'), which already covers this read (not
  // enforcement-gated itself, but the invariant — trusted context reaches
  // every state-handler branch — still holds; proven at runtime by
  // tests/unit/drain-submissions-dal-context.test.js).
  test('source no longer wraps the recovery read in its own local context', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../lib/services/cron/drain-submissions-service.js'),
      'utf8'
    );
    expect(src).not.toMatch(/withDalContext\(\s*['"]drain-recover-request-created['"]/);
    expect(src).not.toMatch(/bypassDynamicsRestrictions/);
    // The outer dispatcher wrap must still exist — that's what makes the
    // removal safe rather than a stranding regression.
    expect(src).toMatch(/withDalContext\(\s*['"]drain-submissions['"][^]*?handler\s*\(/);
  });
});
