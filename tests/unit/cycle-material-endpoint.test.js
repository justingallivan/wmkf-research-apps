/**
 * Tests for GET /api/reviewer-finder/cycle-material — the record-scoped private
 * download proxy for grant-cycle materials (Phase 1 private-blob migration).
 *
 * Covers: method/param validation, the record-scope allowlist (the security
 * property — a pathname not belonging to the cycle is 404), legacy public refs
 * are not served, fail-closed 503 on a missing store token, and the safe
 * response headers (attachment + nosniff + no-store).
 */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 7 })) }));
jest.mock('../../lib/services/grant-cycles-dataverse', () => ({ findById: jest.fn() }));
jest.mock('../../lib/utils/uploaded-blob', () => ({ readUploadedBlobBuffer: jest.fn() }));

import handler from '../../pages/api/reviewer-finder/cycle-material';
import { requireAppAccess } from '../../lib/utils/auth';
import { findById } from '../../lib/services/grant-cycles-dataverse';
import { readUploadedBlobBuffer } from '../../lib/utils/uploaded-blob';

const TEMPLATE_PATH = 'cycle-materials/review-template-aB3xQ.docx';
const ATT_PATH = 'cycle-materials/cycle-attachment-Zk9pP.pdf';
const PUBLIC_URL = 'https://abc123.public.blob.vercel-storage.com/old-template-xyz.docx';
// cycleId becomes a Dataverse record-id selector, so the route GUID-validates it
// at the edge (S259 trust-boundary hardening). Fixtures must use a real GUID or
// they 400 before reaching the cycle lookup / record-scope logic.
const CYCLE_ID = '00000000-0000-4000-8000-000000000001';

function makeCycle(overrides = {}) {
  return {
    id: CYCLE_ID,
    name: 'FY25',
    reviewTemplateBlobUrl: TEMPLATE_PATH,
    reviewTemplateFilename: 'Review Template.docx',
    additionalAttachments: [
      { pathname: ATT_PATH, access: 'private', filename: 'Guidelines.pdf' },
    ],
    ...overrides,
  };
}

function res() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    sent: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.sent = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 7 });
  findById.mockReset().mockResolvedValue(makeCycle());
  readUploadedBlobBuffer.mockReset().mockResolvedValue(Buffer.from('PRIVATE-MATERIAL-BYTES'));
});

it('rejects non-GET (405)', async () => {
  const r = res();
  await handler({ method: 'POST', query: {} }, r);
  expect(r.statusCode).toBe(405);
  expect(r.headers.Allow).toBe('GET');
});

it('returns early when auth fails (no body served)', async () => {
  requireAppAccess.mockResolvedValue(null); // gate already wrote its own response
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: TEMPLATE_PATH } }, r);
  expect(r.sent).toBeNull();
  expect(findById).not.toHaveBeenCalled();
});

it('400 when cycleId or pathname is missing', async () => {
  const r1 = res();
  await handler({ method: 'GET', query: { pathname: TEMPLATE_PATH } }, r1);
  expect(r1.statusCode).toBe(400);
  const r2 = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID } }, r2);
  expect(r2.statusCode).toBe(400);
});

it('400 when cycleId is not a valid GUID (before any cycle lookup)', async () => {
  // cycleId feeds findById → a Dataverse key-predicate selector, so it is
  // GUID-validated at the edge (S259 trust-boundary hardening); a non-GUID is a
  // 400 and never reaches the lookup.
  const r = res();
  await handler({ method: 'GET', query: { cycleId: 'nope', pathname: TEMPLATE_PATH } }, r);
  expect(r.statusCode).toBe(400);
  expect(findById).not.toHaveBeenCalled();
  expect(readUploadedBlobBuffer).not.toHaveBeenCalled();
});

it('404 when the cycle does not exist', async () => {
  findById.mockResolvedValue(null);
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: TEMPLATE_PATH } }, r);
  expect(r.statusCode).toBe(404);
  expect(readUploadedBlobBuffer).not.toHaveBeenCalled();
});

