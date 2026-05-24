/**
 * Tests for the shared HTTP-response mapper used by both review-upload
 * endpoints (/api/review-manager/upload-review and
 * /api/external/review/[token]/upload). Verifies that the writeReviewFiles
 * ok:false reasons map to consistent status codes across both surfaces.
 */

const { respondForFailedReviewUpload } = require('../../lib/utils/review-upload-response.js');

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  return res;
}

describe('respondForFailedReviewUpload', () => {
  test('validation → 400, echoes errors', () => {
    const res = makeRes();
    respondForFailedReviewUpload(res, { ok: false, reason: 'validation', errors: ['missing affiliation'] });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, reason: 'validation', errors: ['missing affiliation'] });
  });

  test('not_found → 404', () => {
    const res = makeRes();
    respondForFailedReviewUpload(res, { ok: false, reason: 'not_found' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ ok: false, reason: 'not_found' });
  });

  test('infected → 422, echoes the file-level errors (caller-actionable)', () => {
    const res = makeRes();
    respondForFailedReviewUpload(res, {
      ok: false,
      reason: 'infected',
      errors: ['a.pdf: virus detected (EICAR-Test-Signature)'],
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      ok: false,
      reason: 'infected',
      errors: ['a.pdf: virus detected (EICAR-Test-Signature)'],
    });
  });

  test('scan_misconfigured → 500, generic message (no leak)', () => {
    const res = makeRes();
    respondForFailedReviewUpload(res, { ok: false, reason: 'scan_misconfigured' });
    expect(res.statusCode).toBe(500);
    expect(res.body.reason).toBe('scan_misconfigured');
    expect(res.body.message).toBe('Virus scanner is misconfigured. Contact an administrator.');
    // No `error` or `details` fields that would leak structured-error context.
    expect(res.body).not.toHaveProperty('error');
    expect(res.body).not.toHaveProperty('details');
  });

  test('scan_unavailable → 503, generic retry message', () => {
    const res = makeRes();
    respondForFailedReviewUpload(res, { ok: false, reason: 'scan_unavailable' });
    expect(res.statusCode).toBe(503);
    expect(res.body.reason).toBe('scan_unavailable');
    expect(res.body.message).toMatch(/temporarily unavailable/);
    expect(res.body.message).toMatch(/try again/);
    expect(res.body).not.toHaveProperty('error');
  });

  test('unknown reason → 500, echoes envelope (defensive)', () => {
    const res = makeRes();
    respondForFailedReviewUpload(res, { ok: false, reason: 'some_new_thing', extra: 1 });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ ok: false, reason: 'some_new_thing', extra: 1 });
  });

  test('sharepoint_failed (existing reason) → 500 via default branch', () => {
    // Defensive: ensure pre-existing reasons that we didn't add a case for
    // still surface as 500. Behavior matches the pre-extraction inline
    // mapping (`else → 500`).
    const res = makeRes();
    respondForFailedReviewUpload(res, {
      ok: false,
      reason: 'sharepoint_failed',
      error: 'SharePoint 503',
      partial: ['a.pdf'],
    });
    expect(res.statusCode).toBe(500);
    expect(res.body.reason).toBe('sharepoint_failed');
  });
});
