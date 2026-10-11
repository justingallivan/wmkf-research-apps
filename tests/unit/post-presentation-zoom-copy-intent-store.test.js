/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(), db: { connect: jest.fn() } }));

import { db, sql } from '@vercel/postgres';
import {
  abandonZoomCopyIntentForSourceFailure,
  bindZoomCopyRegisteredReceipt,
  claimZoomCopyIntentForFinalize,
  claimZoomCopyIntentPump,
  claimZoomCopyIntentReceiptInspection,
  recordZoomCopyIntentSession,
  releaseZoomCopyIntentReceiptInspection,
  renewZoomCopyIntentReceiptInspection,
} from '../../lib/services/post-presentation-materials/upload-intent-store.js';

const ID = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222222';
const TOKEN = '44444444-4444-4444-8444-444444444444';
const COPY_TOKEN = '55555555-5555-4555-8555-555555555555';
const statement = (index = -1) => {
  const [strings] = index < 0 ? sql.mock.calls.at(index) : sql.mock.calls[index];
  return strings.join('?').replace(/\s+/g, ' ');
};

beforeEach(() => { sql.mockReset(); sql.mockResolvedValue({ rows: [{ id: ID }] }); db.connect.mockReset(); });

test('I1 is the recovery claim keyed on origin and an unexpired intent, with a recorded-candidate/document exclusion', async () => {
  const claimed = await claimZoomCopyIntentPump({ uploadId: ID });
  expect(claimed.leaseToken).toMatch(/^[0-9a-f-]{36}$/);
  const text = statement();
  expect(text).toContain("WHERE id = ? AND origin = 'zoom_copy' AND state IN ('initiated', 'failed')");
  expect(text).toContain('candidate_item_id IS NULL AND request_document_id IS NULL AND intent_expires_at > NOW()');
  expect(text).toContain('(lease_token IS NULL OR lease_expires_at <= NOW())');
  expect(text).not.toContain('request_id =');
  sql.mockResolvedValue({ rows: [] });
  expect(await claimZoomCopyIntentPump({ uploadId: ID })).toBeNull();
});

test('I2 requires origin, initiated, no ciphertext or candidate, and the live pump token; it keeps the lease', async () => {
  await recordZoomCopyIntentSession({ uploadId: ID, leaseToken: TOKEN, uploadUrlCiphertext: 'c', expiresAt: 'e', intentExpiresAt: 'i' });
  const text = statement();
  expect(text).toContain("origin = 'zoom_copy' AND state = 'initiated' AND upload_url_ciphertext IS NULL AND candidate_item_id IS NULL AND lease_token = ? AND lease_expires_at > NOW()");
  expect(text).toContain('last_error = NULL');
  expect(text).not.toContain('lease_token = NULL');
});

test('I3 takes only a recorded candidate, from uploaded or finalizing with a free or expired lease', async () => {
  const claimed = await claimZoomCopyIntentForFinalize({ uploadId: ID });
  expect(claimed.leaseToken).toBeTruthy();
  const text = statement();
  expect(text).toContain("SET state = 'finalizing'");
  expect(text).toContain("origin = 'zoom_copy' AND intent_expires_at > NOW()");
  expect(text).toContain("(state = 'uploaded' AND candidate_item_id IS NOT NULL AND (lease_token IS NULL OR lease_expires_at <= NOW()))");
  expect(text).toContain("(state = 'finalizing' AND candidate_item_id IS NOT NULL AND (lease_token IS NULL OR lease_expires_at <= NOW()))");
});

test('I4 claim needs origin, an inspectable state, a free lease, and expiry or a failed copy or a non-staff abandonment', async () => {
  await claimZoomCopyIntentReceiptInspection({ uploadId: ID });
  const text = statement();
  expect(text).toContain("u.origin = 'zoom_copy' AND u.state IN ('initiated', 'uploaded', 'finalizing', 'failed', 'abandoned')");
  expect(text).toContain('(u.lease_token IS NULL OR u.lease_expires_at <= NOW())');
  expect(text).toContain('u.intent_expires_at <= NOW()');
  expect(text).toContain("EXISTS (SELECT 1 FROM zoom_video_copies c WHERE c.upload_id = u.id AND c.state = 'failed')");
  expect(text).toContain("(u.state = 'abandoned' AND u.last_error IS DISTINCT FROM 'staff_cancelled')");
  expect(text).not.toMatch(/SET [^W]*state =/);
  expect(text).not.toMatch(/SET [^W]*intent_expires_at/);
});

