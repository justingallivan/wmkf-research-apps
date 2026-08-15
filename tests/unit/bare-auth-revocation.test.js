/**
 * Route-level tests for the four "bare requireAuth" routes (no
 * requireAuthWithProfile / requireAppAccess layered on top):
 *   - pages/api/blob-proxy.js
 *   - pages/api/upload-handler.js
 *   - pages/api/health.js
 *   - pages/api/api-capabilities.js
 *
 * Security audit (docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md
 * §1): bare requireAuth previously did NO is_active read, so a disabled staff
 * account kept using these routes indefinitely. requireAuth now performs a
 * live is_active lookup for non-applicant sessions (see lib/utils/auth.js).
 * These tests prove the fix at the route boundary: a disabled session is
 * blocked with 403 BEFORE the route's core side effect runs, and an active
 * session still reaches the handler (proving the 403 comes from revocation,
 * not a broken mock).
 */

import {
  mockAuthenticatedUser,
  mockDisabledUser,
  createMockReq,
  createMockRes,
} from '../helpers/auth-mock';

// --- blob-proxy.js: mock global fetch so we can assert it was/wasn't called ---
const mockFetch = jest.fn();
global.fetch = mockFetch;

// --- upload-handler.js: mock @vercel/blob/client's handleUpload ---
const mockHandleUpload = jest.fn();
jest.mock('@vercel/blob/client', () => ({
  handleUpload: (...args) => mockHandleUpload(...args),
}));

// --- health.js: mock the health-check runner ---
const mockRunHealthChecks = jest.fn();
jest.mock('../../lib/utils/health-checker', () => ({
  runHealthChecks: (...args) => mockRunHealthChecks(...args),
}));

import blobProxyHandler from '../../pages/api/blob-proxy';
import uploadHandler from '../../pages/api/upload-handler';
import healthHandler from '../../pages/api/health';
import apiCapabilitiesHandler from '../../pages/api/api-capabilities';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('bare requireAuth revocation — /api/blob-proxy', () => {
  it('blocks a disabled session with 403 and does not fetch the blob', async () => {
    mockDisabledUser(1);
    const req = createMockReq({ method: 'GET', query: { url: 'https://abc123.public.blob.vercel-storage.com/x' } });
    const res = createMockRes();

    await blobProxyHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('disabled') })
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('positive control: an active session reaches the fetch', async () => {
    mockAuthenticatedUser(1, []);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const req = createMockReq({ method: 'GET', query: { url: 'https://abc123.public.blob.vercel-storage.com/x' } });
    const res = createMockRes();

    await blobProxyHandler(req, res);

    expect(mockFetch).toHaveBeenCalledWith('https://abc123.public.blob.vercel-storage.com/x');
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

describe('bare requireAuth revocation — /api/upload-handler', () => {
  it('blocks a disabled session with 403 and does not mint an upload token', async () => {
    mockDisabledUser(2);
    const req = createMockReq({ method: 'POST', body: {} });
    const res = createMockRes();

    await uploadHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('disabled') })
    );
    expect(mockHandleUpload).not.toHaveBeenCalled();
  });

  it('positive control: an active session reaches handleUpload', async () => {
    mockAuthenticatedUser(2, []);
    mockHandleUpload.mockResolvedValue({ type: 'blob.generate-client-token', clientToken: 'x' });
    const req = createMockReq({ method: 'POST', body: {} });
    const res = createMockRes();

    await uploadHandler(req, res);

    expect(mockHandleUpload).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

describe('bare requireAuth revocation — /api/health', () => {
  it('blocks a disabled session with 403 and does not run health checks', async () => {
    mockDisabledUser(3);
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();

    await healthHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('disabled') })
    );
    expect(mockRunHealthChecks).not.toHaveBeenCalled();
  });

  it('positive control: an active session reaches runHealthChecks', async () => {
    mockAuthenticatedUser(3, []);
    mockRunHealthChecks.mockResolvedValue({ overall: 'healthy' });
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();

    await healthHandler(req, res);

    expect(mockRunHealthChecks).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

describe('bare requireAuth revocation — /api/api-capabilities', () => {
  it('blocks a disabled session with 403 and does not report capability status', async () => {
    mockDisabledUser(4);
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();

    await apiCapabilitiesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('disabled') })
    );
    expect(res.json).not.toHaveBeenCalledWith(
      expect.objectContaining({ orcid: expect.anything() })
    );
  });

  it('positive control: an active session reaches the capability report', async () => {
    mockAuthenticatedUser(4, []);
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();

    await apiCapabilitiesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ orcid: expect.any(Boolean) })
    );
  });
});
