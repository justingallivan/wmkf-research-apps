/** @jest-environment node */
import { jest } from '@jest/globals';
import {
  LEDGER_RECEIPT_KEYS,
  assertLedgerReceipt,
  createRunLedger,
  requestNumberOrThrow,
  sanitizeErrorMessage,
} from '../../lib/services/test-requests/run-ledger.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';

function thrownCode(fn) {
  try { fn(); } catch (error) { return error.code; }
  return 'did-not-throw';
}

function recordingDb(rowsPerCall = []) {
  const calls = [];
  let index = 0;
  const query = async (text, params) => {
    calls.push({ text, params });
    const rows = rowsPerCall[index++] ?? [];
    return { rows };
  };
  return { calls, query, transaction: async (fn) => fn({ query }) };
}

describe('ledger redaction', () => {
  test('sanitizeErrorMessage removes the secret itself, not just its label', () => {
    const text = 'Bearer abc.def; Authorization: Basic dXNlcjpwYXNz; url https://x.sharepoint.com/_layouts/15/download.aspx?a=1&sig=SECRET123&sv=2020';
    const cleaned = sanitizeErrorMessage(text);
    for (const secret of ['abc.def', 'dXNlcjpwYXNz', 'SECRET123', 'download.aspx']) {
      expect(cleaned).not.toContain(secret);
    }
    for (const quoted of [
      'Authorization: "Basic QUOTED1"', "Authorization='Basic QUOTED2'", '{"Authorization":"Bearer QUOTED3"}', 'Authorization=Basic QUOTED4,next',
    ]) {
      expect(sanitizeErrorMessage(quoted)).not.toMatch(/QUOTED/);
    }
    expect(cleaned.length).toBeLessThanOrEqual(500);
  });

  test('assertLedgerReceipt is an allowlist: unknown keys, nested objects, bodies, links and credentials are rejected, not redacted', () => {
    const ok = {
      requestId: '5d54abc5-7f74-4d23-b4be-39599147e674', requestNumber: '1000340', itemId: '01G4GVMS34H6SGDJZCGNF2NLBTIUMXWRAW',
      contentHash: 'a'.repeat(64), size: 287771, eTag: '"{1}"', versionId: '1.0', outcome: 'verified',
      dispatchedAt: '2026-09-24T04:40:00.000Z', restoreVerified: true, requestIds: ['5d54abc5-7f74-4d23-b4be-39599147e674'],
    };
    expect(assertLedgerReceipt(ok)).toBe(ok);
    const rejects = [
      { akoya_purpose: 'confidential text' },
      { createBody: { akoya_title: 'x' } },
      { '@microsoft.graph.downloadUrl': 'https://x' },
      { body: 'x' }, { bytes: 'x' }, { narrative: 'x' }, { token: 'x' }, { bodyId: 'x' },
      { reason: 'anything' },
      { workflowName: 'GOverify' },
      { eTag: 'Authorization: Basic zzz' },
      { name: 'https://sharepoint.com/file' },
      { filename: 'x'.repeat(201) },
      { filename: 'Report with a very long name that exceeds the sixty character cap.pdf' },
      { filename: 'The confidential purpose of this proposal' },
      { contentHash: 'not-hex' },
      { requestNumber: 'DROP TABLE' },
      { verifiedAt: 'yesterday' },
      { nested: { a: 1 } },
      { requestIds: [{ id: 1 }] },
      { folder: 'line\nbreak' },
      { workflowName: 'The confidential purpose of this proposal is to study' },
      { expectedValue: 'confidential narrative text here' },
      { relativeUrl: '//attacker/share' },
      { relativeUrl: '../escape' },
      { folder: 'a//b' },
      { itemIds: ['QmFzZSBzaXh0eS1mb3VyIGVuY29kZWQgdGV4dCB0aGF0IGlzIGxvbmcgZW5vdWdoIHRvIGNhcnJ5IGNvbnRlbnQ='] },
      { status: 'x'.repeat(41) },
      { size: -1 }, { size: 'twelve' }, { restored: 'yes' },
      { eTag: 'W/"1" Bearer x' },
      { createdAt: 'Bearer x' },
      { bodyAt: '2026-01-01T00:00:00Z' },
    ];
    for (const bad of rejects) {
      expect([JSON.stringify(bad).slice(0, 40), thrownCode(() => assertLedgerReceipt(bad))])
        .toEqual([JSON.stringify(bad).slice(0, 40), 'test_request_ledger_unsafe_value']);
    }
    expect(LEDGER_RECEIPT_KEYS).not.toEqual(expect.arrayContaining(['purpose', 'body', 'content', 'token', 'downloadUrl', 'reason', 'workflowName', 'title']));
  });

  test('every JSONB write is validated before binding, so an unsafe receipt never reaches SQL', async () => {
    const runRow = { run_id: RUN_ID, lease_token: TOKEN, lease_generation: 1, lease_live: true, version: 2 };
    const db = recordingDb([[runRow], [{ next_sequence: 1 }], [{ resource_id: 1 }], [runRow], [{ resource_id: 1 }]]);
    const ledger = createRunLedger(db);
    await ledger.journalPlannedResource({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint',
      plannedIdentity: { filename: 'a.pdf', folder: 'F/AI Materials' },
      sourceProvenance: { graphItemId: 'x', contentHash: 'b'.repeat(64) },
    });
    await ledger.recordResourceReadback({
      resourceId: 1, runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, responseStatus: 201,
      readback: { itemId: 'x', eTag: '"2"' }, outcome: 'verified',
    });
    const before = db.calls.length;
    await expect(ledger.journalPlannedResource({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint',
      plannedIdentity: { filename: 'a.pdf', downloadUrl: 'https://leak' },
    })).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
    await expect(ledger.recordResourceReadback({
      resourceId: 1, runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, responseStatus: 201,
      readback: { itemId: 'x', body: 'huge' }, outcome: 'verified',
    })).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
    // Validation happens before any SQL for the rejected calls.
    expect(db.calls.length).toBe(before);
    const inserted = db.calls.find((c) => c.text.includes('INSERT INTO test_request_run_resources'));
    expect(inserted.params[5]).toBe(JSON.stringify({ filename: 'a.pdf', folder: 'F/AI Materials' }));
  });

  test('requestNumberOrThrow is shared by advanceStep and markReady, and markReady requires a number atomically', async () => {
    expect(requestNumberOrThrow(1000340)).toBe('1000340');
    expect(requestNumberOrThrow(null)).toBeNull();
    expect(thrownCode(() => requestNumberOrThrow('12x'))).toBe('test_request_run_invalid_request_number');
    const db = recordingDb([[{ run_id: RUN_ID, status: 'ready' }]]);
    const ledger = createRunLedger(db);
    await expect(ledger.markReady({ runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 2, destinationRequestNumber: 'abc' }))
      .rejects.toMatchObject({ code: 'test_request_run_invalid_request_number' });
    expect(db.calls).toHaveLength(0);
    await ledger.markReady({ runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 2, destinationRequestNumber: '1000340' });
    expect(db.calls[0].text).toContain("AND COALESCE($5::text, destination_request_number) ~ '^[0-9]{1,10}$'");
    expect(db.calls[0].params[4]).toBe('1000340');
  });
});