it('RECORD-SCOPE: 404 for a pathname not belonging to the cycle (does not read the blob)', async () => {
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: 'someone-elses-secret.pdf' } }, r);
  expect(r.statusCode).toBe(404);
  expect(readUploadedBlobBuffer).not.toHaveBeenCalled();
});

it('RECORD-SCOPE: a pathname that is a PREFIX of an allowed path is rejected (404)', async () => {
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: 'cycle-materials/review-template-aB3xQ' } }, r);
  expect(r.statusCode).toBe(404);
  expect(readUploadedBlobBuffer).not.toHaveBeenCalled();
});

it('RECORD-SCOPE: an allowed path with a trailing query string is rejected (404)', async () => {
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: `${TEMPLATE_PATH}?x=1` } }, r);
  expect(r.statusCode).toBe(404);
  expect(readUploadedBlobBuffer).not.toHaveBeenCalled();
});

it('strict prefix: a non-prefixed bare pathname in the template field is NOT treated as private', async () => {
  // A legacy/oddball value without the cycle-materials/ prefix must not be servable
  // as private — the discriminator is the prefix, not "anything that is not a URL".
  findById.mockResolvedValue(makeCycle({ reviewTemplateBlobUrl: 'review-template.docx', additionalAttachments: [] }));
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: 'review-template.docx' } }, r);
  expect(r.statusCode).toBe(404);
  expect(readUploadedBlobBuffer).not.toHaveBeenCalled();
});

it('does NOT serve a legacy public (https) template ref — that goes through blob-proxy', async () => {
  findById.mockResolvedValue(makeCycle({ reviewTemplateBlobUrl: PUBLIC_URL, additionalAttachments: [] }));
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: PUBLIC_URL } }, r);
  expect(r.statusCode).toBe(404);
  expect(readUploadedBlobBuffer).not.toHaveBeenCalled();
});

it('serves the private template with attachment + nosniff + no-store headers', async () => {
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: TEMPLATE_PATH } }, r);
  expect(r.statusCode).toBe(200);
  expect(readUploadedBlobBuffer).toHaveBeenCalledWith({ access: 'private', pathname: TEMPLATE_PATH });
  expect(r.sent.toString()).toBe('PRIVATE-MATERIAL-BYTES');
  expect(r.headers['Content-Disposition']).toBe('attachment; filename="Review Template.docx"');
  expect(r.headers['X-Content-Type-Options']).toBe('nosniff');
  expect(r.headers['Cache-Control']).toBe('private, no-store');
  expect(r.headers['Content-Type']).toBe(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
});

it('prefix-only classifier: an attachment with access:private but NO prefix is not served', async () => {
  // The single classifier is the cycle-materials/ prefix, NOT the JSON access field
  // (Codex SLICE2-5-VERIFY: a divergent access-vs-prefix check dropped attachments).
  findById.mockResolvedValue(makeCycle({
    additionalAttachments: [{ pathname: 'no-prefix-attachment.pdf', access: 'private', filename: 'x.pdf' }],
  }));
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: 'no-prefix-attachment.pdf' } }, r);
  expect(r.statusCode).toBe(404);
  expect(readUploadedBlobBuffer).not.toHaveBeenCalled();
});

it('serves a private additional attachment by pathname', async () => {
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: ATT_PATH } }, r);
  expect(r.statusCode).toBe(200);
  expect(r.headers['Content-Type']).toBe('application/pdf');
  expect(r.headers['Content-Disposition']).toBe('attachment; filename="Guidelines.pdf"');
});

it('fails closed with 503 when the private-store token is unset', async () => {
  readUploadedBlobBuffer.mockRejectedValue(
    new Error('readUploadedBlobBuffer: UPLOADS_BLOB_RW_TOKEN is not set — cannot read private uploads'),
  );
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: TEMPLATE_PATH } }, r);
  expect(r.statusCode).toBe(503);
});

it('maps a non-token read failure to 404', async () => {
  readUploadedBlobBuffer.mockRejectedValue(new Error('private blob not found'));
  const r = res();
  await handler({ method: 'GET', query: { cycleId: CYCLE_ID, pathname: TEMPLATE_PATH } }, r);
  expect(r.statusCode).toBe(404);
});