test('I4 renew has no unexpired-intent predicate and release is token keyed', async () => {
  await renewZoomCopyIntentReceiptInspection({ uploadId: ID, leaseToken: TOKEN });
  const renew = statement();
  expect(renew).toContain("origin = 'zoom_copy' AND lease_token = ? AND lease_expires_at > NOW()");
  expect(renew).not.toContain('intent_expires_at');
  await releaseZoomCopyIntentReceiptInspection({ uploadId: ID, leaseToken: TOKEN });
  const release = statement();
  expect(release).toContain("origin = 'zoom_copy' AND lease_token = ?");
  expect(release).toContain('lease_token = NULL, lease_expires_at = NULL');
  expect(release).not.toMatch(/SET [^W]*state =/);
});

test('source-failure abandonment mirrors staff cancellation predicates but stores the sanitized source code', async () => {
  await abandonZoomCopyIntentForSourceFailure({ uploadId: ID, leaseToken: TOKEN, failureCode: 'zoom_recording_changed' });
  const text = statement();
  expect(text).toContain("SET state = 'abandoned', upload_url_ciphertext = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = ?");
  expect(text).toContain("origin = 'zoom_copy' AND lease_token = ? AND lease_expires_at > NOW() AND state IN ('initiated', 'failed') AND candidate_item_id IS NULL AND request_document_id IS NULL");
  expect(sql.mock.calls.at(-1).slice(1)).toContain('zoom_recording_changed');
  await abandonZoomCopyIntentForSourceFailure({ uploadId: ID, leaseToken: TOKEN, failureCode: 'Not A Code' });
  expect(sql.mock.calls.at(-1).slice(1)).toContain('zoom_import_failed');
  await expect(abandonZoomCopyIntentForSourceFailure({ uploadId: ID, leaseToken: TOKEN, failureCode: 'staff_cancelled' })).rejects.toThrow(TypeError);
});

