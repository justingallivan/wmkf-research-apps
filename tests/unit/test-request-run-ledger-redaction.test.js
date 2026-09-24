/** @jest-environment node */
import { jest } from '@jest/globals';
import {
  createRunLedger,
  sanitizeErrorMessage,
  sanitizeLedgerJson,
} from '../../lib/services/test-requests/run-ledger.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';

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
  test('sanitizeErrorMessage strips bearer tokens, Authorization headers, SAS signatures and download links', () => {
    const text = 'Bearer abc.def Authorization: Basic xyz https://x.sharepoint.com/_layouts/15/download.aspx?a=1 ?sig=SECRET&sv=2020';
    const cleaned = sanitizeErrorMessage(text);
    expect(cleaned).not.toContain('abc.def');
    expect(cleaned).not.toContain('Basic xyz');
    expect(cleaned).not.toContain('download.aspx');
    expect(cleaned).not.toContain('SECRET');
    expect(cleaned.length).toBeLessThanOrEqual(500);
  });

  test('sanitizeLedgerJson redacts credential, link, body and purpose keys but keeps identities, hashes and sizes', () => {
    const scrubbed = sanitizeLedgerJson({
      id: '01ABC',
      graphItemId: '01ABC',
      contentHash: 'a'.repeat(64),
      size: 12,
      eTag: '"1"',
      '@microsoft.graph.downloadUrl': 'https://x/download?tempauth=zzz',
      akoya_purpose: 'confidential purpose text',
      createBody: { akoya_purpose: 'x' },
      nested: { authorization: 'Bearer q', requestIds: ['a'], note: 'Bearer leaked' },
      list: [{ token: 't' }],
    });
    expect(scrubbed).toEqual({
      id: '01ABC',
      graphItemId: '01ABC',
      contentHash: 'a'.repeat(64),
      size: 12,
      eTag: '"1"',
      '@microsoft.graph.downloadUrl': '[redacted]',
      akoya_purpose: '[redacted]',
      createBody: '[redacted]',
      nested: { authorization: '[redacted]', requestIds: ['a'], note: 'Bearer [redacted]' },
      list: [{ token: '[redacted]' }],
    });
  });

  test('every JSONB write passes through the scrubber', async () => {
    const runRow = { run_id: RUN_ID, lease_token: TOKEN, lease_generation: 1, lease_live: true, version: 2 };
    const db = recordingDb([
      [runRow], [{ next_sequence: 1 }], [{ resource_id: 1 }], // journalPlannedResource
      [runRow], [{ resource_id: 1 }], // recordResourceReadback
    ]);
    const ledger = createRunLedger(db);
    await ledger.journalPlannedResource({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint',
      plannedIdentity: { filename: 'a.pdf', downloadUrl: 'https://leak' },
      sourceProvenance: { graphItemId: 'x', akoya_purpose: 'text' },
    });
    await ledger.recordResourceReadback({
      resourceId: 1, runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, responseStatus: 201,
      readback: { id: 'x', body: 'huge', eTag: '"2"' }, outcome: 'verified',
    });
    const inserted = db.calls.find((c) => c.text.includes('INSERT INTO test_request_run_resources'));
    expect(inserted.params[5]).toBe(JSON.stringify({ filename: 'a.pdf', downloadUrl: '[redacted]' }));
    expect(inserted.params[6]).toBe(JSON.stringify({ graphItemId: 'x', akoya_purpose: '[redacted]' }));
    const readback = db.calls.find((c) => c.text.includes('readback = $4::jsonb'));
    expect(readback.params[3]).toBe(JSON.stringify({ id: 'x', body: '[redacted]', eTag: '"2"' }));
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