describe('ledger lifecycle additions', () => {
  test('markNeedsAttention releases the lease in the same statement', async () => {
    const db = recordingDb([[{ run_id: RUN_ID, status: 'needs_attention' }]]);
    await createRunLedger(db).markNeedsAttention({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 3, reason: 'Bearer secret stalled',
    });
    const { text, params } = db.calls[0];
    expect(text).toMatch(/lease_token = NULL/);
    expect(text).toMatch(/locked_until = NULL/);
    expect(text).toMatch(/lease_token = \$2::uuid/);
    expect(text).toMatch(/lease_generation = \$3::integer/);
    expect(text).toMatch(/version = \$4::integer/);
    expect(params[4]).toBe('Bearer [redacted] stalled');
  });

  test('advanceStep records the server-assigned request number with COALESCE and validates its shape', async () => {
    const db = recordingDb([[{ run_id: RUN_ID }]]);
    const ledger = createRunLedger(db);
    await ledger.advanceStep({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 2,
      nextStep: 'correct_meeting_date', nextStepIndex: 2, status: 'creating', destinationRequestNumber: 1000340,
    });
    expect(db.calls[0].text).toMatch(/destination_request_number = COALESCE\(\$8::text, destination_request_number\)/);
    expect(db.calls[0].params[7]).toBe('1000340');
    await ledger.advanceStep({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 3, nextStep: 'x', nextStepIndex: 3,
    });
    expect(db.calls[1].params[7]).toBeNull();
    await expect(ledger.advanceStep({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 3, nextStep: 'x', nextStepIndex: 3,
      destinationRequestNumber: 'DROP TABLE',
    })).rejects.toMatchObject({ code: 'test_request_run_invalid_request_number' });
    expect(db.calls).toHaveLength(2);
  });
});