describe('I5 bindZoomCopyRegisteredReceipt', () => {
  const candidate = { siteId: 's', driveId: 'd', itemId: 'i', versionId: 'v', eTag: 'e', size: 100 };
  const verified = { candidate, requestDocumentId: '66666666-6666-4666-8666-666666666666' };
  const expected = { state: 'initiated', generationKey: 'g'.repeat(64), candidateItemId: null, lastError: null };
  const intent = (over = {}) => ({ id: ID, origin: 'zoom_copy', request_id: REQ, state: 'initiated', generation_key: 'g'.repeat(64),
    candidate_item_id: null, last_error: null, lease_token: TOKEN, lease_live: true, declared_size: '100', request_document_id: null, ...over });
  const copy = (over = {}) => ({ id: ID, upload_id: ID, request_id: REQ, state: 'failed', lease_token: null, lease_live: false, ...over });

  function client({ copyRow = copy(), intentRow = intent(), update = [{ id: ID, state: 'finalized' }] } = {}) {
    const calls = [];
    const query = jest.fn(async (text, params) => {
      calls.push({ text: text.replace(/\s+/g, ' '), params });
      if (/FROM zoom_video_copies/.test(text)) return { rows: copyRow ? [copyRow] : [] };
      if (/^\s*SELECT \*/.test(text)) return { rows: intentRow ? [intentRow] : [] };
      if (/^\s*UPDATE/.test(text)) return { rows: update };
      return { rows: [] };
    });
    const release = jest.fn();
    db.connect.mockResolvedValue({ query, release });
    return { calls, release, query };
  }
  const bind = (over = {}) => bindZoomCopyRegisteredReceipt({ copyId: ID, inspectionLeaseToken: TOKEN, expected, verified, ...over });

  test('locks the copy then the intent, rechecks, updates once, and commits', async () => {
    const { calls, release } = client();
    const result = await bind();
    expect(result.bound).toBe(true);
    const texts = calls.map(c => c.text);
    expect(texts[0]).toBe('BEGIN');
    expect(texts[1]).toContain('FROM zoom_video_copies WHERE id = $1 FOR UPDATE');
    expect(texts[2]).toContain('FROM presentation_material_uploads WHERE id = $1 FOR UPDATE');
    expect(texts[3]).toContain("SET state = 'finalized', request_document_id = $2");
    expect(texts[3]).toContain("upload_url_ciphertext = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = NULL");
    expect(texts[3]).toContain("origin = 'zoom_copy' AND lease_token = $9 AND lease_expires_at > NOW()");
    expect(texts[4]).toBe('COMMIT');
    expect(release).toHaveBeenCalled();
  });

  test.each([
    ['copy_missing', { copyRow: null }, {}],
    ['intent_missing', { intentRow: null }, {}],
    ['link_mismatch', { intentRow: intent({ origin: 'browser' }) }, {}],
    ['link_mismatch', { intentRow: intent({ request_id: 'other' }) }, {}],
    ['inspection_lease_lost', { intentRow: intent({ lease_live: false }) }, {}],
    ['inspection_lease_lost', { intentRow: intent({ lease_token: 'other' }) }, {}],
    ['intent_changed', { intentRow: intent({ state: 'uploaded' }) }, {}],
    ['intent_changed', { intentRow: intent({ generation_key: 'h'.repeat(64) }) }, {}],
    ['intent_changed', { intentRow: intent({ candidate_item_id: 'i2' }) }, {}],
    ['rejected_candidate', { intentRow: intent({ state: 'failed', candidate_item_id: 'i', last_error: 'x' }) }, { expected: { ...expected, state: 'failed', candidateItemId: 'i', lastError: 'x' } }],
    ['abandonment_not_bindable', { intentRow: intent({ state: 'abandoned', last_error: 'staff_cancelled' }) }, { expected: { ...expected, state: 'abandoned', lastError: 'staff_cancelled' } }],
    ['candidate_mismatch', { intentRow: intent({ candidate_item_id: 'i', candidate_drive_id: 'other', candidate_size: '100' }) }, { expected: { ...expected, candidateItemId: 'i' } }],
    ['size_mismatch', { intentRow: intent({ declared_size: '101' }) }, {}],
    ['copy_lease_lost', { copyRow: copy({ state: 'copying', lease_token: COPY_TOKEN, lease_live: true }) }, {}],
    ['copy_lease_lost', { copyRow: copy({ state: 'copying', lease_token: 'other', lease_live: true }) }, { copyLeaseToken: COPY_TOKEN }],
    ['copy_lease_live', { copyRow: copy({ lease_token: COPY_TOKEN, lease_live: true }) }, {}],
    ['copy_state_invalid', { copyRow: copy({ state: 'cancelled' }) }, {}],
    ['bind_failed', { update: [] }, {}],
  ])('%s writes nothing and rolls back', async (reason, setup, over) => {
    const { calls } = client(setup);
    expect(await bind(over)).toMatchObject({ bound: false, reason });
    const texts = calls.map(c => c.text);
    if (reason !== 'bind_failed') expect(texts.some(t => t.startsWith('UPDATE'))).toBe(false);
    expect(texts.at(-1)).toBe('ROLLBACK');
  });

  test('an active copy binds only with the caller live copy token; a failed copy needs a free lease', async () => {
    client({ copyRow: copy({ state: 'registering', lease_token: COPY_TOKEN, lease_live: true }) });
    expect((await bind({ copyLeaseToken: COPY_TOKEN })).bound).toBe(true);
    client({ copyRow: copy({ state: 'failed', lease_token: COPY_TOKEN, lease_live: false }) });
    expect((await bind()).bound).toBe(true);
  });

  test('a verified candidate and document id are required, and a thrown error rolls back and releases', async () => {
    await expect(bind({ verified: { candidate: { ...candidate, itemId: '' }, requestDocumentId: verified.requestDocumentId } })).rejects.toThrow(TypeError);
    const { query, release } = client();
    query.mockImplementation(async text => { if (/^\s*UPDATE/.test(text)) throw new Error('boom'); return { rows: /FROM zoom_video_copies/.test(text) ? [copy()] : [intent()] }; });
    await expect(bind()).rejects.toThrow('boom');
    expect(query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalled();
  });
});
